import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarChart, EmptyState, InlineNotice, SegmentedControl } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { EatenEntry } from "../domain/DiaryModel.ts";
import { corridorsForDate, homeAdjustmentFor } from "../domain/HomeMacroTargets.ts";
import type { DateSpan } from "../domain/MetricPeriods.ts";
import { averageTargetX10, computeNutritionStats, weeklyAverages } from "../domain/NutritionStats.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type ResolvedTarget, type TargetException, type TargetMetric, type TargetVersion } from "../domain/TargetModel.ts";
import { MacroGlass } from "./MacroGlass.tsx";
import { useMacroColors } from "./MacroGrid.tsx";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { WeeklyAveragesCard } from "./WeeklyAveragesCard.tsx";
import { metricLabels, wholeText } from "./nutritionFormat.ts";
import { useNutritionGuide } from "./useNutritionGuide.ts";

/** Без цели заливка декоративная (произвольный уровень): на уровень не нужно опираться. */
const NO_TARGET_LEVEL = { kcal: 0.6, protein: 0.45, fat: 0.3, carbs: 0.7 } as const;
const unitOf = { kcal: "ккал", protein: "г", fat: "г", carbs: "г" } as const;
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * Статистика КБЖУ на экране «Приёмы» (UIX-08, UI-OWN-075): прежняя статистика питания (§§49.22–49.23) за период экрана показателя —
 * средние и попадания в коридор цели по дням с записями о еде, столбцы по дням, средние по неделям. Дни без еды и только с водой не учитываются,
 * неизвестные значения не заменяются нулём; всегда «по внесённым записям», не как доказанное полное потребление.
 */
export function MealMacroStats({ clientId, body, span, diary, targets, calc, measurements, onOpenDay }: Readonly<{ clientId: string; body: CalcClientBody; span: DateSpan;
  diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onOpenDay: (date: string) => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const macroColors = useMacroColors();
  const { loaded: guideLoaded, failed: guideFailed, guide, defaults, leanMassKg } = useNutritionGuide(clientId, body, calc, measurements);
  const key = `${clientId}|${span.from}|${span.to}`;
  const [state, setState] = useState<Readonly<{ key: string; entries: readonly EatenEntry[]; versions: readonly TargetVersion[]; exceptions: readonly TargetException[] }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [chartMetric, setChartMetric] = useState<TargetMetric>("kcal");

  useEffect(() => {
    let active = true;
    setFailed(false);
    void Promise.all([diary.listEatenEntries(clientId, span.from, span.to), targets.listVersions(clientId), targets.listExceptions(clientId)]).then(([entries, versions, exceptions]) => {
      if (active) { setState({ key, entries, versions, exceptions }); setFailed(false); }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, diary, targets, span.from, span.to, key, tick]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId && change.scope !== "WATER") refresh(); });
    const offTargets = targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    return () => { offDiary(); offTargets(); };
  }, [clientId, diary, targets]);

  const stats = useMemo(() => {
    if (state === null || state.key !== key || guideLoaded === null) return null;
    // Корректировка действует по версии на дату: расчёт коридоров один на версию, а не на каждый день периода.
    const byAdjustment = new Map<unknown, Corridors>();
    const corridorsFor = (localDate: string, resolved: ResolvedTarget): Corridors => {
      if (resolved.source === "EXCEPTION") return resolved.corridors;
      const adjustment = homeAdjustmentFor(state.versions, localDate);
      let corridors = byAdjustment.get(adjustment);
      if (corridors === undefined) { corridors = corridorsForDate(resolved, state.versions, localDate, guide, defaults, leanMassKg); byAdjustment.set(adjustment, corridors); }
      return corridors;
    };
    return computeNutritionStats({ from: span.from, to: span.to, entries: state.entries, versions: state.versions, exceptions: state.exceptions, corridorsFor });
  }, [state, key, span.from, span.to, guideLoaded, guide, defaults, leanMassKg]);
  const weekGroups = useMemo(() => weeklyAverages(stats?.days ?? []), [stats]);

  if (stats === null) return failed || guideFailed ? <InlineNotice kind="error">Не удалось загрузить статистику питания.</InlineNotice> : null;
  if (stats.accountedDays === 0) return <EmptyState reason="no-data" title="Нет данных" body="За выбранный период нет пищевых записей. Статистика появится после добавления еды в дневник." />;
  return (
    <>
      {failed ? <InlineNotice kind="error">Не удалось обновить статистику. Показаны последние загруженные данные.</InlineNotice> : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Дней с записями о еде</Text>
        <Text style={[styles.big, { color: colors.textPrimary }]}>{`${stats.accountedDays} из ${stats.periodDays}`}</Text>
      </View>
      <View style={styles.metricRow}>
        {TARGET_METRICS.map((metric) => {
          const item = stats.metrics[metric];
          const target = averageTargetX10(stats.days, metric);
          const ratio = item.averageX10 === null || target === null || target <= 0 ? null : item.averageX10 / target;
          return (
            <MacroGlass key={metric} color={macroColors[metric]} ratio={ratio ?? NO_TARGET_LEVEL[metric]}>
              <View accessible accessibilityLabel={`${metricLabels[metric]}: в среднем ${item.averageX10 === null ? "нет данных" : `${wholeText(item.averageX10)} ${unitOf[metric]}`}, ${target === null ? "цели нет" : `цель ${wholeText(target)}${ratio !== null && ratio > 1 ? ", выше цели" : ""}`}`} style={styles.metricBody}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.metricTitle, { color: macroColors[metric] }]}>{metricLabels[metric]}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.metricValue, { color: macroColors[metric] }]}>{item.averageX10 === null ? "—" : wholeText(item.averageX10)}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{unitOf[metric]}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.meta, { color: colors.textSecondary }]}>{item.compared === 0 ? "цели нет" : `${item.inRange} из ${item.compared}`}</Text>
              </View>
            </MacroGlass>
          );
        })}
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>{`${metricLabels[chartMetric]} по дням`}</Text>
        <SegmentedControl compact items={TARGET_METRICS.map((metric) => ({ id: metric, label: metricLabels[metric] }))} selectedId={chartMetric} onSelect={setChartMetric} />
        <BarChart color={macroColors[chartMetric]} items={stats.days.map((day) => ({ key: day.localDate, label: shortDate(day.localDate), value: day.valuesX10[chartMetric] === null ? null : Math.round(day.valuesX10[chartMetric]! / 10) }))}
          format={(value) => `${Math.round(value)} ${unitOf[chartMetric]}`} accessibilityLabel={`${metricLabels[chartMetric]} по дням, ${stats.accountedDays} дней с записями`} onPressItem={(item) => onOpenDay(item.key)} />
      </View>
      {weekGroups.length > 1 ? <WeeklyAveragesCard weeks={weekGroups} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { ...shadow.card, borderRadius: 26, padding: 16, gap: 8 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  big: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  metricRow: { flexDirection: "row", gap: 10 },
  metricBody: { alignItems: "center", gap: 2 },
  metricTitle: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  metricValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
});
