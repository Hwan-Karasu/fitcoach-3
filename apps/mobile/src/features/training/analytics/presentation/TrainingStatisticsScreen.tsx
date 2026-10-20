import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { AppButton, BarChart, EmptyState, InlineNotice, LoadingState, SelectionChip, type BarChartItem } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { dateText, filterHistory, HistoryFilterBar, type HistoryFilter, type TrainingHistoryEntry } from "../../archive/public.ts";
import type { WorkoutSlot } from "../../execution/public.ts";
import { useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import { ChartCard, DrillDownModal, SummaryCard, bucketLabel, kg, number, scaleCaption, statusLabels, type DrillTarget } from "./statsParts.tsx";
import { periods, readStatsFilters, writeStatsFilters, type PeriodId } from "./statsFilters.ts";
import { bucketKeyOf, buckets, entriesInRange, entryTonnage, exerciseActivity, isWorkingSet, muscleGroups, rangeFor, recordsInRange,
  sanitizeFilter, statusCounts, summarize, trimToGroup } from "./trainingStats.ts";

type Section = "workouts" | "load" | "muscles" | "exercises";

const sections: readonly Readonly<{ id: Section; label: string }>[] = [
  { id: "workouts", label: "Тренировки" }, { id: "load", label: "Нагрузка" },
  { id: "muscles", label: "Мышечные группы" }, { id: "exercises", label: "Прогресс упражнений" },
];

/**
 * «Статистика» клиента (A01, §48.86): четыре ключевых показателя над тематическими разделами, каждый график — своя
 * карточка. Данные — хронология занятий всех программ клиента (§48.85); фильтры программы/мезоцикла и период общие
 * для сводки и графиков и сохраняются между разделами и экранами (§48.86.16). Показатели и столбцы раскрываются до
 * исходных занятий и подходов (§48.86.19). Экран только читает. Средняя длительность не считается: время начала и
 * конца не записывается.
 */
export function TrainingStatisticsScreen({ clientId, history, exercises, onOpenExercise, onOpenWorkout, onOpenMonthlyReport, now = new Date() }: Readonly<{
  clientId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  exercises: ExerciseLookupPort;
  onOpenExercise: (exerciseId: string) => void;
  onOpenWorkout: (slot: WorkoutSlot) => void;
  onOpenMonthlyReport: () => void;
  now?: Date;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const [entries, setEntries] = useState<readonly TrainingHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [stored, setStored] = useState(() => readStatsFilters(clientId));
  const [section, setSection] = useState<Section>("workouts");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  useEffect(() => {
    let active = true;
    history.list(clientId).then((next) => { if (active) { setEntries(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, history, version]);
  useEffect(() => history.subscribe(clientId, () => setVersion((value) => value + 1)), [clientId, history]);
  useEffect(() => { setStored(readStatsFilters(clientId)); }, [clientId]);

  const change = useCallback((next: Partial<Readonly<{ filter: HistoryFilter; period: PeriodId }>>) => {
    setStored((current) => { const merged = { ...current, ...next }; writeStatsFilters(clientId, merged); return merged; });
  }, [clientId]);

  const all = useMemo(() => entries ?? [], [entries]);
  const filter = useMemo(() => sanitizeFilter(all, stored.filter), [all, stored.filter]);
  const infoOf = useMemo(() => (exerciseId: string) => lookup?.get(exerciseId), [lookup]);
  const range = useMemo(() => rangeFor(now, periods.find((item) => item.id === stored.period)!.days), [now, stored.period]);
  const scoped = useMemo(() => entriesInRange(filterHistory(all, filter), range), [all, filter, range]);
  const summary = useMemo(() => summarize(scoped, infoOf), [scoped, infoOf]);
  const nameOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.name ?? "Упражнение", [lookup]);

  const workoutsChart = useMemo(() => buckets(scoped, range, (entry) => entry.status === "COMPLETED" ? 1 : 0, 0), [scoped, range]);
  const setsChart = useMemo(() => buckets(scoped, range, (entry) => entry.exercises.reduce(
    (sum, exercise) => sum + exercise.facts.filter(isWorkingSet).length, 0), 0), [scoped, range]);
  const tonnageChart = useMemo(() => buckets(scoped, range, (entry) => entryTonnage(entry, infoOf).kg, null), [scoped, range, infoOf]);
  const statuses = useMemo(() => statusCounts(scoped), [scoped]);
  const groups = useMemo(() => muscleGroups(scoped, infoOf), [scoped, infoOf]);
  const activity = useMemo(() => exerciseActivity(scoped), [scoped]);
  const records = useMemo(() => recordsInRange(all, scoped, range, infoOf), [all, scoped, range, infoOf]);

  const items = (result: ReturnType<typeof buckets>): readonly BarChartItem[] =>
    result.items.map((item) => ({ key: item.key, label: bucketLabel(item.key, result.scale), value: item.value }));
  /** Столбец раскрывается до занятий своего интервала (§48.86.19 п. 2). */
  const drillBucket = (result: ReturnType<typeof buckets>, title: string, mode: DrillTarget["mode"], only?: (entry: TrainingHistoryEntry) => boolean) =>
    (item: BarChartItem) => setDrill({ title: `${title} · ${bucketLabel(item.key, result.scale)}`, mode,
      entries: scoped.filter((entry) => bucketKeyOf(entry.actualDate, result.scale) === item.key && (only?.(entry) ?? true)) });
  const openWorkout = useCallback((entry: TrainingHistoryEntry) =>
    onOpenWorkout({ clientId, programId: entry.programId, weekIndex: entry.weekIndex, plannedWorkoutId: entry.plannedWorkoutId }), [clientId, onOpenWorkout]);

  if (failed) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
    <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить статистику.</InlineNotice></View></View>;
  if (entries === null) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}><LoadingState label="Считаем статистику…" /></View>;

  const incomplete = summary.incompleteSets > 0;
  const incompleteNote = `Неполные данные: ${summary.incompleteSets} подх. не учтены — нет веса, повторов или массы тела`;
  const max = Math.max(1, ...groups.map((group) => group.sets));
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.header}>
          <HistoryFilterBar entries={all} filter={filter} onChange={(next) => change({ filter: next })} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {periods.map((item) => <SelectionChip key={item.id} group="Период" label={item.label} selected={stored.period === item.id}
              onPress={() => change({ period: item.id })} />)}
          </ScrollView>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryCard label="Проведено" value={number(summary.completed)} caption={`из ${number(summary.workouts)} занятий с результатами`}
            onPress={() => setDrill({ title: "Проведённые тренировки", mode: "workouts", entries: scoped.filter((entry) => entry.status === "COMPLETED") })} />
          <SummaryCard label="Рабочих подходов" value={number(summary.workingSets)} caption="без разминки"
            onPress={() => setDrill({ title: "Рабочие подходы", mode: "sets", entries: scoped.filter((entry) => entry.exercises.some((exercise) => exercise.facts.some(isWorkingSet))) })} />
          <SummaryCard label="Тоннаж" value={summary.tonnageKg === null ? "Нет данных" : kg(summary.tonnageKg)}
            caption={incomplete ? "Неполные данные" : undefined} warning
            onPress={() => setDrill({ title: "Тоннаж", mode: "tonnage", entries: scoped })} />
          <SummaryCard label="Средняя длительность" value="Нет данных" caption="время начала и конца не записывается" />
        </View>
        {incomplete ? <Text style={[styles.caption, { color: colors.warning }]}>{incompleteNote}</Text> : null}
        <AppButton variant="secondary" label="Месячный отчёт" onPress={onOpenMonthlyReport} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {sections.map((item) => <SelectionChip key={item.id} group="Раздел" label={item.label} selected={section === item.id}
            onPress={() => setSection(item.id)} />)}
        </ScrollView>

        {scoped.length === 0 ? <EmptyState reason="no-data" title="Нет данных"
          body="За выбранный период и программу нет занятий с записанными подходами или исходом." /> : null}

        {scoped.length > 0 && section === "workouts" ? <>
          <ChartCard title="Проведённые тренировки" note={`Завершённые, ${scaleCaption[workoutsChart.scale]}. Нажмите на столбец — покажем занятия.`}>
            <BarChart items={items(workoutsChart)} format={(value) => number(value)}
              onPressItem={drillBucket(workoutsChart, "Проведённые тренировки", "workouts", (entry) => entry.status === "COMPLETED")}
              accessibilityLabel={`Проведённые тренировки ${scaleCaption[workoutsChart.scale]}: всего ${summary.completed}`} />
          </ChartCard>
          <ChartCard title="Исходы занятий">
            {(["COMPLETED", "IN_PROGRESS", "MISSED", "CANCELLED"] as const).map((status) => (
              <Pressable key={status} accessibilityRole="button" accessibilityLabel={`${statusLabels[status]}: ${statuses.get(status) ?? 0}. Показать занятия`}
                disabled={(statuses.get(status) ?? 0) === 0}
                onPress={() => setDrill({ title: statusLabels[status], mode: "workouts", entries: scoped.filter((entry) => entry.status === status) })}
                style={styles.row}>
                <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{statusLabels[status]}</Text>
                <Text style={[styles.rowValue, { color: colors.textPrimary }]}>{number(statuses.get(status) ?? 0)}</Text>
              </Pressable>
            ))}
          </ChartCard>
        </> : null}

        {scoped.length > 0 && section === "load" ? <>
          <ChartCard title="Рабочие подходы" note={`Подтверждённые, без разминки, ${scaleCaption[setsChart.scale]}.`}>
            <BarChart items={items(setsChart)} format={(value) => number(value)} onPressItem={drillBucket(setsChart, "Рабочие подходы", "sets")}
              accessibilityLabel={`Рабочие подходы ${scaleCaption[setsChart.scale]}: всего ${summary.workingSets}`} />
          </ChartCard>
          <ChartCard title="Тоннаж" note={incomplete ? incompleteNote : `${scaleCaption[tonnageChart.scale][0]!.toUpperCase()}${scaleCaption[tonnageChart.scale].slice(1)}; период без вычислимых подходов — без столбца.`}>
            {summary.tonnageKg === null ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Нет данных для расчёта тоннажа.</Text>
              : <BarChart items={items(tonnageChart)} format={kg} onPressItem={drillBucket(tonnageChart, "Тоннаж", "tonnage")}
                accessibilityLabel={`Тоннаж ${scaleCaption[tonnageChart.scale]}: всего ${kg(summary.tonnageKg)}`} />}
          </ChartCard>
        </> : null}

        {scoped.length > 0 && section === "muscles" ? (
          <ChartCard title="Подходы по мышечным группам"
            note="Рабочие подходы по категории упражнения. Нажмите на группу — покажем упражнения и подходы. Сумма по группам может отличаться от общего числа подходов.">
            {groups.length === 0 ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Нет рабочих подходов.</Text> : groups.map((group) => (
              <Pressable key={group.id} accessibilityRole="button" accessibilityLabel={`${group.label}: ${group.sets} подходов. Показать упражнения`}
                onPress={() => setDrill({ title: group.label, mode: "sets", entries: trimToGroup(scoped, infoOf, group.id) })} style={styles.groupRow}>
                <View style={styles.row}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{group.label}</Text>
                  <Text style={[styles.rowValue, { color: colors.textPrimary }]}>{number(group.sets)}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: colors.surfaceRaised }]}>
                  <View style={[styles.fill, { backgroundColor: colors.accentInk, width: `${Math.max(group.sets / max * 100, 2)}%` }]} />
                </View>
              </Pressable>
            ))}
          </ChartCard>
        ) : null}

        {scoped.length > 0 && section === "exercises" ? <>
          <ChartCard title="Новые личные рекорды" note="Лучший вес на точное число повторений, установленный в периоде; разминка не считается.">
            {records.length === 0 ? <Text style={[styles.empty, { color: colors.textSecondary }]}>В этом периоде новых рекордов нет.</Text> : records.map((record) => (
              <Pressable key={`${record.exerciseId}:${record.reps}`} accessibilityRole="button"
                accessibilityLabel={`${nameOf(record.exerciseId)}: ${record.reps} повторений, ${number(record.loadKg, 1)} килограмм, ${dateText(record.date)}. Открыть упражнение`}
                onPress={() => onOpenExercise(record.exerciseId)} style={[styles.record, { borderColor: colors.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{nameOf(record.exerciseId)}</Text>
                  <Text style={[styles.caption, { color: colors.textSecondary }]}>{`${record.reps} ПМ · ${number(record.loadKg, 1)} кг · ${dateText(record.date)}`}</Text>
                </View>
                <ChevronRight size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </ChartCard>
          <ChartCard title="Упражнения в периоде" note="Нажмите, чтобы открыть историю и прогресс упражнения.">
            {activity.map((row) => (
              <Pressable key={row.exerciseId} accessibilityRole="button"
                accessibilityLabel={`${nameOf(row.exerciseId)}: ${row.sessions} занятий, ${row.workingSets} подходов. Открыть упражнение`}
                onPress={() => onOpenExercise(row.exerciseId)} style={[styles.record, { borderColor: colors.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{nameOf(row.exerciseId)}</Text>
                  <Text style={[styles.caption, { color: colors.textSecondary }]}>{`${row.sessions} занятий · ${row.workingSets} подходов · последнее ${dateText(row.lastDate)}`}</Text>
                </View>
                <ChevronRight size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </ChartCard>
        </> : null}
      </ScrollView>
      <DrillDownModal target={drill} infoOf={infoOf} nameOf={nameOf} onClose={() => setDrill(null)}
        onOpenWorkout={(entry) => { setDrill(null); openWorkout(entry); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  header: { gap: 8 },
  chips: { gap: 8, paddingRight: 8 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 36 },
  rowLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  rowValue: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  groupRow: { gap: 4, minHeight: 48, justifyContent: "center" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  record: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, gap: 1 },
});
