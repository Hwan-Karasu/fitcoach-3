import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { PlanDeletePlansParticipant, ProgramDeletePort } from "../features/training/plans/public.ts";
import type { ExecutionCleanupParticipant } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * Удаление программы у этого клиента «полностью с результатами» (§50.3): его участие и план, его выполнения и факты.
 * Остальные участники сохраняют программу; если клиент был последним — программа удаляется целиком.
 */
export function createProgramDeleteWorkflow(transaction: TrainingTransaction, plans: PlanDeletePlansParticipant<SqliteStatementPort>,
  execution: ExecutionCleanupParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): ProgramDeletePort {
  return {
    deleteProgram: async (request) => {
      await transaction(async (tx) => {
        await execution.remove(tx, request.clientId, request.programId, null);
        await plans.deleteProgram(tx, request, now());
      });
      plans.notify([request.clientId]);
      execution.notify(request.clientId, request.programId);
    },
  };
}
