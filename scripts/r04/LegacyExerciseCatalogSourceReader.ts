import type { DatabaseSync } from "node:sqlite";
import { projectLegacyExerciseCatalog } from "../../apps/mobile/src/features/exercises/domain/legacy-import/LegacyExerciseCatalogProjection.ts";
import { legacyExerciseCatalogReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacyProfileReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";
export * from "../../apps/mobile/src/features/exercises/domain/legacy-import/LegacyExerciseCatalogProjection.ts";
export { legacyObjectJson } from "../../apps/mobile/src/shared/migration/LegacyValues.ts";
export function requireLegacyColumns(
  db: DatabaseSync, table: string, required: readonly string[], errorCode = "R04_EXERCISE_SHAPE_UNSUPPORTED",
): void {
  // Table names are fixed by callers, not supplied by the backup or user.
  if (!/^[a-z_]+$/u.test(table)) throw new Error("R04_EXERCISE_TABLE_INVALID");
  const columns = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
  if (required.some((column) => !columns.has(column))) throw new Error(errorCode);
}

export function readLegacyExerciseCatalogInSnapshot(db: DatabaseSync, accountScope: string) {
  return projectLegacyExerciseCatalog(runNodeLegacyReadPlan(db, legacyExerciseCatalogReadPlan(accountScope)));
}