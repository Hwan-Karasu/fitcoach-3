import type { LegacyClientsSource, LegacyExerciseCatalogSource, LegacyQuestionnaireSource } from "../../../shared/migration/LegacyProfileSources.ts";
export type { LegacySourceRow, LegacyClientsSource, LegacyExerciseCatalogSource, LegacyQuestionnaireSource } from "../../../shared/migration/LegacyProfileSources.ts";

import type { LegacyPlansSource } from "../../../shared/migration/LegacyPlanSources.ts";
export { PLAN_SOURCE_TABLES, type PlanSourceTable, type LegacyPlansSource } from "../../../shared/migration/LegacyPlanSources.ts";
import type { LegacyExecutionSource } from "../../../shared/migration/LegacyExecutionSources.ts";
export { EXECUTION_SOURCE_TABLES, type ExecutionSourceTable, type LegacyExecutionSource } from "../../../shared/migration/LegacyExecutionSources.ts";
export interface LegacyTrainingSnapshots {
  readonly plans: LegacyPlansSource;
  readonly executions: LegacyExecutionSource;
}

import type { LegacyNutritionSource } from "../../../shared/migration/LegacyNutritionSources.ts";
export { NUTRITION_SOURCE_TABLES, type LegacyNutritionSource } from "../../../shared/migration/LegacyNutritionSources.ts";

import type { LegacyMeasurementsSnapshot } from "../../../shared/migration/LegacyMeasurementSources.ts";
export { legacyMeasurementFields, type LegacyMeasurementsSnapshot } from "../../../shared/migration/LegacyMeasurementSources.ts";

import type { LegacyCalendarSnapshot } from "../../../shared/migration/LegacyCalendarSources.ts";
export { LEGACY_CALENDAR_COLUMNS, type LegacyCalendarSnapshot } from "../../../shared/migration/LegacyCalendarSources.ts";

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
