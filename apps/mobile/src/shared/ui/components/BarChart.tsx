import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarChart as GiftedBarChart } from "react-native-gifted-charts";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { chartLayout, niceStep } from "./chartScale.ts";

export interface BarChartItem {
  readonly key: string;
  readonly label: string;
  /** `null` — нет данных за период: столбца нет (это не ноль, §48.86.32). */
  readonly value: number | null;
}

const HEIGHT = 140;
const AXIS = 44;
const PAD = 8;

/**
 * Столбчатая диаграмма (react-native-gifted-charts) от нуля до округлённого максимума; подписаны крайние периоды.
 * `onPressItem` — переход к исходным данным столбца (§48.86.19).
 */
export function BarChart({ items, format, accessibilityLabel, onPressItem }: Readonly<{
  items: readonly BarChartItem[];
  format: (value: number) => string;
  accessibilityLabel: string;
  onPressItem?: (item: BarChartItem) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [width, setWidth] = useState(0);
  const step = niceStep(Math.max(0, ...items.map((item) => item.value ?? 0)) / 3);
  const layout = chartLayout(width - AXIS - PAD, items.length, 28);
  return (
    <View accessible accessibilityLabel={accessibilityLabel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <GiftedBarChart
        data={items.map((item) => ({ value: item.value ?? 0, frontColor: colors.accentInk, onPress: onPressItem === undefined || item.value === null
          ? undefined : () => onPressItem(item) }))}
        height={HEIGHT - PAD} noOfSections={3} maxValue={step * 3} stepValue={step}
        barWidth={layout.barWidth} spacing={layout.spacing} initialSpacing={layout.spacing / 2} endSpacing={0} barBorderRadius={4}
        yAxisLabelWidth={AXIS} yAxisThickness={0} xAxisThickness={1} xAxisColor={colors.border} rulesColor={colors.border}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.medium }} formatYLabel={(label) => format(Number(label))}
        disableScroll isAnimated={false} /> : <View style={{ height: HEIGHT }} />}
      <View style={[styles.dates, { paddingLeft: AXIS }]}>
        <Text style={[styles.date, { color: colors.textMuted }]}>{items[0]?.label ?? ""}</Text>
        {items.length > 1 ? <Text style={[styles.date, { color: colors.textMuted }]}>{items[items.length - 1]!.label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dates: { flexDirection: "row", justifyContent: "space-between", paddingRight: PAD },
  date: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
});
