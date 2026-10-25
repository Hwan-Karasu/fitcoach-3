import type { NativeSqliteDatabase } from "../../shared/db/IsolatedSqliteConnection.ts";
import type { CandidateIdentityContext } from "../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacyClientsSource } from "../../shared/migration/LegacyProfileSources.ts";
import { captureLegacySourceRow } from "../../shared/migration/LegacySourceCapture.ts";
import { combineLegacyStageExtensions } from "../../shared/migration/LegacyStageExtension.ts";
import type { LegacyClientCheckpoint } from "../../shared/migration/LegacyWritePlan.ts";
import type { LegacyImportSourceSnapshots } from "../../features/legacy-import/public.ts";
import { prepareLegacyClientStaging } from "../../features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyQuestionnaireStagingExtension } from "../../features/questionnaire/data/legacy-import/LegacyQuestionnaireStaging.ts";
import { legacyClientWorkDataStagingExtension } from "../../features/clients/data/legacy-import/LegacyClientWorkDataStaging.ts";
import { legacyExerciseCatalogStagingExtension } from "../../features/exercises/data/legacy-import/LegacyExerciseCatalogStaging.ts";
import { legacyPlansStagingExtension } from "../../features/training/plans/data/legacy-import/LegacyPlansStaging.ts";
import { legacyLoadPlanMappingsPlan } from "../../features/training/plans/data/legacy-import/LegacyPlansStagePlan.ts";
import { legacyExecutionStagingExtension } from "../../features/training/execution/data/legacy-import/LegacyExecutionStaging.ts";
import { legacyMeasurementStagingExtension } from "../../features/measurements/data/legacy-import/LegacyMeasurementStaging.ts";
import { legacyNutritionStagingExtension } from "../../features/nutrition/data/legacy-import/LegacyNutritionStaging.ts";
import { legacyCalendarStagingExtension } from "../../features/calendar/data/legacy-import/LegacyCalendarStaging.ts";
import { legacyAccountingStagingStatements } from "../../features/accounting/data/legacy-import/LegacyAccountingStaging.ts";
import { legacySettingsStagingExtension } from "../../features/settings/data/legacy-import/LegacySettingsStaging.ts";
import { legacySourceCoverageStagingExtension } from "../../features/legacy-import/data/LegacySourceCoverageStaging.ts";

export interface LegacyImportCandidateInput {
  /** Independent native handles to one private staging file; never source/inspection/live DB. */
  readonly openStaging: () => Promise<NativeSqliteDatabase>;
  readonly context: CandidateIdentityContext;
  readonly importedAt: string;
  readonly referenceDay: string;
  /** Read from the pinned inspection snapshot after source admission, bound to context SHA. */
  readonly source: LegacyImportSourceSnapshots;
  readonly allocate: () => string;
}

/** Internal R04 composition, not a production import or cutover entry point.
 * Captures all owner payloads/dependencies before awaiting; every write shares
 * one transaction. Coverage, permanent-model and release gates remain separate.
 */
export async function stageLegacyImportCandidate(input: LegacyImportCandidateInput,
  checkpoint: (phase: Exclude<LegacyClientCheckpoint, "after-clients">) => void | Promise<void> = () => undefined) {
  const { openStaging, importedAt, referenceDay, allocate, source } = input;
  const context = Object.freeze({ ...input.context });
  const clients: LegacyClientsSource = { accountScope: source.clients.accountScope, rows: source.clients.rows.map(captureLegacySourceRow) };
  const owners = combineLegacyStageExtensions(
    legacyQuestionnaireStagingExtension(source.questionnaire),
    legacyClientWorkDataStagingExtension(),
    legacyExerciseCatalogStagingExtension(source.exerciseCatalog, { accountScope: clients.accountScope, clients: clients.rows,
      workouts: source.plans.tables.training_workouts, exercises: source.plans.tables.training_exercises, history: source.executions.tables.training_exercise_history }),
    legacyPlansStagingExtension(source.plans, { templates: true, archives: true }, { settings: source.settings, facts: { accountScope: source.executions.accountScope, segments: source.executions.tables.training_set_segments } }),
    legacyExecutionStagingExtension(source.plans, source.executions, () => legacyLoadPlanMappingsPlan(true, true)),
    legacyMeasurementStagingExtension(source.measurements, referenceDay),
    legacyNutritionStagingExtension(source.nutrition),
    legacyCalendarStagingExtension(source.calendar, legacyAccountingStagingStatements),
    legacySettingsStagingExtension(source.settings),
    legacySourceCoverageStagingExtension(source),
  );
  const staging = await prepareLegacyClientStaging(openStaging, context, importedAt, owners);
  const { extensionResult, ...result } = await staging.stageClients(clients, allocate, checkpoint);
  if (!extensionResult) throw new Error("R04_ID_LEDGER_EXTENSION_RESULT_MISSING");
  const [profileAndQuestionnaire, workData, exercises, plans, executions, measurements, nutrition, calendar, settings, coverage] = extensionResult;
  return { ...result, owners: { profileAndQuestionnaire, workData, exercises, plans, executions, measurements, nutrition, calendar, settings, coverage }, finalizable: false as const };
}
