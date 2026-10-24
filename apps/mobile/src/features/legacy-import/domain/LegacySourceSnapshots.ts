import type { LegacySourceRow, LegacyClientsSource, LegacyExerciseCatalogSource, LegacyQuestionnaireSource } from "../../../shared/migration/LegacyProfileSources.ts";
export type { LegacySourceRow, LegacyClientsSource, LegacyExerciseCatalogSource, LegacyQuestionnaireSource } from "../../../shared/migration/LegacyProfileSources.ts";

export const PLAN_SOURCE_TABLES = ["training_programs", "training_weeks", "training_workouts", "training_exercises", "training_set_logs",
  "training_library_programs", "training_workspaces", "training_program_view_state", "training_library_preferences", "training_archive_entries"] as const;
export type PlanSourceTable = typeof PLAN_SOURCE_TABLES[number];
export interface LegacyPlansSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<PlanSourceTable, readonly LegacySourceRow[] | null>>;
}
export const EXECUTION_SOURCE_TABLES = ["training_sessions", "training_session_exercises", "training_session_sets", "training_set_segments", "training_exercise_history", "training_workout_logs"] as const;
export type ExecutionSourceTable = typeof EXECUTION_SOURCE_TABLES[number];
export interface LegacyExecutionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<ExecutionSourceTable, readonly LegacySourceRow[] | null>>;
}
export interface LegacyTrainingSnapshots {
  readonly plans: LegacyPlansSource;
  readonly executions: LegacyExecutionSource;
}

export const NUTRITION_SOURCE_TABLES = ["food_products", "nutrition_recipes", "nutrition_days", "client_day_facts", "client_kbju_state", "nutrition_archive_weeks"] as const;
export interface LegacyNutritionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<typeof NUTRITION_SOURCE_TABLES[number], readonly LegacySourceRow[] | null>>;
}

export const legacyMeasurementFields = ["neck", "shoulders", "chest", "waist", "hips", "upper_arm", "thigh", "calf"] as const;
export interface LegacyMeasurementsSnapshot {
  readonly accountScope: string;
  /** Optional absence is different from an observed empty table. */
  readonly rows: readonly LegacySourceRow[] | null;
  readonly clientDays: readonly LegacySourceRow[] | null;
}

export const LEGACY_CALENDAR_COLUMNS = ["id", "date_key", "start_time", "end_time", "duration_minutes", "client_id", "guest_name", "client_name", "appointment_type", "note", "created_at", "updated_at", "deleted_at"] as const;
export interface LegacyCalendarSnapshot {
  readonly accountScope: string;
  readonly appointments: readonly LegacySourceRow[] | null;
  /** Calendar-owned key only; other settings need separate coverage. */
  readonly plannerRows: readonly LegacySourceRow[] | null;
  readonly unsupportedAccountingTables: readonly string[];
}

export interface LegacyDomainSnapshots {
  readonly nutrition: LegacyNutritionSource;
  readonly measurements: LegacyMeasurementsSnapshot;
  readonly calendar: LegacyCalendarSnapshot;
}
export interface LegacyProfileSnapshots {
  readonly clients: LegacyClientsSource;
  readonly exerciseCatalog: LegacyExerciseCatalogSource;
  readonly questionnaire: LegacyQuestionnaireSource | null;
}
export interface LegacyImportSourceSnapshots extends LegacyDomainSnapshots, LegacyTrainingSnapshots, LegacyProfileSnapshots {}
