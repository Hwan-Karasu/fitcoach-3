/** Только внешняя native-граница для интеграционных тестов панели; код приложения и React настоящие. */
import { createContext, createElement, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, type ReactNode } from "react";

type Props = Record<string, unknown> & { children?: ReactNode };
const component = (name: string) => forwardRef<unknown, Props>(function Native(props, ref) {
  useImperativeHandle(ref, () => ({ scrollTo: (value: unknown) => { nativePanelBoundary.scrolls.push(value); } }), []);
  return createElement(name, props, props.children as ReactNode);
});
export const View = component("View");
export const Text = component("Text");
export const TextInput = component("TextInput");
export const Pressable = component("Pressable");
export const ScrollView = component("ScrollView");
export const StyleSheet = { create: <T,>(styles: T): T => styles };
export const useWindowDimensions = () => ({ width: 360, height: 800, fontScale: 1, scale: 1 });
const focus = createContext(true);
export const FocusProvider = focus.Provider;
export const useIsFocused = () => useContext(focus);
const appListeners = new Set<(state: string) => void>();
export const AppState = {
  currentState: "active",
  addEventListener: (_name: string, listener: (state: string) => void) => {
    appListeners.add(listener);
    return { remove: () => { appListeners.delete(listener); } };
  },
};
export const nativePanelBoundary = { scrolls: [] as unknown[], signals: 0,
  appState: (state: string) => { AppState.currentState = state; appListeners.forEach((listener) => listener(state)); },
  listenerCount: () => appListeners.size };
export const NotificationFeedbackType = { Warning: "warning" };
export async function notificationAsync() { nativePanelBoundary.signals += 1; }
export const useSharedValue = <T,>(initial: T) => useMemo(() => ({ value: initial }), []);
export const useAnimatedStyle = <T,>(style: () => T): T => style();
export const useAnimatedProps = useAnimatedStyle;
export function useAnimatedReaction<T>(prepare: () => T, react: (value: T, before: T | null) => void, dependencies: readonly unknown[]) {
  useEffect(() => { react(prepare(), null); }, dependencies);
}
export const useFrameCallback = () => useMemo(() => ({ setActive: (active: boolean) => { void active; } }), []);
export const withTiming = <T,>(value: T): T => value;
export const scheduleOnRN = (callback: (...args: never[]) => unknown, ...args: never[]) => callback(...args);
export const Gesture = { Pan: () => {
  const gesture = { activeOffsetY: (value: unknown) => { void value; return gesture; }, failOffsetX: (value: unknown) => { void value; return gesture; },
    onEnd: (callback: (event: { translationY: number; velocityY: number }) => void) => {
      return { ...gesture, end: callback };
    } };
  return gesture;
} };
export const GestureDetector = component("GestureDetector");
export const ChevronDown = component("ChevronDown");
export const Pause = component("Pause");
export const Play = component("Play");
export const SkipForward = component("SkipForward");
export const Timer = component("Timer");
export default { View, createAnimatedComponent: <T,>(value: T) => value };
