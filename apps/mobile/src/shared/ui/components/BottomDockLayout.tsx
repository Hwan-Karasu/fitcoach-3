import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { LayoutChangeEvent } from "react-native";

const Height = createContext(0);
const Register = createContext<((height: number) => void) | null>(null);

/** Таймер располагается выше закреплённых действий активного редактора. */
export function BottomDockLayoutProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [height, setHeight] = useState(0);
  return <Register.Provider value={setHeight}><Height.Provider value={height}>{children}</Height.Provider></Register.Provider>;
}
export function useEditorDockHeight() { return useContext(Height); }
export function useEditorDockLayout() {
  const register = useContext(Register);
  const [height, setHeight] = useState(0);
  useFocusEffect(useCallback(() => { register?.(height); return () => register?.(0); }, [register, height]));
  return useCallback((event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height), []);
}
