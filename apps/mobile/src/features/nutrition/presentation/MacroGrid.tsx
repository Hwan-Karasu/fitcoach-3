import { memo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { Nutrients } from "../domain/FoodModel.ts";
import { TARGET_METRICS, type TargetMetric } from "../domain/TargetModel.ts";
import { metricLabels, wholeText } from "./nutritionFormat.ts";
import { formatDecimalX10 } from "../domain/FoodRules.ts";

/** Фиксированная ширина числовых колонок: итоги дня, строка приёма и строки продуктов выровнены по одной сетке К | Б | Ж | У (UX v1.1, NUT-FS-15). */
const COLUMN_WIDTH: Readonly<Record<TargetMetric, number>> = { kcal: 46, protein: 36, fat: 36, carbs: 36 };
const KEY_OF: Readonly<Record<TargetMetric, keyof Nutrients>> = { kcal: "kcalX10", protein: "proteinX10", fat: "fatX10", carbs: "carbsX10" };

/** Значения К/Б/Ж/У совпадают: ячейки не перерисовываются при пересоздании объекта с теми же числами. */
const KEYS_EQUAL = (a: Nutrients | null, b: Nutrients | null) => a === b || (a !== null && b !== null && a.kcalX10 === b.kcalX10 && a.proteinX10 === b.proteinX10 && a.fatX10 === b.fatX10 && a.carbsX10 === b.carbsX10);

/** Цвета колонок берутся из графических токенов темы и акцента; цвет не единственный признак — есть буква, позиция и подпись для чтения с экрана (NUT-FS-17). */
export function useMacroColors(): Readonly<Record<TargetMetric, string>> {
  const { charts } = usePrototypeTheme().palette.tokens;
  return { kcal: charts[0], protein: charts[1], fat: charts[2], carbs: charts[3] };
}

/** Значения К/Б/Ж/У в тех же колонках; `null` — «—» (нет данных, а не ноль). */
export const MacroCells = memo(function MacroCells({ values, bold = false }: Readonly<{ values: Nutrients | null; bold?: boolean }>) {
  const colors = useMacroColors();
  const { width, fontScale } = useWindowDimensions();
  const display = (metric: TargetMetric) => {
    const value = values?.[KEY_OF[metric]] ?? null;
    return value === null ? "—" : metric === "kcal" ? wholeText(value) : formatDecimalX10(value);
  };
  return (
    <View style={styles.row}>
      {TARGET_METRICS.map((metric) => (
        <Text key={metric} accessibilityLabel={`${metricLabels[metric]}: ${display(metric) === "—" ? "нет данных" : display(metric)}`}
          style={[styles.cell, { width: COLUMN_WIDTH[metric], fontSize: width < 360 || fontScale > 1.1 ? 12 : 14, color: colors[metric], fontFamily: bold ? fonts.bold : fonts.semibold }]}>
          {display(metric)}
        </Text>
      ))}
    </View>
  );
}, (before, after) => before.bold === after.bold && KEYS_EQUAL(before.values, after.values));

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  letter: { textAlign: "right", fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  cell: { textAlign: "right", fontSize: 14, lineHeight: 19, fontVariant: ["tabular-nums"] },
});
