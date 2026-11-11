import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { daysBetweenIso, isFutureDay } from "../domain/DayNavigation.ts";
import { useToday } from "./useToday.ts";

/** Длительность въезда ленты дней после смены дня, мс. */
const STRIP_SLIDE_MS = 200;

interface ClientDayState {
  /** Выбранная дата клиента: общая для «Главной» и «Питания». */
  readonly day: string;
  readonly today: string;
  /** Выбрать дату; сегодняшняя возвращает слежение за текущим днём (в полночь день сменится сам). */
  readonly setDay: (date: string) => void;
  /** Будущий день: доступно только питание (UI-OWN-070). */
  readonly future: boolean;
  /**
   * Смещение ленты дней в долях колонки (UIX-FIT-11): палец ведёт ленту, смена дня на ±1 сутки сдвигает её на столько же и возвращает в 0 анимацией,
   * поэтому прежний день «уезжает», а новый встаёт на место — карусель. Значение живёт на UI-потоке, экран при этом не перерисовывается.
   */
  readonly stripShift: SharedValue<number>;
}

const ClientDayContext = createContext<ClientDayState | null>(null);

/** Смена дня на соседние сутки продолжает ленту с того места, где её оставил палец; дальний выбор (календарь) — без слайда. */
function useDayStrip(): Readonly<{ stripShift: SharedValue<number>; slide: (from: string, to: string) => void }> {
  const stripShift = useSharedValue(0);
  const slide = useCallback((from: string, to: string) => {
    const delta = daysBetweenIso(from, to);
    if (Math.abs(delta) !== 1) { stripShift.value = 0; return; }
    stripShift.value = stripShift.value + delta;
    stripShift.value = withTiming(0, { duration: STRIP_SLIDE_MS });
  }, [stripShift]);
  return { stripShift, slide };
}

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
  // Выбранный день обновляется сразу, до перерисовки: быстрый второй свайп считает слайд от актуальной даты.
  const dayRef = useRef(day);
  dayRef.current = day;
  const { stripShift, slide } = useDayStrip();
  const setDay = useCallback((date: string) => {
    slide(dayRef.current, date);
    dayRef.current = date;
    setPicked(date === todayRef.current ? null : date);
  }, [slide]);
  const value = useMemo(() => ({ day, today, setDay, future: isFutureDay(day, today), stripShift }), [day, today, setDay, stripShift]);
  return <ClientDayContext.Provider value={value}>{children}</ClientDayContext.Provider>;
}

/** Выбранный день клиента; вне провайдера — сегодня без возможности выбрать (отдельный экран питания без карточки клиента). */
export function useClientDay(): ClientDayState {
  const shared = useContext(ClientDayContext);
  const today = useToday();
  const [local, setLocal] = useState<string | null>(null);
  const { stripShift, slide } = useDayStrip();
  const day = local ?? today;
  return shared ?? { day, today, stripShift,
    setDay: (date) => { slide(day, date); setLocal(date === today ? null : date); }, future: isFutureDay(day, today) };
}
