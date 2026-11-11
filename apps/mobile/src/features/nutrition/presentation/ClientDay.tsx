import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/** Лента: `slide(±1)` продолжает её с того места, где оставил палец, и возвращает в 0 анимацией; `reset` — без слайда (дальний выбор в календаре). */
function useDayStrip(): Readonly<{ stripShift: SharedValue<number>; slide: (delta: number) => void; reset: () => void }> {
  const stripShift = useSharedValue(0);
  const slide = useCallback((delta: number) => {
    stripShift.value = stripShift.value + delta;
    stripShift.value = withTiming(0, { duration: STRIP_SLIDE_MS });
  }, [stripShift]);
  const reset = useCallback(() => { stripShift.value = 0; }, [stripShift]);
  return { stripShift, slide, reset };
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
  const { stripShift, slide, reset } = useDayStrip();
  // Слайд применяется после коммита нового дня (до отрисовки): новые подписи ленты уже на месте, и лента не «прыгает» на 1–3 кадра в старой раскладке.
  const pendingSlide = useRef(0);
  const setDay = useCallback((date: string) => {
    const delta = daysBetweenIso(dayRef.current, date);
    if (Math.abs(delta) === 1) pendingSlide.current = delta; else { pendingSlide.current = 0; reset(); }
    dayRef.current = date;
    setPicked(date === todayRef.current ? null : date);
  }, [reset]);
  useLayoutEffect(() => {
    const delta = pendingSlide.current;
    pendingSlide.current = 0;
    if (delta !== 0) slide(delta);
  }, [day, slide]);
  const value = useMemo(() => ({ day, today, setDay, future: isFutureDay(day, today), stripShift }), [day, today, setDay, stripShift]);
  return <ClientDayContext.Provider value={value}>{children}</ClientDayContext.Provider>;
}

/** Выбранный день клиента; вне провайдера — сегодня без возможности выбрать (отдельный экран питания без карточки клиента). */
export function useClientDay(): ClientDayState {
  const shared = useContext(ClientDayContext);
  const today = useToday();
  const [local, setLocal] = useState<string | null>(null);
  const { stripShift, slide, reset } = useDayStrip();
  const day = local ?? today;
  return shared ?? { day, today, stripShift,
    setDay: (date) => { const delta = daysBetweenIso(day, date); if (Math.abs(delta) === 1) slide(delta); else reset(); setLocal(date === today ? null : date); },
    future: isFutureDay(day, today) };
}
