import type { HistoryFilter } from "../../archive/public.ts";
import { rangeFor, type StatsRange } from "./trainingStats.ts";

export type PresetId = "30" | "90" | "180" | "365" | "all";
export type PeriodId = PresetId | "custom";

export const periods: readonly Readonly<{ id: PresetId; label: string; days: number | null }>[] = [
  { id: "30", label: "30 дней", days: 30 }, { id: "90", label: "3 мес", days: 90 }, { id: "180", label: "6 мес", days: 180 },
  { id: "365", label: "Год", days: 365 }, { id: "all", label: "Всё время", days: null },
];

/** Свой период: фактические даты занятий `YYYY-MM-DD`, обе границы включительно, `from ≤ to`. */
export interface CustomRange {
  readonly from: string;
  readonly to: string;
}

export interface StatsFilters {
  readonly filter: HistoryFilter;
  readonly period: PeriodId;
  /** Последний выбранный свой период; применяется, когда `period = "custom"`. */
  readonly custom: CustomRange | null;
}

const DEFAULT: StatsFilters = { filter: { programId: null, mesocycleId: null, workoutKey: null }, period: "90", custom: null };
const byClient = new Map<string, StatsFilters>();

/**
 * §48.86.16: период, программа и мезоцикл сохраняются при переходах между разделами, отчётом и детализацией, пока
 * приложение открыто; у каждого клиента свои (контекст клиентов не смешивается). Между запусками не сохраняются.
 */
export const readStatsFilters = (clientId: string): StatsFilters => byClient.get(clientId) ?? DEFAULT;
export const writeStatsFilters = (clientId: string, next: StatsFilters): void => { byClient.set(clientId, next); };

/** Границы выбранного периода: готовый вариант — от сегодняшней даты, свой — как выбрано (без своих границ — 3 месяца). */
export function periodRange(now: Date, stored: Readonly<{ period: PeriodId; custom: CustomRange | null }>): StatsRange {
  if (stored.period === "custom") return stored.custom ?? rangeFor(now, 90);
  return rangeFor(now, periods.find((item) => item.id === stored.period)?.days ?? null);
}
