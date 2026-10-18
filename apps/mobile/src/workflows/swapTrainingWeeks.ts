import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { WeekSwapPlansParticipant, WeekSwapPort } from "../features/training/plans/public.ts";
import type { WeekRenumberParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Перестановка недель (§48.21 п. 5): позиции недель в плане и номера недель у выполнений меняются одной
 * транзакцией — результаты остаются при своих тренировках. Уведомления — после commit.
 */
export function createWeekSwapWorkflow(transaction: TrainingTransaction, plans: WeekSwapPlansParticipant<SqliteStatementPort>,
  execution: WeekRenumberParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): WeekSwapPort {
  return {
    swap: async (request) => {
      if (request.first === request.second) return;
      await transaction(async (tx) => {
        const stamp = now();
        const moved = await plans.swap(tx, request, stamp);
        await execution.renumber(tx, { clientId: request.clientId, programId: request.programId, first: request.first,
          second: request.second, toSecond: moved.toSecond, toFirst: moved.toFirst }, stamp);
      });
      plans.notify(request.clientId);
      execution.notify(request.clientId, request.programId);
    },
  };
}
