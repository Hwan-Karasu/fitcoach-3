import type { ClientRosterRow } from "./ClientRosterPort.ts";
import type { RosterClientOverview } from "./ClientRosterOverview.ts";

export interface ClientRosterFilters {
  readonly sex: "ALL" | "MALE" | "FEMALE" | "UNSPECIFIED";
  readonly health: "ALL" | "RESTRICTED" | "UNMARKED";
  readonly credit: "ALL" | "AVAILABLE" | "EMPTY" | "NO_PACK" | "NOT_TRACKED";
}
export const EMPTY_ROSTER_FILTERS: ClientRosterFilters = { sex: "ALL", health: "ALL", credit: "ALL" };
export function rosterFilterCount(filters: ClientRosterFilters): number {
  return Number(filters.sex !== "ALL") + Number(filters.health !== "ALL") + Number(filters.credit !== "ALL");
}
/** Intersects only explicit structured fields; health text never enters identity search. */
export function matchesRosterFilters(row: ClientRosterRow, facts: RosterClientOverview | undefined, filters: ClientRosterFilters): boolean {
  if (filters.sex !== "ALL" && (filters.sex === "UNSPECIFIED" ? row.sex != null : row.sex !== filters.sex)) return false;
  if (filters.health !== "ALL" && (facts === undefined || facts.restrictionsKnown === false
    || (filters.health === "RESTRICTED" ? !facts.restricted : facts.restricted))) return false;
  if (filters.credit !== "ALL" && facts?.creditStatus !== filters.credit) return false;
  return true;
}
