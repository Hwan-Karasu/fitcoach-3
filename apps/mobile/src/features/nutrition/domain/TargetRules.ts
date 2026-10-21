import type { DaySummary } from "./DiaryModel.ts";
import { assertDate } from "./DiaryRules.ts";
import { kcalFromMacrosX10 } from "./EnergyRules.ts";
import type { Nutrients } from "./FoodModel.ts";
import { TARGET_METRICS, type Corridors, type RangeVerdict, type ResolvedTarget, type TargetException, type TargetMetric, type TargetRange,
  type TargetVersion, type TargetVersionInput } from "./TargetModel.ts";

export type TargetRuleError =
  | "TARGET_RANGE_INVALID"
  | "TARGET_DAYS_INVALID"
  | "TARGET_EMPTY"
  | "DIARY_DATE_INVALID";

function fail(code: TargetRuleError): never { throw new Error(code); }

/** Верхняя граница ввода: опечатка «99999 ккал» отклоняется (физиологические нормы не утверждаются, §49.8.1.1). */
const RANGE_MAX_X10 = 1_000_000;

export function hasAnyRange(corridors: Corridors): boolean {
  return TARGET_METRICS.some((metric) => corridors[metric] !== null);
}

export function validateCorridors(corridors: Corridors): Corridors {
  const out = {} as Record<TargetMetric, TargetRange | null>;
  for (const metric of TARGET_METRICS) {
    const range = corridors[metric];
    if (range === null) { out[metric] = null; continue; }
    // Порядок границ не исправляется молча: min > max — ошибка ввода (§49.8.2).
    if (!Number.isInteger(range.minX10) || !Number.isInteger(range.maxX10) || range.minX10 < 0 || range.maxX10 < range.minX10
      || range.maxX10 > RANGE_MAX_X10) fail("TARGET_RANGE_INVALID");
    out[metric] = { minX10: range.minX10, maxX10: range.maxX10 };
  }
  return out;
}

/** Проверяет версию расписания: дата, семь дней, корректные коридоры, хотя бы один заданный. День без коридоров допустим («цели нет»). */
export function validateVersion(input: TargetVersionInput): TargetVersionInput {
  assertDate(input.effectiveFrom);
  if (input.days.length !== 7) fail("TARGET_DAYS_INVALID");
  const days = input.days.map((day) => day === null || !hasAnyRange(day) ? null : validateCorridors(day));
  if (days.every((day) => day === null)) fail("TARGET_EMPTY");
  const adjustment = input.homeAdjustment;
  if (adjustment == null) return { effectiveFrom: input.effectiveFrom, days };
  if (adjustment.mode !== "EXACT" && adjustment.mode !== "RANGE") fail("TARGET_RANGE_INVALID");
  const { protein, fat, carbs } = validateCorridors({ kcal: null, ...adjustment.manual });
  if (adjustment.mode === "EXACT" && [protein, fat, carbs].some((range) => range !== null && range.minX10 !== range.maxX10)) fail("TARGET_RANGE_INVALID");
  return { effectiveFrom: input.effectiveFrom, days, homeAdjustment: { mode: adjustment.mode, manual: { protein, fat, carbs } } };
}

/** Понедельник = 0 … воскресенье = 6 для даты `YYYY-MM-DD`. */
export function weekdayOf(localDate: string): number {
  assertDate(localDate);
  return (new Date(`${localDate}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** Версия, действовавшая на дату: последняя с `effectiveFrom ≤ date`; до первой версии цели нет (§49.11.4). */
export function versionFor(versions: readonly TargetVersion[], localDate: string): TargetVersion | null {
  let found: TargetVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom <= localDate && (found === null || version.effectiveFrom > found.effectiveFrom)) found = version;
  }
  return found;
}

/** Цель даты: разовое исключение → историческая версия и коридор дня недели → «не установлена» (§49.12.2). */
export function resolveTarget(versions: readonly TargetVersion[], exceptions: readonly TargetException[], localDate: string): ResolvedTarget {
  const exception = exceptions.find((item) => item.localDate === localDate);
  if (exception !== undefined) return { source: "EXCEPTION", corridors: exception.corridors };
  const version = versionFor(versions, localDate);
  const corridors = version?.days[weekdayOf(localDate)] ?? null;
  return version === null || corridors === null ? { source: "NONE" } : { source: "SCHEDULE", effectiveFrom: version.effectiveFrom, corridors };
}

/** Период, который затронет версия с этой даты: до дня перед следующей версией (`null` — без конца). Для предупреждения о ретроспективе (§49.11.3). */
export function affectedPeriod(versions: readonly TargetVersion[], effectiveFrom: string): Readonly<{ from: string; to: string | null }> {
  assertDate(effectiveFrom);
  const next = versions.filter((version) => version.effectiveFrom > effectiveFrom).map((version) => version.effectiveFrom).sort()[0];
  if (next === undefined) return { from: effectiveFrom, to: null };
  const previous = new Date(`${next}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return { from: effectiveFrom, to: previous.toISOString().slice(0, 10) };
}

export const NUTRIENT_OF: Readonly<Record<TargetMetric, keyof Nutrients>> = { kcal: "kcalX10", protein: "proteinX10", fat: "fatX10", carbs: "carbsX10" };

/** Сравнение одного показателя: нет коридора или неизвестный факт — `UNKNOWN`; границы входят в коридор (§49.8.2). */
export function judge(range: TargetRange | null, valueX10: number | null): RangeVerdict {
  if (range === null || valueX10 === null) return "UNKNOWN";
  return valueX10 < range.minX10 ? "BELOW" : valueX10 > range.maxX10 ? "ABOVE" : "IN";
}

/**
 * Оценка дня по четырём показателям независимо (§49.8.1.3). День без пищевых записей не оценивается: ни «ниже нормы», ни «0 ккал» (§49.8.2).
 */
export function assessDay(summary: DaySummary, target: ResolvedTarget): Readonly<Record<TargetMetric, RangeVerdict>> {
  const unknown = { kcal: "UNKNOWN", protein: "UNKNOWN", fat: "UNKNOWN", carbs: "UNKNOWN" } as const;
  if (summary.state === "NO_FOOD" || target.source === "NONE") return unknown;
  return Object.fromEntries(TARGET_METRICS.map((metric) => [metric, judge(target.corridors[metric], summary.totals[NUTRIENT_OF[metric]])])) as Record<TargetMetric, RangeVerdict>;
}

/**
 * Ориентировочная проверка согласованности (§49.8.1.5): калорийный коридор должен пересекаться с энергией из макродиапазонов `4Б + 9Ж + 4У`.
 * Только предупреждение — введённые значения не меняются. `UNKNOWN`, если задан не весь набор из четырёх.
 */
export function energyConsistency(corridors: Corridors): "OK" | "INCOMPATIBLE" | "UNKNOWN" {
  const { kcal, protein, fat, carbs } = corridors;
  if (kcal === null || protein === null || fat === null || carbs === null) return "UNKNOWN";
  const low = kcalFromMacrosX10({ proteinX10: protein.minX10, fatX10: fat.minX10, carbsX10: carbs.minX10 })!;
  const high = kcalFromMacrosX10({ proteinX10: protein.maxX10, fatX10: fat.maxX10, carbsX10: carbs.maxX10 })!;
  return kcal.maxX10 < low || kcal.minX10 > high ? "INCOMPATIBLE" : "OK";
}

/** Одна цель на все семь дней — версия из ряда «Ручная корректировка» (дни недели по отдельности настраиваются на экране целей). */
export function uniformWeek(corridors: Corridors): readonly Corridors[] {
  return Array.from({ length: 7 }, () => corridors);
}

