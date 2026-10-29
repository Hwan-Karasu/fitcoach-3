import { useEffect, useMemo, useState } from "react";
import type { ActiveWorkoutCard, ActiveWorkoutsPort, WorkoutSlot } from "../domain/ExecutionModel.ts";

/** Пауза, за которую серия записей (несколько подходов подряд) даёт одно перечитывание карточек. */
export const ACTIVE_CARDS_PAUSE_MS = 250;

/** Read global cards on invalidation; changing the viewed slot only filters the existing snapshot. */
export function useActiveWorkoutCards(activeWorkouts: ActiveWorkoutsPort, slot: WorkoutSlot) {
  const [cards, setCards] = useState<readonly ActiveWorkoutCard[]>([]);
  useEffect(() => {
    let active = true;
    let request = 0;
    let pause: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      const latest = ++request;
      activeWorkouts.list().then((next) => { if (active && latest === request) setCards(next); }).catch(() => undefined);
    };
    load();
    // WRITE-PATH-1: каждый подход — коммит; серия подходов перечитывает список один раз после паузы.
    const unsubscribe = activeWorkouts.subscribe(() => {
      if (pause !== null) clearTimeout(pause);
      pause = setTimeout(() => { pause = null; load(); }, ACTIVE_CARDS_PAUSE_MS);
    });
    return () => { active = false; unsubscribe(); if (pause !== null) clearTimeout(pause); };
  }, [activeWorkouts]);
  return useMemo(() => cards.filter((card) => !(card.slot.clientId === slot.clientId
    && card.slot.programId === slot.programId && card.slot.weekIndex === slot.weekIndex
    && card.slot.plannedWorkoutId === slot.plannedWorkoutId)),
  [cards, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId]);
}
