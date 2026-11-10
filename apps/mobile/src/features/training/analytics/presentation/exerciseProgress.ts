import type { SetFact, SetValues } from "../../execution/public.ts";
import { compareOptionalDays as compareWorkoutDays } from "../../../../shared/format/calendarDay.ts";
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
  readonly side: "L" | "R" | null;
  readonly reps: number;
  readonly loadKg: number;
  /** Первая известная дата достижения; `null` — лучший вес есть только без даты. */
  readonly date: string | null;
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
type RecordValue = Readonly<{ side: RepRecord["side"]; values: SetValues }>;
function recordValues(facts: readonly SetFact[]): readonly RecordValue[] {
  return facts.filter((fact) => isWorkingSet(fact) && fact.setType !== "DROP").flatMap<RecordValue>((fact) => fact.sides === null
    ? [{ side: null, values: fact.values }]
    : ([{ side: "L" as const, ...fact.sides.left }, { side: "R" as const, ...fact.sides.right }]
      .filter((side) => side.confirmed).map(({ side, values }) => ({ side, values }))));
}

/** Для объёма и суммы повторений — все рабочие, мини-сеты дроп-сета входят (§35.15). */
function workValues(facts: readonly SetFact[]): readonly SetValues[] {
  return facts.filter(isWorkingSet).flatMap((fact) => fact.sides === null ? [fact.values, ...fact.drops] : mainValues(fact));
}

const maxOf = (numbers: readonly number[]) => numbers.length === 0 ? null : Math.max(...numbers);
const sumOf = (numbers: readonly number[]) => numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0);
const kg = (values: SetValues) => values.loadGrams === null ? null : values.loadGrams / 1000;

export function sessionValue(session: ExerciseSession, metric: ProgressMetricId): number | null {
  const records = recordValues(session.facts).map((record) => record.values);
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

/** Точки графика от старых к новым; занятия без значения или достоверной даты пропускаются (§48.86.32). */
export function progressSeries(sessions: readonly ExerciseSession[], metric: ProgressMetricId): readonly ProgressPoint[] {
  return [...sessions].reverse().flatMap((session) => {
    const value = sessionValue(session, metric);
    return value === null || session.entry.actualDate === null ? [] : [{ key: session.entry.key, date: session.entry.actualDate, value }];
  });
}

/** Одна хронология PR для таблицы лучших значений и событий периода; стороны никогда не смешиваются. */
function recordProgress(sessions: readonly ExerciseSession[]) {
  const best = new Map<string, RepRecord>();
  const events: RepRecord[] = [];
  // Недатированные достижения — консервативная база, но не событие на выдуманную дату.
  const chronological = [...sessions].sort((a, b) => compareWorkoutDays(b.entry.actualDate, a.entry.actualDate) || a.entry.key.localeCompare(b.entry.key));
  for (const session of chronological) {
    const candidates = new Map<string, RepRecord>();
    for (const { side, values } of recordValues(session.facts)) {
      const load = kg(values);
      if (load === null || !(load > 0) || values.reps === null || values.reps < 1) continue;
      const key = `${side ?? ""}:${values.reps}`;
      if (load > (candidates.get(key)?.loadKg ?? -1)) candidates.set(key,
        { side, reps: values.reps, loadKg: load, date: session.entry.actualDate, sessionKey: session.entry.key });
    }
    for (const [key, record] of candidates) {
      const current = best.get(key);
      const improved = current === undefined || record.loadKg > current.loadKg;
      if (improved && record.date !== null) events.push(record);
      if (improved || record.loadKg === current?.loadKg && current.date === null && record.date !== null) best.set(key, record);
    }
  }
  return { best: [...best.values()].sort((a, b) => a.reps - b.reps || (a.side ?? "").localeCompare(b.side ?? "")), events };
}

/** §37.7: лучший вес на точное число повторений отдельно для каждой стороны, с первой известной датой. */
export const repRecords = (sessions: readonly ExerciseSession[]): readonly RepRecord[] => recordProgress(sessions).best;

/** §48.86.35: каждое новое достижение остаётся событием своего периода, даже если позже побито. */
export const repRecordEvents = (sessions: readonly ExerciseSession[]): readonly RepRecord[] => recordProgress(sessions).events;

export interface ExerciseWeekNode {
  readonly weekIndex: number;
  /** Новые сверху. */
  readonly sessions: readonly ExerciseSession[];
}

export interface ExerciseCycleNode {
  readonly id: string;
  readonly title: string;
  readonly weeks: readonly ExerciseWeekNode[];
  readonly sessionCount: number;
}

export interface ExerciseProgramNode {
  readonly programId: string;
  readonly title: string;
  readonly archived: boolean;
  /** Циклы в порядке плана; у Простой программы и у «план удалён» — пусто, недели лежат прямо в `weeks`. */
  readonly cycles: readonly ExerciseCycleNode[];
  readonly weeks: readonly ExerciseWeekNode[];
  readonly sessionCount: number;
  readonly lastDate: string | null;
}

function weekNodes(sessions: readonly ExerciseSession[]): readonly ExerciseWeekNode[] {
  const byWeek = new Map<number, ExerciseSession[]>();
  for (const session of sessions) byWeek.set(session.entry.weekIndex, [...(byWeek.get(session.entry.weekIndex) ?? []), session]);
  return [...byWeek].map(([weekIndex, items]): ExerciseWeekNode => ({ weekIndex,
    sessions: [...items].sort((a, b) => compareWorkoutDays(a.entry.actualDate, b.entry.actualDate) || a.entry.key.localeCompare(b.entry.key)) }))
    .sort((a, b) => a.weekIndex - b.weekIndex);
}

/**
 * Вложенная история упражнения: программа → цикл (мезоцикл) → неделя → занятия. Программы — по дате последнего занятия (новее выше),
 * циклы и недели — в порядке плана. Группировка по id, не по названиям.
 */
export function exerciseTree(sessions: readonly ExerciseSession[]): readonly ExerciseProgramNode[] {
  const byProgram = new Map<string, ExerciseSession[]>();
  for (const session of sessions) byProgram.set(session.entry.programId, [...(byProgram.get(session.entry.programId) ?? []), session]);
  return [...byProgram].map(([programId, items]): ExerciseProgramNode => {
    const latest = [...items].sort((a, b) => compareWorkoutDays(a.entry.actualDate, b.entry.actualDate) || a.entry.key.localeCompare(b.entry.key))[0]!.entry;
    const byCycle = new Map<string, ExerciseSession[]>();
    const loose: ExerciseSession[] = [];
    for (const item of items) {
      if (item.entry.mesocycleId === null || item.entry.mesocycleIndex === null) loose.push(item);
      else byCycle.set(item.entry.mesocycleId, [...(byCycle.get(item.entry.mesocycleId) ?? []), item]);
    }
    const cycles = [...byCycle].map(([id, list]) => ({ id, index: list[0]!.entry.mesocycleIndex!,
      node: { id, title: list[0]!.entry.mesocycleTitle ?? "Цикл", weeks: weekNodes(list), sessionCount: list.length } as ExerciseCycleNode }))
      .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id)).map((item) => item.node);
    return { programId, title: latest.programTitle, archived: latest.archived, cycles, weeks: weekNodes(loose),
      sessionCount: items.length, lastDate: latest.actualDate };
  }).sort((a, b) => compareWorkoutDays(a.lastDate, b.lastDate) || a.programId.localeCompare(b.programId));
}
