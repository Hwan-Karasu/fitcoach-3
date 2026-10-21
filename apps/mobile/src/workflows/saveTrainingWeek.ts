import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { WeekEditSavePlansParticipant, WeekEditSavePort, WeekEditSlot } from "../features/training/plans/public.ts";
import type { ExecutionCleanupParticipant, WeekExecutionParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Сохранение правки недели (§48.6): работа с результатами убираемых тренировок (дневник) и запись планов участников — одной
 * транзакцией. Тренировка с результатами без явного выбора не убирается (`WEEK_HAS_RESULTS`); выбор — удалить результаты окончательно
 * (§48.30) или оставить их в истории со снимком происхождения (§50.3). Уведомления — после commit.
 */
export function createWeekEditWorkflow(transaction: TrainingTransaction, plans: WeekEditSavePlansParticipant<SqliteStatementPort>,
  execution: WeekExecutionParticipant<SqliteStatementPort>, cleanup: ExecutionCleanupParticipant<SqliteStatementPort>,
  now: () => Date = () => new Date()): WeekEditSavePort {
  return {
    saveWeek: async (request) => {
      const touched = new Map<string, Readonly<{ clientId: string; programId: string }>>();
      const saved = await transaction(async (tx) => {
        const removed = await plans.removedWorkouts(tx, request);
        const executions = await execution.read(tx, removed);
        const withResults = removed.filter((_, at) => {
          const value = executions[at];
          return value !== undefined && value.session !== null && (value.facts.size > 0 || value.session.outcome !== null);
        });
        if (withResults.length > 0) {
          if (request.resultsAction === undefined) throw new Error("WEEK_HAS_RESULTS");
          const groups = new Map<string, WeekEditSlot[]>();
          for (const slot of withResults) groups.set(`${slot.clientId}|${slot.programId}`, [...(groups.get(`${slot.clientId}|${slot.programId}`) ?? []), slot]);
          const stamp = now();
          for (const slots of groups.values()) {
            const { clientId, programId } = slots[0]!;
            const ids = slots.map((slot) => slot.plannedWorkoutId);
            if (request.resultsAction === "DELETE") await cleanup.remove(tx, clientId, programId, ids);
            else {
              await cleanup.keepAsHistory(tx, clientId, programId, (weekIndex, plannedWorkoutId) => {
                const slot = slots.find((item) => item.weekIndex === weekIndex && item.plannedWorkoutId === plannedWorkoutId)!;
                return { programTitle: slot.programTitle, programKind: "PERIODIZED", mesocycleTitle: slot.mesocycleTitle, workoutTitle: slot.workoutTitle };
              }, stamp, ids);
            }
            touched.set(`${clientId}|${programId}`, { clientId, programId });
          }
        }
        return plans.save(tx, request, now());
      });
      plans.notify(request.input.clientIds);
      execution.notify(request.clientId, request.programId);
      for (const { clientId, programId } of touched.values()) {
        if (clientId !== request.clientId || programId !== request.programId) execution.notify(clientId, programId);
      }
      return saved;
    },
  };
}
