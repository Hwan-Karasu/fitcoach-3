import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { LayoutChangeEvent } from "react-native";

const Height = createContext(0);
const Register = createContext<((height: number) => void) | null>(null);
const BarHeight = createContext(0);
const RegisterBar = createContext<((height: number) => void) | null>(null);

/** Таймер располагается выше закреплённых действий активного редактора. */
export function BottomDockLayoutProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [height, setHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(0);
  return (
    <Register.Provider value={setHeight}><Height.Provider value={height}>
      <RegisterBar.Provider value={setBarHeight}><BarHeight.Provider value={barHeight}>{children}</BarHeight.Provider></RegisterBar.Provider>
    </Height.Provider></Register.Provider>
  );
}
export function useEditorDockHeight() { return useContext(Height); }
/** Фактическая высота нижней панели вкладок экрана в фокусе (вместе с нижним отступом); 0 — на экране её нет. Панель таймера встаёт над ней. */
export function useBottomBarHeight() { return useContext(BarHeight); }
/** Нижняя панель вкладок сообщает свою высоту, пока её экран в фокусе, и обнуляет её при уходе. */
export function useBottomBarLayout() {
  const register = useContext(RegisterBar);
  const [height, setHeight] = useState(0);
  useFocusEffect(useCallback(() => { register?.(height); return () => register?.(0); }, [register, height]));
  return useCallback((event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height), []);
}
export function useEditorDockLayout() {
  const register = useContext(Register);
  const [height, setHeight] = useState(0);
  useFocusEffect(useCallback(() => { register?.(height); return () => register?.(0); }, [register, height]));
  return useCallback((event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height), []);
}
