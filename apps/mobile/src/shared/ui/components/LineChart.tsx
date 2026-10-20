import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LineChart as GiftedLineChart } from "react-native-gifted-charts";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { niceStep } from "./chartScale.ts";

export interface LineChartPoint {
  readonly key: string;
  /** Подпись по оси X (дата). */
  readonly label: string;
  readonly value: number;
}

const HEIGHT = 160;
const AXIS = 52;
const PAD = 12;

/**
 * Линейный график по точкам (react-native-gifted-charts): шкала от минимума до округлённого максимума, подписи
 * крайних дат. Точки — только реальные наблюдения; пропуски не превращаются в ноль (§48.86.32).
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
  const low = Math.min(...values);
  // Данные передаются от минимума, подписи шкалы возвращают смещение: график не прижат к нулю.
  const step = niceStep((Math.max(...values) - low) / 3);
  const spacing = points.length > 1 ? Math.max((width - AXIS - PAD * 2) / (points.length - 1), 0) : 0;
  const last = points.length - 1;
  return (
    <View accessible accessibilityLabel={accessibilityLabel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <GiftedLineChart
        data={points.map((point, index) => ({ value: point.value - low, dataPointColor: index === last ? colors.accentInk : colors.surface }))}
        height={HEIGHT - PAD} noOfSections={3} maxValue={step * 3} stepValue={step}
        spacing={spacing} initialSpacing={PAD} endSpacing={PAD}
        color={colors.accentInk} thickness={2.5} dataPointsColor={colors.surface} dataPointsRadius={4}
        yAxisLabelWidth={AXIS} yAxisThickness={0} xAxisThickness={1} xAxisColor={colors.border} rulesColor={colors.border}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.medium }}
        formatYLabel={(label) => format(Number(label) + low)} disableScroll isAnimated={false} /> : <View style={{ height: HEIGHT }} />}
      <View style={[styles.dates, { paddingLeft: AXIS }]}>
        <Text style={[styles.date, { color: colors.textMuted }]}>{points[0]?.label ?? ""}</Text>
        {points.length > 1 ? <Text style={[styles.date, { color: colors.textMuted }]}>{points[last]!.label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dates: { flexDirection: "row", justifyContent: "space-between", paddingRight: PAD },
  date: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
});
