import type { SetFact, WorkoutStatus } from "../../execution/public.ts";
import type { TrainingHistoryEntry } from "../../archive/public.ts";
import type { ExerciseInfo } from "../../plans/public.ts";
import { exerciseSessions, repRecords } from "./exerciseProgress.ts";

/**
 * Статистика клиента (A01, §48.86): расчёты по хронологии занятий — фактам дневника всех программ. Ничего не пишет;
 * недостающие данные — `null` или явный счётчик неполных, но не ноль (§48.86.15, §48.86.32).
 */

/** Период по фактической дате занятия (§48.84), включительно; `from = null` — всё время. */
export interface StatsRange {
  readonly from: string | null;
  readonly to: string;
}

type InfoOf = (exerciseId: string) => ExerciseInfo | undefined;

const iso = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
const parse = (date: string) => { const [year, month, day] = date.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(year, month - 1, day)); };
const addDays = (date: string, days: number) => { const next = parse(date); next.setUTCDate(next.getUTCDate() + days); return iso(next); };
const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
/** Понедельник недели даты. */
const weekStart = (date: string) => addDays(date, -((parse(date).getUTCDay() + 6) % 7));

/** Последние `days` дней, включая сегодняшний (`now` — локальная дата устройства); `null` — всё время. */
export function rangeFor(now: Date, days: number | null): StatsRange {
  const today = iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  return { from: days === null ? null : addDays(today, -(days - 1)), to: today };
}

export function entriesInRange(entries: readonly TrainingHistoryEntry[], range: StatsRange): readonly TrainingHistoryEntry[] {
  return entries.filter((entry) => (range.from === null || entry.actualDate >= range.from) && entry.actualDate <= range.to);
}

/** §48.44, §48.80: засчитанный рабочий подход — не разминка; частично выполненный односторонний тоже один подход. */
export const isWorkingSet = (fact: SetFact) => fact.confirmed && fact.setType !== "WARMUP";

const workingFacts = (entry: TrainingHistoryEntry) => entry.exercises.flatMap((exercise) => exercise.facts.filter(isWorkingSet));

/** Тоннаж подхода: `null` — к упражнению не применим; `kg: null` — невычислим (§48.86.15). */
export function factTonnage(fact: SetFact, info: ExerciseInfo | undefined): Readonly<{ kg: number | null }> | null {
  const metrics = info?.metrics ?? [];
  // Масса тела клиента на дату занятия (§48.86.7, §48.86.36) пока не подключена — такие подходы считаются неполными.
  if (metrics.includes("addedLoad") || metrics.includes("assistance")) return { kg: null };
  if (!(metrics.includes("load") && metrics.includes("reps"))) return null;
  const pieces = fact.sides === null ? [fact.values, ...fact.drops]
    : [fact.sides.left, fact.sides.right].filter((side) => side.confirmed).map((side) => side.values);
  const known = pieces.filter((values) => values.loadGrams !== null && values.reps !== null);
  return known.length === 0 ? { kg: null } : { kg: known.reduce((sum, values) => sum + values.loadGrams! / 1000 * values.reps!, 0) };
}

export interface EntryTonnage {
  /** `null` — ни одного вычислимого подхода. */
  readonly kg: number | null;
  readonly incompleteSets: number;
}

export function entryTonnage(entry: TrainingHistoryEntry, infoOf: InfoOf): EntryTonnage {
  let kg: number | null = null;
  let incompleteSets = 0;
  for (const exercise of entry.exercises) {
    const info = infoOf(exercise.exerciseId);
    for (const fact of exercise.facts.filter(isWorkingSet)) {
      const tonnage = factTonnage(fact, info);
      if (tonnage === null) continue;
      if (tonnage.kg === null) incompleteSets += 1;
      else kg = (kg ?? 0) + tonnage.kg;
    }
  }
  return { kg, incompleteSets };
}

/** §48.86.25: четыре ключевых показателя; средняя длительность не считается — время начала и конца не записывается. */
export interface StatsSummary {
  /** Занятия с результатами. */
  readonly workouts: number;
  /** «Проведено» — только статус «Завершена» (§48.51). */
  readonly completed: number;
  readonly workingSets: number;
  readonly tonnageKg: number | null;
  readonly incompleteSets: number;
}

export function summarize(entries: readonly TrainingHistoryEntry[], infoOf: InfoOf): StatsSummary {
  let tonnageKg: number | null = null;
  let incompleteSets = 0;
  for (const entry of entries) {
    const tonnage = entryTonnage(entry, infoOf);
    incompleteSets += tonnage.incompleteSets;
    if (tonnage.kg !== null) tonnageKg = (tonnageKg ?? 0) + tonnage.kg;
  }
  return { workouts: entries.length, completed: entries.filter((entry) => entry.status === "COMPLETED").length,
    workingSets: entries.reduce((sum, entry) => sum + workingFacts(entry).length, 0), tonnageKg, incompleteSets };
}

