import type { LegacySourceRow } from "./LegacyProfileSources.ts";
export type { LegacySourceRow as ExecutionRaw } from "./LegacyProfileSources.ts";

export const EXECUTION_SOURCE_TABLES = ["training_sessions", "training_session_exercises", "training_session_sets", "training_set_segments", "training_exercise_history", "training_workout_logs"] as const;
export type ExecutionSourceTable = typeof EXECUTION_SOURCE_TABLES[number];
export interface LegacyExecutionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<ExecutionSourceTable, readonly LegacySourceRow[] | null>>;
}
