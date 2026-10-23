import type { DatabaseSync } from "node:sqlite";
import { trainingPlansBaseline } from "../../apps/mobile/src/features/training/plans/data/TrainingPlansBaseline.generated.ts";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "./LegacyPlansSourceReader.ts";
import { composeLegacyPlans, PLAN_TARGET_TABLES, TEMPLATE_TARGET_TABLES, type ExercisePlanLink, type PlanIdentityKind, type PlanRow } from "./LegacyPlansProjection.ts";
import { composeLegacyArchivePlans } from "./LegacyArchivePlansProjection.ts";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const kinds: readonly PlanIdentityKind[] = ["PROGRAM", "MESOCYCLE", "LINEAGE", "WEEK", "WORKOUT", "EXERCISE", "SET", "SUPERSET", "TEMPLATE"];
function fail(code: string): never { throw new Error(`R04_ID_LEDGER_PLANS_${code}`); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("PAYLOAD_INVALID");
}
const baselineObjects = trainingPlansBaseline.flatMap((step) => step.statements).map((sql) => {
  const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER)\s+"?([a-z_]+)"?/u.exec(sql);
  if (!match) return fail("SCHEMA_UNAVAILABLE"); return [match[2]!, match[1]!.toLowerCase()];
});
/** These existing D01 definitions are created only inside an explicitly bound R04
 * rehearsal. No new production migration or source attachment. */
export const plansRehearsalObjects: Readonly<Record<string, string>> = Object.fromEntries([...baselineObjects,
  ...["r04_plan_ids", "r04_plan_source", "r04_plan_receipt"].map((name) => [name, "table"])]);
