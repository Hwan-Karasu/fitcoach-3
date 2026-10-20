import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

export interface RingSegment {
  /** Вес сегмента; доли считаются от суммы весов. */
  readonly weight: number;
  readonly color: string;
}

/**
 * Кольцевая диаграмма прогресса из цветных сегментов (UX 2.0, «% от цели»): `fraction` — доля заполнения 0…1 (больше 1 — полное кольцо цвета предупреждения),
 * `null` — нет данных (пустое кольцо). Заполненная дуга делится на сегменты по весам (например, калории от белков, жиров и углеводов); без сегментов — один цвет акцента.
 * Содержимое в центре — детьми; значение дублируется текстом для чтения с экрана (`accessibilityLabel`).
 */
export function SegmentedRing({ fraction, segments = [], size = 112, stroke = 12, accessibilityLabel, children }: Readonly<{ fraction: number | null; segments?: readonly RingSegment[]; size?: number;
  stroke?: number; accessibilityLabel: string; children?: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));
  const over = fraction !== null && fraction > 1;
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.weight), 0);
  const parts = total > 0 && !over ? segments.filter((segment) => segment.weight > 0) : [{ weight: 1, color: over ? colors.warning : colors.accentFill }];
  const sum = total > 0 && !over ? total : 1;
  let start = 0;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={stroke} fill="none" />
        {clamped > 0 ? parts.map((part, index) => {
          const share = (part.weight / sum) * clamped;
          const node = (
            <Circle key={index} cx={size / 2} cy={size / 2} r={radius} stroke={part.color} strokeWidth={stroke} fill="none" strokeLinecap="butt"
              strokeDasharray={`${circumference * share} ${circumference}`} rotation={-90 + start * 360} originX={size / 2} originY={size / 2} />
          );
          start += share;
          return node;
        }) : null}
      </Svg>
      <View style={styles.center} pointerEvents="none">{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: { position: "absolute" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
