import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { DevAccountingRepository, devAccountingCalendarHook, devAccountingClientDeletionParticipant } from "../../features/accounting/data/DevAccountingRepository.ts";
import { DevCalendarRepository, devCalendarClientDeletionParticipant } from "../../features/calendar/data/DevCalendarRepository.ts";
import { DevClientRepository } from "../../features/clients/data/DevClientRepository.ts";
import { DevExerciseCatalogRepository } from "../../features/exercises/data/DevExerciseCatalogRepository.ts";
import type { SystemCatalog } from "../../features/exercises/public.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from "../../features/measurements/data/DevMeasurementRepository.ts";
import { DevNotificationRepository, devNotificationClientDeletionParticipant } from "../../features/notifications/data/DevNotificationRepository.ts";
import { DevFoodCatalogRepository } from "../../features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevRecipeCatalogRepository } from "../../features/nutrition/data/DevRecipeCatalogRepository.ts";
import { DevNutritionDiaryRepository, devNutritionClientDeletionParticipant } from "../../features/nutrition/data/DevNutritionDiaryRepository.ts";
import { DevNutritionTargetsRepository, devNutritionTargetsClientDeletionParticipant } from "../../features/nutrition/data/DevNutritionTargetsRepository.ts";
import { DevNutritionCalcRepository, devNutritionCalcClientDeletionParticipant } from "../../features/nutrition/data/DevNutritionCalcRepository.ts";
import { DevQuestionnaireRepository, devQuestionnaireClientDeletionParticipant } from "../../features/questionnaire/data/DevQuestionnaireRepository.ts";
import { DevSettingsRepository } from "../../features/settings/data/DevSettingsRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from "../../features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from "../../features/training/execution/data/DevTrainingExecutionRepository.ts";

/** Actual application owner inventory, also used by the filesystem integration rehearsal.
 * Every holder belongs to the same physical file. Keep initialize/close derived from this
 * single inventory so adding a repository cannot silently leave a handle open at restore. */
export function createLocalRepositories(database: SharedSqliteDatabase, workspaceId: string, system: SystemCatalog) {
  const clients = new DevClientRepository(database, workspaceId,
    [devAccountingClientDeletionParticipant, devCalendarClientDeletionParticipant, devNotificationClientDeletionParticipant,
      devMeasurementClientDeletionParticipant, devNutritionCalcClientDeletionParticipant, devNutritionClientDeletionParticipant,
      devNutritionTargetsClientDeletionParticipant, devQuestionnaireClientDeletionParticipant,
      devTrainingPlansClientDeletionParticipant, devTrainingExecutionClientDeletionParticipant]);
  const calendar = new DevCalendarRepository(database, workspaceId, devAccountingCalendarHook);
  const accounting = new DevAccountingRepository(database, workspaceId);
  const measurements = new DevMeasurementRepository(database, workspaceId);
  const nutrition = { foods: new DevFoodCatalogRepository(database, workspaceId), recipes: new DevRecipeCatalogRepository(database, workspaceId),
    diary: new DevNutritionDiaryRepository(database, workspaceId), targets: new DevNutritionTargetsRepository(database, workspaceId),
    calc: new DevNutritionCalcRepository(database, workspaceId) };
  const questionnaire = new DevQuestionnaireRepository(database, workspaceId);
  const settings = new DevSettingsRepository(database, workspaceId);
  const notifications = new DevNotificationRepository(database, workspaceId);
  const trainingPlans = new DevTrainingPlansRepository(database, workspaceId);
  const trainingExecution = new DevTrainingExecutionRepository(database, workspaceId);
  const exercises = new DevExerciseCatalogRepository(database, workspaceId, system);
  const owners = [clients, calendar, accounting, measurements, nutrition.foods, nutrition.recipes, nutrition.diary,
    nutrition.targets, nutrition.calc, questionnaire, settings, notifications, trainingPlans, trainingExecution, exercises] as const;
  calendar.subscribeCommittedChanges(() => accounting.notifyExternalChange());
  return { clients, calendar, accounting, measurements, nutrition, questionnaire, settings, notifications, trainingPlans, trainingExecution, exercises,
    ownerCount: owners.length,
    async initialize(): Promise<void> { for (const owner of owners) await owner.initialize(); },
    async close(): Promise<void> {
      const results = await Promise.allSettled(owners.map((owner) => owner.close()));
      if (results.some((result) => result.status === "rejected")) throw new Error("RUNTIME_OWNER_CLOSE_FAILED");
    },
  };
}
