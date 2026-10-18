import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useFocusEffect } from "@react-navigation/native";

export interface WeekNavigationState {
  readonly week: number;
  readonly previous: (() => void) | null;
  readonly next: (() => void) | null;
  readonly busy?: boolean;
}
const WeekNavigationContext = createContext<WeekNavigationState | null>(null);
const RegisterWeekNavigation = createContext<((state: WeekNavigationState | null) => void) | null>(null);

export function WeekNavigationProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<WeekNavigationState | null>(null);
  return <RegisterWeekNavigation.Provider value={setState}>
    <WeekNavigationContext.Provider value={state}>{children}</WeekNavigationContext.Provider>
  </RegisterWeekNavigation.Provider>;
}

export function useWeekNavigationState() { return useContext(WeekNavigationContext); }

/** Регистрирует стрелки только для активного экрана. Вкладки сохраняют стек, но не чужие действия. */
export function useWeekNavigation(state: WeekNavigationState | null) {
  const setState = useContext(RegisterWeekNavigation);
  // Действия экрана — новые функции на каждом рендере; в панель уходят постоянные обёртки,
  // а перерегистрация — только при смене недели, доступности стрелок или занятости.
  const actions = useRef(state);
  actions.current = state;
  const week = state?.week;
  const hasPrevious = state?.previous != null;
  const hasNext = state?.next != null;
  const busy = state?.busy;
  useFocusEffect(useCallback(() => {
    setState?.(week === undefined ? null : { week, busy,
      previous: hasPrevious ? () => actions.current?.previous?.() : null,
      next: hasNext ? () => actions.current?.next?.() : null });
    return () => setState?.(null);
  }, [setState, week, hasPrevious, hasNext, busy]));
}
