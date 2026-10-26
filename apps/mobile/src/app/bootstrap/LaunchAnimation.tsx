import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StatusBar, StyleSheet, Text, View } from "react-native";
import { fonts } from "../../shared/ui/theme/typography.ts";
import launchIcon from "../../../assets/brand/icon.png";

/** One short brand reveal per cold start; the application boots underneath it. */
export function LaunchAnimation({ ready, onComplete }: Readonly<{ ready: boolean; onComplete: () => void }>) {
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => setMinimumElapsed(true), 750);
    const animate = (reduced: boolean) => {
      if (!active) return;
      if (reduced) progress.setValue(1);
      else Animated.timing(progress, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(animate, () => animate(false));
    return () => { active = false; clearTimeout(timer); progress.stopAnimation(); };
  }, [progress]);
  useEffect(() => {
    if (!ready || !minimumElapsed) return;
    const animation = Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) onComplete(); });
    return () => animation.stop();
  }, [ready, minimumElapsed, opacity, onComplete]);
  return <Animated.View style={[styles.overlay, { opacity }]} accessibilityLabel="Дневник атлета. Запуск приложения." accessibilityViewIsModal>
    <StatusBar barStyle="light-content" backgroundColor="#0C171C" />
    <Animated.View style={[styles.brand, { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }, { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      <View style={styles.halo}><Image source={launchIcon} style={styles.icon} /></View>
      <Text style={styles.title}>Дневник атлета</Text>
      <View style={styles.accent} />
    </Animated.View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, backgroundColor: "#0C171C", alignItems: "center", justifyContent: "center" },
  brand: { alignItems: "center", gap: 28, paddingBottom: 32 },
  halo: { padding: 12, backgroundColor: "#132C33", borderWidth: 1, borderColor: "#24454C", borderRadius: 46 },
  icon: { width: 154, height: 154, borderRadius: 34 },
  title: { color: "#F3F8F8", fontFamily: fonts.bold, fontSize: 26, letterSpacing: 0.2 },
  accent: { width: 46, height: 3, borderRadius: 2, backgroundColor: "#88C7C2", marginTop: -9 },
});
