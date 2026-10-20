import { useRef, useState, type ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LineChart as GiftedLineChart } from "react-native-gifted-charts";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow } from "../theme/style.ts";
import { niceStep } from "./chartScale.ts";

export interface LineChartPoint {
  readonly key: string;
  /** Короткая подпись по оси X («5 окт»). */
  readonly label: string;
  /** Полная подпись точки для подсказки («5 окт 2026»); без неё — `label`. */
  readonly caption?: string;
  readonly value: number;
}

const HEIGHT = 160;
const AXIS = 52;
const PAD = 12;
const TOOLTIP_WIDTH = 132;
const TOOLTIP_HEIGHT = 58;

type GiftedData = ComponentProps<typeof GiftedLineChart>["data"];

/**
 * Интерактивный линейный график (react-native-gifted-charts): касание или протягивание по графику ставит вертикальную
 * черту на ближайшую точку и показывает подсказку — дата, значение с единицей, название показателя; выбор остаётся после
 * отпускания. Изначально выбрана последняя точка. `onSelect` сообщает о выбранной точке — под графиком можно показать
 * подробности. Точки — только реальные наблюдения; пропуски не превращаются в ноль (§48.86.32).
 */
export function LineChart({ points, format, formatValue, title, accessibilityLabel, onSelect }: Readonly<{
  points: readonly LineChartPoint[];
  /** Подписи шкалы по оси Y (коротко, без единицы). */
  format: (value: number) => string;
  /** Значение в подсказке (с единицей); без него — `format`. */
  formatValue?: (value: number) => string;
  /** Название показателя в подсказке. */
  title?: string;
  accessibilityLabel: string;
  onSelect?: (point: LineChartPoint) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [width, setWidth] = useState(0);
  const lastIndex = useRef(-1);
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  // Данные передаются от минимума, подписи шкалы возвращают смещение: график не прижат к нулю.
  const step = niceStep((Math.max(...values) - low) / 3);
  const spacing = points.length > 1 ? Math.max((width - AXIS - PAD * 2) / (points.length - 1), 0) : 0;
  const last = points.length - 1;
  const shown = formatValue ?? format;
  // Данные элемента приходят в подсказку как есть — подпись и значение кладутся в сам элемент.
  const data = points.map((point, index) => ({ value: point.value - low, caption: point.caption ?? point.label, real: point.value,
    dataPointColor: index === last ? colors.accentInk : colors.surface })) as unknown as GiftedData;
  return (
    <View accessible accessibilityLabel={accessibilityLabel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <GiftedLineChart
        data={data}
        height={HEIGHT - PAD} noOfSections={3} maxValue={step * 3} stepValue={step}
        spacing={spacing} initialSpacing={PAD} endSpacing={PAD}
        color={colors.accentInk} thickness={2.5} dataPointsColor={colors.surface} dataPointsRadius={4}
        yAxisLabelWidth={AXIS} yAxisThickness={0} xAxisThickness={1} xAxisColor={colors.border} rulesColor={colors.border}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.medium }}
        formatYLabel={(label: string) => format(Number(label) + low)} disableScroll isAnimated={false}
        pointerConfig={{
          pointerStripHeight: HEIGHT - PAD, pointerStripColor: colors.border, pointerStripWidth: 2, pointerColor: colors.accentInk, radius: 6,
          pointerLabelWidth: TOOLTIP_WIDTH, pointerLabelHeight: TOOLTIP_HEIGHT, autoAdjustPointerLabelPosition: true,
          activatePointersOnLongPress: false, persistPointer: true, initialPointerIndex: last,
          pointerLabelComponent: (items: readonly Readonly<{ caption?: string; real?: number }>[]) => {
            const item = items[0];
            return (
              <View style={[styles.tooltip, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text numberOfLines={1} style={[styles.tooltipDate, { color: colors.textSecondary }]}>{item?.caption ?? ""}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.tooltipValue, { color: colors.textPrimary }]}>
                  {item?.real === undefined ? "" : shown(item.real)}</Text>
                {title === undefined ? null : <Text numberOfLines={1} style={[styles.tooltipTitle, { color: colors.accentInk }]}>{title}</Text>}
              </View>
            );
          },
        }}
        getPointerProps={({ pointerIndex }: Readonly<{ pointerIndex: number }>) => {
          if (pointerIndex < 0 || pointerIndex === lastIndex.current) return;
          lastIndex.current = pointerIndex;
          const point = points[pointerIndex];
          if (point !== undefined) onSelect?.(point);
        }} /> : <View style={{ height: HEIGHT }} />}
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
  tooltip: { width: TOOLTIP_WIDTH, height: TOOLTIP_HEIGHT, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6, justifyContent: "center" },
  tooltipDate: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  tooltipValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  tooltipTitle: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
});
