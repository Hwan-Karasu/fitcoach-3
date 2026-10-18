import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { ExerciseLookupPort, WeekCopyPort, WeekCopyPreview, WeekCopyRequest, WeekPlansParticipant } from "../features/training/plans/public.ts";
import type { WeekExecutionParticipant, WorkoutCopyMapping, WorkoutExecution, WorkoutSlot } from "../features/training/execution/public.ts";

export type TrainingTransaction = <T>(task: (tx: SqliteStatementPort) => Promise<T>) => Promise<T>;

/** Оба владельца пишут в одной транзакции; уведомления и таймеры внутри неё не запускаются. */
export function createWeekCopyWorkflow(transaction: TrainingTransaction, plans: WeekPlansParticipant<SqliteStatementPort>,
  execution: WeekExecutionParticipant<SqliteStatementPort>, exercises: ExerciseLookupPort, now: () => Date = () => new Date()): WeekCopyPort {
  const read = async (tx: SqliteStatementPort, request: WeekCopyRequest) => {
    const structure = await plans.read(tx, request);
    const slot = (weekIndex: number, plannedWorkoutId: string): WorkoutSlot => ({ clientId: request.clientId,
      programId: request.programId, weekIndex, plannedWorkoutId });
    const sourceSlots = structure.source.workouts.map((item) => slot(request.sourceWeek, item.id));
    const targetSlots = structure.target.workouts.map((item) => slot(request.targetWeek, item.id));
    const source = await execution.read(tx, sourceSlots);
    const target = await execution.read(tx, targetSlots);
    const stamp = (values: readonly WorkoutExecution[]) => values.map((value) => ({ session: value.session,
      facts: [...value.facts.values()].map((fact) => [fact.id, fact.revision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      notes: [...value.notes].sort(([a], [b]) => a.localeCompare(b)),
    }));
    const preview: WeekCopyPreview = {
      revisionToken: JSON.stringify([request, stamp(source), stamp(target)]),
      sourceSets: source.reduce((n, value, index) => n + [...value.facts.values()].filter((fact) =>
        structure.source.workouts[index]!.exercises.some((exercise) => exercise.id === fact.plannedExerciseId
          && (fact.extra || exercise.sets.some((set) => set.id === fact.plannedSetId)))).length, 0),
      targetSessions: target.filter((value) => value.session !== null).length,
      targetSets: target.reduce((n, value) => n + value.facts.size, 0),
      targetNotes: target.reduce((n, value) => n + value.notes.size, 0),
    };
    return { preview, targetSlots, sourceSlots, slot };
  };
  return {
    preview: (request) => transaction(async (tx) => (await read(tx, request)).preview),
    copy: async (request, revisionToken, mode, replaceExisting) => {
      if (!["PLAN", "PREFILL", "CONFIRM"].includes(mode)) throw new Error("DRAFT_INVALID");
      const lookup = mode === "PLAN" ? null : await exercises.lookup();
      await transaction(async (tx) => {
        const current = await read(tx, request);
        if (current.preview.revisionToken !== revisionToken) throw new Error("COPY_PREVIEW_STALE");
        if (current.preview.targetSessions > 0 && !replaceExisting) throw new Error("REPLACE_CONFIRMATION_REQUIRED");
        const stamp = now();
        const copied = await plans.replace(tx, request, stamp);
        const mappings: WorkoutCopyMapping[] = copied.source.workouts.map((workout, index) => ({
          source: current.sourceSlots[index]!, target: current.slot(request.targetWeek, copied.target.workouts[index]!.id),
          exercises: workout.exercises.map((exercise, i) => {
            const target = copied.target.workouts[index]!.exercises[i]!;
            const metrics = lookup?.get(exercise.exerciseId)?.metrics ?? [];
            if (mode !== "PLAN" && metrics.length === 0) throw new Error("EXERCISE_PROFILE_UNAVAILABLE");
            return { sourceId: exercise.id, targetId: target.id, exerciseId: exercise.exerciseId, metrics,
              sets: exercise.sets.map((set, j) => ({ sourceId: set.id, targetId: target.sets[j]!.id })) };
          }),
        }));
        await execution.replace(tx, current.targetSlots, mappings, mode, stamp);
      });
      plans.notify(request.clientId);
      execution.notify(request.clientId, request.programId);
    },
  };
}
