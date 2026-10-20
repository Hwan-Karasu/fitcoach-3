import type { HistoryFilter } from "../../archive/public.ts";

export type PeriodId = "30" | "90" | "180" | "365" | "all";

export const periods: readonly Readonly<{ id: PeriodId; label: string; days: number | null }>[] = [
  { id: "30", label: "30 дней", days: 30 }, { id: "90", label: "3 мес", days: 90 }, { id: "180", label: "6 мес", days: 180 },
  { id: "365", label: "Год", days: 365 }, { id: "all", label: "Всё время", days: null },
];

export interface StatsFilters {
  readonly filter: HistoryFilter;
  readonly period: PeriodId;
}

const DEFAULT: StatsFilters = { filter: { programId: null, mesocycleId: null }, period: "90" };
const byClient = new Map<string, StatsFilters>();

/**
 * §48.86.16: период, программа и мезоцикл сохраняются при переходах между разделами, отчётом и детализацией, пока
 * приложение открыто; у каждого клиента свои (контекст клиентов не смешивается). Между запусками не сохраняются.
 */
export const readStatsFilters = (clientId: string): StatsFilters => byClient.get(clientId) ?? DEFAULT;
export const writeStatsFilters = (clientId: string, next: StatsFilters): void => { byClient.set(clientId, next); };
