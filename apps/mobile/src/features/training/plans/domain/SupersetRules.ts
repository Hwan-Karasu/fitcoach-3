import type { PlannedExercise, PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";

export function withoutSuperset(exercise: PlannedExercise): PlannedExercise {
  const { supersetId: _group, ...rest } = exercise;
  void _group;
  return rest;
}

/** Если в группе осталось одно упражнение, суперсет распадается; ID упражнений не меняются. */
export function cleanSupersets(exercises: readonly PlannedExercise[]): readonly PlannedExercise[] {
  const counts = new Map<string, number>();
  for (const item of exercises) if (item.supersetId) counts.set(item.supersetId, (counts.get(item.supersetId) ?? 0) + 1);
  return exercises.map((item) => item.supersetId && (counts.get(item.supersetId) ?? 0) < 2 ? withoutSuperset(item) : item);
}

export function supersetNumber(workout: PlannedWorkout, exercise: PlannedExercise): number | null {
  if (!exercise.supersetId) return null;
  const groups = [...new Set(workout.exercises.flatMap((item) => item.supersetId ? [item.supersetId] : []))];
  return groups.indexOf(exercise.supersetId) + 1;
}

export function joinPreviousSuperset(draft: SimpleProgramDraft, workoutId: string, exerciseId: string): SimpleProgramDraft {
  return { ...draft, plan: { ...draft.plan, workouts: draft.plan.workouts.map((workout) => {
    if (workout.id !== workoutId) return workout;
    const index = workout.exercises.findIndex((item) => item.id === exerciseId);
    const item = workout.exercises[index];
    const previous = workout.exercises[index - 1];
    if (!item || !previous) return workout;
    const group = previous.supersetId ?? `superset:${workout.id}:${previous.id}`;
    return { ...workout, exercises: workout.exercises.map((exercise) =>
      exercise.id === item.id || exercise.id === previous.id
        || (item.supersetId !== undefined && exercise.supersetId === item.supersetId)
        ? { ...exercise, supersetId: group } : exercise) };
  }) } };
}

export function leaveSuperset(draft: SimpleProgramDraft, workoutId: string, exerciseId: string): SimpleProgramDraft {
  return { ...draft, plan: { ...draft.plan, workouts: draft.plan.workouts.map((workout) => workout.id !== workoutId ? workout
    : { ...workout, exercises: cleanSupersets(workout.exercises.map((item) => item.id === exerciseId ? withoutSuperset(item) : item)) }) } };
}

/** Новые ID групп у копии тренировки; связь с группами источника не сохраняется. */
export function remapSupersets(workout: PlannedWorkout): PlannedWorkout {
  const groups = new Map<string, string>();
  return { ...workout, exercises: workout.exercises.map((item) => {
    if (!item.supersetId) return item;
    let group = groups.get(item.supersetId);
    if (!group) { group = `superset:${workout.id}:${item.id}`; groups.set(item.supersetId, group); }
    return { ...item, supersetId: group };
  }) };
}

/** Состав групп сравнивается по родству, а не по ID группы другого участника или недели. */
export function supersetGroups(workout: PlannedWorkout): readonly (readonly string[])[] {
  const groups = new Map<string, string[]>();
  for (const item of workout.exercises) {
    if (!item.supersetId) continue;
    const members = groups.get(item.supersetId) ?? [];
    members.push(item.lineageId ?? item.id);
    groups.set(item.supersetId, members);
  }
  return [...groups.values()].filter((members) => members.length > 1).map((members) => members.sort())
    .sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
}

/**
 * Кнопка «Сет» конструктора (UI-OWN-028, как в 2.0): «Сет» на упражнении, затем на соседних — выбор растёт;
 * повторно на последнем — сет собран. «Сет» на участнике сета, повторно — вынуть его; на другом участнике того же
 * сета — расформировать (экран спрашивает подтверждение). Предела в 3 упражнения, как в 2.0, нет (§48.59 п. 2).
 */
export type SupersetPick =
  | Readonly<{ mode: "idle" }>
  | Readonly<{ mode: "picking"; workoutId: string; ids: readonly string[] }>
  | Readonly<{ mode: "leaving"; workoutId: string; id: string; groupId: string }>;

export type SupersetPress =
  | Readonly<{ type: "none" }>
  | Readonly<{ type: "commit"; ids: readonly string[] }>
  | Readonly<{ type: "extract"; id: string }>
  | Readonly<{ type: "dissolve"; groupId: string }>;

export const IDLE_SUPERSET_PICK: SupersetPick = { mode: "idle" };

const NONE: SupersetPress = { type: "none" };

/** Границы непрерывного блока выбранных упражнений; `null` — выбор не подряд. */
function bounds(exercises: readonly PlannedExercise[], ids: readonly string[]): Readonly<{ start: number; end: number }> | null {
  const indexes = ids.map((id) => exercises.findIndex((item) => item.id === id));
  if (indexes.some((index) => index < 0)) return null;
  const start = Math.min(...indexes);
  const end = Math.max(...indexes);
  return end - start + 1 === indexes.length ? { start, end } : null;
}

export function pressSuperset(pick: SupersetPick, workout: PlannedWorkout, exerciseId: string):
  Readonly<{ pick: SupersetPick; action: SupersetPress }> {
  const index = workout.exercises.findIndex((item) => item.id === exerciseId);
  const exercise = workout.exercises[index];
  if (exercise === undefined) return { pick: IDLE_SUPERSET_PICK, action: NONE };
  const current = pick.mode !== "idle" && pick.workoutId !== workout.id ? IDLE_SUPERSET_PICK : pick;
  if (current.mode === "leaving") {
    if (exerciseId === current.id) return { pick: IDLE_SUPERSET_PICK, action: { type: "extract", id: exerciseId } };
    if (exercise.supersetId === current.groupId) {
      return { pick: IDLE_SUPERSET_PICK, action: { type: "dissolve", groupId: current.groupId } };
    }
  } else if (current.mode === "picking") {
    if (exerciseId === current.ids[current.ids.length - 1]) {
      return { pick: IDLE_SUPERSET_PICK, action: current.ids.length >= 2 ? { type: "commit", ids: current.ids } : NONE };
    }
    const block = bounds(workout.exercises, current.ids);
    const adjacent = block !== null && (index === block.start - 1 || index === block.end + 1);
    if (!current.ids.includes(exerciseId) && exercise.supersetId === undefined && adjacent) {
      return { pick: { ...current, ids: [...current.ids, exerciseId] }, action: NONE };
    }
    return { pick: current, action: NONE };
  }
  if (exercise.supersetId !== undefined) {
    return { pick: { mode: "leaving", workoutId: workout.id, id: exerciseId, groupId: exercise.supersetId }, action: NONE };
  }
  return { pick: { mode: "picking", workoutId: workout.id, ids: [exerciseId] }, action: NONE };
}

function mapExercises(draft: SimpleProgramDraft, workoutId: string,
  edit: (exercises: readonly PlannedExercise[]) => readonly PlannedExercise[]): SimpleProgramDraft {
  return { ...draft, plan: { ...draft.plan, workouts: draft.plan.workouts.map((workout) =>
    workout.id === workoutId ? { ...workout, exercises: edit(workout.exercises) } : workout) } };
}

/** Действие «Сет» над черновиком; неприменимое (выбор уже не подряд и т. п.) ничего не меняет. */
export function applySupersetPress(draft: SimpleProgramDraft, workoutId: string, action: SupersetPress): SimpleProgramDraft {
  if (action.type === "none") return draft;
  return mapExercises(draft, workoutId, (exercises) => {
    if (action.type === "dissolve") {
      return exercises.map((item) => item.supersetId === action.groupId ? withoutSuperset(item) : item);
    }
    if (action.type === "commit") {
      const block = bounds(exercises, action.ids);
      if (block === null || exercises.slice(block.start, block.end + 1).some((item) => item.supersetId !== undefined)) return exercises;
      const group = `superset:${workoutId}:${action.ids[0]}`;
      return exercises.map((item) => action.ids.includes(item.id) ? { ...item, supersetId: group } : item);
    }
    const index = exercises.findIndex((item) => item.id === action.id);
    const member = exercises[index];
    if (member?.supersetId === undefined) return exercises;
    const group = member.supersetId;
    const members = exercises.flatMap((item, at) => item.supersetId === group ? [at] : []);
    const last = members[members.length - 1] ?? index;
    // Из середины упражнение встаёт сразу после сета, чтобы сет остался непрерывным.
    const moved = index > (members[0] ?? index) && index < last
      ? [...exercises.slice(0, index), ...exercises.slice(index + 1, last + 1), member, ...exercises.slice(last + 1)]
      : exercises;
    return cleanSupersets(moved.map((item) => item.id === action.id ? withoutSuperset(item) : item));
  });
}
