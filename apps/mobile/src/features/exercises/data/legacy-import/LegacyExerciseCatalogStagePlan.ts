import type { CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacyStageClient, LegacyStageClientIds } from "../../../../shared/migration/LegacyStageExtension.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import { legacyStageQuery as query, legacyStageRun as run, type LegacyWritePlan } from "../../../../shared/migration/LegacyWritePlan.ts";
import { projectLegacyExerciseCatalogRow, type LegacyExerciseCatalogCandidate } from "../../domain/legacy-import/LegacyExerciseCatalogProjection.ts";
import { projectLegacyExerciseReferences, type LegacyExerciseReferenceCandidate } from "../../domain/legacy-import/LegacyExerciseReferences.ts";
import { exercisesBaseline } from "../ExercisesBaseline.generated.ts";
import type { BodyPart, ExerciseDefinition, ExerciseOrigin } from "../../domain/ExerciseModel.ts";
import type { CatalogEntry } from "../../domain/ExerciseRules.ts";

export interface LegacyExerciseStageResult {
  readonly exerciseRows: number;
  readonly exerciseLinkRows: number;
  readonly unspecifiedCategoryRows: number;
  readonly unspecifiedEquipmentRows: number;
  readonly archivedExerciseRows: number;
  readonly finalizable: false;
}

/** R04 proposal for imported registry records. Nullable source classification is NOT
 * smuggled into the current NOT NULL production custom_exercises definition. */
