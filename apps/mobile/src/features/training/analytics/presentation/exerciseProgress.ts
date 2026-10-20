import type { SetFact, SetValues } from "../../execution/public.ts";
import { isWorkingSet } from "./workingSet.ts";
import type { ExerciseInfo } from "../../plans/public.ts";

type TrackingMetric = ExerciseInfo["metrics"][number];
import type { TrainingHistoryEntry } from "../../archive/public.ts";

/**
 * История и прогресс одного упражнения клиента (§§35, 37, X02): только из фактов дневника всех его программ, через
 * хронологию занятий (§48.85). Ничего не записывает; отсутствие данных — `null`, не ноль (§48.86.32).
 */

/** Занятие, в котором выполнялось упражнение: запись хронологии и все его подходы (включая разминку). */
export interface ExerciseSession {
  readonly entry: TrainingHistoryEntry;
  readonly facts: readonly SetFact[];
}

export type ProgressMetricId = "e1rm" | "maxLoad" | "volume" | "maxReps" | "totalReps" | "maxDuration" | "maxDistance";

export interface ProgressPoint {
  readonly key: string;
  readonly date: string;
  readonly value: number;
}

export interface RepRecord {
  readonly reps: number;
  readonly loadKg: number;
  /** Дата первого достижения лучшего веса. */
  readonly date: string;
  readonly sessionKey: string;
}

/** §48.86.8: e1RM = W × 36 / (37 − r) только для 1–12 повторений и пригодного веса. */
export function brzycki(loadKg: number, reps: number): number | null {
  if (!Number.isInteger(reps) || reps < 1 || reps > 12 || !(loadKg > 0)) return null;
  return reps === 1 ? loadKg : loadKg * 36 / (37 - reps);
}

/** §37.6: набор графиков по профилю учёта; первый — главный по умолчанию. */
export function progressMetrics(metrics: readonly TrackingMetric[]): readonly ProgressMetricId[] {
  const has = (metric: TrackingMetric) => metrics.includes(metric);
  const list: ProgressMetricId[] = [];
  if (has("load") && has("reps")) list.push("e1rm", "maxLoad", "volume");
  else if (has("load") || has("addedLoad")) list.push("maxLoad");
  if (has("reps")) list.push("maxReps");
  if (has("reps") && metrics.length === 1) list.push("totalReps");
  if (has("distance")) list.push("maxDistance");
  if (has("duration")) list.push("maxDuration");
  return list;
}

/** Все занятия с упражнением, в порядке хронологии (новые сверху); повтор упражнения в тренировке — одно занятие. */
export function exerciseSessions(entries: readonly TrainingHistoryEntry[], exerciseId: string): readonly ExerciseSession[] {
  return entries.flatMap((entry) => {
    const facts = entry.exercises.filter((exercise) => exercise.exerciseId === exerciseId).flatMap((exercise) => exercise.facts);
    return facts.length === 0 ? [] : [{ entry, facts }];
  });
}


/** Засчитанные стороны или основное значение подхода. */
function mainValues(fact: SetFact): readonly SetValues[] {
  if (fact.sides === null) return [fact.values];
  return [fact.sides.left, fact.sides.right].filter((side) => side.confirmed).map((side) => side.values);
}

/** Для рекордов и e1RM — одиночные обычные/отказные рабочие подходы (§48.86.8 п. 4). */
function recordValues(facts: readonly SetFact[]): readonly SetValues[] {
  return facts.filter((fact) => isWorkingSet(fact) && fact.setType !== "DROP").flatMap(mainValues);
}

/** Для объёма и суммы повторений — все рабочие, мини-сеты дроп-сета входят (§35.15). */
function workValues(facts: readonly SetFact[]): readonly SetValues[] {
  return facts.filter(isWorkingSet).flatMap((fact) => fact.sides === null ? [fact.values, ...fact.drops] : mainValues(fact));
}

const maxOf = (numbers: readonly number[]) => numbers.length === 0 ? null : Math.max(...numbers);
const sumOf = (numbers: readonly number[]) => numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0);
const kg = (values: SetValues) => values.loadGrams === null ? null : values.loadGrams / 1000;

export function sessionValue(session: ExerciseSession, metric: ProgressMetricId): number | null {
  const records = recordValues(session.facts);
  const pick = (read: (values: SetValues) => number | null) =>
    records.map(read).filter((value): value is number => value !== null);
  switch (metric) {
    case "e1rm": return maxOf(records.map((values) => kg(values) === null || values.reps === null ? null : brzycki(kg(values)!, values.reps))
      .filter((value): value is number => value !== null));
    case "maxLoad": return maxOf(pick(kg));
    case "maxReps": return maxOf(pick((values) => values.reps));
    case "maxDuration": return maxOf(pick((values) => values.durationSec));
    case "maxDistance": return maxOf(pick((values) => values.distanceM));
    case "volume": return sumOf(workValues(session.facts).filter((values) => values.loadGrams !== null && values.reps !== null)
      .map((values) => kg(values)! * values.reps!));
    case "totalReps": return sumOf(workValues(session.facts).map((values) => values.reps).filter((value): value is number => value !== null));
  }
}

/** Точки графика от старых к новым; занятия без значения пропускаются (§48.86.32). */
export function progressSeries(sessions: readonly ExerciseSession[], metric: ProgressMetricId): readonly ProgressPoint[] {
  return [...sessions].reverse().flatMap((session) => {
    const value = sessionValue(session, metric);
    return value === null ? [] : [{ key: session.entry.key, date: session.entry.actualDate, value }];
  });
}

/** §37.7: фактические рекорды веса на точное число повторений, отдельно от e1RM. */
export function repRecords(sessions: readonly ExerciseSession[]): readonly RepRecord[] {
  const best = new Map<number, RepRecord>();
  for (const session of [...sessions].reverse()) {
    for (const values of recordValues(session.facts)) {
      const load = kg(values);
      if (load === null || !(load > 0) || values.reps === null || values.reps < 1) continue;
      const current = best.get(values.reps);
      if (current === undefined || load > current.loadKg) {
        best.set(values.reps, { reps: values.reps, loadKg: load, date: session.entry.actualDate, sessionKey: session.entry.key });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps);
}
