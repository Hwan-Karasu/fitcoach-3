import type { DatabaseSync } from "node:sqlite";
import { legacyPlansReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacyTrainingReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";
export { PLAN_SOURCE_TABLES } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
export type { PlanSourceTable, LegacyPlansSource } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";

/** Same full-row plan as mobile. Caller owns an immutable source snapshot. */
export function readLegacyPlansInSnapshot(db: DatabaseSync, accountScope: string) {
  return runNodeLegacyReadPlan(db, legacyPlansReadPlan(accountScope));
}
