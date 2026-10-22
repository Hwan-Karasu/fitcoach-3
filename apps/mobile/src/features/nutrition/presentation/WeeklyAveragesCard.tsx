import { StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { WeekAverages } from "../domain/NutritionStats.ts";
import { TARGET_METRICS } from "../domain/TargetModel.ts";
import { metricLabels, shiftDate, wholeText } from "./nutritionFormat.ts";
import { useMacroColors } from "./MacroGrid.tsx";

const unitOf = { kcal: "ккал", protein: "г", fat: "г", carbs: "г" } as const;
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * Недельные средние (§49.22): на каждую неделю — даты, сколько дней с едой и четыре плитки К/Б/Ж/У в цветах показателей. Среднее —
 * по дням, где значение известно; если таких дней меньше, чем дней с едой, под значением стоит «по N дн.» (неизвестное не ноль).
 */
export function WeeklyAveragesCard({ weeks }: Readonly<{ weeks: readonly WeekAverages[] }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const macroColors = useMacroColors();
  return (
    <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>Недельные средние</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>по дням с едой</Text>
      </View>
      {weeks.map((week, index) => {
        const range = `${shortDate(week.monday)} — ${shortDate(shiftDate(week.monday, 6))}`;
        const summary = TARGET_METRICS.map((metric) => `${metricLabels[metric]} ${wholeText(week.metrics[metric].averageX10)} ${unitOf[metric]}`).join(", ");
        return (
          <View key={week.monday} accessible accessibilityLabel={`${range}, дней с едой: ${week.accountedDays}. ${summary}`}
            style={[styles.week, index > 0 ? [styles.weekDivider, { borderTopColor: colors.border }] : null]}>
            <View style={styles.weekHead}>
              <Text style={[styles.range, { color: colors.textPrimary }]}>{range}</Text>
              <Text style={[styles.days, { color: colors.accentInk, backgroundColor: colors.accentSoft }]}>{`${week.accountedDays} дн. с едой`}</Text>
            </View>
            <View style={styles.tiles}>
              {TARGET_METRICS.map((metric) => {
                const item = week.metrics[metric];
                return (
                  <View key={metric} style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.tileLabel, { color: macroColors[metric] }]}>{metricLabels[metric]}</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.tileValue, { color: colors.textPrimary }]}>{wholeText(item.averageX10)}</Text>
                    <Text style={[styles.tileMeta, { color: colors.textSecondary }]}>{unitOf[metric]}</Text>
                    <Text numberOfLines={1} style={[styles.tileNote, { color: colors.textMuted }]}>
                      {item.daysWithValue < week.accountedDays ? `по ${item.daysWithValue} дн.` : " "}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 14, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  week: { gap: 8 },
  weekDivider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  weekHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  range: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  days: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  tiles: { flexDirection: "row", gap: 6 },
  tile: { flex: 1, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 4, alignItems: "center", gap: 1 },
  tileLabel: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  tileValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  tileMeta: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  tileNote: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 13 },
});
