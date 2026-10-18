import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import type { PlannedExercise, PlannedSet, PlannedWorkout, TrainingPlansRepositoryPort } from "../../plans/public.ts";
import type { ConfirmationMode, PreviousSet, SetFact, SetType, SetValues, TrackingMetric, WorkoutExecution,
  WorkoutOutcome, WorkoutSlot } from "../domain/ExecutionModel.ts";
import { EMPTY_VALUES } from "../domain/ExecutionModel.ts";
import { dropsForType, hasEnteredData, workoutStatus } from "../domain/ExecutionRules.ts";
import type { SaveSetInput, TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";

/** Добавленные разминочные подходы упражнения по порядку добавления. */
export function extraWarmups(state: WorkoutExecution | null, plannedExerciseId: string): readonly SetFact[] {
  return [...(state?.facts.values() ?? [])].filter((fact) => fact.extra && fact.plannedExerciseId === plannedExerciseId)
    .sort((a, b) => a.position - b.position);
}

/** Правка подхода; поля накладываются на последние сохранённые значения в момент записи. */
export interface SetPatch {
  readonly fields?: Partial<SetValues>;
  readonly rpe?: number | null;
  /** Смена типа; мини-сеты дроп-сета появляются или убираются вместе с ней. */
  readonly setType?: SetType;
  /** Состав мини-сетов целиком: добавить, убрать, перенести из «Пред.». */
  readonly drops?: readonly SetValues[];
  /** Поле одного мини-сета. */
  readonly drop?: Readonly<{ index: number; fields: Partial<SetValues> }>;
}

const errorText = (error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  return code === "INVALID_METRIC" ? "Значение вне допустимого диапазона — подход не сохранён."
    : code === "STALE_SESSION" ? "Тренировка изменилась — показаны сохранённые значения, повторите ввод."
      : code === "DROP_STRUCTURE_LOCKED" ? "Дроп-сет уже выполнен: чтобы изменить мини-сеты или тип, сначала снимите выполнение — очистите вес или повторы либо снимите галочку."
      : "Не удалось сохранить. Последнее сохранённое значение на месте — повторите ввод.";
};

/**
 * Дневник одного слота: план тренировки (только чтение), факты, «Пред.», режим подтверждения.
 * Записи идут строго по очереди: каждая берёт ревизию из ответа предыдущей, двойное нажатие не дублирует.
 */
export function useWorkoutDiary(slot: WorkoutSlot, plans: TrainingPlansRepositoryPort, execution: TrainingExecutionPort,
  metricsOf: (exerciseId: string) => readonly TrackingMetric[] | null,
  /** Новый переход «не выполнен → выполнен» при вводе в открытом дневнике — запуск таймера отдыха (§48.55). */
  onConfirmedNow: (exercise: PlannedExercise) => void) {
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
  const confirmedRef = useRef(onConfirmedNow);
  confirmedRef.current = onConfirmedNow;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await plans.getSimplePlan(clientId, programId);
        const found = loaded?.draft.plan.workouts.find((item) => item.id === plannedWorkoutId) ?? null;
        const [current, nextMode] = await Promise.all([execution.getWorkout(stableSlot), execution.getConfirmationMode()]);
        // Добавленные разминки тоже получают «Пред.» — по типу и номеру среди разминок.
        const nextPrevious = found === null ? new Map<string, PreviousSet>() : await execution.getPrevious(stableSlot,
          found.exercises.map((exercise) => ({ plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId,
            plannedSetIds: [...extraWarmups(current, exercise.id).map((fact) => fact.plannedSetId),
              ...exercise.sets.map((set) => set.id)] })));
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

  // Режим подтверждения — общая настройка тренера (§48.54): после смены в настройках дневник берёт новый.
  useFocusEffect(useCallback(() => {
    let active = true;
    execution.getConfirmationMode().then((next) => { if (active) setMode(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [execution]));

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
      const setType = patch.setType ?? fact?.setType ?? "NORMAL";
      let drops = setType === (fact?.setType ?? "NORMAL") ? fact?.drops ?? [] : dropsForType(setType, fact?.drops ?? []);
      if (patch.drops !== undefined) drops = patch.drops;
      const { drop } = patch;
      if (drop !== undefined) drops = drops.map((item, index) => index === drop.index ? { ...item, ...drop.fields } : item);
      const input: SaveSetInput = { ...identity, values: { ...(fact?.values ?? EMPTY_VALUES), ...patch.fields }, drops,
        rpe: patch.rpe !== undefined ? patch.rpe : fact?.rpe ?? null, setType };
      const result = await execution.saveSet(input);
      applyFact(result.fact, result.session);
      if (result.confirmedNow) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        confirmedRef.current(exercise);
      }
      return result;
    }), [applyFact, enqueue, execution, identityOf]);

  const toggleSet = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number) =>
    enqueue(async () => {
      const { identity } = identityOf(exercise, set, position);
      const result = await execution.toggleSetConfirmation(identity);
      applyFact(result.fact, result.session);
      if (result.confirmedNow) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        confirmedRef.current(exercise);
      }
      return result;
    }), [applyFact, enqueue, execution, identityOf]);

  /** Разминка (как в 2.0): новый подход сверху упражнения, плановые не меняются. */
  const addWarmup = useCallback((exercise: PlannedExercise) => enqueue(async () => {
    const result = await execution.addWarmupSet(stableSlot, { plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId });
    applyFact(result.fact, result.session);
    return result;
  }), [applyFact, enqueue, execution, stableSlot]);

  const removeWarmup = useCallback((plannedSetId: string) => enqueue(async () => {
    const fact = stateRef.current?.facts.get(plannedSetId);
    if (fact === undefined) return null;
    await execution.removeWarmupSet(stableSlot, plannedSetId, fact.revision);
    setState((current) => {
      const facts = new Map(current?.facts ?? []);
      facts.delete(plannedSetId);
      const next = { session: current?.session ?? null, facts };
      stateRef.current = next;
      return next;
    });
    return fact;
  }), [enqueue, execution, stableSlot]);

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
    saveSet, toggleSet, setOutcome, addWarmup, removeWarmup,
    dismissMessage: () => setMessage(null),
  };
}
