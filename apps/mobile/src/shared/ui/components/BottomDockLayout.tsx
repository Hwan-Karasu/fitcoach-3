import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type RefObject } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { REST_SPACER_BASE, restSpacerHeight } from "./restSpacerRules.ts";

const Height = createContext(0);
const Register = createContext<((height: number) => void) | null>(null);
const BarHeight = createContext(0);
const RegisterBar = createContext<((height: number) => void) | null>(null);
const RestInset = createContext(0);
const RegisterRestInset = createContext<((inset: number) => void) | null>(null);

/** Таймер располагается выше закреплённых действий активного редактора. */
export function BottomDockLayoutProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [height, setHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(0);
  const [restInset, setRestInset] = useState(0);
  return (
    <Register.Provider value={setHeight}><Height.Provider value={height}>
      <RegisterBar.Provider value={setBarHeight}><BarHeight.Provider value={barHeight}>
        <RegisterRestInset.Provider value={setRestInset}><RestInset.Provider value={restInset}>{children}</RestInset.Provider></RegisterRestInset.Provider>
      </BarHeight.Provider></RegisterBar.Provider>
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

/**
 * Сколько панель таймеров отдыха занимает от нижнего края окна: её отступ снизу плюс измеренная высота показанного вида
 * (развёрнутая панель, «Ещё N» или «таблетка»); 0 — таймеров нет. Считает и сообщает сама панель (REST-INSET-1).
 */
export function useRestDockInset() { return useContext(RestInset); }
export function useRestDockRegister() { return useContext(RegisterRestInset); }

type Measurable = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };

/**
 * Последний элемент содержимого прокрутки вместо постоянного отступа под панель таймеров. Нет таймеров — обычный небольшой отступ;
 * иначе ровно столько, сколько панель перекрывает нижний край области. Меняется только сам запас, остальное не перерисовывается.
 */
export function RestDockSpacer({ scrollRef }: Readonly<{ scrollRef: RefObject<Measurable | null> }>) {
  const inset = useRestDockInset();
  const { height: windowHeight } = useWindowDimensions();
  const [below, setBelow] = useState(0);
  const measure = useCallback(() => {
    scrollRef.current?.measureInWindow((_x, y, _width, height) => {
      const next = Math.max(0, Math.round(windowHeight - (y + height)));
      setBelow((old) => old === next ? old : next);
    });
  }, [scrollRef, windowHeight]);
  useEffect(() => { if (inset > 0) measure(); }, [inset, measure]);
  return <View onLayout={measure} pointerEvents="none" style={{ height: inset === 0 ? REST_SPACER_BASE : restSpacerHeight(inset, below) }} />;
}
