import type { DatabaseSync } from "node:sqlite";
import type { LegacyExerciseCatalogCandidate } from "./LegacyExerciseCatalogSourceReader.ts";
import { legacyExerciseReferenceReadPlan } from "../../apps/mobile/src/features/exercises/data/legacy-import/LegacyExerciseReferenceReadPlan.ts";
import { projectLegacyExerciseReferencesFromSource } from "../../apps/mobile/src/features/exercises/domain/legacy-import/LegacyExerciseReferences.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";
export * from "../../apps/mobile/src/features/exercises/domain/legacy-import/LegacyExerciseReferences.ts";

export function readLegacyExerciseReferencesInSnapshot(db: DatabaseSync, accountScope: string, catalog: readonly LegacyExerciseCatalogCandidate[]) {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  if (catalog.some((row) => row.accountScope !== accountScope)) throw new Error("R04_EXERCISE_ACCOUNT_MISMATCH");
  if (new Set(catalog.map((row) => row.sourceCatalogId)).size !== catalog.length) throw new Error("R04_EXERCISE_CATALOG_IDENTITY_INVALID");
  return projectLegacyExerciseReferencesFromSource(runNodeLegacyReadPlan(db, legacyExerciseReferenceReadPlan(accountScope)), catalog);
}
