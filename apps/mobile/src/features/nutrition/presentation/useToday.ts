import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { todayLocal } from "./nutritionFormat.ts";
import { msUntilNextLocalDay } from "./todayClock.ts";

/**
 * Сегодняшняя дата по часам устройства, обновляется сама: таймером в полночь и при возвращении приложения из фона (таймеры в фоне не идут).
 * Экран, открытый через полночь, не продолжает писать вес, шаги и итоги «сегодня» на вчерашнюю дату. Таймер и слушатель снимаются в cleanup.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayLocal());
  useEffect(() => {
    const timer = setTimeout(() => setToday(todayLocal()), msUntilNextLocalDay(new Date()));
    return () => clearTimeout(timer);
  }, [today]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") setToday(todayLocal()); });
    return () => subscription.remove();
  }, []);
  return today;
}
