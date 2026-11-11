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
export const withSpring = <T,>(value: T): T => value;
export const cancelAnimation = (value: unknown) => { void value; };
export const scheduleOnRN = (callback: (...args: never[]) => unknown, ...args: never[]) => callback(...args);
type GestureEvent = { translationY: number; velocityY: number };
type PanHandlers = { onBegin?: () => void; onUpdate?: (event: GestureEvent) => void; onEnd?: (event: GestureEvent, success: boolean) => void; onFinalize?: (event: GestureEvent, success: boolean) => void };
/** Жест как набор записанных обработчиков: тест вызывает begin/update/end/finalize так, как их вызывает RNGH. */
export const Gesture = { Pan: () => {
  const handlers: PanHandlers = {};
  const gesture = {
    activeOffsetY: (value: unknown) => { void value; return gesture; }, failOffsetX: (value: unknown) => { void value; return gesture; },
    onBegin: (callback: NonNullable<PanHandlers["onBegin"]>) => { handlers.onBegin = callback; return gesture; },
    onUpdate: (callback: NonNullable<PanHandlers["onUpdate"]>) => { handlers.onUpdate = callback; return gesture; },
    onEnd: (callback: NonNullable<PanHandlers["onEnd"]>) => { handlers.onEnd = callback; return gesture; },
    onFinalize: (callback: NonNullable<PanHandlers["onFinalize"]>) => { handlers.onFinalize = callback; return gesture; },
    begin: () => handlers.onBegin?.(), update: (event: GestureEvent) => handlers.onUpdate?.(event),
    end: (event: GestureEvent, success = true) => handlers.onEnd?.(event, success), finalize: (event: GestureEvent, success: boolean) => handlers.onFinalize?.(event, success),
  };
  return gesture;
} };
export const GestureDetector = component("GestureDetector");
export const ChevronDown = component("ChevronDown");
export const ChevronRight = component("ChevronRight");
export const Pause = component("Pause");
export const Play = component("Play");
export const SkipForward = component("SkipForward");
export const Timer = component("Timer");
export default { View, createAnimatedComponent: <T,>(value: T) => value };
