import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { isFutureDay } from "../domain/DayNavigation.ts";
import { useToday } from "./useToday.ts";

interface ClientDayState {
  /** Выбранная дата клиента: общая для «Главной» и «Питания». */
  readonly day: string;
  readonly today: string;
  /** Выбрать дату; сегодняшняя возвращает слежение за текущим днём (в полночь день сменится сам). */
  readonly setDay: (date: string) => void;
  /** Будущий день: доступно только питание (UI-OWN-070). */
  readonly future: boolean;
}

const ClientDayContext = createContext<ClientDayState | null>(null);

/**
 * Выбранный день карточки клиента (UIX-05, UI-OWN-070): один на «Главную» и «Питание», по умолчанию сегодня. Живёт, пока открыт клиент.
 * Пока тренер не выбрал другую дату, день следует за часами устройства (`useToday`).
 */
export function ClientDayProvider({ children }: Readonly<{ children: ReactNode }>) {
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  // Стабильная функция: смена «сегодня» в полночь не должна повторно запускать эффекты тех, кто её получил.
  const todayRef = useRef(today);
  todayRef.current = today;
  const setDay = useCallback((date: string) => setPicked(date === todayRef.current ? null : date), []);
  const value = useMemo(() => ({ day, today, setDay, future: isFutureDay(day, today) }), [day, today, setDay]);
  return <ClientDayContext.Provider value={value}>{children}</ClientDayContext.Provider>;
}

/** Выбранный день клиента; вне провайдера — сегодня без возможности выбрать (отдельный экран питания без карточки клиента). */
export function useClientDay(): ClientDayState {
  const shared = useContext(ClientDayContext);
  const today = useToday();
  const [local, setLocal] = useState<string | null>(null);
  return shared ?? { day: local ?? today, today, setDay: (date) => setLocal(date === today ? null : date), future: isFutureDay(local ?? today, today) };
}
