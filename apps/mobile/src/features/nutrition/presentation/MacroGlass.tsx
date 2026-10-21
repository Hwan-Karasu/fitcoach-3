import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { shadow } from "../../../shared/ui/theme/style.ts";

const SPILL_MAX = 44;

/**
 * «Стакан» показателя: заливка снизу показывает, какую часть цели составляет съеденное (`ratio` = съедено / цель). Выше цели стакан полон, и жидкость переливается
 * через края двумя струйками по бокам. Анимация одноразовая — при смене значения; без цели (`null`) стакан пуст.
 */
export function MacroGlass({ color, ratio, children }: Readonly<{ color: string; ratio: number | null; children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const level = useRef(new Animated.Value(0)).current;
  const spill = useRef(new Animated.Value(0)).current;
  const filled = ratio === null ? 0 : Math.max(0, Math.min(ratio, 1));
  const over = ratio !== null && ratio > 1 ? Math.min((ratio - 1) * 4, 1) : 0;
  useEffect(() => {
    const animation = Animated.sequence([
      Animated.timing(level, { toValue: filled, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(spill, { toValue: over, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [filled, over, level, spill]);
  const height = level.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  const streamHeight = spill.interpolate({ inputRange: [0, 1], outputRange: [0, SPILL_MAX] });
  return (
    <View style={styles.wrap}>
      <View style={[styles.glass, { borderTopColor: color, backgroundColor: colors.surface }]}>
        <View style={styles.clip}><Animated.View style={[styles.fill, { height, backgroundColor: color }]} /></View>
        <View style={styles.content}>{children}</View>
      </View>
      <Animated.View style={[styles.stream, styles.streamLeft, { height: streamHeight, backgroundColor: color }]} />
      <Animated.View style={[styles.stream, styles.streamRight, { height: streamHeight, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0, height: 132 },
  glass: { ...shadow.card, flex: 1, borderTopWidth: 4, borderRadius: 16 },
  clip: { ...StyleSheet.absoluteFillObject, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, overflow: "hidden" },
  fill: { position: "absolute", left: 0, right: 0, bottom: 0, opacity: 0.28 },
  content: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, paddingVertical: 10, gap: 2 },
  stream: { position: "absolute", top: 0, width: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  streamLeft: { left: -4 },
  streamRight: { right: -4 },
});
