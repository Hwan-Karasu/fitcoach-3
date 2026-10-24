import type { DatabaseSync } from "node:sqlite";
import { legacyCalendarReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacySourceReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";

export { LEGACY_CALENDAR_COLUMNS } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
export type { LegacyCalendarSnapshot, LegacySourceRow as CalendarRaw } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";

export function readLegacyCalendarSnapshot(db: DatabaseSync, accountScope: string) {
  return runNodeLegacyReadPlan(db, legacyCalendarReadPlan(accountScope));
}
