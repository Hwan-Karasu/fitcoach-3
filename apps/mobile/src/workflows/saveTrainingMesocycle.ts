import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { MesocycleSavePlansParticipant, MesocycleSavePort } from "../features/training/plans/public.ts";
import type { WeekExecutionParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Сохранение мезоцикла из конструктора (UI-OWN-041): проверка результатов в удаляемых неделях (дневник) и запись
 * плана — одной транзакцией. Факты не уничтожаются: неделя с результатами не удаляется. Уведомления — после commit.
 */
export function createMesocycleSaveWorkflow(transaction: TrainingTransaction, plans: MesocycleSavePlansParticipant<SqliteStatementPort>,
  execution: WeekExecutionParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): MesocycleSavePort {
  return {
    save: async (request) => {
      const saved = await transaction(async (tx) => {
        const removed = await plans.removedWorkouts(tx, request);
        const executions = await execution.read(tx, removed.map((item) => ({ clientId: request.clientId,
          programId: request.programId, weekIndex: item.weekIndex, plannedWorkoutId: item.plannedWorkoutId })));
        if (executions.some((value) => value.session !== null || value.facts.size > 0)) throw new Error("WEEK_HAS_RESULTS");
        return plans.save(tx, request, now());
      });
      plans.notify(request.clientIds);
      execution.notify(request.clientId, request.programId);
      return saved;
    },
  };
}
