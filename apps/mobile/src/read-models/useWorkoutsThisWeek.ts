import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { workoutsInWeek } from "./trainingWeek.ts";
import type { TrainingHistoryPort } from "./trainingHistory.ts";

/** `null`, пока история не загружена или недоступна; пересчитывается при возвращении на экран, как `useTrainedOn`. */
export function useWorkoutsThisWeek(clientId: string, today: string, history: Pick<TrainingHistoryPort, "list">): number | null {
  const [state, setState] = useState<Readonly<{ key: string; count: number | null }> | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    void history.list(clientId).then((entries) => {
      if (active) setState({ key: `${clientId}|${today}`, count: workoutsInWeek(entries, today) });
    }, () => undefined);
    return () => { active = false; };
  }, [clientId, today, history]));
  return state !== null && state.key === `${clientId}|${today}` ? state.count : null;
}
