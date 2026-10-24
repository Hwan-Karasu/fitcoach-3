import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { CalendarDays, Dumbbell, Footprints } from "lucide-react-native";
import { AppButton, BarChart, DateRangeCalendar, EmptyState, InlineNotice, LineChart, LoadingState, SegmentedControl } from "../../../shared/ui/components/public.ts";
import type { DateRange } from "../../../shared/ui/components/DateRangeCalendar.tsx";
import { dailyPoints, type ClientMeasurements, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { NutritionCalcPort, StepsDay, WorkoutMark } from "../domain/NutritionCalcPort.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { EatenEntry } from "../domain/DiaryModel.ts";
import { corridorsForDate, homeAdjustmentFor } from "../domain/HomeMacroTargets.ts";
import { averageTargetX10, computeNutritionStats, weeklyAverages } from "../domain/NutritionStats.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type ResolvedTarget, type TargetException, type TargetMetric, type TargetVersion } from "../domain/TargetModel.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { useNutritionGuide } from "./useNutritionGuide.ts";
import { useToday } from "./useToday.ts";
import { metricLabels, shiftDate, wholeText } from "./nutritionFormat.ts";
import { useMacroColors } from "./MacroGrid.tsx";
import { MacroGlass } from "./MacroGlass.tsx";
import { WeeklyAveragesCard } from "./WeeklyAveragesCard.tsx";

type PeriodId = "week" | "month" | "quarter" | "all" | "range";
const periods: readonly Readonly<{ id: PeriodId; label: string; days: number }>[] = [
  { id: "week", label: "Неделя", days: 7 }, { id: "month", label: "Месяц", days: 30 }, { id: "quarter", label: "3 мес.", days: 90 },
  { id: "all", label: "Всё", days: 0 }, { id: "range", label: "Период", days: 0 },
];
/** Без цели заливка декоративная (произвольный уровень): на уровень не нужно опираться. */
const NO_TARGET_LEVEL = { kcal: 0.6, protein: 0.45, fat: 0.3, carbs: 0.7 } as const;
const unitOf = { kcal: "ккал", protein: "г", fat: "г", carbs: "г" } as const;

const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * «Статистика» питания клиента (§§49.22–49.23): среднее и доля попаданий в коридор по дням с учётом — это дни, где есть хотя бы одна пищевая запись.
 * Дни без еды и только с водой не входят; неизвестные значения не заменяются нулём. Всегда «по внесённым записям», не как доказанное полное потребление.
 */
export function NutritionStatsScreen({ clientId, body, diary, targets, measurements, calc, onOpenDay }: Readonly<{ clientId: string; body: CalcClientBody; diary: NutritionDiaryPort; targets: NutritionTargetsPort;
  measurements: MeasurementRepositoryPort; calc: NutritionCalcPort; onOpenDay: (date: string) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const macroColors = useMacroColors();
  // Цель дня — та же, что в дневнике и на главной: расчёт с ручной корректировкой на дату (ADR-029).
  const { loaded: guideLoaded, guide, defaults, leanMassKg } = useNutritionGuide(clientId, body, calc, measurements);
  const today = useToday();
  const [period, setPeriod] = useState<PeriodId>("week");
  const [latest, setLatest] = useState<Readonly<{ entries: readonly EatenEntry[]; versions: readonly TargetVersion[]; exceptions: readonly TargetException[]; key: string;
    body: ClientMeasurements; steps: readonly StepsDay[]; workouts: readonly WorkoutMark[] }> | null>(null);
  /** Уже прочитанные периоды: возврат к ним открывается сразу; при изменении данных клиента очищается, `latest` остаётся на экране до прихода новых. */
  const store = useRef(new Map<string, NonNullable<typeof latest>>());
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [range, setRange] = useState({ from: shiftDate(today, -29), to: today });
  const [draftRange, setDraftRange] = useState<DateRange>(range);
  const [calendar, setCalendar] = useState(false);
  const [chartMetric, setChartMetric] = useState<TargetMetric>("kcal");
  const [trend, setTrend] = useState<"weight" | "fat" | "steps">("weight");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const days = periods.find((item) => item.id === period)!.days;
  const queryFrom = period === "all" ? "0001-01-01" : period === "range" ? range.from : shiftDate(today, -(days - 1));
  const to = period === "range" ? range.to : today;
  const key = `${clientId}|${queryFrom}|${to}`;
  const data = store.current.get(key) ?? latest;
  const from = period === "all" && data?.key === key ? [...data.entries.map((entry) => entry.localDate), ...data.body.measurements.filter((row) => row.localDate <= to).map((row) => row.localDate), ...data.steps.map((row) => row.localDate)].sort()[0] ?? to : queryFrom;

  useEffect(() => {
    let active = true;
    void Promise.all([diary.listEatenEntries(clientId, queryFrom, to), targets.listVersions(clientId), targets.listExceptions(clientId), measurements.listForClient(clientId),
      calc.listSteps(clientId, queryFrom, to), calc.listWorkoutMarks(clientId, queryFrom, to)]).then(([entries, versions, exceptions, body, steps, workouts]) => {
      if (active) {
        const payload = { entries, versions, exceptions, body, steps, workouts, key };
        store.current.set(key, payload);
        setLatest(payload);
        setFailed(false);
      }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, diary, targets, measurements, calc, queryFrom, to, key, tick]);
  useEffect(() => {
    const refresh = () => { store.current.clear(); setTick((value) => value + 1); };
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId && change.scope !== "WATER") refresh(); });
    const offTargets = targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    const offBody = measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    const offCalc = calc.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    return () => { offDiary(); offTargets(); offBody(); offCalc(); };
  }, [clientId, diary, targets, measurements, calc]);

  const fresh = useMemo(() => {
    if (data === null || data.key !== key || guideLoaded === null) return null;
    // Корректировка действует по версии на дату: расчёт коридоров один на версию, а не на каждый из тысяч дней периода.
    const byAdjustment = new Map<unknown, Corridors>();
    const corridorsFor = (localDate: string, resolved: ResolvedTarget): Corridors => {
      if (resolved.source === "EXCEPTION") return resolved.corridors;
      const adjustment = homeAdjustmentFor(data.versions, localDate);
      let corridors = byAdjustment.get(adjustment);
      if (corridors === undefined) { corridors = corridorsForDate(resolved, data.versions, localDate, guide, defaults, leanMassKg); byAdjustment.set(adjustment, corridors); }
      return corridors;
    };
    return computeNutritionStats({ from, to, entries: data.entries, versions: data.versions, exceptions: data.exceptions, sparse: period === "all", corridorsFor });
  }, [data, key, from, to, period, guideLoaded, guide, defaults, leanMassKg]);
  // Пока грузится новый период, остаётся прежняя статистика (приглушённая): экран не пересоздаётся.
  const [shown, setShown] = useState<typeof fresh>(null);
  if (fresh !== null && shown !== fresh) setShown(fresh);
  const stats = fresh ?? shown;
  const graph = useMemo(() => {
    if (data === null) return [];
    if (trend === "steps") return data.steps.map((row) => ({ key: row.localDate, label: shortDate(row.localDate), caption: row.localDate, value: row.steps }));
    return dailyPoints(data.body.measurements, data.body.primaries, trend === "weight" ? "WEIGHT" : "BODY_FAT").filter((row) => row.localDate >= from && row.localDate <= to)
      .flatMap((row) => row.kind !== "VALUE" ? [] : [{ key: row.localDate, label: shortDate(row.localDate), caption: row.localDate, value: row.measurement.valueX10 / 10 }]);
  }, [data, trend, from, to]);
  const weekGroups = useMemo(() => weeklyAverages(stats?.days ?? []), [stats]);
  const selected = selectedDate ?? graph.at(-1)?.key ?? to;
  const selectedDay = stats?.days.find((day) => day.localDate === selected);
  const selectedSteps = data?.steps.find((row) => row.localDate === selected)?.steps;
  const selectedWorkout = data?.workouts.find((row) => row.localDate === selected)?.done;
  const rangeDays = draftRange.from === null || draftRange.to === null ? 0 : Math.round((Date.parse(draftRange.to) - Date.parse(draftRange.from)) / 86400000) + 1;

  const control = <>
    <View style={[styles.header, { backgroundColor: colors.surface }]}>
      <SegmentedControl compact fit items={periods} selectedId={period}
        onSelect={(id) => { if (id === "range") { setDraftRange(range); setCalendar(true); } else { setPeriod(id); setSelectedDate(null); } }} />
      <Text style={[styles.meta, styles.periodText, { color: colors.textSecondary }]}>{`${period === "all" && stats === null ? "Всё время" : from} — ${to}`}</Text>
    </View>
    <Modal visible={calendar} transparent animationType="fade" onRequestClose={() => setCalendar(false)}><View style={styles.backdrop}><View style={[styles.dialog, { backgroundColor: colors.surface }]}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Выберите период</Text><DateRangeCalendar value={draftRange} max={today} onChange={setDraftRange} />
      {rangeDays > 1830 ? <Text style={[styles.meta, { color: colors.danger }]}>Диапазон — до пяти лет. Для полной истории выберите «Всё время».</Text> : null}
      <AppButton label="Показать период" disabled={rangeDays <= 0 || rangeDays > 1830} onPress={() => { if (draftRange.from !== null && draftRange.to !== null) { setRange({ from: draftRange.from, to: draftRange.to }); setPeriod("range"); setSelectedDate(null); setCalendar(false); } }} />
      <AppButton variant="ghost" label="Отмена" onPress={() => setCalendar(false)} />
    </View></View></Modal>
  </>;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
      {control}
      {stats === null ? failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить статистику питания.</InlineNotice><AppButton label="Повторить" onPress={() => setTick((value) => value + 1)} /></View> : <LoadingState label="Считаем статистику…" /> : <>
      {failed ? <InlineNotice kind="error">Не удалось обновить статистику. Показаны последние загруженные данные.</InlineNotice> : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Дней с записями о еде</Text>
        <Text style={[styles.big, { color: colors.textPrimary }]}>{`${stats.accountedDays} из ${stats.periodDays}`}</Text>
      </View>
      {stats.accountedDays === 0 ? <EmptyState reason="no-data" title="Нет данных" body="За выбранный период нет пищевых записей. Статистика появится после добавления еды в дневник." /> : (
        <>
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
        </>
      )}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>{trend === "weight" ? "Вес" : trend === "fat" ? "% жира" : "Шаги"}</Text>
        <SegmentedControl compact items={[{ id: "weight", label: "Вес" }, { id: "fat", label: "% жира" }, { id: "steps", label: "Шаги" }] as const} selectedId={trend} onSelect={(id) => { setTrend(id); setSelectedDate(null); }} />
        {graph.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Нет данных за период.</Text> :
          <LineChart points={graph} format={(value) => String(Math.round(value * 10) / 10)} formatValue={(value) => `${Math.round(value * 10) / 10} ${trend === "weight" ? "кг" : trend === "fat" ? "%" : "шагов"}`} accessibilityLabel="Динамика по известным значениям" onSelect={(point) => setSelectedDate(point.key)} />}
        <View style={[styles.daySummary, { borderColor: colors.border }]}>
          <View style={styles.dayHeader}>
            <CalendarDays size={18} color={colors.accentInk} />
            <Text style={[styles.heading, { color: colors.textPrimary }]}>{`${shortDate(selected)}.${selected.slice(0, 4)}`}</Text>
          </View>
          <View style={styles.dayMacros}>
            {TARGET_METRICS.map((metric) => <View key={metric} accessible
              accessibilityLabel={`${metricLabels[metric]}: ${wholeText(selectedDay?.valuesX10[metric] ?? null)} ${unitOf[metric]}`}
              style={[styles.dayMacro, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.metricTitle, { color: macroColors[metric] }]}>{metric === "kcal" ? "Ккал" : metric === "protein" ? "Б" : metric === "fat" ? "Ж" : "У"}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
                style={[styles.dayValue, { color: colors.textPrimary }]}>{wholeText(selectedDay?.valuesX10[metric] ?? null)}</Text>
              <Text style={[styles.dayUnit, { color: colors.textSecondary }]}>{unitOf[metric]}</Text>
            </View>)}
          </View>
          <View style={styles.dayActivity}>
            <View style={[styles.activityTile, { backgroundColor: colors.surfaceRaised }]}>
              <View style={styles.activityLabel}><Footprints size={16} color={colors.accentInk} />
                <Text style={[styles.meta, styles.activityText, { color: colors.textSecondary }]}>Шаги</Text></View>
              <Text style={[styles.dayValue, { color: colors.textPrimary }]}>{selectedSteps === undefined ? "—" : String(selectedSteps).replace(/\B(?=(\d{3})+(?!\d))/gu, " ")}</Text>
            </View>
            <View style={[styles.activityTile, { backgroundColor: colors.surfaceRaised }]}>
              <View style={styles.activityLabel}><Dumbbell size={16} color={colors.accentInk} />
                <Text style={[styles.meta, styles.activityText, { color: colors.textSecondary }]}>Отметка тренировки</Text></View>
              <Text style={[styles.dayValue, { color: colors.textPrimary }]}>{selectedWorkout === true ? "Да" : selectedWorkout === false ? "Нет" : "—"}</Text>
            </View>
          </View>
          <AppButton label="Открыть день в дневнике" compact onPress={() => onOpenDay(selected)} />
        </View>
      </View>
      {weekGroups.length > 0 ? <WeeklyAveragesCard weeks={weekGroups} /> : null}
      </>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16, paddingTop: 8 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 4 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  big: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  header: { ...shadow.card, borderRadius: 20, padding: 10, gap: 4 },
  metricRow: { flexDirection: "row", gap: 10 },
  metricBody: { alignItems: "center", gap: 2 },
  periodText: { textAlign: "center" },
  metricTitle: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  metricValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  daySummary: { marginTop: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  dayHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayMacros: { flexDirection: "row", gap: 6 },
  dayMacro: { flex: 1, minWidth: 0, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4, alignItems: "center", gap: 2 },
  dayValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, fontVariant: ["tabular-nums"] },
  dayUnit: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 13 },
  dayActivity: { flexDirection: "row", gap: 6 },
  activityTile: { flex: 1, minWidth: 0, borderRadius: 12, padding: 10, gap: 6, justifyContent: "space-between" },
  activityLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  activityText: { flex: 1 },
  backdrop: { flex: 1, padding: 16, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  dialog: { padding: 12, borderRadius: 20, gap: 8 },
});
