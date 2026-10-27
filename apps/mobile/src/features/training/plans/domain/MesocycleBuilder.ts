import type { BuilderWeek, CycleType, WeekScope } from "./PeriodizedModel.ts";
import { applyWeekOps, diffWeek, targetWeeks, withLineage } from "./PeriodizedRules.ts";
import { CYCLE_REST_SEC } from "../../../../shared/training-transfer/CycleRest.ts";
import { setRest } from "./SimplePlanEdits.ts";
import { REST_DEFAULT_SEC, type PlannedWorkout, type PlanRange, type SimpleProgramDraft } from "./SimplePlanModel.ts";
import { dropUntrackedValues, type TrackingMetric } from "./SimplePlanRules.ts";
import { remapSupersets } from "./SupersetRules.ts";

/**
 * Конструктор Расширенной программы (UI-OWN-038, как в 2.0): мезоцикл с типом цикла, повторениями по умолчанию и
 * датой старта; каждая неделя — свой план и тип.
 */
export type { BuilderWeek, CycleType, MesocycleSettings } from "./PeriodizedModel.ts";

export const CYCLE_TYPES: readonly Readonly<{ id: CycleType; label: string; reps: PlanRange; restSec: number }>[] = [
  { id: "hypertrophy", label: "Гипертрофия", reps: { min: 8, max: 12 }, restSec: CYCLE_REST_SEC.hypertrophy },
  { id: "strength", label: "Сила", reps: { min: 3, max: 6 }, restSec: CYCLE_REST_SEC.strength },
  { id: "power", label: "Мощность", reps: { min: 1, max: 5 }, restSec: CYCLE_REST_SEC.power },
  { id: "endurance", label: "Выносливость", reps: { min: 12, max: 20 }, restSec: CYCLE_REST_SEC.endurance },
  { id: "recomp", label: "Рекомпозиция", reps: { min: 8, max: 12 }, restSec: CYCLE_REST_SEC.recomp },
  { id: "custom", label: "Свой", reps: { min: 8, max: 12 }, restSec: CYCLE_REST_SEC.custom },
];

/**
 * Упражнения, добавленные в цикл, получают отдых типа цикла (как повторения мезоцикла). Меняется только отдых по умолчанию:
 * заданное вручную и выключенное таймером остаётся как есть.
 */
export function restForNewExercises(draft: SimpleProgramDraft, isNew: (exerciseId: string) => boolean, restSec: number): SimpleProgramDraft {
  if (restSec === REST_DEFAULT_SEC) return draft;
  let result = draft;
  for (const workout of draft.plan.workouts) {
    for (const exercise of workout.exercises) if (isNew(exercise.id) && exercise.restSec === REST_DEFAULT_SEC) result = setRest(result, exercise.id, restSec);
  }
  return result;
}

export const cycleTypeLabels = Object.fromEntries(CYCLE_TYPES.map((item) => [item.id, item.label])) as Readonly<Record<CycleType, string>>;

/** «Скопировать из недели»: план и тип недели; новые ID, родство — с исходными тренировками и упражнениями. */
export function copyWeekPlan(source: BuilderWeek, newId: () => string): BuilderWeek {
  return { type: source.type, workouts: withLineage(source.workouts).map((workout) => remapSupersets({ ...workout, id: newId(),
    exercises: workout.exercises.map((exercise) => ({ ...exercise, id: newId(), sets: exercise.sets.map((set) => ({ ...set, id: newId() })) })),
  })) };
}

/**
 * Защита от мисклика (решение владельца): при сохранении пустая неделя получает план ближайшей заполненной
 * раньше, а если раньше нет — первой заполненной. Тип недели остаётся её собственным. Всё пусто — без изменений.
 */
export function fillEmptyWeeks(weeks: readonly BuilderWeek[], newId: () => string): readonly BuilderWeek[] {
  const firstFilled = weeks.find((week) => week.workouts.length > 0);
  if (firstFilled === undefined) return weeks;
  let source = firstFilled;
  return weeks.map((week) => {
    if (week.workouts.length > 0) { source = week; return week; }
    return { type: week.type, workouts: copyWeekPlan(source, newId).workouts };
  });
}

