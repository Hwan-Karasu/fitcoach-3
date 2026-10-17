import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/** Скелет загрузки: заглушки той же формы, что карточки списка (UI-OWN-014). */
export function SkeletonList({ count = 3, label = "Загрузка" }: Readonly<{ count?: number; label?: string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const block = { backgroundColor: colors.surfaceRaised };
  return (
    <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <Animated.View key={index} style={[styles.card, { opacity: pulse, borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={[styles.avatar, block]} />
          <View style={styles.lines}>
            <View style={[styles.lineWide, block]} />
            <View style={[styles.lineShort, block]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 8 },
  lines: { flex: 1, gap: 8 },
  lineWide: { width: "60%", height: 14, borderRadius: 7 },
  lineShort: { width: "35%", height: 12, borderRadius: 6 },
});
