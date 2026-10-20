import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import type { TrainingHistoryPort } from "./trainingHistory.ts";

/**
 * Была ли у клиента тренировка в указанную дату по дневнику тренировок (есть рабочие подходы): `true`, `false` или `null`, пока данные не загружены или недоступны.
 * Только чтение чужого владельца; пересчитывается при каждом возвращении на экран (кэш истории сбрасывается самим read-model при фиксации тренировок).
 */
export function useTrainedOn(clientId: string, localDate: string, history: Pick<TrainingHistoryPort, "list">): boolean | null {
  const [state, setState] = useState<Readonly<{ key: string; trained: boolean }> | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    void history.list(clientId).then((entries) => {
      if (active) setState({ key: `${clientId}|${localDate}`, trained: entries.some((entry) => entry.actualDate === localDate && entry.workingSets > 0) });
    }, () => undefined);
    return () => { active = false; };
  }, [clientId, localDate, history]));
  return state !== null && state.key === `${clientId}|${localDate}` ? state.trained : null;
}
