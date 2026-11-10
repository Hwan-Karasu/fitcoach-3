import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { createLocalDayStore } from "./localDayStore.ts";

const days = createLocalDayStore((refresh) => {
  const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
  return () => subscription.remove();
});

/**
 * Сегодняшняя дата по часам устройства, обновляется сама: таймером в полночь и при возвращении приложения из фона (таймеры в фоне не идут).
 * Экран, открытый через полночь, не продолжает писать вес, шаги и итоги «сегодня» на вчерашнюю дату. Таймер и слушатель снимаются в cleanup.
 */
export function useToday(): string {
  return useSyncExternalStore(days.subscribe, days.getSnapshot, days.getSnapshot);
}
