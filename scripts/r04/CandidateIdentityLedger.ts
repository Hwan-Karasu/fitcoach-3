import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";

export interface CandidateIdentityContext {
  readonly sourceSha256: string;
  readonly accountScope: string;
  readonly sourceWorkspaceId: string;
  readonly targetWorkspaceId: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const workspace = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/u;
function contextJson(context: CandidateIdentityContext): string {
  if (!/^[0-9a-f]{64}$/u.test(context.sourceSha256) || !context.accountScope.trim()
    || !context.sourceWorkspaceId.trim() || !workspace.test(context.targetWorkspaceId)) {
    throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  }
  return JSON.stringify([1, context.sourceSha256, context.accountScope, context.sourceWorkspaceId, context.targetWorkspaceId]);
}
function validateClientKey(key: string, scope: string): void {
  let parts: unknown;
  try { parts = JSON.parse(key) as unknown; } catch { throw new Error("R04_ID_LEDGER_SOURCE_KEY_INVALID"); }
  if (!Array.isArray(parts) || parts.length !== 2 || parts[0] !== scope
    || typeof parts[1] !== "string" || !parts[1].trim() || JSON.stringify(parts) !== key) {
    throw new Error("R04_ID_LEDGER_SOURCE_KEY_INVALID");
  }
}

/** R04 isolated synthetic staging contract. Never attach this schema to a source or runtime DB. */
export function prepareCandidateIdentityLedger(db: DatabaseSync, context: CandidateIdentityContext) {
  // Snapshot caller input so a later caller mutation cannot change the ledger's binding.
  const binding = { ...context }, expectedContext = contextJson(binding);
  const workspaceKey = JSON.stringify([binding.accountScope, binding.sourceWorkspaceId]);
  function inspect(): "new" | "owned" {
    const objects = db.prepare("SELECT type,name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_' ORDER BY name").all();
    if (objects.length === 0) return "new";
    if (objects.length !== 2 || objects.some((row) => row.type !== "table"
      || row.name !== "r04_candidate_identity" && row.name !== "r04_candidate_ids")) {
      throw new Error("R04_ID_LEDGER_FOREIGN_DATABASE");
    }
    const identities = db.prepare("SELECT id,context_json FROM r04_candidate_identity").all();
    if (identities.length !== 1 || identities[0]?.id !== 1 || identities[0]?.context_json !== expectedContext) {
      throw new Error("R04_ID_LEDGER_CONTEXT_MISMATCH");
    }
    const maps = db.prepare("SELECT kind,source_key,target_id FROM r04_candidate_ids").all();
    const targets = new Set<string>(), keys = new Set<string>();
    let workspaceRows = 0;
    for (const row of maps) {
      if (typeof row.source_key !== "string" || typeof row.target_id !== "string") throw new Error("R04_ID_LEDGER_CORRUPT");
      if (row.kind === "WORKSPACE") {
        workspaceRows += 1;
        if (row.source_key !== workspaceKey || row.target_id !== binding.targetWorkspaceId) throw new Error("R04_ID_LEDGER_CORRUPT");
      } else if (row.kind === "CLIENT") {
        validateClientKey(row.source_key, binding.accountScope);
        if (!uuid.test(row.target_id) || targets.has(row.target_id) || keys.has(row.source_key)) throw new Error("R04_ID_LEDGER_CORRUPT");
        targets.add(row.target_id); keys.add(row.source_key);
      } else throw new Error("R04_ID_LEDGER_CORRUPT");
    }
    if (workspaceRows !== 1) throw new Error("R04_ID_LEDGER_CORRUPT");
    return "owned";
  }
  function transaction<T>(run: () => T): T {
    if (db.isTransaction) throw new Error("R04_ID_LEDGER_TRANSACTION_REQUIRED_EXCLUSIVE");
    db.exec("BEGIN IMMEDIATE");
    try { const result = run(); db.exec("COMMIT"); return result; }
    catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (error instanceof Error && /^R04_ID_LEDGER_[A-Z_]+$/u.test(error.message)) throw error;
      throw new Error("R04_ID_LEDGER_WRITE_FAILED", { cause: error });
    }
  }
  // Inspect before any mutation, then inspect again under the writer lock.
  inspect();
  transaction(() => {
    if (inspect() === "owned") return;
    db.exec(`CREATE TABLE r04_candidate_identity(id INTEGER PRIMARY KEY CHECK(id=1),context_json TEXT NOT NULL);
      CREATE TABLE r04_candidate_ids(kind TEXT NOT NULL CHECK(kind IN ('WORKSPACE','CLIENT')),
        source_key TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(kind,source_key),UNIQUE(kind,target_id));`);
    db.prepare("INSERT INTO r04_candidate_identity VALUES(1,?)").run(expectedContext);
    db.prepare("INSERT INTO r04_candidate_ids VALUES('WORKSPACE',?,?)").run(workspaceKey, binding.targetWorkspaceId);
  });
  function reserveClientIds(sourceKeys: readonly string[], allocate: () => string = randomUUID): ReadonlyMap<string, string> {
    const unique = new Set<string>();
    for (const key of sourceKeys) {
      validateClientKey(key, binding.accountScope);
      if (unique.has(key)) throw new Error("R04_ID_LEDGER_DUPLICATE_SOURCE_KEY");
      unique.add(key);
    }
    return transaction(() => {
      if (inspect() !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
      const result = new Map<string, string>();
      for (const key of [...unique].sort()) {
        const existing = db.prepare("SELECT target_id FROM r04_candidate_ids WHERE kind='CLIENT' AND source_key=?").get(key);
        if (existing) { result.set(key, String(existing.target_id)); continue; }
        const target = allocate();
        if (!uuid.test(target)) throw new Error("R04_ID_LEDGER_INVALID_TARGET_ID");
        if (db.prepare("SELECT 1 FROM r04_candidate_ids WHERE kind='CLIENT' AND target_id=?").get(target)) throw new Error("R04_ID_LEDGER_TARGET_COLLISION");
        db.prepare("INSERT INTO r04_candidate_ids VALUES('CLIENT',?,?)").run(key, target);
        result.set(key, target);
      }
      return result;
    });
  }
  function loadClientDraftIds(): ClientDraftIdMap {
    if (inspect() !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
    const rows = db.prepare("SELECT source_key,target_id FROM r04_candidate_ids WHERE kind='CLIENT' ORDER BY source_key").all();
    return { workspaces: new Map([[workspaceKey, binding.targetWorkspaceId]]),
      clients: new Map(rows.map((row) => [String(row.source_key), String(row.target_id)])) };
  }
  return { reserveClientIds, loadClientDraftIds };
}
