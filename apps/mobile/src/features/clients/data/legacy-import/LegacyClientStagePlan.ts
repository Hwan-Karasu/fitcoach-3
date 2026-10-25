import { clientsBaseline } from "../ClientsBaseline.generated.ts";
import { projectClientIdentityDrafts, type ClientDraftIdMap } from "../../domain/legacy-import/ProjectClientIdentityDraft.ts";
import type { LegacyClientIdentityCandidate } from "../../domain/legacy-import/LegacyClientIdentity.ts";
import type { ClientCardFields } from "../../domain/legacy-import/LegacyClientCardProjection.ts";
import { LEGACY_STAGE_UUID, validateLegacyClientKey, type LegacyIdentityStageBinding } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import { legacyStageQuery as query, legacyStageRun as run, type LegacyWritePlan, type LegacyStageRow } from "../../../../shared/migration/LegacyWritePlan.ts";

function* one(sql: string, bindings: readonly (string | number | null)[] = []): LegacyWritePlan<LegacyStageRow | undefined> {
  return (yield query(sql, bindings))[0];
}
const workspaceKey = (binding: LegacyIdentityStageBinding) => JSON.stringify([binding.context.accountScope, binding.context.sourceWorkspaceId]);

export function* legacyClientWorkspaceIndexPlan(): LegacyWritePlan<void> {
  const index = clientsBaseline[0]!.statements.find((sql) => sql.startsWith("CREATE UNIQUE INDEX clients_id_workspace "));
  if (!index) throw new Error("R04_ID_LEDGER_PROFILE_SCHEMA_UNAVAILABLE");
  yield run(index);
}

/** Read before mutating an existing file; repeat under the writer lock. */
export function* legacyInspectIdentityPlan(binding: LegacyIdentityStageBinding): LegacyWritePlan<"new" | "owned"> {
  const { context, expectedObjects, createdAt } = binding;
  const objects = yield query("SELECT type,name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_' ORDER BY name");
  if (objects.length === 0) return "new";
  if (objects.length !== Object.keys(expectedObjects).length || objects.some((row) => !Object.hasOwn(expectedObjects, String(row.name)) || row.type !== expectedObjects[String(row.name)])) throw new Error("R04_ID_LEDGER_FOREIGN_DATABASE");
  const identities = yield query("SELECT id,context_json FROM r04_candidate_identity");
  if (identities.length !== 1 || identities[0]?.id !== 1 || identities[0]?.context_json !== binding.contextJson) throw new Error("R04_ID_LEDGER_CONTEXT_MISMATCH");
  const maps = yield query("SELECT kind,source_key,target_id FROM r04_candidate_ids");
  const targets = new Set<string>(), keys = new Set<string>(); let workspaceRows = 0;
  for (const row of maps) {
    if (typeof row.source_key !== "string" || typeof row.target_id !== "string") throw new Error("R04_ID_LEDGER_CORRUPT");
    if (row.kind === "WORKSPACE") {
      workspaceRows++;
      if (row.source_key !== workspaceKey(binding) || row.target_id !== context.targetWorkspaceId) throw new Error("R04_ID_LEDGER_CORRUPT");
    } else if (row.kind === "CLIENT") {
      if (context.sourceWorkspaceId === null) throw new Error("R04_ID_LEDGER_CORRUPT");
      validateLegacyClientKey(row.source_key, context.accountScope);
      if (!LEGACY_STAGE_UUID.test(row.target_id) || targets.has(row.target_id) || keys.has(row.source_key)) throw new Error("R04_ID_LEDGER_CORRUPT");
      targets.add(row.target_id); keys.add(row.source_key);
    } else throw new Error("R04_ID_LEDGER_CORRUPT");
  }
  if (workspaceRows !== 1) throw new Error("R04_ID_LEDGER_CORRUPT");
  if (createdAt !== undefined) {
    const workspaces = yield query("SELECT id,created_at FROM workspaces");
    if (workspaces.length !== 1 || workspaces[0]?.id !== context.targetWorkspaceId || workspaces[0]?.created_at !== createdAt) throw new Error("R04_ID_LEDGER_CORRUPT");
    for (const client of yield query("SELECT id,workspace_id FROM clients")) {
      if (client.workspace_id !== context.targetWorkspaceId || !targets.has(String(client.id))) throw new Error("R04_ID_LEDGER_CORRUPT");
    }
  }
  return "owned";
}

