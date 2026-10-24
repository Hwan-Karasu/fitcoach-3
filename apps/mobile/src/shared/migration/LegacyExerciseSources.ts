import type { LegacySourceRow } from "./LegacyProfileSources.ts";

/** Physical inputs from one admitted read snapshot; never join by names. */
export interface LegacyExerciseReferenceSource {
  readonly accountScope: string;
  readonly clients: readonly LegacySourceRow[] | null;
  readonly workouts: readonly LegacySourceRow[] | null;
  readonly exercises: readonly LegacySourceRow[] | null;
  readonly history: readonly LegacySourceRow[] | null;
}
