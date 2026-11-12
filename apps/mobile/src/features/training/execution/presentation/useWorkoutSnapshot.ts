import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { PlannedWorkout, TrainingPlansRepositoryPort } from "../../plans/public.ts";
import { navigationPerformance } from "../../../../shared/diagnostics/NavigationPerformance.ts";
import type { ConfirmationMode, PreviousSet, WorkoutExecution, WorkoutSlot } from "../domain/ExecutionModel.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { previousWeekQueries } from "../domain/PreviousWeekQueries.ts";

interface Snapshot {
  readonly key: string;
  readonly slot: WorkoutSlot;
  readonly workout: PlannedWorkout | null;
  readonly state: WorkoutExecution;
  readonly previous: ReadonlyMap<string, PreviousSet>;
  readonly mode: ConfirmationMode;
}
const CAPACITY = 12;
const keyOf = (slot: WorkoutSlot) => JSON.stringify([slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId]);

/** Component-local, bounded snapshots. Cache hits are selected during render, without a loading effect/SQL. */
export function useWorkoutSnapshot(slot: WorkoutSlot, plans: TrainingPlansRepositoryPort, execution: TrainingExecutionPort, version: number) {
  const { clientId, programId, weekIndex, plannedWorkoutId } = slot;
  const stableSlot = useMemo<WorkoutSlot>(() => ({ clientId, programId, weekIndex, plannedWorkoutId }),
    [clientId, programId, weekIndex, plannedWorkoutId]);
  const slotKey = keyOf(stableSlot);
  const slotKeyRef = useRef(slotKey); slotKeyRef.current = slotKey;
  const loadedKeyRef = useRef<string | null>(null);
  const visible = useRef<Snapshot | null>(null);
  const [, render] = useState(0);
  const [failureKey, setFailureKey] = useState<string | null>(null);
  const [messageFor, setMessageFor] = useState<{ key: string; text: string | null } | null>(null);
  const [cache] = useState(() => ({ plans, execution, version, entries: new Map<string, Snapshot>(),
    pending: new Map<string, { slot: WorkoutSlot; promise: Promise<Snapshot | null> }>() }));
  if (cache.plans !== plans || cache.execution !== execution) {
    cache.plans = plans; cache.execution = execution; cache.entries.clear(); cache.pending.clear(); visible.current = null;
  }
  if (cache.version !== version) {
    cache.version = version; cache.entries.delete(slotKey); cache.pending.delete(slotKey);
  }
  const put = useCallback((snapshot: Snapshot) => {
    cache.entries.delete(snapshot.key); cache.entries.set(snapshot.key, snapshot);
    if (cache.entries.size > CAPACITY) cache.entries.delete(cache.entries.keys().next().value!);
  }, [cache]);
  const hit = cache.entries.get(slotKey);
  if (hit !== undefined) { visible.current = hit; cache.entries.delete(slotKey); cache.entries.set(slotKey, hit); }
  loadedKeyRef.current = hit === undefined ? null : slotKey;

  useEffect(() => {
    const invalidate = (client: string, program?: string, keep?: string) => {
      for (const [key, item] of cache.entries) if (key !== keep && item.slot.clientId === client && (program === undefined || item.slot.programId === program)) cache.entries.delete(key);
      for (const [key, item] of cache.pending) if (key !== keep && item.slot.clientId === client && (program === undefined || item.slot.programId === program)) cache.pending.delete(key);
    };
    // Остальные недели программы вытесняются (N+1 перечитает «Пред.»), а показанный слот остаётся: его обновляет ACK собственной записи,
    // а чужое изменение приходит в дневник через `refresh` → `version`. Иначе рендер между публикацией и ACK видел бы слот незагруженным:
    // `switching` закрывал ввод и отказывал записи (INPUT-LAG-1).
    const offExecution = execution.subscribeCommittedChanges((change) => invalidate(change.clientId, change.programId, slotKeyRef.current));
    const offPlans = plans.subscribeCommittedChanges((change) => {
      if (change.selectionOnly !== true && change.orderOnly !== true) for (const client of change.clientIds) invalidate(client);
    });
    return () => { offExecution(); offPlans(); };
  }, [cache, execution, plans]);

  /** Один запрос снимка на слот: общий для показа и предзагрузки (`pending` склеивает повторные). */
  const request = useCallback((target: WorkoutSlot): Promise<Snapshot | null> => {
    const key = keyOf(target);
    const running = cache.pending.get(key);
    if (running !== undefined) return running.promise;
    const endPlan = navigationPerformance.phase("plan");
    const foundPromise = cache.plans.findWorkout(target.clientId, target.programId, target.plannedWorkoutId, target.weekIndex).finally(endPlan);
    const loading = Promise.all([foundPromise,
      cache.execution.getWorkoutWithPrevious(target, foundPromise.then((found) => found === null ? []
        : previousWeekQueries(found.workout, found.previousWorkout ?? null))), cache.execution.getConfirmationMode()]);
    const identity = { slot: target, promise: null as unknown as Promise<Snapshot | null> };
    identity.promise = loading.then(([found, data, mode]) => {
      if (cache.pending.get(key) !== identity) return null;
      cache.pending.delete(key);
      const snapshot: Snapshot = { key, slot: target, workout: found?.workout ?? null, state: data.current, previous: data.previous, mode };
      put(snapshot); return snapshot;
    }, (error: unknown) => {
      if (cache.pending.get(key) === identity) cache.pending.delete(key);
      throw error;
    });
    cache.pending.set(key, identity);
    return identity.promise;
  }, [cache, put]);
  /**
   * Загрузить слот заранее, не показывая его (PART-FLICKER-1): смена участника переключает экран, когда данные уже в кэше, —
   * участник, неделя и значения меняются одним кадром, без приглушённого «переключения». `false` — не загрузилось или вытеснено.
   */
  const preload = useCallback(async (target: WorkoutSlot): Promise<boolean> => {
    if (cache.entries.has(keyOf(target))) return true;
    try { return (await request(target)) !== null; } catch { return false; }
  }, [cache, request]);

  useEffect(() => {
    if (cache.entries.has(slotKey)) return undefined;
    let active = true;
    setFailureKey(null);
    void request(stableSlot).then((snapshot) => {
      if (!active || snapshot === null) return;
      visible.current = snapshot; setMessageFor((old) => old?.key === slotKey ? null : old); render((value) => value + 1);
    }).catch(() => {
      if (active) { setFailureKey(slotKey); setMessageFor({ key: slotKey, text: "Не удалось открыть тренировку." }); }
    });
    return () => { active = false; };
  // `plans`/`execution` — смена владельца базы сбрасывает кэш при рендере; эффект обязан перечитать слот у нового владельца.
  }, [cache, execution, plans, request, slotKey, stableSlot, version]);

  const setState = useCallback((action: SetStateAction<WorkoutExecution | null>) => {
    const old = visible.current;
    if (old === null || old.key !== slotKeyRef.current) return;
    const state = typeof action === "function" ? action(old.state) : action;
    if (state === null || state === old.state) return;
    const next = { ...old, state }; visible.current = next; put(next); render((value) => value + 1);
  }, [put]);
  const setMode = useCallback((mode: ConfirmationMode) => {
    let changed = false;
    for (const [key, entry] of cache.entries) if (entry.mode !== mode) { cache.entries.set(key, { ...entry, mode }); changed = true; }
    if (visible.current !== null && visible.current.mode !== mode) { visible.current = { ...visible.current, mode }; changed = true; }
    if (changed) render((value) => value + 1);
  }, [cache]);
  const setMessage = useCallback((text: string | null) => setMessageFor((old) => old?.key === slotKeyRef.current && old.text === text
    ? old : { key: slotKeyRef.current, text }), []);
  const isCached = useCallback((target: WorkoutSlot) => cache.entries.has(keyOf(target)), [cache]);
  const snapshot = visible.current;
  return { stableSlot, slotKey, slotKeyRef, loadedKey: hit?.key ?? null, loadedKeyRef,
    displayedSlot: snapshot?.slot ?? stableSlot, displayedKey: snapshot?.key ?? slotKey,
    workout: snapshot?.workout, state: snapshot?.state ?? null,
    setState, previous: snapshot?.previous ?? new Map<string, PreviousSet>(), mode: snapshot?.mode ?? null,
    setMode, isCached, preload, message: messageFor?.key === slotKey ? messageFor.text : null, setMessage, loadFailed: failureKey === slotKey };
}