/** Private R04 schema only; caller must have inspected a new file under BEGIN IMMEDIATE. */
export function* legacyCreateIdentityPlan(binding: LegacyIdentityStageBinding): LegacyWritePlan<void> {
  yield run("CREATE TABLE r04_candidate_identity(id INTEGER PRIMARY KEY CHECK(id=1),context_json TEXT NOT NULL)");
  yield run(`CREATE TABLE r04_candidate_ids(kind TEXT NOT NULL CHECK(kind IN ('WORKSPACE','CLIENT')),
    source_key TEXT NOT NULL,target_id TEXT NOT NULL,
    source_payload_json TEXT CHECK(source_payload_json IS NULL OR json_valid(source_payload_json)),
    PRIMARY KEY(kind,source_key),UNIQUE(kind,target_id))`);
  yield run("INSERT INTO r04_candidate_identity VALUES(1,?)", [binding.contextJson]);
  yield run("INSERT INTO r04_candidate_ids(kind,source_key,target_id) VALUES('WORKSPACE',?,?)", [workspaceKey(binding), binding.context.targetWorkspaceId]);
  if (binding.createdAt !== undefined) {
    for (const name of ["workspaces", "clients"]) {
      const sql = clientsBaseline[0]!.statements.find((statement) => statement.startsWith(`CREATE TABLE ${name} (`));
      if (!sql) throw new Error("R04_ID_LEDGER_CLIENT_SCHEMA_UNAVAILABLE");
      yield run(sql);
    }
    yield run("INSERT INTO workspaces(id,display_name,created_at) VALUES(?,?,?)", [binding.context.targetWorkspaceId, "R04 synthetic identity rehearsal", binding.createdAt]);
  }
}

