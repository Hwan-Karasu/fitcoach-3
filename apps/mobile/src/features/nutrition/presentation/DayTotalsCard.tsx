import { StyleSheet, Text, View } from "react-native";
import { Repeat2 } from "lucide-react-native";
import { AppButton, ProgressBar, SegmentedRing } from "../../../shared/ui/components/public.ts";
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
 * «Итого за день» (UIX-07, UI-OWN-072): кольцо «съедено от цели» в ккал, три полосы Б / Ж / У и пилюля «С прошлого дня» в этой же карточке.
 * Только показ: итоги и ориентир считает экран дневника по прежним правилам.
 */
export function DayTotalsCard({ rows, copying, onCopyPrevious }: Readonly<{ rows: readonly DayTotalRow[]; copying: boolean; onCopyPrevious: () => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const macroColors = useMacroColors();
  const kcal = rows.find((row) => row.metric === "kcal");
  const macros = rows.filter((row) => row.metric !== "kcal");
  const summary = TARGET_METRICS.map((metric) => {
    const row = rows.find((entry) => entry.metric === metric);
    return `${metricLabels[metric]} ${eatenText(row?.eaten ?? 0)} из ${targetText(row?.target ?? null)}`;
  }).join(", ");
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.top}>
        <SegmentedRing size={104} stroke={10} fraction={kcal === undefined ? null : shareOfTarget(kcal.eaten, kcal.target)}
          segments={[]} accessibilityLabel={`Итоги дня, съедено из ориентира: ${summary}`}>
          <View style={styles.ringText} importantForAccessibility="no-hide-descendants">
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.ringNumber, { color: colors.textPrimary }]}>{eatenText(kcal?.eaten ?? 0)}</Text>
            <Text style={[styles.ringUnit, { color: colors.textMuted }]}>ккал</Text>
          </View>
        </SegmentedRing>
        <View style={styles.bars}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Итого за день</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>{`${eatenText(kcal?.eaten ?? 0)} / ${targetText(kcal?.target ?? null)} ккал`}</Text>
          {macros.map((row) => (
            <View key={row.metric} style={styles.barRow}>
              <Text style={[styles.barLetter, { color: macroColors[row.metric] }]}>{metricLabels[row.metric].slice(0, 1)}</Text>
              <View style={styles.barTrack}>
                <ProgressBar color={macroColors[row.metric]} value={shareOfTarget(row.eaten, row.target) ?? 0}
                  accessibilityLabel={`${metricLabels[row.metric]}: ${eatenText(row.eaten)} из ${targetText(row.target)} ${unitOf(row.metric)}`} />
              </View>
              <Text numberOfLines={1} style={[styles.barValue, { color: colors.textSecondary }]}>{`${eatenText(row.eaten)}/${targetText(row.target)}`}</Text>
            </View>
          ))}
        </View>
      </View>
      <AppButton compact variant="secondary" icon={(color) => <Repeat2 size={16} color={color} />} label="С прошлого дня" busy={copying} onPress={onCopyPrevious} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...shadow.card, borderRadius: 26, padding: 14, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", gap: 14 },
  ringText: { alignItems: "center" },
  ringNumber: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 26, maxWidth: 72, textAlign: "center" },
  ringUnit: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  bars: { flex: 1, minWidth: 0, gap: 6 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  sub: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, fontVariant: ["tabular-nums"] },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLetter: { width: 12, fontFamily: fonts.bold, fontSize: 12, lineHeight: 15 },
  barTrack: { flex: 1 },
  barValue: { width: 62, textAlign: "right", fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
});
