import type { DatabaseSync } from "node:sqlite";
import type { LegacySourceReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacySourceReadPlans.ts";

/** Executes exactly the mobile read plan on the caller's immutable snapshot. */
export function runNodeLegacyReadPlan<Result>(db: DatabaseSync, plan: LegacySourceReadPlan<Result>): Result {
  let step = plan.next();
  while (!step.done) {
    const request = step.value;
    let rows;
    try { rows = db.prepare(request.sql).all(...request.bindings); } catch { throw new Error("R04_SOURCE_READ_FAILED"); }
    step = plan.next(rows);
  }
  return step.value;
}
