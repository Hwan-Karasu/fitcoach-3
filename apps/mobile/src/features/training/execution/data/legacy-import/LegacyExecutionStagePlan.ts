import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { legacyStageQuery as query, legacyStageRun as run, type LegacyWritePlan, type LegacyExecutionCheckpoint } from "../../../../../shared/migration/LegacyWritePlan.ts";
import type { LegacyPlanMappingsReader } from "../../../../../shared/migration/LegacyPlanMappings.ts";
import type { CandidateIdentityContext } from "../../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacyStageClient, LegacyStageClientIds } from "../../../../../shared/migration/LegacyStageExtension.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "../../../../../shared/migration/LegacyPlanSources.ts";
import { EXECUTION_SOURCE_TABLES, type LegacyExecutionSource } from "../../../../../shared/migration/LegacyExecutionSources.ts";
import { composeLegacyExecutionOccurrences } from "../../domain/legacy-import/LegacyExecutionOccurrences.ts";
import { composeLegacyExecutions, EXECUTION_TARGET_TABLES, type ExecutionIdentityKind } from "../../domain/legacy-import/LegacyExecutionProjection.ts";
import { isExplicitTimestamp } from "../../../../../shared/migration/LegacyValues.ts";
import { composeLegacyWorkoutContexts } from "../../domain/legacy-import/LegacyWorkoutContexts.ts";

function fail(code: string): never { throw new Error(`R04_ID_LEDGER_EXECUTION_${code}`); }
const digest = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("PAYLOAD_INVALID");
}
export const executionRehearsalObjects: Readonly<Record<string, string>> = Object.fromEntries([...EXECUTION_TARGET_TABLES,
  "r04_execution_ids", "r04_execution_receipt"].map((t) => [t, "table"]));
/** Proposed normalized import owner, confined to R04. D01 cannot represent
 * unknown/derived dates, all legacy metrics or DROP+failure yet. No production DDL. */
