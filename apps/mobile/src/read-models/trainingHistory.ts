import type { ClientExecution, SetFact, TrainingExecutionPort, TrainingHistoryEntry, TrainingPlansRepositoryPort, WorkoutOutcome,
  WorkoutStatus } from "../features/training/public.ts";
import type { PlannedWorkout } from "../features/training/plans/public.ts";

/** Чистые правила владельцев (как у сводки «Главной»): объём факта, статус тренировки, порядок хронологии. */
export interface TrainingHistoryRules {
  readonly factVolume: (fact: SetFact) => number;
  readonly workoutStatus: (outcome: WorkoutOutcome | null, started: boolean) => WorkoutStatus;
  readonly sortHistory: (entries: readonly TrainingHistoryEntry[]) => readonly TrainingHistoryEntry[];
}

type Origin = Readonly<{ mesocycleId: string | null; mesocycleTitle: string | null; workout: PlannedWorkout }>;

/**
 * §48.85, T06: единая хронология занятий клиента. Факты — у дневника, происхождение (программа, мезоцикл, день) —
 * у планов; архивные программы входят. Тренировка, которой больше нет в плане, остаётся записью с фактами.
 */
export function createTrainingHistory(rules: TrainingHistoryRules,
  execution: Pick<TrainingExecutionPort, "listClientExecutions" | "subscribeCommittedChanges">,
  plans: Pick<TrainingPlansRepositoryPort, "getLibrary" | "getPeriodizedPlan" | "getSimpleWeeks" | "subscribeCommittedChanges">) {
  const { factVolume, workoutStatus, sortHistory } = rules;
  return {
    async list(clientId: string): Promise<readonly TrainingHistoryEntry[]> {
      const [executions, library] = await Promise.all([execution.listClientExecutions(clientId), plans.getLibrary(clientId)]);
      const cards = new Map([...library.active, ...library.archived].map((card) => [card.id, card]));
      const origins = new Map<string, ReadonlyMap<string, Origin>>();
      for (const programId of new Set(executions.filter((item) => item.origin === null).map((item) => item.programId))) {
        const card = cards.get(programId);
        const map = new Map<string, Origin>();
        if (card?.kind === "PERIODIZED") {
          for (const cycle of (await plans.getPeriodizedPlan(clientId, programId))?.mesocycles ?? []) {
            for (const week of cycle.weeks) {
              for (const workout of week.workouts) map.set(`${week.index}:${workout.id}`, { mesocycleId: cycle.id, mesocycleTitle: cycle.title, workout });
            }
          }
        } else if (card?.kind === "SIMPLE") {
          for (const week of await plans.getSimpleWeeks(clientId, programId)) {
            for (const workout of week.workouts) map.set(`${week.index}:${workout.id}`, { mesocycleId: null, mesocycleTitle: null, workout });
          }
        }
        origins.set(programId, map);
      }
      const entries = executions.flatMap((item: ClientExecution): TrainingHistoryEntry[] => {
        const session = item.execution.session;
        const card = cards.get(item.programId);
        const facts = [...item.execution.facts.values()];
        // Занятие — тренировка с записанными подходами или исходом; пустое выполнение (например, после «Удалить
        // результаты» или смены даты без ввода) в хронологию не входит.
        // План удалён с сохранением истории — подписи из снимка дневника (§50.3, действие 1).
        const snapshot = item.origin;
        if (session === null || (card === undefined && snapshot === null) || (facts.length === 0 && session.outcome === null)) return [];
        const origin = snapshot !== null ? undefined : origins.get(item.programId)?.get(`${item.weekIndex}:${item.plannedWorkoutId}`);
        // Порядок упражнений — как в плане; убранные из плана — после, в порядке записи.
        const order = origin?.workout.exercises.map((exercise) => exercise.id) ?? [];
        const groups = new Map<string, { exerciseId: string; facts: SetFact[] }>();
        for (const id of order) groups.set(id, { exerciseId: origin!.workout.exercises.find((exercise) => exercise.id === id)!.exerciseId, facts: [] });
        for (const fact of facts.sort((a, b) => a.position - b.position)) {
          const group = groups.get(fact.plannedExerciseId) ?? { exerciseId: fact.exerciseId, facts: [] };
          group.facts.push(fact);
          groups.set(fact.plannedExerciseId, group);
        }
        return [{ key: session.id, programId: item.programId, programTitle: snapshot?.programTitle ?? card!.title,
          programKind: snapshot?.programKind ?? card!.kind, archived: snapshot === null && card!.archivedAt !== null, planDeleted: snapshot !== null,
          mesocycleId: origin?.mesocycleId ?? null, mesocycleTitle: snapshot !== null ? snapshot.mesocycleTitle : origin?.mesocycleTitle ?? null,
          workoutTitle: snapshot !== null ? snapshot.workoutTitle : origin?.workout.title ?? null, plannedWorkoutId: item.plannedWorkoutId, weekIndex: item.weekIndex, actualDate: session.actualDate,
          status: workoutStatus(session.outcome, facts.length > 0),
          confirmedSets: facts.filter((fact) => fact.confirmed).length,
          volumeKg: facts.reduce((sum, fact) => sum + factVolume(fact), 0),
          exercises: [...groups.values()].filter((group) => group.facts.length > 0) }];
      });
      return sortHistory(entries);
    },
    subscribe(clientId: string, listener: () => void): () => void {
      const offExecution = execution.subscribeCommittedChanges((change) => { if (change.clientId === clientId) listener(); });
      const offPlans = plans.subscribeCommittedChanges((change) => { if (change.clientIds.includes(clientId)) listener(); });
      return () => { offExecution(); offPlans(); };
    },
  };
}

export type TrainingHistoryPort = ReturnType<typeof createTrainingHistory>;