export const exerciseRehearsalObjects: Readonly<Record<string, string>> = Object.fromEntries([
  "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt",
].map((name) => [name, "table"]));
export type { LegacyExerciseCheckpoint as ExerciseStageCheckpoint } from "../../../../shared/migration/LegacyWritePlan.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function fail(code: string): never { throw new Error(`R04_ID_LEDGER_EXERCISE_${code}`); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => compare(a, b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("INVALID_PAYLOAD");
}
export function* legacyExerciseSchemaPlan(): LegacyWritePlan<void> {
  const overlay = exercisesBaseline[0]!.statements.find((sql) => sql.startsWith("CREATE TABLE exercise_overlay "));
  if (!overlay) return fail("SCHEMA_UNAVAILABLE");
  yield run(overlay);
  yield run("CREATE TABLE r04_exercise_ids(source_key TEXT PRIMARY KEY NOT NULL,target_id TEXT NOT NULL UNIQUE,\n      source_payload_json TEXT NOT NULL CHECK(json_valid(source_payload_json)))");
  yield run("CREATE TABLE r04_exercise_registry(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n      origin TEXT NOT NULL CHECK(origin IN ('CUSTOM','SYSTEM')),name TEXT NOT NULL CHECK(length(trim(name))>0),\n      body_part TEXT CHECK(body_part IS NULL OR body_part IN ('chest','back','shoulders','upper_arms','lower_arms','core','upper_legs','lower_legs','full_body')),\n      equipment TEXT CHECK(equipment IS NULL OR length(trim(equipment))>0),\n      tracking_profile TEXT NOT NULL CHECK(tracking_profile='LOAD_REPS'),revision INTEGER NOT NULL CHECK(revision=1),\n      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,source_catalog_id TEXT NOT NULL,\n      UNIQUE(id,workspace_id),UNIQUE(workspace_id,source_catalog_id),\n      CHECK((origin='CUSTOM' AND substr(id,1,4)='usr:') OR (origin='SYSTEM' AND substr(id,1,14)='sys:legacy-v2:')))");
  yield run("CREATE TABLE r04_exercise_links(source_key TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,\n      source_table TEXT NOT NULL CHECK(source_table IN ('training_exercises','training_exercise_history')),\n      source_row_id TEXT NOT NULL,source_client_id TEXT NOT NULL,target_client_id TEXT NOT NULL,target_exercise_id TEXT NOT NULL,\n      source_deleted_at TEXT,source_json TEXT NOT NULL CHECK(json_valid(source_json)),\n      FOREIGN KEY(target_client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT,\n      FOREIGN KEY(target_exercise_id,workspace_id) REFERENCES r04_exercise_registry(id,workspace_id) ON DELETE RESTRICT)");
  yield run("CREATE TABLE r04_exercise_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),\n      target_json TEXT NOT NULL CHECK(json_valid(target_json)))");
}
interface RegistryRow {
  readonly id: string; readonly workspace_id: string; readonly origin: ExerciseOrigin; readonly name: string;
  readonly body_part: BodyPart | null; readonly equipment: string | null; readonly tracking_profile: "LOAD_REPS";
  readonly revision: 1; readonly created_at: string; readonly updated_at: string; readonly archived_at: string | null; readonly source_catalog_id: string;
}
export function* legacyExerciseCatalogStagePlan(context: CandidateIdentityContext,
  cards: readonly LegacyStageClient[], clients: LegacyStageClientIds, sourceCatalog: readonly LegacyExerciseCatalogCandidate[],
  sourceRefs: readonly LegacyExerciseReferenceCandidate[], allocate: () => string): LegacyWritePlan<LegacyExerciseStageResult> {
  const catalog = sourceCatalog.map((candidate) => {
    const row = projectLegacyExerciseCatalogRow(context.accountScope, candidate.raw);
    if (candidate.accountScope !== context.accountScope || candidate.sourceIdentityKey !== row.sourceIdentityKey || candidate.sourceCatalogId !== row.sourceCatalogId) return fail("SCOPE_MISMATCH");
    if (row.issues.length > 0 || row.origin === null || row.name === null || row.aliases === null) return fail("CATALOG_INVALID");
    return row;
  }).sort((a, b) => compare(a.sourceIdentityKey, b.sourceIdentityKey));
  if (new Set(catalog.map((c) => c.sourceCatalogId)).size !== catalog.length) return fail("IDENTITY_DUPLICATE");
  const sourceKeys = new Set<string>();
  for (const ref of sourceRefs) {
    if (ref.accountScope !== context.accountScope || !["training_exercises", "training_exercise_history"].includes(ref.sourceTable)
      || ref.sourceRowId !== ref.raw.id || ref.sourceIdentityKey !== JSON.stringify([context.accountScope, ref.sourceTable, ref.raw.id]) || sourceKeys.has(ref.sourceIdentityKey)) return fail("SCOPE_MISMATCH");
    sourceKeys.add(ref.sourceIdentityKey);
  }
  const refs = [...projectLegacyExerciseReferences(context.accountScope, catalog,
    sourceRefs.filter((r) => r.sourceTable === "training_exercises").map((r) => r.raw),
    sourceRefs.filter((r) => r.sourceTable === "training_exercise_history").map((r) => r.raw))].sort((a, b) => compare(a.sourceIdentityKey, b.sourceIdentityKey));
  const sourceClients = new Map<string, string>();
  for (const card of cards) {
    const id = clients.clients.get(card.identity.sourceIdentityKey);
    if (!id || card.identity.accountScope !== context.accountScope || card.identity.sourceWorkspaceId !== context.sourceWorkspaceId) return fail("CLIENT_SCOPE_MISMATCH");
    sourceClients.set(card.identity.sourceClientId, id);
  }
  for (const ref of refs) if (ref.status !== "linked-source" || ref.clientId === null || !sourceClients.has(ref.clientId)
    || ref.raw.deleted_at !== null && !isExplicitTimestamp(ref.raw.deleted_at)) return fail("REFERENCE_UNRESOLVED");
  const existingIds = (yield query("SELECT * FROM r04_exercise_ids ORDER BY source_key"));
  const ids = new Map<string, string>(); const targetIds = new Set<string>();
  for (const saved of existingIds) {
    const row = catalog.find((c) => c.sourceIdentityKey === saved.source_key);
    const prefix = row?.origin === "CUSTOM" ? "usr:" : "sys:legacy-v2:";
    if (!row || typeof saved.target_id !== "string" || !saved.target_id.startsWith(prefix) || !uuid.test(saved.target_id.slice(prefix.length))
      || saved.source_payload_json !== canonical(row.raw) || targetIds.has(saved.target_id)) return fail("IDENTITY_MISMATCH");
    ids.set(row.sourceCatalogId, saved.target_id); targetIds.add(saved.target_id);
  }
  for (const row of catalog) if (!ids.has(row.sourceCatalogId)) {
    const allocated = allocate(); if (!uuid.test(allocated)) return fail("IDENTITY_INVALID");
    const id = `${row.origin === "CUSTOM" ? "usr:" : "sys:legacy-v2:"}${allocated}`;
    if (targetIds.has(id)) return fail("IDENTITY_COLLISION");
    yield run("INSERT INTO r04_exercise_ids VALUES(?,?,?)", [row.sourceIdentityKey, id, canonical(row.raw)]);
    ids.set(row.sourceCatalogId, id); targetIds.add(id);
  }
  yield { kind: "checkpoint", phase: "after-exercise-ids" } as const;
  const registry: RegistryRow[] = catalog.map((row) => ({ id: ids.get(row.sourceCatalogId)!, workspace_id: context.targetWorkspaceId,
    origin: row.origin!, name: row.name!, body_part: row.bodyPart, equipment: row.equipment, tracking_profile: "LOAD_REPS", revision: 1,
    created_at: row.raw.created_at as string, updated_at: row.raw.updated_at as string, archived_at: row.raw.deleted_at as string | null, source_catalog_id: row.sourceCatalogId }));
  const overlays = catalog.map((row) => ({ workspace_id: context.targetWorkspaceId, exercise_id: ids.get(row.sourceCatalogId)!,
    favorite: 0, hidden: 0, display_name: null, aliases_json: JSON.stringify(row.aliases), updated_at: row.raw.updated_at as string }));
  const links = refs.map((row) => ({ source_key: row.sourceIdentityKey, workspace_id: context.targetWorkspaceId, source_table: row.sourceTable,
    source_row_id: row.sourceRowId, source_client_id: row.clientId!, target_client_id: sourceClients.get(row.clientId!)!,
    target_exercise_id: ids.get(row.sourceCatalogId!)!, source_deleted_at: row.raw.deleted_at as string | null, source_json: canonical(row.raw) }));
  const sourceJson = canonical({ catalog: catalog.map((c) => ({ sourceKey: c.sourceIdentityKey, raw: c.raw })), refs: refs.map((r) => ({ sourceKey: r.sourceIdentityKey, raw: r.raw })) });
  const targetJson = canonical({ registry, overlays, links, policy: "LEGACY_LOAD_REPS_UNSPECIFIED_METADATA_V1" });
  const receipts = (yield query("SELECT * FROM r04_exercise_receipt"));
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_json !== sourceJson || receipts[0]?.target_json !== targetJson)) return fail("PARITY_MISMATCH");
  const tables = [
    { name: "r04_exercise_registry", rows: registry, phase: "after-exercise-registry" },
    { name: "exercise_overlay", rows: overlays, phase: "after-exercise-overlay" },
    { name: "r04_exercise_links", rows: links, phase: "after-exercise-links" },
  ] as const;
  if (receipts.length === 0) for (const table of tables) if ((yield query(`SELECT count(*) AS n FROM ${table.name}`))[0]?.n !== 0) return fail("FOREIGN_TARGET");
  for (const table of tables) {
    if (receipts.length === 0) for (const row of table.rows) {
      const columns = Object.keys(row);
      yield run(`INSERT INTO ${table.name}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, Object.values(row));
    }
    const actual = (yield query(`SELECT * FROM ${table.name}`)).map((r) => canonical({ ...r })).sort(compare);
    if (canonical(actual) !== canonical(table.rows.map((r) => canonical(r)).sort(compare))) return fail("PARITY_MISMATCH");
    yield { kind: "checkpoint", phase: table.phase } as const;
  }
  if (receipts.length === 0) yield run("INSERT INTO r04_exercise_receipt VALUES(1,?,?)", [sourceJson, targetJson]);
  const receipt = (yield query("SELECT * FROM r04_exercise_receipt WHERE id=1"))[0];
  if (receipt?.source_json !== sourceJson || receipt?.target_json !== targetJson) return fail("PARITY_MISMATCH");
  yield { kind: "checkpoint", phase: "after-exercise-receipt" } as const;
  return { exerciseRows: registry.length, exerciseLinkRows: links.length, unspecifiedCategoryRows: registry.filter((r) => r.body_part === null).length,
    unspecifiedEquipmentRows: registry.filter((r) => r.equipment === null).length, archivedExerciseRows: registry.filter((r) => r.archived_at !== null).length, finalizable: false as const };
}

/** Read proof through the actual registry domain model, without publishing this DB.
 * includeArchived serves history; removed catalog entries never become active picks. */
export function* legacyReadStagedExerciseCatalogPlan(workspaceId: string, includeArchived = false): LegacyWritePlan<readonly CatalogEntry[]> {
  const rows = yield query(`SELECT r.*,o.aliases_json,o.favorite,o.hidden,o.display_name FROM r04_exercise_registry r LEFT JOIN exercise_overlay o
    ON o.workspace_id=r.workspace_id AND o.exercise_id=r.id WHERE r.workspace_id=? ${includeArchived ? "" : "AND r.archived_at IS NULL"} ORDER BY r.id`, [workspaceId]);
  return rows.map((row) => {
    let aliases: unknown;
    try { aliases = JSON.parse(row.aliases_json as string) as unknown; } catch { return fail("READ_INVALID"); }
    if (!Array.isArray(aliases) || aliases.some((a: unknown) => typeof a !== "string")) return fail("READ_INVALID");
    const definition: ExerciseDefinition = { id: row.id as string, origin: row.origin as ExerciseOrigin, name: row.name as string,
      nameEn: null, bodyPart: row.body_part as BodyPart | null, primaryMuscles: [], secondaryMuscles: [], equipment: row.equipment as string | null,
      ...(row.equipment === null ? { equipmentUnspecified: true as const } : {}), trackingProfile: "LOAD_REPS", mechanic: null, difficulty: null,
      unilateral: false, variationGroup: null, instructions: [], tips: [], textLanguage: "ru", media: null,
      source: { provider: "LEGACY_V2", sourceId: row.source_catalog_id as string } };
    return { definition, overlay: { favorite: row.favorite === 1, hidden: row.hidden === 1, displayName: row.display_name as string | null, aliases: aliases as string[] } };
  });
}

/** Shared ID read for later training owners, after staging ownership was checked. */
export function* legacyLoadExerciseDraftIdsPlan(accountScope: string): LegacyWritePlan<ReadonlyMap<string, string>> {
  const rows = yield query("SELECT * FROM r04_exercise_ids ORDER BY source_key");
  const result = new Map<string, string>();
  for (const row of rows) {
    let raw: unknown;
    try { raw = JSON.parse(row.source_payload_json as string) as unknown; } catch { return fail("IDENTITY_MISMATCH"); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("IDENTITY_MISMATCH");
    const projected = projectLegacyExerciseCatalogRow(accountScope, raw as Record<string, unknown>);
    const prefix = projected.origin === "CUSTOM" ? "usr:" : "sys:legacy-v2:";
    if (projected.issues.length > 0 || row.source_key !== projected.sourceIdentityKey || typeof row.target_id !== "string"
      || !row.target_id.startsWith(prefix) || !uuid.test(row.target_id.slice(prefix.length))) return fail("IDENTITY_MISMATCH");
    result.set(row.source_key as string, row.target_id);
  }
  return result;
}
