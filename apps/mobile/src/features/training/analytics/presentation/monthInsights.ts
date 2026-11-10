import { plural } from "../../../../shared/format/clockText.ts";
import type { TrainingHistoryEntry } from "../../archive/public.ts";
import type { ExerciseInfo } from "../../plans/public.ts";
import { isWorkingSet } from "./workingSet.ts";

/**
 * «Итоги месяца» (UIX-11, UI-OWN-079): фраза-вывод, лучший результат месяца и «на что обратить внимание». Чистые правила поверх тех же
 * определений, что и общая статистика: «проведено» — только «Завершена», рабочий подход — без разминки; недостающие данные не заменяются нулём.
 */
const PREPOSITIONAL = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"] as const;

/** Месяц в предложном падеже: «ноябре» (для «в ноябре»). */
export const monthPrepositional = (month: number): string => PREPOSITIONAL[month - 1] ?? "";

const sessionsText = (count: number) => `${count} ${plural(count, "занятие", "занятия", "занятий")}`;

/**
 * Фраза-вывод: «В ноябре проведено 9 занятий — на 2 больше, чем в октябре.» Неполный месяц сравнивается с такой же по длине частью прошлого
 * («…чем за такой же срок в октябре»). Нет занятий в обоих месяцах — «пока нет»; нечем сравнить (в прошлом месяце не было) — без сравнения.
 */
export function monthPhrase(input: Readonly<{ month: number; previousMonth: number; completed: number; previousCompleted: number; partial: boolean }>): string {
  const now = `в ${monthPrepositional(input.month)}`;
  const then = input.partial ? `за такой же срок в ${monthPrepositional(input.previousMonth)}` : `в ${monthPrepositional(input.previousMonth)}`;
  if (input.completed === 0) return `${now[0]!.toUpperCase()}${now.slice(1)} проведённых занятий пока нет.`;
  const head = `${now[0]!.toUpperCase()}${now.slice(1)} проведено ${sessionsText(input.completed)}`;
  if (input.previousCompleted === 0) return `${head}; ${then} занятий не было.`;
  const difference = input.completed - input.previousCompleted;
  if (difference === 0) return `${head} — столько же, сколько ${then}.`;
  return `${head} — на ${Math.abs(difference)} ${difference > 0 ? "больше" : "меньше"}, чем ${then}.`;
}

/** Рабочий подход с весом и повторами; тонн и масса тела не нужны. */
export interface LoadSet {
  readonly exerciseId: string;
  readonly loadKg: number;
  readonly reps: number;
}

/** Рабочие подходы «вес × повторы» тех упражнений, где эти величины есть в профиле; односторонние и неполные подходы пропускаются. */
export function loadSetsOf(entries: readonly TrainingHistoryEntry[], infoOf: (exerciseId: string) => ExerciseInfo | undefined): readonly LoadSet[] {
  return entries.flatMap((entry) => entry.exercises.flatMap((exercise) => {
    const metrics = infoOf(exercise.exerciseId)?.metrics ?? [];
    if (!(metrics.includes("load") && metrics.includes("reps"))) return [];
    return exercise.facts.filter(isWorkingSet).flatMap((fact) => {
      const { loadGrams, reps } = fact.values;
      return fact.sides === null && loadGrams !== null && loadGrams > 0 && reps !== null && reps > 0 ? [{ exerciseId: exercise.exerciseId, loadKg: loadGrams / 1000, reps }] : [];
    });
  }));
}

export interface BestResult {
  readonly exerciseId: string;
  readonly loadKg: number;
  readonly reps: number;
  /** Лучший вес этого упражнения в прошлом месяце; `null` — тогда его не было (изменение неизвестно, а не «+весь вес»). */
  readonly previousLoadKg: number | null;
}

/** Лучший результат месяца — самый тяжёлый рабочий подход (главное — вес; при равенстве — больше повторов) и изменение к прошлому месяцу. */
export function bestResult(current: readonly LoadSet[], previous: readonly LoadSet[]): BestResult | null {
  let best: LoadSet | null = null;
  for (const set of current) {
    if (best === null || set.loadKg > best.loadKg || (set.loadKg === best.loadKg && set.reps > best.reps)) best = set;
  }
  if (best === null) return null;
  const before = previous.filter((set) => set.exerciseId === best.exerciseId).map((set) => set.loadKg);
  return { exerciseId: best.exerciseId, loadKg: best.loadKg, reps: best.reps, previousLoadKg: before.length === 0 ? null : Math.max(...before) };
}

/** «На что обратить внимание»: пропущенные занятия, неполные данные, снижение к прошлому месяцу; нет замечаний — пустой список. */
export function attentionNotes(input: Readonly<{ missed: number; incompleteSets: number; completed: number; previousCompleted: number; partial: boolean }>): readonly string[] {
  const notes: string[] = [];
  if (input.missed > 0) notes.push(`Пропущено ${sessionsText(input.missed)}.`);
  if (input.completed < input.previousCompleted) {
    notes.push(`Проведено на ${input.previousCompleted - input.completed} меньше, чем ${input.partial ? "за такой же срок в прошлом месяце" : "в прошлом месяце"}.`);
  }
  if (input.incompleteSets > 0) notes.push(`Неполные данные: ${input.incompleteSets} подх. без веса, повторов или массы тела — в тоннаж не вошли.`);
  return notes;
}

export const trainingEntriesMissed = (entries: readonly TrainingHistoryEntry[]): number => entries.filter((entry) => entry.status === "MISSED").length;
