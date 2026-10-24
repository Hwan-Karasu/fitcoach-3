import type { DatabaseSync } from "node:sqlite";
import { legacyExecutionReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacyTrainingReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";
export { EXECUTION_SOURCE_TABLES } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
export type { ExecutionSourceTable, LegacyExecutionSource, LegacySourceRow as ExecutionRaw } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";

/** Same full-row plan as mobile, including absent/partial session-store checks. */
export function readLegacyExecutionInSnapshot(db: DatabaseSync, accountScope: string) {
  return runNodeLegacyReadPlan(db, legacyExecutionReadPlan(accountScope));
}
