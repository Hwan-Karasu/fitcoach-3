/** Device boundaries only. App, boot gate, BootCoordinator and notification lifecycle run unchanged in tests. */
import { createElement, useEffect, useMemo, type ReactNode } from "react";
import type { ApplicationRuntime } from "../../src/app/composition/createServices.ts";
type Props = Record<string, unknown> & { children?: ReactNode };
const host = (name: string) => (props: Props) => createElement(name, props, props.children);
export const View = host("View");
export const Text = host("Text");
export const Pressable = host("Pressable");
export const StatusBar = host("StatusBar");
export const SafeAreaProvider = host("SafeAreaProvider");
export const SafeAreaView = host("SafeAreaView");
export const GestureHandlerRootView = host("GestureHandlerRootView");
export const LaunchAnimation = host("LaunchAnimation");
export const PrototypeShell = host("PrototypeShell");
export const AutomaticBackupHost = host("AutomaticBackupHost");
export const LaunchArtwork = host("LaunchArtwork");
export const LaunchBackdrop = host("LaunchBackdrop");
export const useWindowDimensions = () => ({ width: 360, height: 800, fontScale: 1, scale: 1 });
export const StyleSheet = { create: <T,>(value: T): T => value };
export const fontAssets = {};
export const splashBoundary = { fonts: [false, null] as readonly [boolean, Error | null], hidden: 0, prevented: 0,
  options: {} as unknown, runtime: null as ApplicationRuntime | null, listeners: new Set<(state: string) => void>() };
export const createDevRuntime = () => splashBoundary.runtime!;
export const createProductionRuntime = createDevRuntime;
export const useFonts = () => splashBoundary.fonts;
export async function preventAutoHideAsync() { splashBoundary.prevented++; }
export async function hideAsync() { splashBoundary.hidden++; }
export function setOptions(value: unknown) { splashBoundary.options = value; }
export const AppState = { currentState: "active", addEventListener: (_event: string, listener: (state: string) => void) => {
  splashBoundary.listeners.add(listener); return { remove: () => { splashBoundary.listeners.delete(listener); } };
} };

interface Timing { target: number; duration: number; callback?: (finished: boolean) => void }
const animations = new Map<object, Timing>();
const reactions = new Set<() => void>();
export const animationBoundary = { reducedMotion: false, calls: [] as Timing[],
  flush: () => { for (const run of reactions) run(); },
  finish: () => { const pending = [...animations.values()]; animations.clear(); for (const item of pending) item.callback?.(true); },
  emit: (state: string) => { AppState.currentState = state; for (const listener of splashBoundary.listeners) listener(state); },
  pending: () => animations.size, reactions: () => reactions.size,
};
export function useSharedValue<T>(initial: T): { value: T } {
  return useMemo(() => {
    let value = initial;
    const shared = { get value() { return value; }, set value(next: T) {
      if (typeof next === "object" && next !== null && "target" in next) {
        const timing = next as unknown as Timing;
        animations.set(shared, timing); value = timing.target as T;
      } else value = next;
    } };
    return shared;
  }, []);
}
export function withTiming(target: number, options: { duration: number }, callback?: (finished: boolean) => void): number {
  const timing = { target, duration: options.duration, callback };
  animationBoundary.calls.push(timing);
  return timing as unknown as number;
}
export function cancelAnimation(shared: object): void {
  const pending = animations.get(shared); animations.delete(shared); pending?.callback?.(false);
}
export function useAnimatedReaction<T>(prepare: () => T, react: (value: T, previous: T | null) => void, dependencies: readonly unknown[]) {
  useEffect(() => {
    let previous: T | null = null;
    const run = () => { const next = prepare(); if (next !== previous) { react(next, previous); previous = next; } };
    reactions.add(run); run(); return () => { reactions.delete(run); };
  }, dependencies);
}
export const useAnimatedStyle = <T,>(calculate: () => T) => calculate();
export const useReducedMotion = () => animationBoundary.reducedMotion;
export const Easing = { linear: (value: number) => value };
export const ReduceMotion = { Never: "never" };
export const scheduleOnRN = (callback: () => void) => callback();
export default { View };
