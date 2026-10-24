import type { LegacySourceRow } from "./LegacyProfileSources.ts";

export const PLAN_SOURCE_TABLES = ["training_programs", "training_weeks", "training_workouts", "training_exercises", "training_set_logs",
  "training_library_programs", "training_workspaces", "training_program_view_state", "training_library_preferences", "training_archive_entries"] as const;
export type PlanSourceTable = typeof PLAN_SOURCE_TABLES[number];
export interface LegacyPlansSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<PlanSourceTable, readonly LegacySourceRow[] | null>>;
}
