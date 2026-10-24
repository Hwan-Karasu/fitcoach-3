import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import type { PlannedExercise, PlannedSet, TrainingPlansRepositoryPort } from "../../plans/public.ts";
import type { SetFact, SetType, SetValues, Side, TrackingMetric, WorkoutExecution,
  WorkoutOutcome, WorkoutSlot } from "../domain/ExecutionModel.ts";
import { EMPTY_VALUES } from "../domain/ExecutionModel.ts";
import { dropsForType, hasEnteredData, workoutStatus } from "../domain/ExecutionRules.ts";
import type { SaveSetInput, TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { useWorkoutSnapshot } from "./useWorkoutSnapshot.ts";
import { SerialWriteQueue } from "../application/SerialWriteQueue.ts";

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
  /** Поле одной стороны одностороннего подхода. */
  readonly side?: Readonly<{ side: Side; fields: Partial<SetValues> }>;
  /** «Пред.» одностороннего подхода: переносятся только имеющиеся стороны (§48.81). */
  readonly sidesFrom?: Readonly<{ left: SetValues | null; right: SetValues | null }>;
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
  /** Одностороннее ли упражнение каталога (§48.66): тогда подход пишется по сторонам. */
  unilateralOf: (exerciseId: string) => boolean,
  /** Новый переход «не выполнен → выполнен» при вводе в открытом дневнике — запуск таймера отдыха (§48.55). */
  onConfirmedNow: (exercise: PlannedExercise) => void) {
  const { clientId, programId } = slot;
  const [version, setVersion] = useState(0);
  const { stableSlot, slotKey, slotKeyRef, loadedKey, loadedKeyRef, workout, state, setState,
    previous, mode, setMode, message, setMessage, loadFailed } = useWorkoutSnapshot(slot, plans, execution, version);
  const stateRef = useRef<WorkoutExecution | null>(null);
  const confirmedRef = useRef(onConfirmedNow);
  confirmedRef.current = onConfirmedNow;
  const unilateralRef = useRef(unilateralOf);
  unilateralRef.current = unilateralOf;
  /** Собственные команды идут по очереди; пока они выполняются, их коммиты уже применены через ACK и перечитывания не требуют. */
  const queue = useRef(new SerialWriteQueue()).current;
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  /** Изменение пришло, пока экран был скрыт (поверх него матрица): перечитать при возврате. */
  const staleWhileHidden = useRef(false);
  stateRef.current = state;

  useFocusEffect(useCallback(() => {
    let active = true;
    execution.getConfirmationMode().then((next) => { if (active) setMode(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [execution]));

  const refresh = useCallback(() => {
    if (!focusedRef.current) { staleWhileHidden.current = true; return; }
    setVersion((value) => value + 1);
  }, []);
  useEffect(() => { if (focused && staleWhileHidden.current) { staleWhileHidden.current = false; setVersion((value) => value + 1); } }, [focused]);

  // Собственная запись возвращает результат (ACK) и применяется сразу; перечитывание нужно только для чужих изменений (матрица, другой экран).
  useEffect(() => execution.subscribeCommittedChanges((change) => {
    if (queue.busy) return;
    if (change.clientId === clientId && change.programId === programId) refresh();
  }), [clientId, execution, programId, refresh]);

  // Выбор программы или порядок мезоциклов на дневник не влияют.
  useEffect(() => plans.subscribeCommittedChanges((change) => {
    if (change.selectionOnly === true || change.orderOnly === true) return;
    if (change.clientIds.includes(clientId)) refresh();
  }), [clientId, plans, refresh]);

  const applyFact = useCallback((fact: SetFact, sessionState: WorkoutExecution["session"]) => {
    // Очередная команда читает ACK немедленно, не ждёт отложенного React-render с новой revision.
    const facts = new Map(stateRef.current?.facts ?? []);
    facts.set(fact.plannedSetId, fact);
    const next = { session: sessionState, facts, notes: stateRef.current?.notes ?? new Map<string, string>() };
    stateRef.current = next;
    setState(next);
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T | null> => {
    if (loadedKeyRef.current !== slotKeyRef.current) return Promise.resolve(null);
    return queue.run(task, { onSuccess: () => setMessage(null), onError: (error) => {
      setMessage(errorText(error));
      setVersion((value) => value + 1);
    } });
  }, [queue]);

  const finishSaving = useCallback((): Promise<boolean> => queue.settle(), [queue]);

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
      let sides: SaveSetInput["sides"];
      if (unilateralRef.current(exercise.exerciseId)) {
        let left = fact?.sides?.left.values ?? EMPTY_VALUES;
        let right = fact?.sides?.right.values ?? EMPTY_VALUES;
        if (patch.side?.side === "L") left = { ...left, ...patch.side.fields };
        if (patch.side?.side === "R") right = { ...right, ...patch.side.fields };
        if (patch.sidesFrom?.left) left = patch.sidesFrom.left;
        if (patch.sidesFrom?.right) right = patch.sidesFrom.right;
        sides = { left, right };
      }
      const input: SaveSetInput = { ...identity, drops, sides, setType,
        values: sides === undefined ? { ...(fact?.values ?? EMPTY_VALUES), ...patch.fields } : EMPTY_VALUES,
        rpe: patch.rpe !== undefined ? patch.rpe : fact?.rpe ?? null };
      const result = await execution.saveSet(input);
      applyFact(result.fact, result.session);
      if (result.confirmedNow) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        confirmedRef.current(exercise);
      }
      return result;
    }), [applyFact, enqueue, execution, identityOf]);

  const toggleSet = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number, side?: Side) =>
    enqueue(async () => {
      const { identity } = identityOf(exercise, set, position);
      const result = await execution.toggleSetConfirmation(identity, undefined, side);
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
      const next = { session: current?.session ?? null, facts, notes: current?.notes ?? new Map<string, string>() };
      stateRef.current = next;
      return next;
    });
    return fact;
  }), [enqueue, execution, stableSlot]);

  /** §48.84: фактическая дата проведения — та же тренировка, без второго выполнения. */
  const setActualDate = useCallback((date: string) => enqueue(async () => {
    const revision = stateRef.current?.session?.revision;
    if (revision === undefined) return null;
    const session = await execution.setActualDate(stableSlot, date, revision);
    setState((current) => {
      const next = { session, facts: current?.facts ?? new Map(), notes: current?.notes ?? new Map<string, string>() };
      stateRef.current = next;
      return next;
    });
    return session;
  }), [enqueue, execution, stableSlot]);

  /** PC §48.86.13: ручная правка отметок времени занятия (момент UTC или `null`); исход и факты не меняются. */
  const setTimes = useCallback((times: Readonly<{ startedAt: string | null; finishedAt: string | null }>) => enqueue(async () => {
    const revision = stateRef.current?.session?.revision;
    if (revision === undefined) return null;
    const session = await execution.setTimes(stableSlot, times, revision);
    setState((current) => {
      const next = { session, facts: current?.facts ?? new Map(), notes: current?.notes ?? new Map<string, string>() };
      stateRef.current = next;
      return next;
    });
    return session;
  }), [enqueue, execution, stableSlot]);

  /** §48.67: заметка о выполнении упражнения в этой тренировке. */
  const saveNote = useCallback((plannedExerciseId: string, text: string) => enqueue(async () => {
    await execution.saveExerciseNote(stableSlot, plannedExerciseId, text);
    setState((current) => {
      const notes = new Map(current?.notes ?? []);
      if (text.trim() === "") notes.delete(plannedExerciseId); else notes.set(plannedExerciseId, text.trim());
      const next = { session: current?.session ?? null, facts: current?.facts ?? new Map(), notes };
      stateRef.current = next;
      return next;
    });
    return text;
  }), [enqueue, execution, stableSlot]);

  /** §48.30: удалить выполнение целиком; плановая тренировка остаётся пустой. */
  const deleteExecution = useCallback(() => enqueue(async () => {
    const revision = stateRef.current?.session?.revision;
    if (revision === undefined) return null;
    await execution.deleteWorkoutExecution(stableSlot, revision);
    const next = { session: null, facts: new Map<string, SetFact>(), notes: new Map<string, string>() };
    stateRef.current = next;
    setState(next);
    return revision;
  }), [enqueue, execution, stableSlot]);

  const setOutcome = useCallback((outcome: WorkoutOutcome | null) => enqueue(async () => {
    const session = await execution.setOutcome(stableSlot, outcome, stateRef.current?.session?.revision ?? null);
    setState((current) => {
      const next = { session, facts: current?.facts ?? new Map(), notes: current?.notes ?? new Map<string, string>() };
      stateRef.current = next;
      return next;
    });
    return session;
  }), [enqueue, execution, stableSlot]);

  const started = state !== null && hasEnteredData(state.facts.values());
  return {
    workout, state, previous, mode, message, loadFailed, retry: refresh,
    /** Открыта другая неделя, её данные ещё грузятся: на экране прежние значения, ввод закрыт. */
    switching: workout !== undefined && loadedKey !== slotKey,
    status: workoutStatus(state?.session?.outcome ?? null, started),
    saveSet, toggleSet, setOutcome, addWarmup, removeWarmup, setActualDate, setTimes, saveNote, deleteExecution, finishSaving,
    dismissMessage: () => setMessage(null),
  };
}
