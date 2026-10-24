import type { SqliteStatementPort, SqlValue } from "../db/SqlitePort.ts";

export type LegacyStageRow = Readonly<Record<string, unknown>>;
export type LegacyExerciseCheckpoint = "after-exercise-ids" | "after-exercise-registry" | "after-exercise-overlay" | "after-exercise-links" | "after-exercise-receipt";
export type LegacyPlanCheckpoint = "after-plan-ids" | "after-plan-rows" | "after-plan-source" | "after-plan-receipt" | "after-archive-plans";
export type LegacyExecutionCheckpoint = "after-execution-ids" | "after-execution-sessions" | "after-execution-facts" | "after-execution-segments" | "after-execution-representations" | "after-execution-contexts" | "after-execution-receipt";
export type LegacyMeasurementCheckpoint = "after-measurement-ids" | "after-measurement-rows" | "after-measurement-receipt";
export type LegacyClientCheckpoint = "after-ids" | "after-client" | "after-clients" | "after-profile" | "after-work-data" | "before-commit" | LegacyExerciseCheckpoint | LegacyPlanCheckpoint | LegacyExecutionCheckpoint | LegacyMeasurementCheckpoint;
export type LegacyWriteRequest = Readonly<{ kind: "all" | "run"; sql: string; bindings: readonly SqlValue[] }>
  | Readonly<{ kind: "checkpoint"; phase: LegacyClientCheckpoint }>;
/** Caller owns the entire exclusive transaction, including all delegated owners. */
export type LegacyWritePlan<Result> = Generator<LegacyWriteRequest, Result, readonly LegacyStageRow[]>;
export const legacyStageQuery = (sql: string, bindings: readonly SqlValue[] = []): LegacyWriteRequest => ({ kind: "all", sql, bindings });
export const legacyStageRun = (sql: string, bindings: readonly SqlValue[] = []): LegacyWriteRequest => ({ kind: "run", sql, bindings });

export async function runLegacyWritePlan<Result>(tx: SqliteStatementPort, plan: LegacyWritePlan<Result>, checkpoint: (phase: LegacyClientCheckpoint) => void | Promise<void> = () => undefined): Promise<Result> {
  let step = plan.next();
  while (!step.done) {
    const request = step.value;
    let rows: readonly LegacyStageRow[] = [];
    if (request.kind === "checkpoint") await checkpoint(request.phase);
    else if (request.kind === "all") rows = await tx.all<LegacyStageRow>(request.sql, request.bindings);
    else await tx.run(request.sql, request.bindings);
    step = plan.next(rows);
  }
  return step.value;
}
