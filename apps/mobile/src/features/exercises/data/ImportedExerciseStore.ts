import type { SqliteStatementPort, SqlValue } from "../../../shared/db/SqlitePort.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS, type ExerciseDefinition, type BodyPart, type TrackingProfileId } from "../domain/ExerciseModel.ts";
import { reportReadIssue } from "../../../shared/diagnostics/ReadIssues.ts";

export const IMPORTED_EXERCISE_FORMAT = "IMPORTED_EXERCISES_V1";
export const IMPORTED_EXERCISE_TABLES = ["imported_exercises", "imported_exercise_links", "imported_exercise_fact_use"] as const;
export type ImportedExerciseRow = Readonly<Record<string, SqlValue>>;
export interface InitialImportedExercises {
  readonly imported_exercises: readonly ImportedExerciseRow[];
  readonly imported_exercise_links: readonly ImportedExerciseRow[];
  readonly imported_exercise_fact_use: readonly ImportedExerciseRow[];
  readonly overlays: readonly ImportedExerciseRow[];
}
export function importedExerciseFail(code: string): never { throw Error(`EXERCISE_IMPORT_${code}`); }
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function validJson(value: unknown): boolean { if (typeof value !== "string") return false; try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed); } catch { return false; } }
export async function hasImportedExerciseStore(tx: SqliteStatementPort): Promise<boolean> {
  const tables = await tx.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('exercise_import_format','imported_exercises','imported_exercise_links','imported_exercise_fact_use')");
  if (!tables.length) return false;
  if (tables.length !== 4) return importedExerciseFail("FORMAT_UNSUPPORTED");
  const formats = await tx.all<{ id: number; format_version: number; policy: string }>("SELECT * FROM exercise_import_format");
  if (formats.length !== 1 || formats[0]?.id !== 1 || formats[0].format_version !== 1 || formats[0].policy !== IMPORTED_EXERCISE_FORMAT) return importedExerciseFail("FORMAT_UNSUPPORTED");
  return true;
}
export function importedExerciseDefinition(row: ImportedExerciseRow): ExerciseDefinition {
  const prefix = row.origin === "CUSTOM" ? "usr:" : row.origin === "SYSTEM" ? "sys:legacy-v2:" : null;
  if (!prefix || !text(row.id) || !row.id.startsWith(prefix) || !text(row.workspace_id) || !text(row.name) || !text(row.source_catalog_id)
    || row.body_part !== null && !BODY_PARTS.includes(row.body_part as BodyPart)
    || row.equipment !== null && !text(row.equipment) || ![0, 1].includes(row.equipment_unspecified as number)
    || row.equipment_unspecified === 1 && row.equipment !== null || !TRACKING_PROFILE_IDS.includes(row.tracking_profile as TrackingProfileId)
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 || !validJson(row.source_json)
    || typeof row.source_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(row.source_sha256)) return importedExerciseFail("ROW_INVALID");
  return { id: row.id, origin: row.origin as "CUSTOM" | "SYSTEM", name: row.name, nameEn: null, bodyPart: row.body_part as BodyPart | null,
    primaryMuscles: [], secondaryMuscles: [], equipment: row.equipment as string | null, ...(row.equipment_unspecified === 1 ? { equipmentUnspecified: true as const } : {}),
    trackingProfile: row.tracking_profile as TrackingProfileId, mechanic: null, difficulty: null, unilateral: false, variationGroup: null,
    instructions: [], tips: [], textLanguage: "ru", media: null, source: { provider: "LEGACY_V2", sourceId: row.source_catalog_id } };
}
export function readImportedExercise(row: ImportedExerciseRow): ExerciseDefinition | null {
  try { return importedExerciseDefinition(row); } catch { reportReadIssue("exercises.imported"); return null; }
}
const canon = (row: ImportedExerciseRow) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
/** New candidate only; joins the shared writer transaction. No DDL or ID allocation.
 * Existing edited records fail parity instead of being overwritten on retry. */
