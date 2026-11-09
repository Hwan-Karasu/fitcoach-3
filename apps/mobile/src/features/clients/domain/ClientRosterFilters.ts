import { CREDITS_ENDING_MAX } from "../../../shared/domain/CreditsEnding.ts";
import type { ClientRosterRow } from "./ClientRosterPort.ts";
import type { RosterClientOverview, RosterOverview } from "./ClientRosterOverview.ts";

export interface ClientRosterFilters {
  readonly sex: "ALL" | "MALE" | "FEMALE" | "UNSPECIFIED";
  readonly health: "ALL" | "RESTRICTED" | "UNMARKED";
  readonly credit: "ALL" | "AVAILABLE" | "EMPTY" | "NO_PACK" | "NOT_TRACKED";
}
export { CREDITS_ENDING_MAX };

/** Кольцо сводки дня: один из трёх фильтров списка, складывается с остальными фильтрами. */
export type RosterRing = "TODAY" | "WEEK" | "ENDING";

export interface RosterSummary {
  /** Сегодняшние записи без исхода, ещё не закончившиеся. */
  readonly today: number;
  /** Записи недели пн–вс, кроме отменённых. */
  readonly week: number;
  /** Клиенты с остатком абонемента 0…CREDITS_ENDING_MAX занятий. */
  readonly ending: number;
  /** Клиенты, которые попадают под кольцо (доля дуги и число в списке). */
  readonly todayClients: number;
  readonly weekClients: number;
}

/** Числа трёх колец по видимым клиентам; нет данных — ноль, не ошибка. */
export function summarizeRoster(overview: RosterOverview | null | undefined, clientIds: readonly string[]): RosterSummary {
  let today = 0;
  let week = 0;
  let ending = 0;
  let todayClients = 0;
  let weekClients = 0;
  for (const id of clientIds) {
    const facts = overview?.get(id);
    if (facts === undefined) continue;
    today += facts.todayCount ?? 0;
    week += facts.weekCount ?? 0;
    if (isCreditsEnding(facts)) ending += 1;
    if (matchesRosterRing(facts, "TODAY")) todayClients += 1;
    if (matchesRosterRing(facts, "WEEK")) weekClients += 1;
  }
  return { today, week, ending, todayClients, weekClients };
}

function isCreditsEnding(facts: RosterClientOverview): boolean {
  return facts.creditsAvailable !== undefined && facts.creditsAvailable !== null && facts.creditsAvailable <= CREDITS_ENDING_MAX;
}

/** Клиент попадает под кольцо: сегодня есть запись, на неделе есть запись, абонемент кончается. */
export function matchesRosterRing(facts: RosterClientOverview | undefined, ring: RosterRing | null): boolean {
  if (ring === null) return true;
  if (facts === undefined) return false;
  if (ring === "TODAY") return facts.todayStartMinute !== null;
  if (ring === "WEEK") return (facts.weekCount ?? 0) > 0;
  return isCreditsEnding(facts);
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
