/** D01-2: runtime catalog; the 63-step dev history is archived under scripts/d01/history. */
import { trainingExecutionBaseline } from "./TrainingExecutionBaseline.generated.ts";
import { executionIntegrityMigration } from "./ExecutionIntegrityMigration.ts";
import { unknownWorkoutDateMigration } from "./UnknownWorkoutDateMigration.ts";
import { calendarAppointmentLinkMigration } from "./CalendarAppointmentLinkMigration.ts";
export const devTrainingExecutionCatalog = [...trainingExecutionBaseline, executionIntegrityMigration, unknownWorkoutDateMigration, calendarAppointmentLinkMigration];
export const DEV_TRAINING_EXECUTION_LEDGER = "training_execution_schema_migrations";