export async function installInitialImportedExercises(tx: SqliteStatementPort, workspaceId: string, input: InitialImportedExercises): Promise<void> {
  const captured = Object.fromEntries([...IMPORTED_EXERCISE_TABLES, "overlays"].map((table) => [table, input[table as keyof InitialImportedExercises].map((r) => ({ ...r }))])) as unknown as InitialImportedExercises;
  for (const row of captured.imported_exercises) importedExerciseDefinition(row);
  for (const rows of Object.values(captured)) for (const row of rows) if (row.workspace_id !== workspaceId || Object.values(row).some((v) => v !== null && typeof v !== "string" && typeof v !== "number")) importedExerciseFail("SCOPE_INVALID");
  if (!await hasImportedExerciseStore(tx) || !await tx.first("SELECT 1 FROM workspaces WHERE id=?", [workspaceId])) importedExerciseFail("FORMAT_UNSUPPORTED");
  const tables = IMPORTED_EXERCISE_TABLES.map((name) => ({ name, rows: captured[name] }));
  let present = false;
  for (const { name } of tables) if ((await tx.first<{ n: number }>(`SELECT count(*) AS n FROM ${name} WHERE workspace_id=?`, [workspaceId]))!.n) present = true;
  for (const row of captured.imported_exercises) if (await tx.first("SELECT 1 FROM custom_exercises WHERE id=?", [row.id!])) importedExerciseFail("ID_COLLISION");
  const exerciseIds = new Set(captured.imported_exercises.map((r) => r.id));
  if (exerciseIds.size !== captured.imported_exercises.length || captured.overlays.length !== exerciseIds.size
    || new Set(captured.overlays.map((o) => o.exercise_id)).size !== exerciseIds.size || captured.overlays.some((o) => !exerciseIds.has(o.exercise_id))) importedExerciseFail("SEED_INVALID");
  if (!present) {
    for (const row of captured.overlays) if (await tx.first("SELECT 1 FROM exercise_overlay WHERE workspace_id=? AND exercise_id=?", [workspaceId, row.exercise_id!])) importedExerciseFail("FOREIGN_TARGET");
    for (const table of [...tables, { name: "exercise_overlay", rows: captured.overlays }]) for (const row of table.rows) {
      const columns = Object.keys(row); if (columns.some((c) => !/^[a-z][a-z0-9_]*$/u.test(c))) importedExerciseFail("SEED_INVALID");
      await tx.run(`INSERT INTO ${table.name}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, Object.values(row));
    }
  }
  for (const table of tables) {
    const actual = (await tx.all<ImportedExerciseRow>(`SELECT * FROM ${table.name} WHERE workspace_id=?`, [workspaceId])).map(canon).sort();
    if (JSON.stringify(actual) !== JSON.stringify(table.rows.map(canon).sort())) importedExerciseFail("PARITY_MISMATCH");
  }
  const overlays = (await tx.all<ImportedExerciseRow>("SELECT * FROM exercise_overlay WHERE workspace_id=?", [workspaceId])).filter((o) => exerciseIds.has(o.exercise_id));
  if (JSON.stringify(overlays.map(canon).sort()) !== JSON.stringify(captured.overlays.map(canon).sort())) importedExerciseFail("PARITY_MISMATCH");
}

/** Workspace catalog entries survive deletion of a client. Its private source
 * references/usage anchors participate in the explicit client deletion manifest. */
export const importedExerciseDeletionParticipant = {
  owner: "exercises.importedReferences", tables: ["imported_exercise_links", "imported_exercise_fact_use"],
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string) {
    if (!await hasImportedExerciseStore(tx)) return 0;
    return (await tx.first<{ n: number }>("SELECT (SELECT count(*) FROM imported_exercise_links WHERE workspace_id=? AND target_client_id=?)+(SELECT count(*) FROM imported_exercise_fact_use WHERE workspace_id=? AND client_id=?) AS n", [workspaceId, clientId, workspaceId, clientId]))!.n;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string) {
    if (!await hasImportedExerciseStore(tx)) return;
    if ((await tx.first<{ lifecycle: string }>("SELECT lifecycle FROM clients WHERE id=? AND workspace_id=?", [clientId, workspaceId]))?.lifecycle !== "ARCHIVED") importedExerciseFail("CLIENT_NOT_ARCHIVED");
    await tx.run("DELETE FROM imported_exercise_links WHERE workspace_id=? AND target_client_id=?", [workspaceId, clientId]);
    await tx.run("DELETE FROM imported_exercise_fact_use WHERE workspace_id=? AND client_id=?", [workspaceId, clientId]);
  },
};
