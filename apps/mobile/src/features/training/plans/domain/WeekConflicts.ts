import type { PlannedExercise, PlannedWorkout } from "./SimplePlanModel.ts";
import type { WeekEditConflict } from "./PeriodizedModel.ts";
import { applyWeekOps, diffWeek, type WeekOp } from "./PeriodizedRules.ts";
import { supersetGroups } from "./SupersetRules.ts";

const lineage = (item: { readonly id: string; readonly lineageId?: string }) => item.lineageId ?? item.id;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const shape = (item: PlannedExercise) => ({ exerciseId: item.exerciseId, restSec: item.restSec,
  instruction: item.instruction, rir: item.rir, sets: item.sets.map(({ id, ...values }) => { void id; return values; }) });
const exerciseIn = (workouts: readonly PlannedWorkout[], id: string) => workouts.flatMap((workout) => workout.exercises)
  .find((exercise) => lineage(exercise) === id);
const workoutOf = (workouts: readonly PlannedWorkout[], id: string) => workouts.find((workout) =>
  lineage(workout) === id || workout.exercises.some((exercise) => lineage(exercise) === id));

const operations: Record<WeekOp["kind"], string> = {
  addWorkout: "Добавить тренировку", removeWorkout: "Удалить тренировку", renameWorkout: "Название тренировки",
  orderWorkouts: "Порядок тренировок", addExercise: "Добавить упражнение", removeExercise: "Удалить упражнение",
  replaceExercise: "Заменить упражнение", updateExercise: "План упражнения", orderExercises: "Порядок упражнений",
  groupExercises: "Суперсеты",
};

function context(op: WeekOp, before: readonly PlannedWorkout[], after: readonly PlannedWorkout[]) {
  const id = "workoutLineageId" in op ? op.workoutLineageId : "lineageId" in op ? op.lineageId : "";
  const workout = workoutOf(after, id) ?? workoutOf(before, id);
  const exercise = op.kind === "addExercise" ? op.exercise : exerciseIn(before, id) ?? exerciseIn(after, id);
  return { workout, exercise };
}

function conflictReason(op: WeekOp, before: readonly PlannedWorkout[], after: readonly PlannedWorkout[],
  target: readonly PlannedWorkout[]): WeekEditConflict["reason"] | null {
  if (op.kind === "orderWorkouts") {
    const known = new Set(before.map(lineage));
    const wanted = before.map(lineage).filter((id) => target.some((workout) => lineage(workout) === id));
    const current = target.map(lineage).filter((id) => known.has(id));
    const desired = op.order.filter((id) => current.includes(id));
    return same(current, wanted) || same(current, desired) ? null : "PERSONAL_CHANGE";
  }
  const { workout } = context(op, before, after);
  const currentWorkout = target.find((item) => lineage(item) === (workout ? lineage(workout) : ""));
  if (op.kind === "addWorkout") return currentWorkout ? "PERSONAL_CHANGE" : null;
  if (!currentWorkout) return op.kind === "removeWorkout" || op.kind === "removeExercise" ? null : "MISSING_WORKOUT";
  const previousWorkout = before.find((item) => lineage(item) === lineage(currentWorkout));
  if (op.kind === "renameWorkout") return currentWorkout.title === previousWorkout?.title || currentWorkout.title === op.title
    ? null : "PERSONAL_CHANGE";
  if (op.kind === "removeWorkout") return previousWorkout && diffWeek([previousWorkout], [currentWorkout]).length > 0 ? "PERSONAL_CHANGE" : null;
  if (op.kind === "orderExercises") {
    const known = previousWorkout?.exercises.map(lineage) ?? [];
    const current = currentWorkout.exercises.map(lineage).filter((id) => known.includes(id));
    return same(current, known.filter((id) => current.includes(id))) || same(current, op.order.filter((id) => current.includes(id)))
      ? null : "PERSONAL_CHANGE";
  }
  if (op.kind === "groupExercises") {
    if (op.groups.flat().some((id) => !currentWorkout.exercises.some((item) => lineage(item) === id))) return "MISSING_EXERCISE";
    const relevant = (groups: readonly (readonly string[])[]) => groups.filter((members) => members.some((id) => op.affected.includes(id)));
    const current = relevant(supersetGroups(currentWorkout));
    return same(current, relevant(previousWorkout ? supersetGroups(previousWorkout) : [])) || same(current, relevant(op.groups))
      ? null : "PERSONAL_CHANGE";
  }
  const id = op.kind === "addExercise" ? lineage(op.exercise) : op.lineageId;
  const current = exerciseIn(target, id);
  const previous = exerciseIn(before, id);
  const desired = exerciseIn(after, id);
  if (!current) return op.kind === "addExercise" || op.kind === "removeExercise" ? null : "MISSING_EXERCISE";
  if (desired && same(shape(current), shape(desired))) return null;
  // Отдых — свойство упражнения, а не подходов: другие повторы и вес недели его не защищают (тип недели выбирают областью).
  // Защищён только отдых, который в той неделе уже задан вручную иначе.
  if (op.kind === "updateExercise" && Object.keys(op.patch).every((key) => key === "restSec")) {
    return previous === undefined || current.restSec === previous.restSec || current.restSec === desired?.restSec ? null : "PERSONAL_CHANGE";
  }
  return previous && same(shape(current), shape(previous)) ? null : "PERSONAL_CHANGE";
}

