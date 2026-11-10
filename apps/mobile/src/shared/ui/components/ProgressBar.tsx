import { ActivityIndicator, StyleSheet, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/** Полоса выполнения. `value` 0…1 — только честно посчитанная доля; null — неизвестна: вращающийся индикатор без выдуманного процента. */
export function ProgressBar({ value, accessibilityLabel, color }: Readonly<{ value: number | null; accessibilityLabel: string; color?: string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  // Нечисловое значение (NaN/Infinity) — доля неизвестна, как null: «NaN%» в стиле недопустим.
  if (value === null || !Number.isFinite(value)) {
    return <ActivityIndicator size="small" color={colors.accentFill} accessibilityLabel={accessibilityLabel} style={styles.spinner} />;
  }
  const share = Math.min(1, Math.max(0, value));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
      style={[styles.track, { backgroundColor: colors.input, borderColor: colors.border }]}>
      <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: color ?? colors.accentFill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  fill: { height: "100%" },
  spinner: { alignSelf: "flex-start" },
});
