import type { LegacySourceRow, LegacyClientsSource, LegacyExerciseCatalogSource, LegacyQuestionnaireSource } from "../../../shared/migration/LegacyProfileSources.ts";
export type { LegacySourceRow, LegacyClientsSource, LegacyExerciseCatalogSource, LegacyQuestionnaireSource } from "../../../shared/migration/LegacyProfileSources.ts";

import type { LegacyPlansSource } from "../../../shared/migration/LegacyPlanSources.ts";
export { PLAN_SOURCE_TABLES, type PlanSourceTable, type LegacyPlansSource } from "../../../shared/migration/LegacyPlanSources.ts";
import type { LegacyExecutionSource } from "../../../shared/migration/LegacyExecutionSources.ts";
export { EXECUTION_SOURCE_TABLES, type ExecutionSourceTable, type LegacyExecutionSource } from "../../../shared/migration/LegacyExecutionSources.ts";
export interface LegacyTrainingSnapshots {
  readonly plans: LegacyPlansSource;
  readonly executions: LegacyExecutionSource;
}

export const NUTRITION_SOURCE_TABLES = ["food_products", "nutrition_recipes", "nutrition_days", "client_day_facts", "client_kbju_state", "nutrition_archive_weeks"] as const;
export interface LegacyNutritionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<typeof NUTRITION_SOURCE_TABLES[number], readonly LegacySourceRow[] | null>>;
}

import type { LegacyMeasurementsSnapshot } from "../../../shared/migration/LegacyMeasurementSources.ts";
export { legacyMeasurementFields, type LegacyMeasurementsSnapshot } from "../../../shared/migration/LegacyMeasurementSources.ts";

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
