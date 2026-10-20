import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export interface BarChartItem {
  readonly key: string;
  readonly label: string;
  /** `null` — нет данных за период: столбца нет (это не ноль, §48.86.32). */
  readonly value: number | null;
}

const HEIGHT = 140;
const AXIS = 44;
const PAD = 8;
const GAP = 3;

/** Столбчатая диаграмма от нуля до максимума; подписаны максимум и крайние периоды. */
export function BarChart({ items, format, accessibilityLabel }: Readonly<{
  items: readonly BarChartItem[];
  format: (value: number) => string;
  accessibilityLabel: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [width, setWidth] = useState(0);
  const max = Math.max(1e-9, ...items.map((item) => item.value ?? 0));
  const slot = Math.max((width - AXIS - PAD) / Math.max(items.length, 1), 1);
  const barWidth = Math.max(Math.min(slot - GAP, 28), 2);
  const plotHeight = HEIGHT - PAD * 2;
  return (
    <View accessible accessibilityLabel={accessibilityLabel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={{ height: HEIGHT }}>
        {width > 0 ? <Svg width={width} height={HEIGHT}>
          <Line x1={AXIS} x2={width - PAD} y1={PAD} y2={PAD} stroke={colors.border} strokeWidth={1} />
          <Line x1={AXIS} x2={width - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke={colors.border} strokeWidth={1} />
          {items.map((item, index) => {
            if (item.value === null || item.value <= 0) return null;
            const height = Math.max(plotHeight * item.value / max, 2);
            return <Rect key={item.key} x={AXIS + index * slot + (slot - barWidth) / 2} y={HEIGHT - PAD - height} width={barWidth} height={height}
              rx={Math.min(4, barWidth / 2)} fill={colors.accentInk} />;
          })}
        </Svg> : null}
        <Text numberOfLines={1} style={[styles.tick, { top: PAD - 8, color: colors.textMuted }]}>{format(max)}</Text>
        <Text numberOfLines={1} style={[styles.tick, { top: HEIGHT - PAD - 8, color: colors.textMuted }]}>0</Text>
      </View>
      <View style={[styles.dates, { paddingLeft: AXIS }]}>
        <Text style={[styles.date, { color: colors.textMuted }]}>{items[0]?.label ?? ""}</Text>
        {items.length > 1 ? <Text style={[styles.date, { color: colors.textMuted }]}>{items[items.length - 1]!.label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { position: "absolute", left: 0, width: AXIS - 6, textAlign: "right", fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 },
  dates: { flexDirection: "row", justifyContent: "space-between", paddingRight: PAD },
  date: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
});
