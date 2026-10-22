import { runF04Probe, type F04ProbeReport } from "../diagnostics/runF04Probe.ts";
import { openExpoSqliteConnection } from "../../shared/db/ExpoSqliteConnection.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { DevAccountingRepository, devAccountingCalendarHook, devAccountingClientDeletionParticipant } from
  "../../features/accounting/data/DevAccountingRepository.ts";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import { DevCalendarRepository, devCalendarClientDeletionParticipant } from
  "../../features/calendar/data/DevCalendarRepository.ts";
import type { CalendarParticipantDirectoryPort, CalendarRepositoryPort } from
  "../../features/calendar/public.ts";
import { DevClientRepository } from "../../features/clients/data/DevClientRepository.ts";
import { DevFoodCatalogRepository } from "../../features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevNutritionCalcRepository, devNutritionCalcClientDeletionParticipant } from "../../features/nutrition/data/DevNutritionCalcRepository.ts";
import { DevNutritionDiaryRepository, devNutritionClientDeletionParticipant } from "../../features/nutrition/data/DevNutritionDiaryRepository.ts";
import { DevNutritionTargetsRepository, devNutritionTargetsClientDeletionParticipant } from "../../features/nutrition/data/DevNutritionTargetsRepository.ts";
import { DevRecipeCatalogRepository } from "../../features/nutrition/data/DevRecipeCatalogRepository.ts";
import type { FoodCatalogPort, NutritionCalcPort, NutritionDiaryPort, NutritionTargetsPort, RecipeCatalogPort } from "../../features/nutrition/public.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from
  "../../features/measurements/data/DevMeasurementRepository.ts";
