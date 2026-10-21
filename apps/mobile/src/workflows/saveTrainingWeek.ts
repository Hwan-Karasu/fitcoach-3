import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { WeekEditSavePlansParticipant, WeekEditSavePort } from "../features/training/plans/public.ts";
import type { WeekExecutionParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Сохранение правки недели (§48.6): проверка результатов в убираемых тренировках (дневник) и запись планов участников — одной
 * транзакцией. Факты не уничтожаются: тренировка с результатами не убирается (`WEEK_HAS_RESULTS`). Уведомления — после commit.
 */
export function createWeekEditWorkflow(transaction: TrainingTransaction, plans: WeekEditSavePlansParticipant<SqliteStatementPort>,
  execution: WeekExecutionParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): WeekEditSavePort {
  return {
    saveWeek: async (request) => {
      const saved = await transaction(async (tx) => {
        const removed = await plans.removedWorkouts(tx, request);
        const executions = await execution.read(tx, removed);
        if (executions.some((value) => value.session !== null && (value.facts.size > 0 || value.session.outcome !== null))) {
          throw new Error("WEEK_HAS_RESULTS");
        }
        return plans.save(tx, request, now());
      });
      plans.notify(request.input.clientIds);
      execution.notify(request.clientId, request.programId);
      return saved;
    },
  };
}
