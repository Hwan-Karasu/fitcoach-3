import type { BuilderWeek, CycleType } from "./PeriodizedModel.ts";
import { withLineage } from "./PeriodizedRules.ts";
import type { PlanRange } from "./SimplePlanModel.ts";
import { remapSupersets } from "./SupersetRules.ts";

/**
 * Конструктор Расширенной программы (UI-OWN-038, как в 2.0): мезоцикл с типом цикла, повторениями по умолчанию и
 * датой старта; каждая неделя — свой план и тип.
 */
export type { BuilderWeek, CycleType, MesocycleSettings } from "./PeriodizedModel.ts";

export const CYCLE_TYPES: readonly Readonly<{ id: CycleType; label: string; reps: PlanRange }>[] = [
  { id: "hypertrophy", label: "Гипертрофия", reps: { min: 8, max: 12 } },
  { id: "strength", label: "Сила", reps: { min: 3, max: 6 } },
  { id: "power", label: "Мощность", reps: { min: 1, max: 5 } },
  { id: "endurance", label: "Выносливость", reps: { min: 12, max: 20 } },
  { id: "recomp", label: "Рекомпозиция", reps: { min: 8, max: 12 } },
  { id: "custom", label: "Свой", reps: { min: 8, max: 12 } },
];

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
