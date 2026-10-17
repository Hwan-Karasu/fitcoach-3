import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import type { PlannedExercise, PlannedSet, PlannedWorkout, TrainingPlansRepositoryPort } from "../../plans/public.ts";
import type { ConfirmationMode, PreviousSet, SetFact, SetType, SetValues, TrackingMetric, WorkoutExecution,
  WorkoutOutcome, WorkoutSlot } from "../domain/ExecutionModel.ts";
import { EMPTY_VALUES } from "../domain/ExecutionModel.ts";
import { hasEnteredData, workoutStatus } from "../domain/ExecutionRules.ts";
import type { SaveSetInput, TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";

/** Правка подхода; поля накладываются на последние сохранённые значения в момент записи. */
export interface SetPatch {
  readonly fields?: Partial<SetValues>;
  readonly rpe?: number | null;
  readonly setType?: SetType;
}

const errorText = (error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  return code === "INVALID_METRIC" ? "Значение вне допустимого диапазона — подход не сохранён."
    : code === "STALE_SESSION" ? "Тренировка изменилась — показаны сохранённые значения, повторите ввод."
      : "Не удалось сохранить. Последнее сохранённое значение на месте — повторите ввод.";
};

/**
 * Дневник одного слота: план тренировки (только чтение), факты, «Пред.», режим подтверждения.
 * Записи идут строго по очереди: каждая берёт ревизию из ответа предыдущей, двойное нажатие не дублирует.
 */
export function useWorkoutDiary(slot: WorkoutSlot, plans: TrainingPlansRepositoryPort, execution: TrainingExecutionPort,
  metricsOf: (exerciseId: string) => readonly TrackingMetric[] | null) {
  const { clientId, programId, weekIndex, plannedWorkoutId } = slot;
  const stableSlot = useMemo<WorkoutSlot>(() => ({ clientId, programId, weekIndex, plannedWorkoutId }),
    [clientId, programId, weekIndex, plannedWorkoutId]);
  const [workout, setWorkout] = useState<PlannedWorkout | null | undefined>(undefined);
  const [state, setState] = useState<WorkoutExecution | null>(null);
  const [previous, setPrevious] = useState<ReadonlyMap<string, PreviousSet>>(new Map());
  const [mode, setMode] = useState<ConfirmationMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const stateRef = useRef<WorkoutExecution | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await plans.getSimplePlan(clientId, programId);
        const found = loaded?.draft.plan.workouts.find((item) => item.id === plannedWorkoutId) ?? null;
        const [current, nextMode, nextPrevious] = await Promise.all([
          execution.getWorkout(stableSlot),
          execution.getConfirmationMode(),
          found === null ? Promise.resolve(new Map<string, PreviousSet>()) : execution.getPrevious(stableSlot,
            found.exercises.map((exercise) => ({ plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId,
              plannedSetIds: exercise.sets.map((set) => set.id) }))),
        ]);
        if (!active) return;
        setWorkout(found);
        setState(current);
        setMode(nextMode);
        setPrevious(nextPrevious);
      } catch {
        if (active) { setWorkout((value) => value === undefined ? null : value); setMessage("Не удалось открыть тренировку."); }
      }
    })();
    return () => { active = false; };
  }, [clientId, execution, plannedWorkoutId, plans, programId, stableSlot, version]);

  useEffect(() => execution.subscribeCommittedChanges((change) => {
    if (change.clientId === clientId && change.programId === programId) setVersion((value) => value + 1);
  }), [clientId, execution, programId]);

  useEffect(() => plans.subscribeCommittedChanges((change) => {
    if (change.clientIds.includes(clientId)) setVersion((value) => value + 1);
  }), [clientId, plans]);

  const applyFact = useCallback((fact: SetFact, sessionState: WorkoutExecution["session"]) => {
    setState((current) => {
      const facts = new Map(current?.facts ?? []);
      facts.set(fact.plannedSetId, fact);
      const next = { session: sessionState, facts };
      stateRef.current = next;
      return next;
    });
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T | null> => {
    const run = queue.current.then(task).then((value) => { setMessage(null); return value; }, (error: unknown) => {
      setMessage(errorText(error));
      setVersion((value) => value + 1);
      return null;
    });
    queue.current = run;
    return run;
  }, []);

  const identityOf = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number) => {
    const fact = stateRef.current?.facts.get(set.id) ?? null;
    return { fact, identity: { slot: stableSlot, plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId,
      plannedSetId: set.id, position, metrics: metricsOf(exercise.exerciseId) ?? [], expectedRevision: fact?.revision ?? null } };
  }, [metricsOf, stableSlot]);

  const saveSet = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number, patch: SetPatch) =>
    enqueue(async () => {
      const { fact, identity } = identityOf(exercise, set, position);
      const input: SaveSetInput = { ...identity, values: { ...(fact?.values ?? EMPTY_VALUES), ...patch.fields },
        rpe: patch.rpe !== undefined ? patch.rpe : fact?.rpe ?? null, setType: patch.setType ?? fact?.setType ?? "NORMAL" };
      const result = await execution.saveSet(input);
      applyFact(result.fact, result.session);
      if (result.confirmedNow) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return result;
    }), [applyFact, enqueue, execution, identityOf]);

  const toggleSet = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number) =>
    enqueue(async () => {
      const { identity } = identityOf(exercise, set, position);
      const result = await execution.toggleSetConfirmation(identity);
      applyFact(result.fact, result.session);
      if (result.confirmedNow) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return result;
    }), [applyFact, enqueue, execution, identityOf]);

  const setOutcome = useCallback((outcome: WorkoutOutcome | null) => enqueue(async () => {
    const session = await execution.setOutcome(stableSlot, outcome, stateRef.current?.session?.revision ?? null);
    setState((current) => {
      const next = { session, facts: current?.facts ?? new Map() };
      stateRef.current = next;
      return next;
    });
    return session;
  }), [enqueue, execution, stableSlot]);

  const started = state !== null && hasEnteredData(state.facts.values());
  return {
    workout, state, previous, mode, message,
    status: workoutStatus(state?.session?.outcome ?? null, started),
    saveSet, toggleSet, setOutcome,
    dismissMessage: () => setMessage(null),
  };
}
