import { useEffect, useMemo, useRef, useState } from "react";
import type { PlannedWorkout, TrainingPlansRepositoryPort } from "../../plans/public.ts";
import { navigationPerformance } from "../../../../shared/diagnostics/NavigationPerformance.ts";
import type { ConfirmationMode, PreviousSet, WorkoutExecution, WorkoutSlot } from "../domain/ExecutionModel.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { previousWeekQueries } from "../domain/PreviousWeekQueries.ts";

/** Load one diary identity atomically; a failed or superseded request never authorizes editing. */
export function useWorkoutSnapshot(slot: WorkoutSlot, plans: TrainingPlansRepositoryPort, execution: TrainingExecutionPort, version: number) {
  const { clientId, programId, weekIndex, plannedWorkoutId } = slot;
  const stableSlot = useMemo<WorkoutSlot>(() => ({ clientId, programId, weekIndex, plannedWorkoutId }),
    [clientId, programId, weekIndex, plannedWorkoutId]);
  const slotKey = JSON.stringify([clientId, programId, weekIndex, plannedWorkoutId]);
  const slotKeyRef = useRef(slotKey);
  slotKeyRef.current = slotKey;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const [failureKey, setFailureKey] = useState<string | null>(null);
  const [workout, setWorkout] = useState<PlannedWorkout | null | undefined>(undefined);
  const [state, setState] = useState<WorkoutExecution | null>(null);
  const [previous, setPrevious] = useState<ReadonlyMap<string, PreviousSet>>(new Map());
  const [mode, setMode] = useState<ConfirmationMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setFailureKey(null);
    void (async () => {
      try {
        const endPlan = navigationPerformance.phase("plan");
        const foundPromise = plans.findWorkout(clientId, programId, plannedWorkoutId, weekIndex).finally(endPlan);
        const [found, { current, previous: nextPrevious }, nextMode] = await Promise.all([
          foundPromise,
          execution.getWorkoutWithPrevious(stableSlot, foundPromise.then((found) => found === null ? []
            : previousWeekQueries(found.workout, found.previousWorkout ?? null))),
          execution.getConfirmationMode(),
        ]);
        if (!active) return;
        setWorkout(found?.workout ?? null); setState(current); setMode(nextMode); setPrevious(nextPrevious); setMessage(null);
        loadedKeyRef.current = slotKey;
        setLoadedKey(slotKey);
      } catch {
        if (active) { setFailureKey(slotKey); setMessage("Не удалось открыть тренировку."); }
      }
    })();
    return () => { active = false; };
  }, [clientId, execution, plannedWorkoutId, plans, programId, slotKey, stableSlot, version, weekIndex]);
  return { stableSlot, slotKey, slotKeyRef, loadedKey, loadedKeyRef, workout, state, setState, previous,
    mode, setMode, message, setMessage, loadFailed: failureKey === slotKey };
}
