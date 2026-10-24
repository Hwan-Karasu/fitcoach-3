import { openIsolatedSqliteConnection, type NativeSqliteDatabase } from "../../../../shared/db/IsolatedSqliteConnection.ts";
import type { SqliteConnectionPort } from "../../../../shared/db/SqlitePort.ts";
import type { LegacyClientsSource, LegacySourceRow } from "../../../../shared/migration/LegacyProfileSources.ts";
import { legacyIdentityContextJson, type CandidateIdentityContext, type LegacyIdentityStageBinding } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import { runLegacyWritePlan, type LegacyClientCheckpoint } from "../../../../shared/migration/LegacyWritePlan.ts";
import { projectLegacyClientIdentities } from "../../domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards, type ClientCardFields } from "../../domain/legacy-import/LegacyClientCardProjection.ts";
import { legacyCreateIdentityPlan, legacyInspectIdentityPlan, legacyLoadClientIdsPlan, legacyReserveClientIdsPlan, legacyStageClientIdentitiesPlan } from "./LegacyClientStagePlan.ts";

/** Internal R04 candidate only. open must create independent handles to one private
 * staging file, never the source, inspection copy, or active application database.
 * No file routing or cutover. Other owners are still required before finalization.
 */
export async function prepareLegacyClientStaging(open: () => Promise<NativeSqliteDatabase>, context: CandidateIdentityContext, createdAt: string) {
  const captured = Object.freeze({ ...context });
  const contextJson = JSON.stringify([legacyIdentityContextJson(captured), "CLIENT_IDENTITY_REHEARSAL_V1", createdAt]);
  if (!isExplicitTimestamp(createdAt)) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  const binding: LegacyIdentityStageBinding = Object.freeze({ context: captured, createdAt, contextJson,
    expectedObjects: Object.freeze({ r04_candidate_identity: "table", r04_candidate_ids: "table", workspaces: "table", clients: "table" }) });

  async function connection<Result>(task: (db: SqliteConnectionPort) => Promise<Result>): Promise<Result> {
    let db: SqliteConnectionPort | undefined, result: Result | undefined, failure: Error | undefined;
    try {
      // Reject an unrelated database before configure() can enable WAL or start a write.
      db = await openIsolatedSqliteConnection(open, (reader) => runLegacyWritePlan(reader, legacyInspectIdentityPlan(binding)));
      result = await task(db);
    } catch (error) { failure = safe(error); }
    finally {
      if (db) try { await db.close(); } catch { failure ??= new Error("R04_ID_LEDGER_STAGE_CLOSE_FAILED"); }
    }
    if (failure) throw failure;
    return result!;
  }
  await connection((db) => db.exclusive(async (tx) => {
    if ((await runLegacyWritePlan(tx, legacyInspectIdentityPlan(binding))) === "new") await runLegacyWritePlan(tx, legacyCreateIdentityPlan(binding));
    await runLegacyWritePlan(tx, legacyLoadClientIdsPlan(binding));
  }));

  return {
    finalizable: false as const,
    async reserveClientIds(keys: readonly string[], allocate: () => string) {
      const capturedKeys = [...keys];
      return connection((db) => db.exclusive((tx) => runLegacyWritePlan(tx, legacyReserveClientIdsPlan(binding, capturedKeys, allocate))));
    },
    async loadClientIds() { return connection((db) => db.exclusive((tx) => runLegacyWritePlan(tx, legacyLoadClientIdsPlan(binding)))); },
    async stageClients(source: LegacyClientsSource, allocate: () => string, checkpoint: (phase: Exclude<LegacyClientCheckpoint, "after-clients">) => void = () => undefined) {
      // Capture and reproject raw SQL rows before the first await. Caller-derived
      // candidate fields never authorize the values written to the staging file.
      if (source.accountScope !== captured.accountScope) throw new Error("R04_ID_LEDGER_CLIENT_SCOPE_MISMATCH");
      const snapshot = { accountScope: source.accountScope, rows: source.rows.map(captureRow) };
      const identities = projectLegacyClientIdentities(snapshot), cards = projectLegacyClientCards(snapshot, identities);
      const fields = new Map<string, ClientCardFields>(), payloads = new Map<string, string>();
      for (const card of cards) {
        if (card.fields === null || card.issues.length > 0) throw new Error("R04_ID_LEDGER_CLIENT_CARD_BLOCKED");
        fields.set(card.identity.sourceIdentityKey, card.fields); payloads.set(card.identity.sourceIdentityKey, JSON.stringify(card.raw));
      }
      return connection((db) => db.exclusive(async (tx) => {
        const result = await runLegacyWritePlan(tx, legacyStageClientIdentitiesPlan(binding, identities, allocate, fields, payloads), (phase) => {
          if (phase !== "after-clients") checkpoint(phase);
        });
        return { ...result, finalizable: false as const, ids: await runLegacyWritePlan(tx, legacyLoadClientIdsPlan(binding)) };
      }));
    },
  };
}

function captureRow(row: LegacySourceRow): LegacySourceRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value instanceof Uint8Array) return [key, new Uint8Array(value)];
    if (value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return [key, value];
    throw new Error("R04_ID_LEDGER_CLIENT_PAYLOAD_INVALID");
  }));
}
function safe(error: unknown): Error {
  return new Error(error instanceof Error && /^R04_ID_LEDGER_[A-Z_]+$/u.test(error.message) ? error.message : "R04_ID_LEDGER_WRITE_FAILED");
}
