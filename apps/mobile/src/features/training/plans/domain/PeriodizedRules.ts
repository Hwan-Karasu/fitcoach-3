import type { PlannedExercise, PlannedSet, PlannedWorkout } from "./SimplePlanModel.ts";
import type { PlanWeek, WeekScope, WeekType } from "./PeriodizedModel.ts";
import { cleanSupersets, remapSupersets, supersetGroups, withoutSuperset } from "./SupersetRules.ts";

/**
 * Правила Расширенного конструктора (§48.6). Правка недели — разница «до/после» по родству (`lineageId`):
 * её операции применяются к соответствующим элементам других недель и участников. Элемент, которого в целевой
 * неделе нет, не подменяется другим (§48.6.5 п. 8) — операция пропускается и считается конфликтом.
 */

type NewId = () => string;

/** Родство элемента; новый элемент получает родство по своему ID. */
const lineageOf = (item: Readonly<{ id: string; lineageId?: string }>) => item.lineageId ?? item.id;

type SetValues = Omit<PlannedSet, "id">;

export interface ExercisePatch {
  readonly sets?: readonly SetValues[];
  /**
   * Для каждого подхода из `sets` — номер того же подхода в исходной неделе («до»), `null` у нового. Подходы целевых недель имеют другие
   * ID, поэтому соответствие идёт по месту в исходной неделе, а не по месту в результате: удаление или вставка подхода не сдвигает
   * результаты соседних (§48.5.7 п. 2–3, 5).
   */
  readonly setSources?: readonly (number | null)[];
  readonly rir?: PlannedExercise["rir"];
  readonly instruction?: string | null;
  readonly restSec?: number | null;
}

export type WeekOp =
  | Readonly<{ kind: "addWorkout"; lineageId: string; after: string | null; workout: PlannedWorkout }>
  | Readonly<{ kind: "removeWorkout"; lineageId: string }>
  | Readonly<{ kind: "renameWorkout"; lineageId: string; title: string }>
  | Readonly<{ kind: "orderWorkouts"; order: readonly string[] }>
  | Readonly<{ kind: "addExercise"; workoutLineageId: string; after: string | null; exercise: PlannedExercise }>
  | Readonly<{ kind: "removeExercise"; lineageId: string }>
  | Readonly<{ kind: "replaceExercise"; lineageId: string; exercise: PlannedExercise }>
  | Readonly<{ kind: "updateExercise"; lineageId: string; patch: ExercisePatch }>
  | Readonly<{ kind: "orderExercises"; workoutLineageId: string; order: readonly string[] }>
  | Readonly<{ kind: "groupExercises"; workoutLineageId: string; affected: readonly string[]; groups: readonly (readonly string[])[] }>;

const valuesOf = (set: PlannedSet): SetValues => ({ reps: set.reps, repsMax: set.repsMax, loadGrams: set.loadGrams,
  durationSec: set.durationSec, distanceM: set.distanceM });
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Новые ID у копии тренировки или упражнения; родство сохраняется. */
function cloneExercise(exercise: PlannedExercise, newId: NewId): PlannedExercise {
  return { ...exercise, id: newId(), lineageId: lineageOf(exercise), sets: exercise.sets.map((set) => ({ ...set, id: newId() })) };
}

function cloneWorkout(workout: PlannedWorkout, newId: NewId): PlannedWorkout {
  return remapSupersets({ ...workout, id: newId(), lineageId: lineageOf(workout),
    exercises: workout.exercises.map((exercise) => cloneExercise(exercise, newId)) });
}

/** Тренировки недели с явным родством (у новых — по ID). */
export function withLineage(workouts: readonly PlannedWorkout[]): readonly PlannedWorkout[] {
  return workouts.map((workout) => ({ ...workout, lineageId: lineageOf(workout),
    exercises: workout.exercises.map((exercise) => ({ ...exercise, lineageId: lineageOf(exercise) })) }));
}

