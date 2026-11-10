import { Pressable, StyleSheet, Text, View } from "react-native";
import { Repeat2 } from "lucide-react-native";
import { SegmentedRing } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { goalFraction } from "../domain/ActivityGoals.ts";
import { TARGET_METRICS, type TargetMetric } from "../domain/TargetModel.ts";
import { useMacroColors } from "./MacroGrid.tsx";
import { metricLabels, wholeText } from "./nutritionFormat.ts";

/** Доля от ориентира для кольца и полос: цели нет — `null` (пустое кольцо, а не 0 %). */
const shareOfTarget = (eaten: number, target: number | null): number | null => target === null ? null : goalFraction(eaten, target);

export interface DayTotalRow {
  readonly metric: TargetMetric;
  /** Съедено за день, целые (ккал или граммы); пустой день — 0. */
  readonly eaten: number;
  /** Ориентир дня или `null`, если цель не задана и данных для расчёта нет. */
  readonly target: number | null;
}

const unitOf = (metric: TargetMetric) => metric === "kcal" ? "ккал" : "г";
const targetText = (target: number | null) => target === null ? "—" : wholeText(target * 10);
const eatenText = (eaten: number) => wholeText(eaten * 10);

/**
 * «Итого за день» (UIX-07, UI-OWN-072; размеры макета): подпись и пилюля «С прошлого дня» в одной строке, кольцо «съедено от цели» 68 с процентом,
 * крупное «съедено / ориентир ккал» и три полосы Б / Ж / У. Только показ: итоги и ориентир считает экран дневника по прежним правилам.
 */
export function DayTotalsCard({ rows, copying, onCopyPrevious }: Readonly<{ rows: readonly DayTotalRow[]; copying: boolean; onCopyPrevious: () => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const macroColors = useMacroColors();
  const kcal = rows.find((row) => row.metric === "kcal");
  const macros = rows.filter((row) => row.metric !== "kcal");
  const fraction = kcal === undefined ? null : shareOfTarget(kcal.eaten, kcal.target);
  const summary = TARGET_METRICS.map((metric) => {
    const row = rows.find((entry) => entry.metric === metric);
    return `${metricLabels[metric]} ${eatenText(row?.eaten ?? 0)} из ${targetText(row?.target ?? null)}`;
  }).join(", ");
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.label, { color: colors.textMuted }]}>Итого за день</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Скопировать день с прошлого дня" accessibilityState={{ busy: copying, disabled: copying }} disabled={copying}
          hitSlop={{ top: 9, bottom: 9 }} onPress={onCopyPrevious}
          style={({ pressed }) => [styles.pill, { backgroundColor: colors.accentSoft, opacity: copying ? 0.6 : pressed ? 0.85 : 1 }]}>
          <Repeat2 size={14} color={colors.accentInk} />
          <Text style={[styles.pillText, { color: colors.accentInk }]}>{copying ? "Копируем…" : "С прошлого дня"}</Text>
        </Pressable>
      </View>
      <View style={styles.top}>
        <SegmentedRing size={68} stroke={8} fraction={fraction} segments={[]} accessibilityLabel={`Итоги дня, съедено из ориентира: ${summary}`}>
          <Text importantForAccessibility="no-hide-descendants" style={[styles.ringNumber, { color: colors.textPrimary }]}>{fraction === null ? "—" : `${Math.round(fraction * 100)}%`}</Text>
        </SegmentedRing>
        <View style={styles.bars}>
          <Text style={[styles.big, { color: colors.textPrimary }]}>{eatenText(kcal?.eaten ?? 0)}<Text style={[styles.bigUnit, { color: colors.textSecondary }]}>{` / ${targetText(kcal?.target ?? null)} ккал`}</Text></Text>
          <View style={styles.barList}>
            {macros.map((row) => {
              const share = Math.min(1, Math.max(0, shareOfTarget(row.eaten, row.target) ?? 0));
              return (
                <View key={row.metric} accessible accessibilityLabel={`${metricLabels[row.metric]}: ${eatenText(row.eaten)} из ${targetText(row.target)} ${unitOf(row.metric)}`} style={styles.barRow}>
                  <Text style={[styles.barLetter, { color: macroColors[row.metric] }]}>{metricLabels[row.metric].slice(0, 1)}</Text>
                  <View style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: macroColors[row.metric] }]} /></View>
                  <Text numberOfLines={1} style={[styles.barValue, { color: colors.textSecondary }]}>{`${eatenText(row.eaten)}/${targetText(row.target)}`}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...shadow.card, borderRadius: 26, padding: 12, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.66, textTransform: "uppercase" },
  pill: { height: 30, borderRadius: 15, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  pillText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  ringNumber: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  bars: { flex: 1, minWidth: 0 },
  big: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 28, fontVariant: ["tabular-nums"] },
  bigUnit: { fontFamily: fonts.regular, fontSize: 12 },
  barList: { gap: 5, marginTop: 8 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  barLetter: { width: 10, fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  barValue: { width: 50, textAlign: "right", fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, fontVariant: ["tabular-nums"] },
});
