import type { DatabaseSync } from "node:sqlite";
import type { LegacyClientCheckpoint, LegacyStageRow, LegacyWritePlan } from "../../apps/mobile/src/shared/migration/LegacyWritePlan.ts";

/** Executes the mobile plan synchronously inside the caller's existing transaction. */
export function runNodeLegacyWritePlan<Result>(db: DatabaseSync, plan: LegacyWritePlan<Result>, checkpoint: (phase: LegacyClientCheckpoint) => void = () => undefined): Result {
  let step = plan.next();
  while (!step.done) {
    const request = step.value;
    let rows: readonly LegacyStageRow[] = [];
    if (request.kind === "checkpoint") checkpoint(request.phase);
    else if (request.kind === "all") rows = db.prepare(request.sql).all(...request.bindings);
    else db.prepare(request.sql).run(...request.bindings);
    step = plan.next(rows);
  }
  return step.value;
}
