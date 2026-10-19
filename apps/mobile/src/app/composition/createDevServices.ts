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
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from
  "../../features/measurements/data/DevMeasurementRepository.ts";
import type { MeasurementRepositoryPort } from "../../features/measurements/public.ts";
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
import { RestTimerService } from "../../features/training/public.ts";
import { expoRestSignal, preloadRestSignal } from "./expoRestSignal.ts";
import { DevExerciseCatalogRepository } from "../../features/exercises/data/DevExerciseCatalogRepository.ts";
import systemCatalogJson from "../../features/exercises/data/system-catalog.generated.json";
import { displayNameOf, thumbnailOf, TRACKING_PROFILES, type ExerciseCatalogPort, type SystemCatalog } from
  "../../features/exercises/public.ts";
import type { ExerciseLookupPort } from "../../features/training/public.ts";
import type { ClientArchivePort, ClientChangePort, ClientRecoveryDraftPort, ClientRepositoryPort,
  ClientRosterPort } from "../../features/clients/public.ts";
import { BootCoordinator } from "../bootstrap/BootCoordinator.ts";
import { createDevBootDependencies, DEV_WORKSPACE_ID } from "../bootstrap/DevBootDependencies.ts";

type DevClientServices = ClientRepositoryPort & ClientRecoveryDraftPort & ClientRosterPort
  & ClientChangePort & ClientArchivePort;

import { createWeekCopyWorkflow, type TrainingTransaction } from "../../workflows/copyTrainingWeek.ts";
import { createWeekSwapWorkflow } from "../../workflows/swapTrainingWeeks.ts";
import { createMesocycleSaveWorkflow } from "../../workflows/saveTrainingMesocycle.ts";
import type { MesocycleSavePort, WeekCopyPort, WeekSwapPort } from "../../features/training/plans/public.ts";
import type { SqliteDatabaseLease } from "../../shared/db/SharedSqliteDatabase.ts";

/** Explicit dev composition. Production boot will get separate, owner-scoped bindings. */
export interface DevServices {
  readonly runSqliteProbe: () => Promise<F04ProbeReport>;
  readonly clients: DevClientServices;
  readonly calendar: CalendarRepositoryPort;
  readonly calendarParticipants: CalendarParticipantDirectoryPort;
  readonly accounting: AccountingRepositoryPort;
  readonly measurements: MeasurementRepositoryPort;
  readonly questionnaire: QuestionnaireRepositoryPort;
  readonly trainingPlans: TrainingPlansRepositoryPort;
  readonly trainingExecution: TrainingExecutionPort;
  /** Таймеры отдыха всех клиентов (§48.62): глобальная панель и запуск из дневника. */
  readonly restTimers: RestTimersPort;
  /** Тренировки «в работе» у всех клиентов — быстрый переход между дневниками (§48.83). */
  readonly activeWorkouts: ActiveWorkoutsPort;
  readonly exercises: ExerciseCatalogPort;
  /** Каталог глазами планов тренировок: название, величины подхода, миниатюра. */
  readonly exerciseLookup: ExerciseLookupPort;
  /** §48.21, §48.24: копирование недели мезоцикла — планы и дневник в одной транзакции. */
  readonly weekCopy: WeekCopyPort;
  /** §48.21 п. 5: перестановка недель — позиции в плане и номера у выполнений в одной транзакции. */
  readonly weekSwap: WeekSwapPort;
  /** UI-OWN-041: мезоцикл из конструктора — план и проверка результатов удаляемых недель в одной транзакции. */
  readonly mesocycleSave: MesocycleSavePort;
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
  return {
    lookup: async () => new Map((await exercises.list()).map((entry) => [entry.definition.id, {
      name: displayNameOf(entry),
      metrics: TRACKING_PROFILES[entry.definition.trackingProfile],
      thumbnail: thumbnailOf(entry.definition.media),
      unilateral: entry.definition.unilateral,
    }])),
    subscribe: (listener) => exercises.subscribeCommittedChanges(listener),
  };
}