/**
 * Меню области после правки недели в конструкторе (§48.6, решение владельца 2026-10-19): изменения недели
 * `editing` (0-based) относительно `baseline` переносятся на недели области по родству; сама неделя не меняется.
 */
export function applyBuilderScope(weeks: readonly BuilderWeek[], editing: number, baseline: readonly PlannedWorkout[],
  scope: WeekScope, newId: () => string): readonly BuilderWeek[] {
  const open = weeks[editing];
  if (open === undefined) return weeks;
  const ops = diffWeek(baseline, open.workouts);
  if (ops.length === 0) return weeks;
  const indexed = weeks.map((week, at) => ({ index: at + 1, type: week.type }));
  const targets = new Set(targetWeeks(indexed, editing + 1, scope, open.type));
  return weeks.map((week, at) => at === editing || !targets.has(at + 1) ? week
    : { type: week.type, workouts: applyWeekOps(week.workouts, ops, newId).workouts });
}

/** Недели без плановых значений, которых профиль упражнения не отслеживает; нечего чистить — тот же массив. */
export function cleanBuilderWeeks(weeks: readonly BuilderWeek[],
  metricsOf: (exerciseId: string) => readonly TrackingMetric[] | null): readonly BuilderWeek[] {
  let changed = false;
  const result = weeks.map((week) => {
    const workouts = dropUntrackedValues(week.workouts, metricsOf);
    if (workouts === week.workouts) return week;
    changed = true;
    return { ...week, workouts };
  });
  return changed ? result : weeks;
}

/**
 * Смена типа цикла в конструкторе: упражнения, у которых отдых прежнего типа (то есть не менявшийся вручную), получают отдых нового
 * типа во всех неделях; заданное вручную и выключенное таймером не меняются. Нечего менять — те же недели.
 */
export function retuneBuilderRest(weeks: readonly BuilderWeek[], fromSec: number, toSec: number): readonly BuilderWeek[] {
  if (fromSec === toSec) return weeks;
  let changed = false;
  const result = weeks.map((week) => {
    let weekChanged = false;
    const workouts = week.workouts.map((workout) => {
      if (!workout.exercises.some((exercise) => exercise.restSec === fromSec)) return workout;
      weekChanged = true;
      return { ...workout, exercises: workout.exercises.map((exercise) => exercise.restSec === fromSec ? { ...exercise, restSec: toSec } : exercise) };
    });
    if (!weekChanged) return week;
    changed = true;
    return { ...week, workouts };
  });
  return changed ? result : weeks;
}

/** Число недель: новые — пустые «Индивидуальные», лишние убираются с конца. */
export function resizeBuilderWeeks(weeks: readonly BuilderWeek[], count: number): readonly BuilderWeek[] {
  if (count <= weeks.length) return weeks.slice(0, Math.max(1, count));
  return [...weeks, ...Array.from({ length: count - weeks.length }, (): BuilderWeek => ({ type: "base", workouts: [] }))];
}

/** Даты недели от старта мезоцикла: `[понедельник недели N, + 6 дней]` в YYYY-MM-DD. */
export function weekDates(startDate: string, weekIndex: number): readonly [string, string] {
  const [year, month, day] = startDate.split("-").map(Number) as [number, number, number];
  const from = new Date(Date.UTC(year, month - 1, day + (weekIndex - 1) * 7));
  const to = new Date(from.getTime() + 6 * 86_400_000);
  return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dayMonth = (date: string) => {
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""}`;
};

/** Подпись дат недели для карточки программы: «26 окт — 1 ноя». */
export function weekRangeLabel(startDate: string, weekIndex: number): string {
  const [from, to] = weekDates(startDate, weekIndex);
  return `${dayMonth(from)} — ${dayMonth(to)}`;
}

export function weeksWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} недель`;
  if (count % 10 === 1) return `${count} неделя`;
  return count % 10 >= 2 && count % 10 <= 4 ? `${count} недели` : `${count} недель`;
}
