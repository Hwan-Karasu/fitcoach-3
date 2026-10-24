import { useEffect, useMemo, useState } from "react";
import type { ActiveWorkoutCard, ActiveWorkoutsPort, WorkoutSlot } from "../domain/ExecutionModel.ts";

/** Read global cards on invalidation; changing the viewed slot only filters the existing snapshot. */
export function useActiveWorkoutCards(activeWorkouts: ActiveWorkoutsPort, slot: WorkoutSlot) {
  const [cards, setCards] = useState<readonly ActiveWorkoutCard[]>([]);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const latest = ++request;
      activeWorkouts.list().then((next) => { if (active && latest === request) setCards(next); }).catch(() => undefined);
    };
    load();
    const unsubscribe = activeWorkouts.subscribe(load);
    return () => { active = false; unsubscribe(); };
  }, [activeWorkouts]);
  return useMemo(() => cards.filter((card) => !(card.slot.clientId === slot.clientId
    && card.slot.programId === slot.programId && card.slot.weekIndex === slot.weekIndex
    && card.slot.plannedWorkoutId === slot.plannedWorkoutId)),
  [cards, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId]);
}
