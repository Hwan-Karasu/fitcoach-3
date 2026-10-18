import { produce, type Draft } from "immer";
import { DEFAULT_WEEKS, REST_DEFAULT_SEC, REST_MAX_SEC, REST_MIN_SEC, type PlannedSet,
  type SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { SetField } from "./SimplePlanRules.ts";

/**
 * Правки черновика конструктора (immer): каждая возвращает новый черновик, исходный не меняется.
 * Новые ID приходят снаружи — так правки детерминированы в тестах.
 */

export const DEFAULT_SETS = 3;

const emptySet = (id: string): PlannedSet => ({ id, reps: null, loadGrams: null, durationSec: null, distanceM: null });

export function newDraft(firstWorkoutId: string): SimpleProgramDraft {
  return { title: "", plan: { weeks: DEFAULT_WEEKS, workouts: [{ id: firstWorkoutId, title: "Тренировка 1", exercises: [] }] } };
}

function workoutOf(draft: Draft<SimpleProgramDraft>, workoutId: string) {
  return draft.plan.workouts.find((workout) => workout.id === workoutId);
}

function exerciseOf(draft: Draft<SimpleProgramDraft>, plannedId: string) {
  for (const workout of draft.plan.workouts) {
    const exercise = workout.exercises.find((item) => item.id === plannedId);
    if (exercise !== undefined) return exercise;
  }
  return undefined;
}

function move<T>(items: T[], index: number, target: number): void {
  if (index < 0 || target < 0 || target >= items.length || index === target) return;
  const [item] = items.splice(index, 1);
  items.splice(target, 0, item as T);
}

export const setTitle = (draft: SimpleProgramDraft, title: string) => produce(draft, (d) => { d.title = title; });

export const setWeeks = (draft: SimpleProgramDraft, weeks: number) => produce(draft, (d) => { d.plan.weeks = weeks; });

export const addWorkout = (draft: SimpleProgramDraft, id: string) => produce(draft, (d) => {
  d.plan.workouts.push({ id, title: `Тренировка ${d.plan.workouts.length + 1}`, exercises: [] });
});

export const renameWorkout = (draft: SimpleProgramDraft, workoutId: string, title: string) => produce(draft, (d) => {
  const workout = workoutOf(d, workoutId);
  if (workout !== undefined) workout.title = title;
});

export const removeWorkout = (draft: SimpleProgramDraft, workoutId: string) => produce(draft, (d) => {
  d.plan.workouts = d.plan.workouts.filter((workout) => workout.id !== workoutId);
});

export const moveWorkout = (draft: SimpleProgramDraft, workoutId: string, direction: -1 | 1) => produce(draft, (d) => {
  const index = d.plan.workouts.findIndex((workout) => workout.id === workoutId);
  move(d.plan.workouts, index, index + direction);
});

/** Новое упражнение в конец тренировки с подходами по умолчанию (пустые плановые значения). */
export const addExercise = (draft: SimpleProgramDraft, workoutId: string, plannedId: string, exerciseId: string,
  setId: (index: number) => string) => produce(draft, (d) => {
  workoutOf(d, workoutId)?.exercises.push({ id: plannedId, exerciseId, restSec: REST_DEFAULT_SEC, instruction: null,
    sets: Array.from({ length: DEFAULT_SETS }, (_, index) => emptySet(setId(index))) });
});

/** §48.56: отдых упражнения в границах 1 с – 60 мин; `null` выключает таймер. */
export const setRest = (draft: SimpleProgramDraft, plannedId: string, restSec: number | null) => produce(draft, (d) => {
  const exercise = exerciseOf(d, plannedId);
  if (exercise === undefined) return;
  exercise.restSec = restSec === null ? null : Math.min(REST_MAX_SEC, Math.max(REST_MIN_SEC, Math.round(restSec)));
});

/** §48.67: плановое указание упражнения; пустое — нет указания. Длину проверяет `validateDraft`. */
export const setInstruction = (draft: SimpleProgramDraft, plannedId: string, text: string) => produce(draft, (d) => {
  const exercise = exerciseOf(d, plannedId);
  if (exercise !== undefined) exercise.instruction = text.trim() === "" ? null : text.trim();
});

/** Черновик, сохранённый до появления отдыха и указаний, получает значения по умолчанию. */
export const withRestDefaults = (draft: SimpleProgramDraft): SimpleProgramDraft => produce(draft, (d) => {
  for (const workout of d.plan.workouts) {
    for (const exercise of workout.exercises) {
      if (exercise.restSec === undefined) exercise.restSec = REST_DEFAULT_SEC;
      if (exercise.instruction === undefined) exercise.instruction = null;
    }
  }
});

export const removeExercise = (draft: SimpleProgramDraft, plannedId: string) => produce(draft, (d) => {
  for (const workout of d.plan.workouts) workout.exercises = workout.exercises.filter((item) => item.id !== plannedId);
});

/** Новый порядок упражнений тренировки (после перетаскивания); ID, которых нет, игнорируются. */
export const reorderExercises = (draft: SimpleProgramDraft, workoutId: string, order: readonly string[]) => produce(draft, (d) => {
  const workout = workoutOf(d, workoutId);
  if (workout === undefined) return;
  const byId = new Map(workout.exercises.map((item) => [item.id, item]));
  const sorted = order.flatMap((id) => { const item = byId.get(id); return item === undefined ? [] : [item]; });
  if (sorted.length === workout.exercises.length) workout.exercises = sorted;
});

/** Новый подход — копия последнего (так быстрее заполнять одинаковые подходы). */
export const addSet = (draft: SimpleProgramDraft, plannedId: string, setId: string) => produce(draft, (d) => {
  const exercise = exerciseOf(d, plannedId);
  if (exercise === undefined) return;
  const last = exercise.sets.at(-1);
  exercise.sets.push(last === undefined ? emptySet(setId) : { ...last, id: setId });
});

export const removeSet = (draft: SimpleProgramDraft, plannedId: string, setId: string) => produce(draft, (d) => {
  const exercise = exerciseOf(d, plannedId);
  if (exercise !== undefined && exercise.sets.length > 1) exercise.sets = exercise.sets.filter((set) => set.id !== setId);
});

export const updateSet = (draft: SimpleProgramDraft, plannedId: string, setId: string, field: SetField,
  value: number | null) => produce(draft, (d) => {
  const set = exerciseOf(d, plannedId)?.sets.find((item) => item.id === setId);
  if (set !== undefined) set[field] = value;
});

/** Одно значение во все подходы упражнения (частый случай «3 × 10»). */
export const fillSets = (draft: SimpleProgramDraft, plannedId: string, field: SetField, value: number | null) => produce(draft, (d) => {
  const exercise = exerciseOf(d, plannedId);
  if (exercise !== undefined) for (const set of exercise.sets) set[field] = value;
});
