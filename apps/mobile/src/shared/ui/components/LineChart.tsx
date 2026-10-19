import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export interface LineChartPoint {
  readonly key: string;
  /** Подпись по оси X (дата). */
  readonly label: string;
  readonly value: number;
}

const HEIGHT = 160;
const AXIS = 52;
const PAD = 8;

/**
 * Простой линейный график по точкам (X02): шкала от минимума до максимума, подписи крайних дат. Точки — только
 * реальные наблюдения; пропуски не превращаются в ноль (§48.86.32).
 */
export function LineChart({ points, format, accessibilityLabel }: Readonly<{
  points: readonly LineChartPoint[];
  format: (value: number) => string;
  accessibilityLabel: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [width, setWidth] = useState(0);
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max), 1);
  const low = max === min ? min - span / 2 : min;
  const plotWidth = Math.max(width - AXIS - PAD, 1);
  const x = (index: number) => AXIS + (points.length === 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1));
  const y = (value: number) => PAD + (HEIGHT - PAD * 2) * (1 - (value - low) / span);
  const ticks = max === min ? [max] : [max, (max + min) / 2, min];
  return (
    <View accessible accessibilityLabel={accessibilityLabel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <View style={{ height: HEIGHT }}>
        <Svg width={width} height={HEIGHT}>
          {ticks.map((tick) => <Line key={tick} x1={AXIS} x2={width - PAD} y1={y(tick)} y2={y(tick)}
            stroke={colors.border} strokeWidth={1} />)}
          {points.length > 1 ? <Polyline points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")}
            fill="none" stroke={colors.accentInk} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {points.map((point, index) => <Circle key={point.key} cx={x(index)} cy={y(point.value)} r={index === points.length - 1 ? 5 : 3.5}
            fill={index === points.length - 1 ? colors.accentInk : colors.surface} stroke={colors.accentInk} strokeWidth={2} />)}
        </Svg>
        {ticks.map((tick) => <Text key={tick} numberOfLines={1} style={[styles.tick, { top: y(tick) - 8, color: colors.textMuted }]}>
          {format(tick)}</Text>)}
      </View> : <View style={{ height: HEIGHT }} />}
      <View style={[styles.dates, { paddingLeft: AXIS }]}>
        <Text style={[styles.date, { color: colors.textMuted }]}>{points[0]?.label ?? ""}</Text>
        {points.length > 1 ? <Text style={[styles.date, { color: colors.textMuted }]}>{points[points.length - 1]!.label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { position: "absolute", left: 0, width: AXIS - 6, textAlign: "right", fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 },
  dates: { flexDirection: "row", justifyContent: "space-between", paddingRight: PAD },
  date: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
});
