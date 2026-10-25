/** The v2 builder uses trimmed workout names; its persisted exercise-scope
 * command additionally requires the exact name and sort_index. Materialize only
 * their unambiguous intersection, within a page or a verified reciprocal shared
 * page family. The caller validates shared membership before supplying scope.
 * These are new plan edit groups, never evidence of shared performed facts.
 */
export interface LegacyScopeWorkout {
  readonly id: string; readonly program: string; readonly scope: string; readonly shared: boolean; readonly week: string; readonly weekIndex: number;
  readonly name: string; readonly position: number;
  readonly exercises: readonly { readonly id: string; readonly catalogId: string }[];
}
interface ScopeGroup {
  readonly sourceProgramIds: readonly string[];
  readonly sourceWorkoutIds: readonly string[];
  readonly status: "LOCAL_ONLY" | "LEGACY_SELECTORS_AGREE" | "WORKOUT_SCOPE_AMBIGUOUS" | "WORKOUT_SELECTORS_DISAGREE";
  readonly workoutAnchorId: string | null;
  readonly issues: readonly string[];
  readonly exercises: readonly { readonly catalogId: string; readonly sourceExerciseIds: readonly string[];
    readonly anchorId: string | null; readonly status: "LOCAL_ONLY" | "LEGACY_SELECTORS_AGREE" | "EXERCISE_SCOPE_AMBIGUOUS" | "WORKOUT_SCOPE_UNPROVEN" }[];
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function legacyScopeLineages(input: readonly LegacyScopeWorkout[]) {
  const groups = new Map<string, LegacyScopeWorkout[]>(), workouts = new Map<string, string>(), exercises = new Map<string, string>();
  const slots = new Map<string, LegacyScopeWorkout[]>(), sharedDisagreement = new Set<string>();
  for (const w of input) if (w.shared) {
    const key = JSON.stringify([w.scope, w.weekIndex, w.position]), rows = slots.get(key) ?? []; rows.push(w); slots.set(key, rows);
  }
  // Shared navigation's by-index fallback is weaker than the builder's named
  // scope. Do not silently claim full correspondence when these disagree.
  for (const rows of slots.values()) if (new Set(rows.map((w) => w.program)).size > 1 && new Set(rows.map((w) => w.name.trim())).size > 1) {
    for (const w of rows) sharedDisagreement.add(w.id);
  }
  for (const w of input) {
    workouts.set(w.id, w.id); for (const e of w.exercises) exercises.set(e.id, e.id);
    const key = JSON.stringify([w.scope, w.name.trim() || "Тренировка"]), group = groups.get(key) ?? [];
    group.push(w); groups.set(key, group);
  }
  const metadata: ScopeGroup[] = [];
  for (const [, unsorted] of [...groups].sort(([a], [b]) => compare(a, b))) {
    const group = [...unsorted].sort((a, b) => compare(a.program, b.program) || a.weekIndex - b.weekIndex || compare(a.id, b.id)), first = group[0]!;
    const ambiguous = new Set(group.map((w) => w.week)).size !== group.length;
    const agree = group.every((w) => w.name === first.name && w.position === first.position);
    const status: ScopeGroup["status"] = ambiguous ? "WORKOUT_SCOPE_AMBIGUOUS" : !agree ? "WORKOUT_SELECTORS_DISAGREE"
      : group.length === 1 ? "LOCAL_ONLY" : "LEGACY_SELECTORS_AGREE";
    const linked = !ambiguous && agree;
    if (linked) for (const w of group) workouts.set(w.id, first.id);
    const catalogs = new Map<string, { readonly workout: string; readonly exercise: string }[]>();
    for (const w of group) for (const e of w.exercises) {
      const rows = catalogs.get(e.catalogId) ?? []; rows.push({ workout: w.id, exercise: e.id }); catalogs.set(e.catalogId, rows);
    }
    const exerciseGroups: ScopeGroup["exercises"][number][] = [];
    for (const [catalogId, rows] of [...catalogs].sort(([a], [b]) => compare(a, b))) {
      const duplicate = new Set(rows.map((r) => r.workout)).size !== rows.length;
      const proven = linked && !duplicate, anchor = proven ? rows[0]!.exercise : null;
      if (anchor !== null) for (const row of rows) exercises.set(row.exercise, anchor);
      exerciseGroups.push({ catalogId, sourceExerciseIds: rows.map((r) => r.exercise).sort(compare), anchorId: anchor,
        status: !linked ? "WORKOUT_SCOPE_UNPROVEN" : duplicate ? "EXERCISE_SCOPE_AMBIGUOUS" : rows.length === 1 ? "LOCAL_ONLY" : "LEGACY_SELECTORS_AGREE" });
    }
    metadata.push({ sourceProgramIds: [...new Set(group.map((w) => w.program))].sort(compare), sourceWorkoutIds: group.map((w) => w.id).sort(compare), status,
      workoutAnchorId: linked ? first.id : null, issues: group.some((w) => sharedDisagreement.has(w.id)) ? ["SHARED_COUNTERPART_NAME_DIFFERS"] : [], exercises: exerciseGroups });
  }
  return { workouts, exercises, metadata, linkedWorkoutGroups: metadata.filter((g) => g.status === "LEGACY_SELECTORS_AGREE").length,
    linkedExerciseGroups: metadata.reduce((n, g) => n + g.exercises.filter((e) => e.status === "LEGACY_SELECTORS_AGREE").length, 0),
    reviewGroups: metadata.filter((g) => g.issues.length || g.status === "WORKOUT_SCOPE_AMBIGUOUS" || g.status === "WORKOUT_SELECTORS_DISAGREE"
      || g.exercises.some((e) => e.status === "EXERCISE_SCOPE_AMBIGUOUS")).length };
}
