import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { SimplePlanSavePlansParticipant, SimplePlanSavePort } from "../features/training/plans/public.ts";
import type { WeekExecutionParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Сохранение Простой программы (§48.5): проверка результатов в убираемых неделях и тренировках (дневник) и запись плана —
 * одной транзакцией. Без подтверждения правка, убирающая выполненное, отклоняется (`WEEKS_HAVE_RESULTS`); с подтверждением
 * результаты остаются в истории. Уведомления — после commit.
 */
export function createSimplePlanSaveWorkflow(transaction: TrainingTransaction, plans: SimplePlanSavePlansParticipant<SqliteStatementPort>,
  execution: WeekExecutionParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): SimplePlanSavePort {
  return {
    saveSimplePlan: async (request) => {
      const saved = await transaction(async (tx) => {
        if (!request.confirmRemovedResults) {
          const removed = await plans.removedWorkouts(tx, request);
          const executions = await execution.read(tx, removed.map((item) => ({ clientId: request.clientId,
            programId: request.programId, weekIndex: item.weekIndex, plannedWorkoutId: item.plannedWorkoutId })));
          if (executions.some((value) => value.session !== null && (value.facts.size > 0 || value.session.outcome !== null))) {
            throw new Error("WEEKS_HAVE_RESULTS");
          }
        }
        return plans.save(tx, request, now());
      });
      plans.notify(saved.memberClientIds);
      execution.notify(request.clientId, request.programId);
      return saved;
    },
  };
}