export function statusCounts(entries: readonly TrainingHistoryEntry[]): ReadonlyMap<WorkoutStatus, number> {
  const counts = new Map<WorkoutStatus, number>();
  for (const entry of entries) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  return counts;
}

export type Scale = "day" | "week" | "month";

/** §48.86.31: короткий интервал — по дням, средний — по неделям, длинный — по месяцам. */
export function scaleFor(from: string, to: string): Scale {
  const days = daysBetween(from, to) + 1;
  return days <= 14 ? "day" : days <= 120 ? "week" : "month";
}

export interface Bucket {
  /** День или месяц `YYYY-MM-DD`/`YYYY-MM`; у недели — её понедельник. */
  readonly key: string;
  readonly value: number | null;
}

export const bucketKeyOf = (date: string, scale: Scale) => scale === "day" ? date : scale === "week" ? weekStart(date) : date.slice(0, 7);
function nextKey(key: string, scale: Scale): string {
  if (scale === "day") return addDays(key, 1);
  if (scale === "week") return addDays(key, 7);
  const [year, month] = key.split("-").map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Столбцы по выбранной шкале. Периоды без занятий — `emptyAs` (0 для счётчиков, `null` для вычислимого тоннажа);
 * сумма столбцов равна сумме по занятиям — агрегация итог не меняет.
 */
export function buckets(entries: readonly TrainingHistoryEntry[], range: StatsRange, valueOf: (entry: TrainingHistoryEntry) => number | null,
  emptyAs: 0 | null): Readonly<{ scale: Scale; items: readonly Bucket[] }> {
  const dates = entries.map((entry) => entry.actualDate).sort();
  const from = range.from ?? dates[0] ?? range.to;
  const scale = scaleFor(from, range.to);
  const sums = new Map<string, number | null>();
  for (const entry of entries) {
    const key = bucketKeyOf(entry.actualDate, scale);
    const value = valueOf(entry);
    sums.set(key, value === null ? sums.get(key) ?? null : (sums.get(key) ?? 0) + value);
  }
  const items: Bucket[] = [];
  const last = bucketKeyOf(range.to, scale);
  for (let key = bucketKeyOf(from, scale); key <= last; key = nextKey(key, scale)) {
    items.push({ key, value: sums.has(key) && sums.get(key) !== null ? sums.get(key)! : emptyAs });
  }
  return { scale, items };
}

export interface MuscleGroupRow {
  readonly id: string;
  readonly label: string;
  readonly sets: number;
}

/**
 * §48.86.27, §48.86.30: рабочие подходы по категории упражнения. Категория не угадывается: без неё — «Без категории».
 * Сумма по группам может превышать число уникальных подходов, когда у упражнения несколько категорий (пока одна).
 */
export function muscleGroups(entries: readonly TrainingHistoryEntry[], infoOf: InfoOf): readonly MuscleGroupRow[] {
  const rows = new Map<string, MuscleGroupRow>();
  for (const entry of entries) {
    for (const exercise of entry.exercises) {
      const group = infoOf(exercise.exerciseId)?.group ?? { id: "none", label: "Без категории" };
      const sets = exercise.facts.filter(isWorkingSet).length;
      if (sets === 0) continue;
      rows.set(group.id, { id: group.id, label: group.label, sets: (rows.get(group.id)?.sets ?? 0) + sets });
    }
  }
  return [...rows.values()].sort((a, b) => b.sets - a.sets || a.label.localeCompare(b.label, "ru"));
}

export interface ExerciseActivity {
  readonly exerciseId: string;
  readonly sessions: number;
  readonly workingSets: number;
  readonly lastDate: string;
}

/** «Прогресс упражнений»: что выполнялось в выборе, последние сверху. */
export function exerciseActivity(entries: readonly TrainingHistoryEntry[]): readonly ExerciseActivity[] {
  const rows = new Map<string, { sessions: Set<string>; workingSets: number; lastDate: string }>();
  for (const entry of entries) {
    for (const exercise of entry.exercises) {
      const row = rows.get(exercise.exerciseId) ?? { sessions: new Set<string>(), workingSets: 0, lastDate: entry.actualDate };
      row.sessions.add(entry.key);
      row.workingSets += exercise.facts.filter(isWorkingSet).length;
      if (entry.actualDate > row.lastDate) row.lastDate = entry.actualDate;
      rows.set(exercise.exerciseId, row);
    }
  }
  return [...rows].map(([exerciseId, row]) => ({ exerciseId, sessions: row.sessions.size, workingSets: row.workingSets, lastDate: row.lastDate }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.workingSets - a.workingSets);
}

export interface RecordEvent {
  readonly exerciseId: string;
  readonly reps: number;
  readonly loadKg: number;
  readonly date: string;
  readonly sessionKey: string;
}

/**
 * §48.86.35: личные рекорды, установленные в периоде. Рекорд считается по всем занятиям клиента (§48.8), а выбор
 * программы/мезоцикла только ограничивает показанные события — рекорд прошлого периода «новым» не становится.
 */
export function recordsInRange(all: readonly TrainingHistoryEntry[], scoped: readonly TrainingHistoryEntry[], range: StatsRange,
  infoOf: InfoOf): readonly RecordEvent[] {
  const scopedKeys = new Set(scoped.map((entry) => entry.key));
  const exerciseIds = new Set(all.flatMap((entry) => entry.exercises.map((exercise) => exercise.exerciseId)));
  const events: RecordEvent[] = [];
  for (const exerciseId of exerciseIds) {
    const metrics = infoOf(exerciseId)?.metrics ?? [];
    if (!(metrics.includes("load") && metrics.includes("reps"))) continue;
    for (const record of repRecords(exerciseSessions(all, exerciseId))) {
      if ((range.from === null || record.date >= range.from) && record.date <= range.to && scopedKeys.has(record.sessionKey)) {
        events.push({ exerciseId, reps: record.reps, loadKg: record.loadKg, date: record.date, sessionKey: record.sessionKey });
      }
    }
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || a.reps - b.reps);
}

/** Календарный месяц отчёта; `month` 1–12. */
export interface MonthRef {
  readonly year: number;
  readonly month: number;
}

const pad = (value: number) => String(value).padStart(2, "0");
/** Период с обеими границами. */
export interface ClosedRange {
  readonly from: string;
  readonly to: string;
}

export const monthRange = ({ year, month }: MonthRef): ClosedRange =>
  ({ from: `${year}-${pad(month)}-01`, to: iso(new Date(Date.UTC(year, month, 0))) });
export const previousMonth = ({ year, month }: MonthRef): MonthRef => month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
export const monthOf = (date: string): MonthRef => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

export interface MonthComparison {
  readonly current: ClosedRange;
  readonly previous: ClosedRange;
  /** Текущий месяц ещё не закончился: сравнение — с первой такой же частью предыдущего (§48.86.18). */
  readonly partial: boolean;
}

/**
 * §48.86.14, §48.86.18: полный месяц сравнивается с полным предыдущим календарным; неполный — с первыми N днями
 * предыдущего, а если тот короче, недостающие дни не достраиваются.
 */
export function compareMonths(ref: MonthRef, today: string): MonthComparison {
  const full = monthRange(ref);
  const before = monthRange(previousMonth(ref));
  if (today >= full.from && today < full.to) {
    const days = daysBetween(full.from, today) + 1;
    const to = addDays(before.from, days - 1);
    return { current: { from: full.from, to: today }, previous: { from: before.from, to: to < before.to ? to : before.to }, partial: true };
  }
  return { current: full, previous: before, partial: false };
}

export interface Delta {
  /** Абсолютная разница; `null` — сравнить нельзя. */
  readonly abs: number | null;
  /** Процент — только при ненулевой базе (§48.86.14 п. 3). */
  readonly pct: number | null;
}

/** §48.86.15 п. 4, §48.86.32: при неполных или отсутствующих данных динамика не выдаётся. */
export function delta(current: number | null, previous: number | null, reliable = true): Delta {
  if (!reliable || current === null || previous === null) return { abs: null, pct: null };
  return { abs: current - previous, pct: previous > 0 ? (current - previous) / previous * 100 : null };
}

/** §48.86.16 п. 3: выбранной программы или мезоцикла уже нет в данных — безопасный сброс, а не чужие значения. */
export function sanitizeFilter(entries: readonly TrainingHistoryEntry[], filter: { programId: string | null; mesocycleId: string | null }):
  Readonly<{ programId: string | null; mesocycleId: string | null }> {
  const inProgram = entries.filter((entry) => entry.programId === filter.programId);
  if (filter.programId === null || inProgram.length === 0) return { programId: null, mesocycleId: null };
  return inProgram.some((entry) => entry.mesocycleId === filter.mesocycleId) ? filter : { programId: filter.programId, mesocycleId: null };
}

/** §48.86.19: занятия, оставленные только с упражнениями выбранной категории (переход от мышечной группы). */
export function trimToGroup(entries: readonly TrainingHistoryEntry[], infoOf: InfoOf, groupId: string): readonly TrainingHistoryEntry[] {
  return entries.flatMap((entry) => {
    const exercises = entry.exercises.filter((exercise) => (infoOf(exercise.exerciseId)?.group?.id ?? "none") === groupId
      && exercise.facts.some(isWorkingSet));
    return exercises.length === 0 ? [] : [{ ...entry, exercises }];
  });
}