export function* legacyExecutionSchemaPlan(): LegacyWritePlan<void> {
  yield run("CREATE TABLE r04_execution_ids(kind TEXT NOT NULL CHECK(kind IN ('FACT','SESSION','CONTEXT')),source_key TEXT NOT NULL,\n      target_id TEXT NOT NULL UNIQUE,PRIMARY KEY(kind,source_key))");
  yield run("CREATE TABLE r04_execution_sessions(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,\n      first_known_date TEXT,last_known_date TEXT,undated_facts INTEGER NOT NULL CHECK(undated_facts>=0),\n      working_facts INTEGER NOT NULL CHECK(working_facts>=0),source_workouts_json TEXT NOT NULL CHECK(json_valid(source_workouts_json)),created_at TEXT NOT NULL,\n      UNIQUE(id,workspace_id,client_id),FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT)");
  yield run("CREATE TABLE r04_execution_facts(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,session_id TEXT NOT NULL,\n      source_identity_key TEXT NOT NULL UNIQUE,source_fact_id TEXT,exercise_id TEXT NOT NULL,snapshot_name TEXT,snapshot_name_basis TEXT NOT NULL,\n      names_json TEXT NOT NULL CHECK(json_valid(names_json)),set_type TEXT NOT NULL CHECK(set_type IN ('NORMAL','WARMUP','DROP','FAILURE')),\n      effort_outcome TEXT NOT NULL CHECK(effort_outcome IN ('normal','failure')),reps INTEGER NOT NULL CHECK(reps>=1),load_grams INTEGER NOT NULL CHECK(load_grams>=0),\n      rpe INTEGER CHECK(rpe IS NULL OR rpe BETWEEN 1 AND 10),date_precision TEXT NOT NULL CHECK(date_precision IN ('INSTANT','LOCAL_DATETIME','DAY','DERIVED','UNKNOWN')),\n      actual_date TEXT,actual_timestamp TEXT,estimated_date TEXT,imported_at TEXT,\n      completion_basis_json TEXT NOT NULL CHECK(json_valid(completion_basis_json)),compatibility_json TEXT NOT NULL CHECK(json_valid(compatibility_json)),\n      revision INTEGER NOT NULL CHECK(revision=1),created_at TEXT NOT NULL,UNIQUE(id,workspace_id),UNIQUE(id,workspace_id,client_id),\n      CHECK(CASE date_precision WHEN 'UNKNOWN' THEN actual_date IS NULL AND actual_timestamp IS NULL AND estimated_date IS NULL\n        WHEN 'DERIVED' THEN actual_date IS NULL AND actual_timestamp IS NULL AND estimated_date IS NOT NULL\n        WHEN 'DAY' THEN actual_date IS NOT NULL AND actual_timestamp IS NULL AND estimated_date IS NULL\n        ELSE actual_date IS NOT NULL AND actual_timestamp IS NOT NULL AND estimated_date IS NULL END),\n      FOREIGN KEY(session_id,workspace_id,client_id) REFERENCES r04_execution_sessions(id,workspace_id,client_id) ON DELETE RESTRICT,\n      FOREIGN KEY(exercise_id,workspace_id) REFERENCES r04_exercise_registry(id,workspace_id) ON DELETE RESTRICT)");
  yield run("CREATE TABLE r04_execution_segments(workspace_id TEXT NOT NULL,fact_id TEXT NOT NULL,position INTEGER NOT NULL CHECK(position>=0),\n      reps INTEGER NOT NULL CHECK(reps>=1),load_grams INTEGER NOT NULL CHECK(load_grams>=0),PRIMARY KEY(workspace_id,fact_id,position),\n      FOREIGN KEY(fact_id,workspace_id) REFERENCES r04_execution_facts(id,workspace_id) ON DELETE RESTRICT)");
  yield run("CREATE TABLE r04_execution_representations(source_key TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,\n      fact_id TEXT,session_id TEXT,source_kind TEXT NOT NULL CHECK(source_kind IN ('CURRENT','SESSION','HISTORY','ARCHIVE','SNAPSHOT')),\n      disposition TEXT NOT NULL CHECK(disposition IN ('PERFORMED','UNCONFIRMED','DELETED','TEMPLATE','OWNERSHIP_REVIEW')),\n      source_json TEXT NOT NULL CHECK(json_valid(source_json)),context_json TEXT NOT NULL CHECK(json_valid(context_json)),date_json TEXT NOT NULL CHECK(json_valid(date_json)),\n      FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT,\n      FOREIGN KEY(fact_id,workspace_id,client_id) REFERENCES r04_execution_facts(id,workspace_id,client_id) ON DELETE RESTRICT,\n      FOREIGN KEY(session_id,workspace_id,client_id) REFERENCES r04_execution_sessions(id,workspace_id,client_id) ON DELETE RESTRICT)");
  yield run("CREATE TABLE r04_execution_contexts(id TEXT PRIMARY KEY NOT NULL,source_key TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,\n      session_id TEXT,source_kind TEXT NOT NULL CHECK(source_kind IN ('CURRENT','ARCHIVE','SESSION','SNAPSHOT')),\n      lifecycle TEXT NOT NULL CHECK(lifecycle IN ('ACTIVE','DELETED','TEMPLATE','OWNERSHIP_REVIEW')),source_workout_key TEXT NOT NULL,\n      plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),source_json TEXT NOT NULL CHECK(json_valid(source_json)),\n      diary_json TEXT NOT NULL CHECK(json_valid(diary_json)),state_json TEXT NOT NULL CHECK(json_valid(state_json)),\n      FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT,\n      FOREIGN KEY(session_id,workspace_id,client_id) REFERENCES r04_execution_sessions(id,workspace_id,client_id) ON DELETE RESTRICT)");
  yield run("CREATE TABLE r04_execution_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),target_json TEXT NOT NULL CHECK(json_valid(target_json)))");
}
export type { LegacyExecutionCheckpoint as ExecutionStageCheckpoint } from "../../../../../shared/migration/LegacyWritePlan.ts";
export interface LegacyExecutionStageResult {
  readonly performedFacts: number; readonly canonicalSessions: number; readonly executionContexts: number;
  readonly retainedExecutionRepresentations: number; readonly incompatibleExecutionFacts: number;
  readonly executionRepresentations: number; readonly finalizable: false;
}
/** The caller owns the transaction; mappings are verified by the plans owner's port. */
export function* legacyExecutionStagePlan(context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyStageClient[], ids: LegacyStageClientIds, plans: LegacyPlansSource, source: LegacyExecutionSource,
  allocate: () => string, readPlanMappings: LegacyPlanMappingsReader): LegacyWritePlan<LegacyExecutionStageResult> {
  if (!isExplicitTimestamp(importedAt)) return fail("TRANSACTION_OR_CONTEXT_INVALID");
  if (source.accountScope !== context.accountScope || Object.keys(source.tables).length !== EXECUTION_SOURCE_TABLES.length
    || EXECUTION_SOURCE_TABLES.some((t) => source.tables[t] !== null && !Array.isArray(source.tables[t])) || source.tables.training_exercise_history === null) return fail("SOURCE_SHAPE_INVALID");
  const observed = EXECUTION_SOURCE_TABLES.slice(0, 3).filter((t) => source.tables[t] !== null).length;
  if (observed !== 0 && observed !== 3) return fail("SOURCE_SHAPE_INVALID");
  const planSource = canonical({ accountScope: plans.accountScope, tables: Object.fromEntries(PLAN_SOURCE_TABLES.map((t) => [t,
    plans.tables[t] === null ? null : plans.tables[t].map(canonical).sort(compare)])) });
  if ((yield query("SELECT source_json FROM r04_plan_receipt WHERE id=1"))[0]?.source_json !== planSource) return fail("PLAN_SOURCE_MISMATCH");
  const clients = new Map<string, string>();
  for (const card of cards) {
    const id = ids.clients.get(card.identity.sourceIdentityKey);
    if (!id || card.identity.accountScope !== context.accountScope || card.identity.sourceWorkspaceId !== context.sourceWorkspaceId) return fail("OWNER_INVALID");
    clients.set(card.identity.sourceClientId, id);
  }
  const catalog = new Map((yield query("SELECT source_catalog_id,id FROM r04_exercise_registry WHERE workspace_id=?", [context.targetWorkspaceId]))
    .map((r) => [r.source_catalog_id as string, r.id as string]));
  const historyLinks = new Map((yield query("SELECT source_row_id,source_json FROM r04_exercise_links WHERE source_table='training_exercise_history'"))
    .map((r) => [r.source_row_id as string, JSON.parse(r.source_json as string) as Record<string, unknown>]));
  if (historyLinks.size !== source.tables.training_exercise_history.length) return fail("HISTORY_SOURCE_MISMATCH");
  for (const row of source.tables.training_exercise_history) {
    const linked = historyLinks.get(row.id as string);
    if (!linked || Object.keys(row).some((k) => canonical(row[k]) !== canonical(linked[k]))) return fail("HISTORY_SOURCE_MISMATCH");
  }
  const aliases = yield* readPlanMappings();
  const occurrences = composeLegacyExecutionOccurrences(context, plans, source, clients, catalog, aliases);
  const contexts = composeLegacyWorkoutContexts(context, plans, source, clients, aliases);
  const cache = new Map<string, string>(), used = new Set<string>(), targets = new Set<string>();
  const pending: { kind: ExecutionIdentityKind; sourceKey: string; id: string }[] = [];
  for (const row of (yield query("SELECT * FROM r04_execution_ids"))) {
    const parts = JSON.parse(row.source_key as string) as unknown;
    if (!['FACT', 'SESSION', 'CONTEXT'].includes(row.kind as string) || !Array.isArray(parts) || parts[0] !== context.accountScope
      || canonical(parts) !== row.source_key || typeof row.target_id !== "string" || !uuid.test(row.target_id) || targets.has(row.target_id)) return fail("IDENTITY_INVALID");
    cache.set(JSON.stringify([row.kind, row.source_key]), row.target_id); targets.add(row.target_id);
  }
  function identity(kind: ExecutionIdentityKind, sourceKey: string) {
    const k = JSON.stringify([kind, sourceKey]); used.add(k); const existing = cache.get(k); if (existing) return existing;
    const id = allocate();
    if (!uuid.test(id) || targets.has(id)) return fail("IDENTITY_COLLISION");
    pending.push({ kind, sourceKey, id }); cache.set(k, id); targets.add(id); return id;
  }
  const projected = composeLegacyExecutions(context, importedAt, occurrences, clients, identity, contexts);
  for (const { kind, sourceKey, id } of pending) {
    if ((yield query("SELECT 1 FROM r04_candidate_ids WHERE target_id=?", [id])).length
      || (yield query("SELECT 1 FROM r04_work_ids WHERE target_id=?", [id])).length
      || (yield query("SELECT 1 FROM r04_plan_ids WHERE target_id=?", [id])).length) return fail("IDENTITY_COLLISION");
    yield run("INSERT INTO r04_execution_ids VALUES(?,?,?)", [kind, sourceKey, id]);
  }
  if (used.size !== cache.size) return fail("IDENTITY_INVALID");
  yield { kind: "checkpoint", phase: "after-execution-ids" };

  const sourceJson = canonical({ plansSource: planSource, execution: { accountScope: source.accountScope,
    tables: Object.fromEntries(EXECUTION_SOURCE_TABLES.map((t) => [t, source.tables[t] === null ? null : source.tables[t].map(canonical).sort(compare)])) } });
  const identities = (yield query("SELECT * FROM r04_execution_ids")).map((r) => canonical({ ...r })).sort(compare);
  const tables = EXECUTION_TARGET_TABLES.map((name) => ({ name, rows: projected.tables[name].map((r) => canonical({ ...r,
    ...(name === "r04_execution_representations" ? { source_json: canonical(JSON.parse(r.source_json as string) as unknown),
      context_json: canonical(JSON.parse(r.context_json as string) as unknown), date_json: canonical(JSON.parse(r.date_json as string) as unknown) } : {}),
    ...(name === "r04_execution_contexts" ? Object.fromEntries(["source_json", "diary_json", "state_json", "plan_json"]
      .map((column) => [column, canonical(JSON.parse(r[column] as string) as unknown)])) : {}) })).sort(compare) }));
  const targetJson = canonical({ snapshotProjectionVersion: 1, contextProjectionVersion: 1, editableProjectionVersion: 1, tables, identities, sourceSha256: digest(sourceJson) });
  const receipts = (yield query("SELECT * FROM r04_execution_receipt"));
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_json !== sourceJson || receipts[0]?.target_json !== targetJson)) return fail("PARITY_MISMATCH");
  const stages: readonly LegacyExecutionCheckpoint[] = ["after-execution-sessions", "after-execution-facts", "after-execution-segments", "after-execution-representations", "after-execution-contexts"];
  for (const [i, table] of tables.entries()) {
    if (!receipts.length) {
      if ((yield query(`SELECT count(*) AS n FROM ${table.name}`))[0]?.n !== 0) return fail("FOREIGN_TARGET");
      for (const encoded of table.rows) {
        const row = JSON.parse(encoded) as Record<string, string | number | null>, cols = Object.keys(row);
        yield run(`INSERT INTO ${table.name}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, Object.values(row));
      }
    }
    if (canonical((yield query(`SELECT * FROM ${table.name}`)).map((r) => canonical({ ...r })).sort(compare)) !== canonical(table.rows)) return fail("PARITY_MISMATCH");
    yield { kind: "checkpoint", phase: stages[i]! };
  }
  if (!receipts.length) yield run("INSERT INTO r04_execution_receipt VALUES(1,?,?)", [sourceJson, targetJson]);
  yield { kind: "checkpoint", phase: "after-execution-receipt" };
  yield* legacyLoadExecutionFactsPlan();
  return { performedFacts: projected.performedFacts, canonicalSessions: projected.canonicalSessions, executionContexts: projected.executionContexts, retainedExecutionRepresentations: projected.retainedRepresentations,
    incompatibleExecutionFacts: projected.incompatibleFacts, executionRepresentations: occurrences.length, finalizable: false as const };
}

export function* legacyLoadExecutionFactsPlan(): LegacyWritePlan<readonly Readonly<Record<string, unknown>>[]> {
  const receipts = (yield query("SELECT * FROM r04_execution_receipt")); if (receipts.length !== 1 || receipts[0]?.id !== 1) return fail("NOT_STAGED");
  let parsed: unknown; try { parsed = JSON.parse(receipts[0].target_json as string) as unknown; } catch { return fail("PARITY_MISMATCH"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("PARITY_MISMATCH");
  const saved = parsed as Record<string, unknown>;
  if (saved.snapshotProjectionVersion !== 1 || saved.contextProjectionVersion !== 1 || saved.editableProjectionVersion !== 1 || !Array.isArray(saved.tables) || saved.tables.length !== EXECUTION_TARGET_TABLES.length || !Array.isArray(saved.identities)
    || saved.sourceSha256 !== digest(receipts[0].source_json as string)) return fail("PARITY_MISMATCH");
  const seen = new Set<string>();
  for (const item of saved.tables) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("PARITY_MISMATCH");
    const table = item as Record<string, unknown>;
    if (typeof table.name !== "string" || !EXECUTION_TARGET_TABLES.includes(table.name as typeof EXECUTION_TARGET_TABLES[number]) || seen.has(table.name)
      || !Array.isArray(table.rows) || table.rows.some((r: unknown) => typeof r !== "string")) return fail("PARITY_MISMATCH"); seen.add(table.name);
    if (canonical((yield query(`SELECT * FROM ${table.name}`)).map((r) => canonical({ ...r })).sort(compare)) !== canonical(table.rows)) return fail("PARITY_MISMATCH");
  }
  if (canonical((yield query("SELECT * FROM r04_execution_ids")).map((r) => canonical({ ...r })).sort(compare)) !== canonical(saved.identities)) return fail("PARITY_MISMATCH");
  return yield query("SELECT * FROM r04_execution_facts ORDER BY source_identity_key");
}
