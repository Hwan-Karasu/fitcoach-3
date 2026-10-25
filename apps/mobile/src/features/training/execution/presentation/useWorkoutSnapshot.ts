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

/** Component-local, bounded snapshots. Cache hits are selected during render, without a loading effect/SQL. */
export function useWorkoutSnapshot(slot: WorkoutSlot, plans: TrainingPlansRepositoryPort, execution: TrainingExecutionPort, version: number) {
  const { clientId, programId, weekIndex, plannedWorkoutId } = slot;
  const stableSlot = useMemo<WorkoutSlot>(() => ({ clientId, programId, weekIndex, plannedWorkoutId }),
    [clientId, programId, weekIndex, plannedWorkoutId]);
  const slotKey = JSON.stringify([clientId, programId, weekIndex, plannedWorkoutId]);
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
    const invalidate = (client: string, program?: string) => {
      for (const [key, item] of cache.entries) if (item.slot.clientId === client && (program === undefined || item.slot.programId === program)) cache.entries.delete(key);
      for (const [key, item] of cache.pending) if (item.slot.clientId === client && (program === undefined || item.slot.programId === program)) cache.pending.delete(key);
    };
    // Invalidate the owner's commits too: its ACK repopulates this slot, while N+1's Previous is evicted.
    const offExecution = execution.subscribeCommittedChanges((change) => invalidate(change.clientId, change.programId));
    const offPlans = plans.subscribeCommittedChanges((change) => {
      if (change.selectionOnly !== true && change.orderOnly !== true) for (const client of change.clientIds) invalidate(client);
    });
    return () => { offExecution(); offPlans(); };
  }, [cache, execution, plans]);

  useEffect(() => {
    if (cache.entries.has(slotKey)) return undefined;
    let active = true;
    setFailureKey(null);
    let request = cache.pending.get(slotKey);
    if (request === undefined) {
      const endPlan = navigationPerformance.phase("plan");
      const foundPromise = plans.findWorkout(clientId, programId, plannedWorkoutId, weekIndex).finally(endPlan);
      const loading = Promise.all([foundPromise,
        execution.getWorkoutWithPrevious(stableSlot, foundPromise.then((found) => found === null ? []
          : previousWeekQueries(found.workout, found.previousWorkout ?? null))), execution.getConfirmationMode()]);
      const identity = { slot: stableSlot, promise: null as unknown as Promise<Snapshot | null> };
      identity.promise = loading.then(([found, data, mode]) => {
        if (cache.pending.get(slotKey) !== identity) return null;
        cache.pending.delete(slotKey);
        const snapshot: Snapshot = { key: slotKey, slot: stableSlot, workout: found?.workout ?? null,
          state: data.current, previous: data.previous, mode };
        put(snapshot); return snapshot;
      }, (error: unknown) => {
        if (cache.pending.get(slotKey) === identity) cache.pending.delete(slotKey);
        throw error;
      });
      cache.pending.set(slotKey, identity); request = identity;
    }
    void request.promise.then((snapshot) => {
      if (!active || snapshot === null) return;
      visible.current = snapshot; setMessageFor((old) => old?.key === slotKey ? null : old); render((value) => value + 1);
    }).catch(() => {
      if (active) { setFailureKey(slotKey); setMessageFor({ key: slotKey, text: "Не удалось открыть тренировку." }); }
    });
    return () => { active = false; };
  }, [cache, clientId, execution, plannedWorkoutId, plans, programId, put, slotKey, stableSlot, version, weekIndex]);

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
  const isCached = useCallback((target: WorkoutSlot) => cache.entries.has(JSON.stringify([
    target.clientId, target.programId, target.weekIndex, target.plannedWorkoutId])), [cache]);
  const snapshot = visible.current;
  return { stableSlot, slotKey, slotKeyRef, loadedKey: hit?.key ?? null, loadedKeyRef,
    displayedSlot: snapshot?.slot ?? stableSlot, displayedKey: snapshot?.key ?? slotKey,
    workout: snapshot?.workout, state: snapshot?.state ?? null,
    setState, previous: snapshot?.previous ?? new Map<string, PreviousSet>(), mode: snapshot?.mode ?? null,
    setMode, isCached, message: messageFor?.key === slotKey ? messageFor.text : null, setMessage, loadFailed: failureKey === slotKey };
}
