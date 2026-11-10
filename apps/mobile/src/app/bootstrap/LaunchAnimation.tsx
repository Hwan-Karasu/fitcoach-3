import { useCallback, useEffect, useState } from "react";
import { AppState, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedReaction, useAnimatedStyle,
  useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { LaunchArtwork, LaunchBackdrop } from "./LaunchArtwork.tsx";
import { canExitLaunch, LAUNCH_BACKGROUND, LAUNCH_DURATION_MS, LAUNCH_EXIT_MS, LAUNCH_ASSET_GRACE_MS, smoothProgress } from "./launchTimeline.ts";
import { startupDiagnostics } from "./StartupDiagnostics.ts";

/** One UI-thread sequence per cold start. Slow boot holds the assembled emblem without replaying it. */
export function LaunchAnimation({ start, ready, onComplete }: Readonly<{ start: boolean; ready: boolean; onComplete: () => void }>) {
  const { width, height } = useWindowDimensions();
  const size = Math.min(width * 0.76, height * 0.49, 360);
  const reducedMotion = useReducedMotion();
  const [assetReady, setAssetReady] = useState(false);
  const onAssetLoad = useCallback(() => setAssetReady(true), []);
  const clock = useSharedValue(0);
  const opacity = useSharedValue(1);
  const canEnter = useSharedValue(false);
  const initiallyForeground = AppState.currentState === "active" || AppState.currentState === null;
  const foreground = useSharedValue(initiallyForeground);
  const interrupted = useSharedValue(!initiallyForeground);
  const exiting = useSharedValue(false);
  const animationComplete = useSharedValue(reducedMotion);

  useEffect(() => { canEnter.value = ready; }, [ready, canEnter]);
  useEffect(() => {
    if (!start || assetReady) return;
    const timeout = setTimeout(onAssetLoad, LAUNCH_ASSET_GRACE_MS);
    return () => clearTimeout(timeout);
  }, [start, assetReady, onAssetLoad]);
  useEffect(() => {
    if (!start || !assetReady) return;
    startupDiagnostics.mark("animation.start");
    if (reducedMotion || interrupted.value) {
      clock.value = LAUNCH_DURATION_MS; animationComplete.value = true;
    } else {
      clock.value = withTiming(LAUNCH_DURATION_MS,
        { duration: LAUNCH_DURATION_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never },
        (finished) => { if (finished) animationComplete.value = true; });
    }
    return () => { cancelAnimation(clock); cancelAnimation(opacity); };
  }, [start, assetReady, reducedMotion, clock, opacity, interrupted, animationComplete]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      foreground.value = state === "active";
      interrupted.value = true;
      // Returning from an interrupted launch shows the settled artwork, never a second intro.
      cancelAnimation(clock);
      cancelAnimation(opacity);
      opacity.value = 1;
      exiting.value = false;
      clock.value = LAUNCH_DURATION_MS;
      animationComplete.value = true;
    });
    return () => { subscription.remove(); cancelAnimation(clock); cancelAnimation(opacity); };
  }, [clock, opacity, foreground, interrupted, exiting, animationComplete]);

  useAnimatedReaction(() => canExitLaunch(canEnter.value, foreground.value, animationComplete.value), (allowed) => {
    if (!allowed) {
      if (exiting.value) { cancelAnimation(opacity); opacity.value = 1; exiting.value = false; }
      return;
    }
    if (exiting.value) return;
    exiting.value = true;
    opacity.value = withTiming(0, { duration: reducedMotion ? 0 : LAUNCH_EXIT_MS, reduceMotion: ReduceMotion.Never },
      (finished) => { if (finished) scheduleOnRN(onComplete); });
  }, [onComplete, reducedMotion]);
  const overlay = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const title = useAnimatedStyle(() => ({ opacity: 0.9 + smoothProgress(clock.value, 0, 450) * 0.1 }));

  return <Animated.View style={[styles.overlay, overlay]} accessibilityLabel="Дневник атлета. Запуск приложения."
    accessibilityViewIsModal importantForAccessibility="yes">
    <StatusBar barStyle="light-content" backgroundColor={LAUNCH_BACKGROUND} />
    <LaunchBackdrop />
    <View style={[styles.brand, { paddingBottom: height * 0.07, gap: height * 0.06 }]} accessible={false}>
      <LaunchArtwork size={size} clock={clock} onLoad={onAssetLoad} />
      <Animated.View style={title}>
        <Text style={[styles.title, { fontSize: Math.min(32, Math.max(18, width * 0.087)) }]}
          maxFontSizeMultiplier={1.3}>Дневник атлета</Text>
      </Animated.View>
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, backgroundColor: LAUNCH_BACKGROUND,
    alignItems: "center", justifyContent: "center" },
  brand: { alignItems: "center", maxWidth: "94%" },
  // System font makes the first React frame independent of bundled font loading.
  title: { color: "#F4F7F8", fontWeight: "600", textAlign: "center" },
});
