import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { PlanDeletePlansParticipant, PlanOnlyDeletePort } from "../features/training/plans/public.ts";
import type { ExecutionCleanupParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * §50.3, действие 1: «Удалить план, сохранить историю занятий» для архивной программы клиента. В одной транзакции
 * выполнения клиента получают неизменяемый снимок происхождения (программа, мезоцикл, тренировка), затем удаляется
 * его план. Факты и подходы не удаляются — остаются в истории, статистике и рекордах с пометкой «исходный план удалён».
 */
export function createPlanOnlyDeleteWorkflow(transaction: TrainingTransaction, plans: PlanDeletePlansParticipant<SqliteStatementPort>,
  execution: ExecutionCleanupParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): PlanOnlyDeletePort {
  return {
    deletePlanKeepHistory: async (request) => {
      await transaction(async (tx) => {
        const stamp = now();
        const origins = await plans.planOrigins(tx, request);
        await execution.keepAsHistory(tx, request.clientId, request.programId, (weekIndex, plannedWorkoutId) => {
          const slot = origins.slots.get(`${weekIndex}:${plannedWorkoutId}`);
          return { programTitle: origins.programTitle, programKind: origins.programKind,
            mesocycleTitle: slot?.mesocycleTitle ?? null, workoutTitle: slot?.workoutTitle ?? null };
        }, stamp);
        await plans.deleteProgram(tx, request, stamp);
      });
      plans.notify([request.clientId]);
      execution.notify(request.clientId, request.programId);
    },
  };
}