export function createPlansRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) return fail("TRANSACTION_REQUIRED");
  for (const step of trainingPlansBaseline) for (const sql of step.statements) db.exec(sql);
  db.exec(`CREATE TABLE r04_plan_ids(kind TEXT NOT NULL CHECK(kind IN ('PROGRAM','MESOCYCLE','LINEAGE','WEEK','WORKOUT','EXERCISE','SET','SUPERSET','TEMPLATE')),
      source_key TEXT NOT NULL,target_id TEXT NOT NULL UNIQUE,PRIMARY KEY(kind,source_key));
    CREATE TABLE r04_plan_source(source_key TEXT PRIMARY KEY NOT NULL,source_table TEXT NOT NULL,source_row_id TEXT NOT NULL,
      target_client_id TEXT,target_id TEXT,target_program_id TEXT,week_index INTEGER CHECK(week_index IS NULL OR week_index BETWEEN 1 AND 52),
      disposition TEXT NOT NULL,source_json TEXT NOT NULL CHECK(json_valid(source_json)));
    CREATE TABLE r04_plan_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),
      target_json TEXT NOT NULL CHECK(json_valid(target_json)));`);
}
export type PlanStageCheckpoint = "after-plan-ids" | "after-plan-rows" | "after-plan-source" | "after-plan-receipt" | "after-archive-plans";
export function stageLegacyPlansInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], clients: ClientDraftIdMap, source: LegacyPlansSource, allocate: () => string,
  checkpoint: (stage: PlanStageCheckpoint) => void, templatesEnabled = false, archivesEnabled = false) {
  if (!db.isTransaction) return fail("TRANSACTION_REQUIRED");
  const clientIds = new Map<string, string>();
  for (const card of cards) {
    const id = clients.clients.get(card.identity.sourceIdentityKey);
    if (!id || card.identity.accountScope !== context.accountScope || card.identity.sourceWorkspaceId !== context.sourceWorkspaceId) return fail("SCOPE_MISMATCH");
    clientIds.set(card.identity.sourceClientId, id);
  }
  const links = new Map<string, ExercisePlanLink>();
  for (const row of db.prepare("SELECT * FROM r04_exercise_links WHERE source_table='training_exercises'").all()) {
    let raw: unknown; try { raw = JSON.parse(row.source_json as string) as unknown; } catch { return fail("EXERCISE_LINK_MISMATCH"); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("EXERCISE_LINK_MISMATCH");
    links.set(row.source_key as string, { sourceKey: row.source_key as string, clientId: row.source_client_id as string,
      exerciseId: row.target_exercise_id as string, raw: raw as Readonly<Record<string, unknown>> });
  }
  if (!Array.isArray(source.tables.training_exercises) || source.tables.training_exercises.length !== links.size) return fail("EXERCISE_LINK_MISMATCH");
  const cache = new Map<string, { kind: PlanIdentityKind; sourceKey: string; id: string }>(); const used = new Set<string>(), targetIds = new Set<string>();
  for (const row of db.prepare("SELECT * FROM r04_plan_ids ORDER BY kind,source_key").all()) {
    let parts: unknown; try { parts = JSON.parse(row.source_key as string) as unknown; } catch { return fail("IDENTITY_MISMATCH"); }
    if (!kinds.includes(row.kind as PlanIdentityKind) || !Array.isArray(parts) || parts[0] !== context.accountScope || JSON.stringify(parts) !== row.source_key
      || typeof row.target_id !== "string" || !uuid.test(row.target_id) || targetIds.has(row.target_id)) return fail("IDENTITY_MISMATCH");
    cache.set(JSON.stringify([row.kind, row.source_key]), { kind: row.kind as PlanIdentityKind, sourceKey: row.source_key as string, id: row.target_id }); targetIds.add(row.target_id);
  }
  const identity = (kind: PlanIdentityKind, sourceKey: string) => {
    const k = JSON.stringify([kind, sourceKey]); used.add(k);
    const existing = cache.get(k); if (existing) return existing.id;
    const id = allocate();
    if (!uuid.test(id) || targetIds.has(id) || db.prepare("SELECT 1 FROM r04_candidate_ids WHERE target_id=?").get(id)
      || db.prepare("SELECT 1 FROM r04_work_ids WHERE target_id=?").get(id)) return fail("IDENTITY_COLLISION");
    db.prepare("INSERT INTO r04_plan_ids VALUES(?,?,?)").run(kind, sourceKey, id); cache.set(k, { kind, sourceKey, id }); targetIds.add(id); return id;
  };
  const projection = composeLegacyPlans(context, importedAt, source, clientIds, links, identity, templatesEnabled);
  const archiveCatalog = new Map<string, string>();
  if (archivesEnabled) for (const row of db.prepare("SELECT source_catalog_id,id FROM r04_exercise_registry WHERE workspace_id=?").all(context.targetWorkspaceId)) {
    archiveCatalog.set(row.source_catalog_id as string, row.id as string);
  }
  const archives = archivesEnabled ? composeLegacyArchivePlans(context, importedAt, source, clientIds, archiveCatalog, identity) : null;
  if (archives) {
    for (const name of TEMPLATE_TARGET_TABLES) for (const row of archives.tables[name]) projection.tables[name].push(row);
    for (const row of archives.sourceRows) projection.sourceRows.push(row);
    projection.sourceRows.sort((a, b) => compare(String(a.source_key), String(b.source_key)));
    for (const row of archives.metadata) projection.metadata.push(row);
    for (const row of archives.planBases) projection.planBases.push(row);
    projection.deferredArchiveRows = archives.deferredArchiveRows;
    projection.retainedSourceRows += archives.sourceRows.filter((r) => r.disposition === "RETAINED_DELETED_ARCHIVE_SOURCE" || r.disposition === "ARCHIVE_WARMUP_SOURCE").length;
    checkpoint("after-archive-plans");
  }
  if (used.size !== cache.size) return fail("IDENTITY_MISMATCH");
  checkpoint("after-plan-ids");
  const targetTables: readonly string[] = templatesEnabled ? TEMPLATE_TARGET_TABLES : PLAN_TARGET_TABLES;
  const tables: { name: string; rows: readonly PlanRow[] }[] = (templatesEnabled ? TEMPLATE_TARGET_TABLES : PLAN_TARGET_TABLES).map((name) => ({ name, rows: projection.tables[name] }));
  const sourceRows = projection.sourceRows.map((row) => ({ ...row, source_json: canonical(JSON.parse(row.source_json as string) as unknown) }));
  const sourceJson = canonical({ accountScope: source.accountScope, tables: Object.fromEntries(PLAN_SOURCE_TABLES.map((table) => [table,
    source.tables[table] === null ? null : source.tables[table].map((r) => canonical(r)).sort(compare)])) });
  const identities = [...cache.values()].map((r) => ({ kind: r.kind, source_key: r.sourceKey, target_id: r.id })).sort((a, b) => compare(canonical(a), canonical(b)));
  const targetJson = canonical({ tables: tables.map((table) => ({ name: table.name, rows: table.rows.map(canonical).sort(compare) })), sourceRows,
    identities,
    metadata: projection.metadata.map(canonical).sort(compare), planBases: projection.planBases.map(canonical).sort(compare),
    deferredArchiveRows: projection.deferredArchiveRows, deferredTemplatePages: projection.deferredTemplatePages,
    ...(archives ? { archivedProgramRows: archives.archivedProgramRows, mirroredArchiveAliasRows: archives.mirroredAliasRows } : {}),
    deferredLibraryRows: projection.deferredLibraryRows, deferredWorkspaceStateRows: projection.deferredWorkspaceStateRows,
    deferredViewRows: projection.deferredViewRows, deferredPreferenceRows: projection.deferredPreferenceRows });
  const receipts = db.prepare("SELECT * FROM r04_plan_receipt").all();
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_json !== sourceJson || receipts[0]?.target_json !== targetJson)) return fail("PARITY_MISMATCH");
  if (receipts.length === 0) for (const [name] of baselineObjects) if (plansRehearsalObjects[name!] === "table" && db.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n !== 0) return fail("FOREIGN_TARGET");
  function writeAndVerify(name: string, expected: readonly PlanRow[]) {
    if (receipts.length === 0) for (const row of expected) {
      const columns = Object.keys(row);
      db.prepare(`INSERT INTO ${name}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row));
    }
    const actual = db.prepare(`SELECT * FROM ${name}`).all().map((r) => canonical({ ...r })).sort(compare);
    if (canonical(actual) !== canonical(expected.map(canonical).sort(compare))) return fail("PARITY_MISMATCH");
  }
  for (const table of tables) { writeAndVerify(table.name, table.rows); checkpoint("after-plan-rows"); }
  // Tables outside this projection must remain empty; a replay cannot absorb a new
  // draft/history/template row silently into its claimed target ownership.
  for (const [name, type] of baselineObjects) if (type === "table" && !targetTables.includes(name!)
    && db.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n !== 0) return fail("PARITY_MISMATCH");
  writeAndVerify("r04_plan_source", sourceRows); checkpoint("after-plan-source");
  if (receipts.length === 0) db.prepare("INSERT INTO r04_plan_receipt VALUES(1,?,?)").run(sourceJson, targetJson);
  const receipt = db.prepare("SELECT * FROM r04_plan_receipt WHERE id=1").get();
  if (receipt?.source_json !== sourceJson || receipt?.target_json !== targetJson) return fail("PARITY_MISMATCH"); checkpoint("after-plan-receipt");
  return { programRows: projection.tables.training_programs.length, mesocycleRows: projection.tables.training_mesocycles.length,
    plannedWorkoutRows: projection.tables.training_workouts.length, plannedExerciseRows: projection.tables.training_planned_exercises.length,
    plannedSetRows: projection.tables.training_planned_sets.length, templateRows: projection.tables.training_templates.length, retainedPlanSourceRows: projection.retainedSourceRows,
    archivedProgramRows: archives?.archivedProgramRows ?? 0, mirroredArchiveAliasRows: archives?.mirroredAliasRows ?? 0, targetFactsCreated: 0 as const,
    deferredArchiveRows: projection.deferredArchiveRows, deferredTemplatePages: projection.deferredTemplatePages,
    deferredLibraryRows: projection.deferredLibraryRows, deferredWorkspaceStateRows: projection.deferredWorkspaceStateRows,
    deferredViewRows: projection.deferredViewRows, deferredPreferenceRows: projection.deferredPreferenceRows, finalizable: false as const };
}

export interface PlanDraftMapping {
  readonly sourceTable: string; readonly sourceRowId: string; readonly clientId: string | null;
  readonly targetId: string | null; readonly programId: string | null; readonly weekIndex: number | null; readonly disposition: string;
}
/** Downstream fact/archive adapters consume source aliases, never deduplicate facts
 * by a logical simple-workout ID shared by several weeks. Read verifies plan parity. */
export function loadStagedPlanMappings(db: DatabaseSync, templatesEnabled = false): ReadonlyMap<string, PlanDraftMapping> {
  const receipts = db.prepare("SELECT * FROM r04_plan_receipt").all();
  if (receipts.length !== 1 || receipts[0]?.id !== 1) return fail("NOT_STAGED");
  let manifest: unknown; try { manifest = JSON.parse(receipts[0].target_json as string) as unknown; } catch { return fail("PARITY_MISMATCH"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return fail("PARITY_MISMATCH");
  const saved = manifest as Record<string, unknown>;
  const targetTables: readonly string[] = templatesEnabled ? TEMPLATE_TARGET_TABLES : PLAN_TARGET_TABLES;
  if (!Array.isArray(saved.tables) || saved.tables.length !== targetTables.length || !Array.isArray(saved.sourceRows) || !Array.isArray(saved.identities)) return fail("PARITY_MISMATCH");
  const names = new Set<string>();
  for (const item of saved.tables) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("PARITY_MISMATCH");
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || !targetTables.includes(row.name) || names.has(row.name)
      || !Array.isArray(row.rows) || row.rows.some((r: unknown) => typeof r !== "string")) return fail("PARITY_MISMATCH"); names.add(row.name);
    if (canonical(db.prepare(`SELECT * FROM ${row.name}`).all().map((r) => canonical({ ...r })).sort(compare)) !== canonical([...row.rows].sort(compare))) return fail("PARITY_MISMATCH");
  }
  for (const [name, type] of baselineObjects) if (type === "table" && !targetTables.includes(name!)
    && db.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n !== 0) return fail("PARITY_MISMATCH");
  const rows = db.prepare("SELECT * FROM r04_plan_source ORDER BY source_key").all();
  if (canonical(rows.map((r) => canonical({ ...r })).sort(compare)) !== canonical(saved.sourceRows.map(canonical).sort(compare))
    || canonical(db.prepare("SELECT * FROM r04_plan_ids").all().map((r) => canonical({ ...r })).sort(compare)) !== canonical(saved.identities.map(canonical).sort(compare))) return fail("PARITY_MISMATCH");
  return new Map(rows.map((r) => [r.source_key as string, { sourceTable: r.source_table as string, sourceRowId: r.source_row_id as string,
    clientId: r.target_client_id as string | null, targetId: r.target_id as string | null, programId: r.target_program_id as string | null,
    weekIndex: r.week_index as number | null, disposition: r.disposition as string }]));
}
