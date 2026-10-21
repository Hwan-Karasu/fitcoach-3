import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { MesocycleSavePlansParticipant, MesocycleSavePort } from "../features/training/plans/public.ts";
import type { ExecutionCleanupParticipant, WeekExecutionParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Сохранение мезоцикла из конструктора (UI-OWN-041): работа с результатами убираемых тренировок (дневник) и запись плана —
 * одной транзакцией. Тренировка с результатами без явного выбора не убирается (`WEEK_HAS_RESULTS`); выбор — удалить результаты
 * окончательно (§48.30) или оставить их в истории со снимком происхождения (§50.3). Уведомления — после commit.
 */
export function createMesocycleSaveWorkflow(transaction: TrainingTransaction, plans: MesocycleSavePlansParticipant<SqliteStatementPort>,
  execution: WeekExecutionParticipant<SqliteStatementPort>, cleanup: ExecutionCleanupParticipant<SqliteStatementPort>,
  now: () => Date = () => new Date()): MesocycleSavePort {
  return {
    save: async (request) => {
      const saved = await transaction(async (tx) => {
        const removed = await plans.removedWorkouts(tx, request);
        const executions = await execution.read(tx, removed.map((item) => ({ clientId: request.clientId,
          programId: request.programId, weekIndex: item.weekIndex, plannedWorkoutId: item.plannedWorkoutId })));
        const withResults = removed.filter((_, at) => {
          const value = executions[at];
          return value !== undefined && (value.session !== null || value.facts.size > 0);
        });
        if (withResults.length > 0) {
          if (request.resultsAction === undefined) throw new Error("WEEK_HAS_RESULTS");
          const ids = withResults.map((item) => item.plannedWorkoutId);
          if (request.resultsAction === "DELETE") await cleanup.remove(tx, request.clientId, request.programId, ids);
          else {
            await cleanup.keepAsHistory(tx, request.clientId, request.programId, (weekIndex, plannedWorkoutId) => {
              const slot = withResults.find((item) => item.weekIndex === weekIndex && item.plannedWorkoutId === plannedWorkoutId)!;
              return { programTitle: slot.programTitle, programKind: "PERIODIZED", mesocycleTitle: slot.mesocycleTitle, workoutTitle: slot.workoutTitle };
            }, now(), ids);
          }
        }
        return plans.save(tx, request, now());
      });
      plans.notify(request.clientIds);
      execution.notify(request.clientId, request.programId);
      return saved;
    },
  };
}
