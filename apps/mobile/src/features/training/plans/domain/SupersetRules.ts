import type { PlannedExercise, PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";

export function withoutSuperset(exercise: PlannedExercise): PlannedExercise {
  const { supersetId: _group, ...rest } = exercise;
  void _group;
  return rest;
}

/** Removing one member of a pair dissolves the pair, without touching either exercise's identity. */
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

/** New group identities for a copied workout. No relationship to the source group is retained. */
export function remapSupersets(workout: PlannedWorkout): PlannedWorkout {
  const groups = new Map<string, string>();
  return { ...workout, exercises: workout.exercises.map((item) => {
    if (!item.supersetId) return item;
    let group = groups.get(item.supersetId);
    if (!group) { group = `superset:${workout.id}:${item.id}`; groups.set(item.supersetId, group); }
    return { ...item, supersetId: group };
  }) };
}

/** Compare group membership by lineage, never by a group ID from another participant/week. */
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
