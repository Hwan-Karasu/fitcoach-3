import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { MesocycleDeletePort, PlanDeletePlansParticipant } from "../features/training/plans/public.ts";
import type { ExecutionCleanupParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Удаление мезоцикла у этого клиента (§48.11): его недели и тренировки (планы) и выполнения с фактами этих
 * тренировок (дневник) — одной транзакцией. У других участников группы копии и результаты остаются.
 */
export function createMesocycleDeleteWorkflow(transaction: TrainingTransaction, plans: PlanDeletePlansParticipant<SqliteStatementPort>,
  execution: ExecutionCleanupParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): MesocycleDeletePort {
  return {
    deleteMesocycle: async (request) => {
      const selected = await transaction(async (tx) => {
        const workouts = await plans.mesocycleWorkouts(tx, request);
        await execution.remove(tx, request.clientId, request.programId, workouts);
        return plans.deleteMesocycle(tx, request, now());
      });
      plans.notify([request.clientId]);
      execution.notify(request.clientId, request.programId);
      return selected;
    },
  };
}
