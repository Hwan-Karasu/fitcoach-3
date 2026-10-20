import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/**
 * Кольцевая диаграмма прогресса (UX 2.0, «% от цели»). `fraction` — 0…1 (больше 1 показывается заполненным кольцом цвета предупреждения), `null` — нет данных (пустое кольцо).
 * Содержимое в центре передаётся детьми; значение дублируется текстом для чтения с экрана (`accessibilityLabel`).
 */
export function ProgressRing({ fraction, size = 112, stroke = 12, accessibilityLabel, children }: Readonly<{ fraction: number | null; size?: number; stroke?: number; accessibilityLabel: string; children?: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));
  const over = fraction !== null && fraction > 1;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={stroke} fill="none" />
        {clamped > 0 ? <Circle cx={size / 2} cy={size / 2} r={radius} stroke={over ? colors.warning : colors.accentFill} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${circumference * clamped} ${circumference}`} rotation={-90} originX={size / 2} originY={size / 2} /> : null}
      </Svg>
      <View style={styles.center} pointerEvents="none">{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: { position: "absolute" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});