/** Явная замена восстанавливает только затронутое упражнение (или недостающую тренировку), с новыми ID, где нужно. */
function replaceConflict(target: readonly PlannedWorkout[], op: WeekOp, before: readonly PlannedWorkout[],
  after: readonly PlannedWorkout[], newId: () => string): readonly PlannedWorkout[] {
  const { workout: source } = context(op, before, after);
  if (!source || op.kind === "orderWorkouts") return applyWeekOps(target, [op], newId).workouts;
  const currentWorkout = target.find((item) => lineage(item) === lineage(source));
  if (!currentWorkout) {
    const desired = after.find((item) => lineage(item) === lineage(source));
    return desired ? applyWeekOps(target, [{ kind: "addWorkout", lineageId: lineage(desired), after: null, workout: desired }], newId).workouts : target;
  }
  if (op.kind === "addWorkout") {
    return applyWeekOps(target, [{ kind: "removeWorkout", lineageId: op.lineageId }, op], newId).workouts;
  }
  if (op.kind === "updateExercise" || op.kind === "replaceExercise" || op.kind === "addExercise") {
    const id = op.kind === "addExercise" ? lineage(op.exercise) : op.lineageId;
    const current = exerciseIn(target, id);
    const desired = exerciseIn(after, id);
    if (!desired) return target;
    if (!current) {
      const previous = source.exercises[source.exercises.findIndex((item) => lineage(item) === id) - 1];
      return applyWeekOps(target, [{ kind: "addExercise", workoutLineageId: lineage(source),
        after: previous ? lineage(previous) : null, exercise: desired }], newId).workouts;
    }
    if (current.exerciseId !== desired.exerciseId || op.kind === "addExercise") {
      return applyWeekOps(target, [{ kind: "replaceExercise", lineageId: id, exercise: desired }], newId).workouts;
    }
  }
  if (op.kind === "groupExercises") {
    let restored = target;
    for (const id of op.groups.flat()) {
      if (exerciseIn(restored, id)) continue;
      const desired = exerciseIn(after, id);
      if (desired) restored = applyWeekOps(restored, [{ kind: "addExercise", workoutLineageId: lineage(source), after: null, exercise: desired }], newId).workouts;
    }
    return applyWeekOps(restored, [op], newId).workouts;
  }
  return applyWeekOps(target, [op], newId).workouts;
}

export function applyWithConflicts(before: readonly PlannedWorkout[], after: readonly PlannedWorkout[],
  target: readonly PlannedWorkout[], clientId: string, weekIndex: number, replace: readonly string[], newId: () => string) {
  const conflicts: WeekEditConflict[] = [];
  let workouts = target;
  let skipped = 0;
  for (const [index, op] of diffWeek(before, after).entries()) {
    const reason = conflictReason(op, before, after, target);
    if (reason !== null) {
      const key = `${clientId}/${weekIndex}/${index}`;
      const { workout, exercise } = context(op, before, after);
      const currentExercise = exercise ? exerciseIn(target, lineage(exercise)) : undefined;
      const proposedExercise = exercise ? exerciseIn(after, lineage(exercise)) : undefined;
      conflicts.push({ key, clientId, weekIndex, workoutTitle: workout?.title ?? "Тренировки",
        exerciseId: exercise?.exerciseId ?? null, operation: operations[op.kind], reason, canReplace: true,
        ...(currentExercise ? { currentExercise } : {}), ...(proposedExercise ? { proposedExercise } : {}) });
      if (!replace.includes(key)) { skipped += 1; continue; }
      workouts = replaceConflict(workouts, op, before, after, newId);
    } else {
      // Уже применённое добавление или удаление — пустая операция, а не ошибка «нет элемента».
      workouts = applyWeekOps(workouts, [op], newId).workouts;
    }
  }
  return { workouts, skipped, conflicts };
}