export function* legacyReserveClientIdsPlan(binding: LegacyIdentityStageBinding, sourceKeys: readonly string[], allocate: () => string): LegacyWritePlan<ReadonlyMap<string, string>> {
  if (binding.context.sourceWorkspaceId === null && sourceKeys.length > 0) throw new Error("R04_ID_LEDGER_CLIENT_SCOPE_MISMATCH");
  const unique = new Set<string>();
  for (const key of sourceKeys) {
    validateLegacyClientKey(key, binding.context.accountScope);
    if (unique.has(key)) throw new Error("R04_ID_LEDGER_DUPLICATE_SOURCE_KEY");
    unique.add(key);
  }
  if ((yield* legacyInspectIdentityPlan(binding)) !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
  const result = new Map<string, string>();
  for (const key of [...unique].sort()) {
    const existing = yield* one("SELECT target_id FROM r04_candidate_ids WHERE kind='CLIENT' AND source_key=?", [key]);
    if (existing) { result.set(key, String(existing.target_id)); continue; }
    const target = allocate();
    if (!LEGACY_STAGE_UUID.test(target)) throw new Error("R04_ID_LEDGER_INVALID_TARGET_ID");
    if (yield* one("SELECT 1 FROM r04_candidate_ids WHERE kind='CLIENT' AND target_id=?", [target])) throw new Error("R04_ID_LEDGER_TARGET_COLLISION");
    yield run("INSERT INTO r04_candidate_ids(kind,source_key,target_id) VALUES('CLIENT',?,?)", [key, target]);
    result.set(key, target);
  }
  return result;
}

export function* legacyLoadClientIdsPlan(binding: LegacyIdentityStageBinding): LegacyWritePlan<ClientDraftIdMap> {
  if ((yield* legacyInspectIdentityPlan(binding)) !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
  const rows = yield query("SELECT source_key,target_id FROM r04_candidate_ids WHERE kind='CLIENT' ORDER BY source_key");
  return { workspaces: new Map([[workspaceKey(binding), binding.context.targetWorkspaceId]]), clients: new Map(rows.map((row) => [String(row.source_key), String(row.target_id)])) };
}

/** Same client/ID write and parity checks on Node and async SQLite; all owners share the transaction. */
export interface LegacyClientStageResult {
  readonly status: "identity-rehearsal-staged";
  readonly sourceRows: number;
  readonly targetRows: number;
  readonly insertedRows: number;
  readonly unchangedRows: number;
  readonly sourceWrites: 0;
}
export function* legacyStageClientIdentitiesPlan(binding: LegacyIdentityStageBinding, source: readonly LegacyClientIdentityCandidate[], allocate: () => string,
  cards?: ReadonlyMap<string, ClientCardFields>, sourcePayloads?: ReadonlyMap<string, string>): LegacyWritePlan<LegacyClientStageResult> {
  if (binding.createdAt === undefined) throw new Error("R04_ID_LEDGER_REHEARSAL_NOT_ENABLED");
  if ((yield* one("PRAGMA foreign_keys"))?.foreign_keys !== 1) throw new Error("R04_ID_LEDGER_FOREIGN_KEYS_DISABLED");
  if (source.some((row) => row.accountScope !== binding.context.accountScope || row.sourceWorkspaceId !== binding.context.sourceWorkspaceId)) throw new Error("R04_ID_LEDGER_CLIENT_SCOPE_MISMATCH");
  yield* legacyReserveClientIdsPlan(binding, source.map((row) => row.sourceIdentityKey), allocate);
  yield { kind: "checkpoint", phase: "after-ids" } as const;
  const projection = projectClientIdentityDrafts(source, yield* legacyLoadClientIdsPlan(binding), binding.context.targetWorkspaceId);
  if (projection.status !== "projected-draft") throw new Error("R04_ID_LEDGER_CLIENT_PROJECTION_BLOCKED");
  let inserted = 0, unchanged = 0;
  for (const client of projection.rows) {
    const payload = sourcePayloads?.get(client.sourceIdentityKey);
    if (sourcePayloads !== undefined && payload === undefined) throw new Error("R04_ID_LEDGER_CLIENT_CARD_MISSING");
    const savedPayload = (yield* one("SELECT source_payload_json FROM r04_candidate_ids WHERE kind='CLIENT' AND source_key=?", [client.sourceIdentityKey]))?.source_payload_json;
    if (savedPayload != null && savedPayload !== payload) throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
    const card = cards?.get(client.sourceIdentityKey);
    if (cards !== undefined && !card) throw new Error("R04_ID_LEDGER_CLIENT_CARD_MISSING");
    const expected = [client.id, client.workspaceId, client.displayName, client.lifecycle, 1, client.createdAt, client.updatedAt,
      client.lifecycle === "ARCHIVED" ? client.sourceArchivedAt : null, card?.birthDate ?? null, card?.heightCmX10 ?? null, card?.sex ?? null, card?.emoji ?? null];
    const columns = ["id", "workspace_id", "display_name", "lifecycle", "revision", "created_at", "updated_at", "archived_at", "birth_date", "height_cm_x10", "sex", "emoji"];
    const existing = yield* one("SELECT * FROM clients WHERE id=?", [client.id]);
    if (existing) {
      if (columns.some((column, index) => existing[column] !== expected[index]) || ["contact_phone", "contact_email"].some((column) => existing[column] !== null)) throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
      unchanged++;
    } else {
      yield run(`INSERT INTO clients(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, expected); inserted++;
    }
    const actual = yield* one(`SELECT ${columns.join(",")} FROM clients WHERE id=?`, [client.id]);
    if (!actual || columns.some((column, index) => actual[column] !== expected[index])) throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
    if (payload !== undefined && savedPayload === null) yield run("UPDATE r04_candidate_ids SET source_payload_json=? WHERE kind='CLIENT' AND source_key=?", [payload, client.sourceIdentityKey]);
    yield { kind: "checkpoint", phase: "after-client" } as const;
  }
  yield { kind: "checkpoint", phase: "after-clients" } as const;
  if ((yield* one("SELECT count(*) AS count FROM clients"))?.count !== projection.rows.length
    || (yield query("PRAGMA foreign_key_check")).length > 0 || (yield* one("PRAGMA integrity_check"))?.integrity_check !== "ok") throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
  yield { kind: "checkpoint", phase: "before-commit" } as const;
  return { status: "identity-rehearsal-staged" as const, sourceRows: source.length, targetRows: projection.rows.length,
    insertedRows: inserted, unchangedRows: unchanged, sourceWrites: 0 as const };
}