import { dailyPoints, type MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import { DevSettingsRepository } from "../../features/settings/data/DevSettingsRepository.ts";
import type { SettingsPort } from "../../features/settings/public.ts";
import { DevQuestionnaireRepository, devQuestionnaireClientDeletionParticipant } from
  "../../features/questionnaire/data/DevQuestionnaireRepository.ts";
import type { QuestionnaireRepositoryPort } from "../../features/questionnaire/public.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../../features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../../features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { ActiveWorkoutsPort, RestTimersPort, TrainingExecutionPort, TrainingPlansRepositoryPort } from
  "../../features/training/public.ts";
import { createActiveWorkouts } from "../../read-models/activeWorkouts.ts";
import { RestTimerService, hasEnteredData, isWorkingSet, sessionDurationSec, sortHistory, workoutStatus } from "../../features/training/public.ts";
import { createTrainingHistory, type TrainingHistoryPort } from "../../read-models/trainingHistory.ts";
import { createClientBodyweight, type ClientBodyweightPort } from "../../read-models/clientBodyweight.ts";
import { expoRestSignal, preloadRestSignal } from "./expoRestSignal.ts";
import { DevExerciseCatalogRepository } from "../../features/exercises/data/DevExerciseCatalogRepository.ts";
import systemCatalogJson from "../../features/exercises/data/system-catalog.generated.json";
import { bodyPartLabels, displayNameOf, thumbnailOf, TRACKING_PROFILES, type CatalogEntry, type ExerciseCatalogPort, type SystemCatalog } from
  "../../features/exercises/public.ts";
import type { ExerciseLookupPort } from "../../features/training/public.ts";
import type { ClientArchivePort, ClientChangePort, ClientRecoveryDraftPort, ClientRepositoryPort,
  ClientRosterPort } from "../../features/clients/public.ts";
import { BootCoordinator } from "../bootstrap/BootCoordinator.ts";
import { createDevBootDependencies, DEV_WORKSPACE_ID } from "../bootstrap/DevBootDependencies.ts";
import { createProductionBootDependencies } from "../bootstrap/ProductionBootDependencies.ts";
import { PRODUCTION_DATABASE, PRODUCTION_WORKSPACE_ID, inspectProductionDatabase } from "./productionDatabase.ts";

type LocalClientServices = ClientRepositoryPort & ClientRecoveryDraftPort & ClientRosterPort
  & ClientChangePort & ClientArchivePort;

import { DevNotificationRepository, devNotificationClientDeletionParticipant } from "../../features/notifications/data/DevNotificationRepository.ts";
import { expoNotificationAdapter } from "../../features/notifications/data/ExpoNotificationAdapter.ts";
import { SCHEDULE_HORIZON_DAYS, candidateFromReminder, diffSchedule, dueReminders, outcomeDueCandidates, planReminders, reminderIdentifier, withinHorizon,
  type NotificationCenterPort, type PlatformNotificationPort } from "../../features/notifications/public.ts";
import { createNotificationSync, type NotificationSync } from "../../workflows/syncNotifications.ts";
import { importLegacyDevDatabase } from "./legacyDevImport.ts";
import { prepareDevSchema } from "./devSchema.ts";
import { createClientCardWorkflow, type ClientCardWithAnswersPort } from "../../workflows/saveClientCard.ts";
import { createCalcProfileWorkflow, type CalcProfileWithBodyPort } from "../../workflows/saveCalcProfile.ts";
import { createWeekCopyWorkflow, type TrainingTransaction } from "../../workflows/copyTrainingWeek.ts";
import { createWeekSwapWorkflow } from "../../workflows/swapTrainingWeeks.ts";
import { createMesocycleSaveWorkflow } from "../../workflows/saveTrainingMesocycle.ts";
import { createSimplePlanSaveWorkflow } from "../../workflows/saveTrainingSimplePlan.ts";
import { createWeekEditWorkflow } from "../../workflows/saveTrainingWeek.ts";
import { createMesocycleDeleteWorkflow } from "../../workflows/deleteTrainingMesocycle.ts";
import { createProgramDeleteWorkflow } from "../../workflows/deleteTrainingProgram.ts";
import { createPlanOnlyDeleteWorkflow } from "../../workflows/deleteTrainingPlanOnly.ts";
import type { MesocycleDeletePort, MesocycleSavePort, SimplePlanSavePort, WeekEditSavePort, PlanOnlyDeletePort, ProgramDeletePort, WeekCopyPort, WeekSwapPort } from "../../features/training/plans/public.ts";
import type { SqliteDatabaseLease } from "../../shared/db/SharedSqliteDatabase.ts";

/** Питание: каталог продуктов и рецептов (общий) и дневник клиента (N01–N02). */
export interface NutritionServices {
  readonly foods: FoodCatalogPort;
  readonly recipes: RecipeCatalogPort;
  readonly diary: NutritionDiaryPort;
  readonly targets: NutritionTargetsPort;
  readonly calc: NutritionCalcPort;
  /** Профиль расчёта вместе с полом и ростом карточки клиента — одной транзакцией. */
  readonly calcProfile: CalcProfileWithBodyPort;
}

/** Новая dev-база (D01): таблицы без префикса `dev_`; прежний файл `fitcoach_f04_clients_dev.db` читается только для одноразового переноса. */
const DEV_DATABASE = "fitcoach_dev_v3.db";

/** Shared port bindings; development tooling is absent from the ordinary runtime. */
export interface ApplicationServices {
  readonly developmentTools?: Readonly<{ runSqliteProbe: () => Promise<F04ProbeReport> }>;
  readonly clients: LocalClientServices;
  readonly calendar: CalendarRepositoryPort;
  readonly calendarParticipants: CalendarParticipantDirectoryPort;
  readonly accounting: AccountingRepositoryPort;
  readonly measurements: MeasurementRepositoryPort;
  readonly nutrition: NutritionServices;
  readonly questionnaire: QuestionnaireRepositoryPort;
  /** Z01: тема, акцент и видимые поля замеров тренера. */
  readonly settings: SettingsPort;
  /** Настройки и лента уведомлений (§§41, 54), граница с Android и сверка с календарём. */
  readonly notifications: NotificationCenterPort;
  readonly notificationPlatform: PlatformNotificationPort;
  readonly notificationSync: NotificationSync;
  /** Карточка клиента и ответы анкеты — одной транзакцией. */
  readonly clientCard: ClientCardWithAnswersPort;
  readonly trainingPlans: TrainingPlansRepositoryPort;
  readonly trainingExecution: TrainingExecutionPort;
  /** Таймеры отдыха всех клиентов (§48.62): глобальная панель и запуск из дневника. */
  readonly restTimers: RestTimersPort;
  /** Тренировки «в работе» у всех клиентов — быстрый переход между дневниками (§48.83). */
  readonly activeWorkouts: ActiveWorkoutsPort;
  /** §48.85: хронология занятий клиента — история и прогресс упражнения (X02). */
  readonly trainingHistory: TrainingHistoryPort;
  /** §48.86.36: ряд массы тела клиента для тоннажа упражнений с собственным весом. */
  readonly clientBodyweight: ClientBodyweightPort;
  readonly exercises: ExerciseCatalogPort;
  /** Каталог глазами планов тренировок: название, величины подхода, миниатюра. */
  readonly exerciseLookup: ExerciseLookupPort;
  /** §48.21, §48.24: копирование недели мезоцикла — планы и дневник в одной транзакции. */
  readonly weekCopy: WeekCopyPort;
  /** §48.21 п. 5: перестановка недель — позиции в плане и номера у выполнений в одной транзакции. */
  readonly weekSwap: WeekSwapPort;
  /** UI-OWN-041: мезоцикл из конструктора — план и проверка результатов удаляемых недель в одной транзакции. */
  readonly mesocycleSave: MesocycleSavePort & SimplePlanSavePort & WeekEditSavePort;
  /** §48.11, §50.3: удаление мезоцикла и программы у клиента — план и результаты одной транзакцией. */
  readonly planDelete: MesocycleDeletePort & ProgramDeletePort & PlanOnlyDeletePort;
  /** Active session types that can consume a credit, for SESSION_TYPE packs. */
  readonly listCreditSessionTypes: () => Promise<readonly Readonly<{ id: string; name: string }>[]>;
}

/** Clients serve only identity/display fields to Calendar, through their public ports. */
function participantDirectory(clients: ClientRosterPort & ClientChangePort): CalendarParticipantDirectoryPort {
  return {
    listParticipants: async () => {
      const [active, archived] = await Promise.all([
        clients.listRoster("ACTIVE"), clients.listRoster("ARCHIVED"),
      ]);
      return [...active, ...archived].map((row) => ({ id: row.id, displayName: row.displayName,
        emoji: row.emoji, active: row.lifecycle === "ACTIVE" }));
    },
    subscribe: (listener) => clients.subscribeCommittedChanges(() => listener()),
  };
}

/** Планы получают только поля отображения и профиль учёта, через публичный порт каталога. */
function exerciseLookup(exercises: ExerciseCatalogPort): ExerciseLookupPort {
  const infoOf = (entry: CatalogEntry, archived: boolean) => [entry.definition.id, {
    name: displayNameOf(entry),
    metrics: TRACKING_PROFILES[entry.definition.trackingProfile],
    thumbnail: thumbnailOf(entry.definition.media),
    unilateral: entry.definition.unilateral,
    group: { id: entry.definition.bodyPart, label: bodyPartLabels[entry.definition.bodyPart] },
    ...(archived ? { archived: true } : {}),
  }] as const;
  // Архивные свои упражнения остаются в справочнике только для чтения: в фактах они известны по id (имя и профиль не пропадают из истории).
  const build = async () => {
    const [active, archived] = await Promise.all([exercises.list(), exercises.listArchived()]);
    return new Map([...active.map((entry) => infoOf(entry, false)), ...archived.map((entry) => infoOf(entry, true))]);
  };
  // Справочник из 643 записей строится один раз и до следующей правки каталога отдаётся всем экранам: раньше каждый экран
  // читал и пересобирал его заново.
  let cached: ReturnType<typeof build> | null = null;
  exercises.subscribeCommittedChanges(() => { cached = null; });
  return {
    lookup: () => {
      const pending = cached ??= build();
      pending.catch(() => { if (cached === pending) cached = null; });
      return pending;
    },
    subscribe: (listener) => exercises.subscribeCommittedChanges(listener),
  };
}

export function createServices(clients: LocalClientServices, calendar: CalendarRepositoryPort,
  accounting: AccountingRepositoryPort, measurements: MeasurementRepositoryPort, nutrition: NutritionServices,
  questionnaire: QuestionnaireRepositoryPort, trainingPlans: TrainingPlansRepositoryPort,
  trainingExecution: TrainingExecutionPort, restTimers: RestTimersPort, exercises: ExerciseCatalogPort,
  weekCopy: WeekCopyPort, weekSwap: WeekSwapPort, mesocycleSave: MesocycleSavePort & SimplePlanSavePort & WeekEditSavePort,
  planDelete: MesocycleDeletePort & ProgramDeletePort & PlanOnlyDeletePort, settings: SettingsPort,
  clientCard: ClientCardWithAnswersPort, notifications: NotificationCenterPort,
  developmentTools?: ApplicationServices["developmentTools"]): ApplicationServices {
  return {
    ...(developmentTools === undefined ? {} : { developmentTools }),
    clients,
    calendar,
    calendarParticipants: participantDirectory(clients),
    accounting,
    measurements,
    nutrition,
    questionnaire,
    settings,
    notifications,
    notificationPlatform: expoNotificationAdapter,
    notificationSync: createNotificationSync({ planReminders, dueReminders, candidateFromReminder, outcomeDueCandidates, diffSchedule, reminderIdentifier, withinHorizon,
      horizonDays: SCHEDULE_HORIZON_DAYS }, { calendar, participants: participantDirectory(clients), center: notifications, platform: expoNotificationAdapter }),
    clientCard,
    trainingPlans,
    trainingExecution,
    restTimers,
    activeWorkouts: createActiveWorkouts(trainingExecution, trainingPlans, clients),
    trainingHistory: createTrainingHistory({ hasEnteredData, isWorkingSet, sessionDurationSec, workoutStatus, sortHistory }, trainingExecution, trainingPlans),
    clientBodyweight: createClientBodyweight(dailyPoints, measurements),
    exercises,
    exerciseLookup: exerciseLookup(exercises),
    weekCopy,
    weekSwap,
    mesocycleSave,
    planDelete,
    listCreditSessionTypes: async () => (await calendar.listSessionTypes())
      .filter((type) => type.requiresCredit && !type.archived)
      .map((type) => ({ id: type.id, name: type.name })),
  };
}

export interface ApplicationRuntime {
  readonly development: boolean;
  readonly boot: BootCoordinator;
  readonly services: ApplicationServices;
}

export function createRuntime(mode: "development" | "production"): ApplicationRuntime {
  // All owners share one file in each mode: a client delete, a booking and its
  // reservation each commit as one transaction across owners.
  const development = mode === "development";
  const workspaceId = development ? DEV_WORKSPACE_ID : PRODUCTION_WORKSPACE_ID;
  const database = new SharedSqliteDatabase(() => development ? openExpoSqliteConnection(DEV_DATABASE)
    : openExpoSqliteConnection(PRODUCTION_DATABASE, inspectProductionDatabase));
  const clients = new DevClientRepository(database, workspaceId,
    [devAccountingClientDeletionParticipant, devCalendarClientDeletionParticipant, devNotificationClientDeletionParticipant,
      devMeasurementClientDeletionParticipant, devNutritionCalcClientDeletionParticipant, devNutritionClientDeletionParticipant, devNutritionTargetsClientDeletionParticipant, devQuestionnaireClientDeletionParticipant,
      devTrainingPlansClientDeletionParticipant, devTrainingExecutionClientDeletionParticipant]);
  const calendar = new DevCalendarRepository(database, workspaceId, devAccountingCalendarHook);
  const accounting = new DevAccountingRepository(database, workspaceId);
  const measurements = new DevMeasurementRepository(database, workspaceId);
  const nutrition = { foods: new DevFoodCatalogRepository(database, workspaceId),
    recipes: new DevRecipeCatalogRepository(database, workspaceId), diary: new DevNutritionDiaryRepository(database, workspaceId),
    targets: new DevNutritionTargetsRepository(database, workspaceId), calc: new DevNutritionCalcRepository(database, workspaceId) };
  const questionnaire = new DevQuestionnaireRepository(database, workspaceId);
  const settings = new DevSettingsRepository(database, workspaceId);
  const notifications = new DevNotificationRepository(database, workspaceId);
  const trainingPlans = new DevTrainingPlansRepository(database, workspaceId);
  const trainingExecution = new DevTrainingExecutionRepository(database, workspaceId);
  const restTimers = new RestTimerService(trainingExecution, expoRestSignal);
  // Системный каталог — снимок RepDB Free, собранный `npm run catalog:build` (§29, §39.12).
  const exercises = new DevExerciseCatalogRepository(database, workspaceId, systemCatalogJson as SystemCatalog);
  // Calendar commands move reservations inside their own transactions.
  calendar.subscribeCommittedChanges(() => accounting.notifyExternalChange());
  // Общая транзакция для workflow: база открыта на всё время работы приложения, как у репозиториев.
  let lease: Promise<SqliteDatabaseLease> | null = null;
  const transaction: TrainingTransaction = async (task) => (await (lease ??= database.acquire())).writer.write(task);
  const calcProfile = createCalcProfileWorkflow(transaction, nutrition.calc.profileParticipant, clients.bodyParticipant);
  const clientCard = createClientCardWorkflow(transaction, clients.cardParticipant, questionnaire.answersParticipant);
  const weekCopy = createWeekCopyWorkflow(transaction, trainingPlans.weekCopyParticipant, trainingExecution.weekCopyParticipant,
    exerciseLookup(exercises));
  const weekSwap = createWeekSwapWorkflow(transaction, trainingPlans.weekSwapParticipant, trainingExecution.weekRenumberParticipant);
  const mesocycleSave = { ...createMesocycleSaveWorkflow(transaction, trainingPlans.mesocycleSaveParticipant, trainingExecution.weekCopyParticipant, trainingExecution.cleanupParticipant),
    ...createSimplePlanSaveWorkflow(transaction, trainingPlans.simplePlanSaveParticipant, trainingExecution.weekCopyParticipant),
    ...createWeekEditWorkflow(transaction, trainingPlans.weekEditSaveParticipant, trainingExecution.weekCopyParticipant, trainingExecution.cleanupParticipant) };
  const planDelete = { ...createMesocycleDeleteWorkflow(transaction, trainingPlans.deleteParticipant, trainingExecution.cleanupParticipant),
    ...createProgramDeleteWorkflow(transaction, trainingPlans.deleteParticipant, trainingExecution.cleanupParticipant),
    ...createPlanOnlyDeleteWorkflow(transaction, trainingPlans.deleteParticipant, trainingExecution.cleanupParticipant) };
  const initializeRepositories = async () => {
    await clients.initialize();
    await calendar.initialize();
    await accounting.initialize();
    await measurements.initialize();
    // Порядок важен: дневник ссылается на клиентов, рецепты — на продукты.
    await nutrition.foods.initialize();
    await nutrition.recipes.initialize();
    await nutrition.diary.initialize();
    await nutrition.targets.initialize();
    await nutrition.calc.initialize();
    await questionnaire.initialize();
    await settings.initialize();
    await notifications.initialize();
    await trainingPlans.initialize();
    await trainingExecution.initialize();
    // Таймеры отдыха — не данные: сбой восстановления не мешает запуску (§44.7).
    await restTimers.recover().catch(() => undefined);
    preloadRestSignal();
    await exercises.initialize();
  };
  const dependencies = development ? createDevBootDependencies(
    () => openExpoSqliteConnection("fitcoach_f03_dev_gate.db"), async () => {
      await prepareDevSchema(database);
      await importLegacyDevDatabase(database);
      await initializeRepositories();
    }) : createProductionBootDependencies(database, initializeRepositories, () => settings.readAppearance());
  return {
    development,
    boot: new BootCoordinator(dependencies),
    services: createServices(clients, calendar, accounting, measurements, { ...nutrition, calcProfile }, questionnaire, trainingPlans, trainingExecution,
      restTimers, exercises, weekCopy, weekSwap, mesocycleSave, planDelete, settings, clientCard, notifications,
      development ? { runSqliteProbe: () => runF04Probe(() => openExpoSqliteConnection("fitcoach_f04_probe.db")) } : undefined),
  };
}
