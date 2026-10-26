/** D01-2: runtime catalog; the 63-step dev history is archived under scripts/d01/history. */
import { trainingPlansBaseline } from "./TrainingPlansBaseline.generated.ts";
import { plansIntegrityMigration } from "./PlansIntegrityMigration.ts";
import { navigationGroupsMigration } from "./NavigationGroupsMigration.ts";
export const devTrainingPlansCatalog = [...trainingPlansBaseline, plansIntegrityMigration, navigationGroupsMigration];
export const DEV_TRAINING_PLANS_LEDGER = "training_plans_schema_migrations";
