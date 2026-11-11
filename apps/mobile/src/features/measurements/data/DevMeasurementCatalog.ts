/** D01-2: runtime catalog; the 63-step dev history is archived under scripts/d01/history. */
import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";
import { measurementMethodMigration } from "./MeasurementMethodMigration.ts";
import { measurementScaleMigration } from "./MeasurementScaleMigration.ts";
import { measurementsBaseline } from "./MeasurementsBaseline.generated.ts";

export const devMeasurementCatalog: readonly MigrationStep[] = [...measurementsBaseline, measurementMethodMigration, measurementScaleMigration];
export const DEV_MEASUREMENT_LEDGER = "measurement_schema_migrations";