/** «Первая неделя → во все» (решение владельца 2026-10-18): план первой недели копируется в каждую. */
export function newMesocycleWeeks(firstWeek: readonly PlannedWorkout[], count: number, newId: NewId,
  type: WeekType = "base"): readonly PlanWeek[] {
  const template = withLineage(firstWeek);
  return Array.from({ length: count }, (_, index) => ({ id: newId(), index: index + 1, type,
    workouts: template.map((workout) => cloneWorkout(workout, newId)) }));
}

/** Копия мезоцикла для другого участника: те же родства, новые ID (§48.28 — у каждого своя структура). */
export function copyWeeks(weeks: readonly PlanWeek[], newId: NewId): readonly PlanWeek[] {
  return weeks.map((week) => ({ ...week, id: newId(), workouts: week.workouts.map((workout) => cloneWorkout(workout, newId)) }));
}

/** Изменился ли относительный порядок общих элементов. */
function orderChanged(before: readonly string[], after: readonly string[]): boolean {
  const kept = new Set(before.filter((id) => after.includes(id)));
  return !sameJson(before.filter((id) => kept.has(id)), after.filter((id) => kept.has(id)));
}

function exercisePatch(before: PlannedExercise, after: PlannedExercise): ExercisePatch | null {
  const patch: { -readonly [K in keyof ExercisePatch]: ExercisePatch[K] } = {};
  if (!sameJson(before.sets.map(valuesOf), after.sets.map(valuesOf))) {
    patch.sets = after.sets.map(valuesOf);
    patch.setSources = after.sets.map((set) => { const at = before.sets.findIndex((item) => item.id === set.id); return at < 0 ? null : at; });
  }
  if (!sameJson(before.rir, after.rir)) patch.rir = after.rir;
  if (before.instruction !== after.instruction) patch.instruction = after.instruction;
  if (before.restSec !== after.restSec) patch.restSec = after.restSec;
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Операции, превращающие неделю «до» в неделю «после». */
export function diffWeek(beforeWeek: readonly PlannedWorkout[], afterWeek: readonly PlannedWorkout[]): readonly WeekOp[] {
  const before = withLineage(beforeWeek);
  const after = withLineage(afterWeek);
  const ops: WeekOp[] = [];
  const beforeByLineage = new Map(before.map((workout) => [lineageOf(workout), workout]));
  const afterLineages = after.map(lineageOf);
  for (const workout of before) if (!afterLineages.includes(lineageOf(workout))) ops.push({ kind: "removeWorkout", lineageId: lineageOf(workout) });
  after.forEach((workout, index) => {
    const lineageId = lineageOf(workout);
    const previous = beforeByLineage.get(lineageId);
    if (previous === undefined) {
      ops.push({ kind: "addWorkout", lineageId, after: index === 0 ? null : afterLineages[index - 1] ?? null, workout });
      return;
    }
    if (previous.title.trim() !== workout.title.trim()) ops.push({ kind: "renameWorkout", lineageId, title: workout.title.trim() });
    const oldByLineage = new Map(previous.exercises.map((exercise) => [lineageOf(exercise), exercise]));
    const newLineages = workout.exercises.map(lineageOf);
    for (const exercise of previous.exercises) {
      if (!newLineages.includes(lineageOf(exercise))) ops.push({ kind: "removeExercise", lineageId: lineageOf(exercise) });
    }
    workout.exercises.forEach((exercise, position) => {
      const exerciseLineage = lineageOf(exercise);
      const old = oldByLineage.get(exerciseLineage);
      if (old === undefined) {
        ops.push({ kind: "addExercise", workoutLineageId: lineageId, after: position === 0 ? null : newLineages[position - 1] ?? null, exercise });
      } else if (old.exerciseId !== exercise.exerciseId) {
        ops.push({ kind: "replaceExercise", lineageId: exerciseLineage, exercise });
      } else {
        const patch = exercisePatch(old, exercise);
        if (patch !== null) ops.push({ kind: "updateExercise", lineageId: exerciseLineage, patch });
      }
    });
    if (orderChanged(previous.exercises.map(lineageOf), newLineages)) {
      ops.push({ kind: "orderExercises", workoutLineageId: lineageId, order: newLineages });
    }
    const oldGroups = supersetGroups(previous);
    const groups = supersetGroups(workout);
    if (!sameJson(oldGroups, groups)) {
      const changedOld = oldGroups.filter((group) => !groups.some((next) => sameJson(group, next)));
      const changedNew = groups.filter((group) => !oldGroups.some((old) => sameJson(group, old)));
      ops.push({ kind: "groupExercises", workoutLineageId: lineageId,
        affected: [...new Set([...changedOld.flat(), ...changedNew.flat()])], groups: changedNew });
    }
  });
  if (orderChanged(before.map(lineageOf), afterLineages)) ops.push({ kind: "orderWorkouts", order: afterLineages });
  return ops;
}

/** Известные элементы встают в новом относительном порядке на свои же места; незнакомые не двигаются. */
function reorder<T extends Readonly<{ id: string; lineageId?: string }>>(items: readonly T[], order: readonly string[]): T[] {
  const known = items.filter((item) => order.includes(lineageOf(item)))
    .sort((a, b) => order.indexOf(lineageOf(a)) - order.indexOf(lineageOf(b)));
  let next = 0;
  return items.map((item) => order.includes(lineageOf(item)) ? known[next++] as T : item);
}

function insertAfter<T extends Readonly<{ id: string; lineageId?: string }>>(items: readonly T[], after: string | null, item: T): T[] {
  if (after === null) return [item, ...items];
  const index = items.findIndex((candidate) => lineageOf(candidate) === after);
  return index < 0 ? [...items, item] : [...items.slice(0, index + 1), item, ...items.slice(index + 1)];
}

/**
 * Подходы по образцу; ID имеющихся подходов сохраняются за тем же подходом исходной недели — факты остаются при них
 * (§48.5.7 п. 2–3, 5). Без `sources` (старый вид операции) соответствие по месту.
 */
function patchSets(sets: readonly PlannedSet[], values: readonly SetValues[], sources: readonly (number | null)[] | undefined,
  newId: NewId): readonly PlannedSet[] {
  const used = new Set<string>();
  return values.map((value, index) => {
    const from = sources === undefined ? index : sources[index] ?? null;
    const kept = from === null ? undefined : sets[from];
    const id = kept !== undefined && !used.has(kept.id) ? kept.id : newId();
    used.add(id);
    return { ...value, id };
  });
}

export interface ApplyResult {
  readonly workouts: readonly PlannedWorkout[];
  /** Операции, для которых в неделе не нашлось соответствующего элемента. */
  readonly skipped: number;
}

export function applyWeekOps(week: readonly PlannedWorkout[], ops: readonly WeekOp[], newId: NewId): ApplyResult {
  let workouts = withLineage(week).map((workout) => ({ ...workout, exercises: [...workout.exercises] }));
  let skipped = 0;
  const hasExercise = (lineageId: string) => workouts.some((workout) => workout.exercises.some((exercise) => lineageOf(exercise) === lineageId));
  const mapExercises = (lineageId: string, change: (exercise: PlannedExercise) => PlannedExercise) => {
    if (!hasExercise(lineageId)) { skipped += 1; return; }
    workouts = workouts.map((workout) => ({ ...workout,
      exercises: workout.exercises.map((exercise) => lineageOf(exercise) === lineageId ? change(exercise) : exercise) }));
  };
  for (const op of ops) {
    switch (op.kind) {
      case "addWorkout":
        if (workouts.some((workout) => lineageOf(workout) === op.lineageId)) { skipped += 1; break; }
        { const copy = cloneWorkout(op.workout, newId);
          workouts = insertAfter(workouts, op.after, { ...copy, exercises: [...copy.exercises] }); }
        break;
      case "removeWorkout":
        if (!workouts.some((workout) => lineageOf(workout) === op.lineageId)) { skipped += 1; break; }
        workouts = workouts.filter((workout) => lineageOf(workout) !== op.lineageId);
        break;
      case "renameWorkout":
        if (!workouts.some((workout) => lineageOf(workout) === op.lineageId)) { skipped += 1; break; }
        workouts = workouts.map((workout) => lineageOf(workout) === op.lineageId ? { ...workout, title: op.title } : workout);
        break;
      case "orderWorkouts":
        workouts = reorder(workouts, op.order);
        break;
      case "addExercise": {
        const target = workouts.find((workout) => lineageOf(workout) === op.workoutLineageId);
        if (target === undefined || hasExercise(lineageOf(op.exercise))) { skipped += 1; break; }
        const added = cloneExercise(op.exercise, newId);
        workouts = workouts.map((workout) => workout === target
          ? { ...workout, exercises: insertAfter(workout.exercises, op.after, added) } : workout);
        break;
      }
      case "removeExercise":
        if (!hasExercise(op.lineageId)) { skipped += 1; break; }
        workouts = workouts.map((workout) => ({ ...workout,
          exercises: workout.exercises.filter((exercise) => lineageOf(exercise) !== op.lineageId) }));
        break;
      case "replaceExercise":
        // Новая идентичность (§48.5.7 п. 1): факты прежнего упражнения к новому не переходят.
        mapExercises(op.lineageId, (previous) => cloneExercise({ ...withoutSuperset(op.exercise), lineageId: op.lineageId,
          ...(previous.supersetId === undefined ? {} : { supersetId: previous.supersetId }) }, newId));
        break;
      case "updateExercise":
        mapExercises(op.lineageId, (exercise) => ({ ...exercise,
          ...(op.patch.sets === undefined ? {} : { sets: patchSets(exercise.sets, op.patch.sets, op.patch.setSources, newId) }),
          ...(op.patch.rir === undefined ? {} : { rir: op.patch.rir }),
          ...(op.patch.instruction === undefined ? {} : { instruction: op.patch.instruction }),
          ...(op.patch.restSec === undefined ? {} : { restSec: op.patch.restSec }) }));
        break;
      case "orderExercises": {
        if (!workouts.some((workout) => lineageOf(workout) === op.workoutLineageId)) { skipped += 1; break; }
        workouts = workouts.map((workout) => lineageOf(workout) === op.workoutLineageId
          ? { ...workout, exercises: reorder(workout.exercises, op.order) } : workout);
        break;
      }
      case "groupExercises": {
        const target = workouts.find((workout) => lineageOf(workout) === op.workoutLineageId);
        if (!target || op.groups.some((group) => group.some((id) => !target.exercises.some((item) => lineageOf(item) === id)))) {
          skipped += 1; break;
        }
        workouts = workouts.map((workout) => workout !== target ? workout : { ...workout,
          exercises: [...cleanSupersets(workout.exercises.map((item) => {
            if (!op.affected.includes(lineageOf(item))) return item;
            const group = op.groups.find((members) => members.includes(lineageOf(item)));
            if (!group) return withoutSuperset(item);
            const first = workout.exercises.find((member) => lineageOf(member) === group[0])!;
            return { ...item, supersetId: `superset:${workout.id}:${first.id}` };
          }))] });
        break;
      }
    }
  }
  return { workouts: workouts.map((workout) => ({ ...workout, exercises: cleanSupersets(workout.exercises) })), skipped };
}

/** §48.6.1: недели мезоцикла, которые получает правка открытой недели. */
export function targetWeeks(weeks: readonly Pick<PlanWeek, "index" | "type">[], openIndex: number, scope: WeekScope,
  sourceType?: WeekType): readonly number[] {
  const open = weeks.find((week) => week.index === openIndex);
  if (open === undefined && sourceType === undefined) return [];
  return weeks.filter((week) => scope === "CURRENT" ? week.index === openIndex
    : scope === "FOLLOWING" ? week.index >= openIndex
      : scope === "SAME_TYPE" ? week.type === (sourceType ?? open?.type)
        : true).map((week) => week.index);
}
