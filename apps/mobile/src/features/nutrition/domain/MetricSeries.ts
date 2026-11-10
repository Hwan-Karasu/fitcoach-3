import { deriveCalc, type CalcProfile, type CalcSex } from "./CalcRules.ts";

/** Показатели «Главной», у каждого свой экран с графиком (UIX-08). */
export type MetricId = "steps" | "sleep" | "expenditure" | "meals";

/** Значение показателя на дату (дата `YYYY-MM-DD`), список упорядочен по возрастанию даты. */
export interface DatedValue {
  readonly date: string;
  readonly value: number;
}

/** Последнее известное значение на дату или раньше; значений нет — `null` (не ноль и не «ближайшее будущее»). */
export function valueOnOrBefore(sorted: readonly DatedValue[], date: string): number | null {
  let found: number | null = null;
  for (const entry of sorted) {
    if (entry.date > date) break;
    found = entry.value;
  }
  return found;
}

export interface ExpenditureInput {
  readonly profile: CalcProfile;
  readonly body: Readonly<{ sex: CalcSex | null; age: number | null; heightCm: number | null }>;
  readonly dates: readonly string[];
  /** Шаги по дням; день без записи или с нулём не попадает в расход (неизвестно ≠ 0, нулевые шаги расчёт считает «нет данных»). */
  readonly steps: ReadonlyMap<string, number>;
  readonly weights: readonly DatedValue[];
  readonly fats: readonly DatedValue[];
}

/**
 * Расход по дням (UIX-08): REE + NEAT по шагам этого дня + EAT, вес и % жира — последние известные на дату. Только дни с шагами:
 * без них NEAT был бы выдуманным «по образу жизни». Дни, где расчёт невозможен (нет пола, роста, возраста или веса), пропускаются.
 */
export function expenditureByDay(input: ExpenditureInput): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const date of input.dates) {
    const steps = input.steps.get(date);
    if (steps === undefined || steps <= 0) continue;
    const calc = deriveCalc(input.profile, { ...input.body, weightKg: valueOnOrBefore(input.weights, date),
      fatPercent: valueOnOrBefore(input.fats, date), avgSteps: steps });
    if (calc.startTdee !== null) result.set(date, calc.startTdee);
  }
  return result;
}