export function createDevServices(clients: DevClientServices, calendar: CalendarRepositoryPort,
  accounting: AccountingRepositoryPort, measurements: MeasurementRepositoryPort,
  questionnaire: QuestionnaireRepositoryPort, trainingPlans: TrainingPlansRepositoryPort,
  trainingExecution: TrainingExecutionPort, restTimers: RestTimersPort, exercises: ExerciseCatalogPort,
  weekCopy: WeekCopyPort, weekSwap: WeekSwapPort, mesocycleSave: MesocycleSavePort): DevServices {
  return {
    runSqliteProbe: () => runF04Probe(() => openExpoSqliteConnection("fitcoach_f04_probe.db")),
    clients,
    calendar,
    calendarParticipants: participantDirectory(clients),
    accounting,
    measurements,
    questionnaire,
    trainingPlans,
    trainingExecution,
    restTimers,
    activeWorkouts: createActiveWorkouts(trainingExecution, trainingPlans, clients),
    exercises,
    exerciseLookup: exerciseLookup(exercises),
    weekCopy,
    weekSwap,
    mesocycleSave,
    listCreditSessionTypes: async () => (await calendar.listSessionTypes())
      .filter((type) => type.requiresCredit && !type.archived)
      .map((type) => ({ id: type.id, name: type.name })),
  };
}

export interface DevRuntime {
  readonly boot: BootCoordinator;
  readonly services: DevServices;
}

export function createDevRuntime(): DevRuntime {
  // Clients, Calendar and Accounting share one dev file: a client delete, a booking and its
  // reservation each commit as one transaction across owners.
  const database = new SharedSqliteDatabase(() => openExpoSqliteConnection("fitcoach_f04_clients_dev.db"));
  const clients = new DevClientRepository(database, DEV_WORKSPACE_ID,
    [devAccountingClientDeletionParticipant, devCalendarClientDeletionParticipant,
      devMeasurementClientDeletionParticipant, devQuestionnaireClientDeletionParticipant,
      devTrainingPlansClientDeletionParticipant, devTrainingExecutionClientDeletionParticipant]);
  const calendar = new DevCalendarRepository(database, DEV_WORKSPACE_ID, devAccountingCalendarHook);
  const accounting = new DevAccountingRepository(database, DEV_WORKSPACE_ID);
  const measurements = new DevMeasurementRepository(database, DEV_WORKSPACE_ID);
  const questionnaire = new DevQuestionnaireRepository(database, DEV_WORKSPACE_ID);
  const trainingPlans = new DevTrainingPlansRepository(database, DEV_WORKSPACE_ID);
  const trainingExecution = new DevTrainingExecutionRepository(database, DEV_WORKSPACE_ID);
  const restTimers = new RestTimerService(trainingExecution, expoRestSignal);
  // Системный каталог — снимок RepDB Free, собранный `npm run catalog:build` (§29, §39.12).
  const exercises = new DevExerciseCatalogRepository(database, DEV_WORKSPACE_ID, systemCatalogJson as SystemCatalog);
  // Calendar commands move reservations inside their own transactions.
  calendar.subscribeCommittedChanges(() => accounting.notifyExternalChange());
  // Общая транзакция для workflow: база открыта на всё время работы приложения, как у репозиториев.
  let lease: Promise<SqliteDatabaseLease> | null = null;
  const transaction: TrainingTransaction = async (task) => (await (lease ??= database.acquire())).writer.write(task);
  const weekCopy = createWeekCopyWorkflow(transaction, trainingPlans.weekCopyParticipant, trainingExecution.weekCopyParticipant,
    exerciseLookup(exercises));
  const weekSwap = createWeekSwapWorkflow(transaction, trainingPlans.weekSwapParticipant, trainingExecution.weekRenumberParticipant);
  const mesocycleSave = createMesocycleSaveWorkflow(transaction, trainingPlans.mesocycleSaveParticipant, trainingExecution.weekCopyParticipant);
  return {
    boot: new BootCoordinator(createDevBootDependencies(
      () => openExpoSqliteConnection("fitcoach_f03_dev_gate.db"),
      async () => {
        await clients.initialize();
        await calendar.initialize();
        await accounting.initialize();
        await measurements.initialize();
        await questionnaire.initialize();
        await trainingPlans.initialize();
        await trainingExecution.initialize();
        // Таймеры отдыха — не данные: сбой восстановления не мешает запуску (§44.7).
        await restTimers.recover().catch(() => undefined);
        preloadRestSignal();
        await exercises.initialize();
      },
    )),
    services: createDevServices(clients, calendar, accounting, measurements, questionnaire, trainingPlans, trainingExecution, restTimers, exercises, weekCopy, weekSwap, mesocycleSave),
  };
}
