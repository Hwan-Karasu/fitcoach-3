import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { BarChart, EmptyState, InlineNotice, LoadingState, SelectionChip, type BarChartItem } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { MONTHS, dateText, filterHistory, HistoryFilterBar, type HistoryFilter, type TrainingHistoryEntry } from "../../archive/public.ts";
import type { WorkoutStatus } from "../../execution/public.ts";
import { useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import { buckets, entriesInRange, entryTonnage, exerciseActivity, isWorkingSet, muscleGroups, rangeFor, recordsInRange, statusCounts, summarize,
  type Scale } from "./trainingStats.ts";

type Section = "workouts" | "load" | "muscles" | "exercises";
type PeriodId = "30" | "90" | "180" | "365" | "all";

const sections: readonly Readonly<{ id: Section; label: string }>[] = [
  { id: "workouts", label: "Тренировки" }, { id: "load", label: "Нагрузка" },
  { id: "muscles", label: "Мышечные группы" }, { id: "exercises", label: "Прогресс упражнений" },
];
const periods: readonly Readonly<{ id: PeriodId; label: string; days: number | null }>[] = [
  { id: "30", label: "30 дней", days: 30 }, { id: "90", label: "3 мес", days: 90 }, { id: "180", label: "6 мес", days: 180 },
  { id: "365", label: "Год", days: 365 }, { id: "all", label: "Всё время", days: null },
];
const statusLabels: Readonly<Record<WorkoutStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", MISSED: "Пропущена", CANCELLED: "Отменена",
};

const number = (value: number, digits = 0) => value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
const kg = (value: number) => `${number(value)} кг`;

/** Подпись столбца: день/неделя — «5 окт», месяц — «окт 2026». */
function bucketLabel(key: string, scale: Scale): string {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number | undefined];
  return scale === "month" ? `${MONTHS[month - 1] ?? ""} ${year}` : `${day} ${MONTHS[month - 1] ?? ""}`;
}
const scaleCaption: Readonly<Record<Scale, string>> = { day: "по дням", week: "по неделям", month: "по месяцам" };

function SummaryCard({ label, value, caption, warning }: Readonly<{ label: string; value: string; caption?: string; warning?: boolean }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${caption === undefined ? "" : `. ${caption}`}`}
      style={[styles.summary, { backgroundColor: colors.surface }]}>
      <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.summaryValue, { color: colors.textPrimary }]}>{value}</Text>
      {caption === undefined ? null : <Text style={[styles.caption, { color: warning === true ? colors.warning : colors.textMuted }]}>{caption}</Text>}
    </View>
  );
}

function ChartCard({ title, note, children }: Readonly<{ title: string; note?: string; children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text accessibilityRole="header" style={[styles.cardTitle, { color: colors.textPrimary }]}>{title}</Text>
      {children}
      {note === undefined ? null : <Text style={[styles.caption, { color: colors.textMuted }]}>{note}</Text>}
    </View>
  );
}

/**
 * «Статистика» клиента (A01, §48.86): четыре ключевых показателя над тематическими разделами, каждый график — своя
 * карточка. Данные — хронология занятий всех программ клиента (§48.85); фильтры программы/мезоцикла и период общие
 * для сводки и графиков. Экран только читает. Средняя длительность не считается: время начала и конца не записывается.
 */
export function TrainingStatisticsScreen({ clientId, history, exercises, onOpenExercise, now = new Date() }: Readonly<{
  clientId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  exercises: ExerciseLookupPort;
  onOpenExercise: (exerciseId: string) => void;
  now?: Date;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const [entries, setEntries] = useState<readonly TrainingHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<HistoryFilter>({ programId: null, mesocycleId: null });
  const [period, setPeriod] = useState<PeriodId>("90");
  const [section, setSection] = useState<Section>("workouts");

  useEffect(() => {
    let active = true;
    history.list(clientId).then((next) => { if (active) { setEntries(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, history, version]);
  useEffect(() => history.subscribe(clientId, () => setVersion((value) => value + 1)), [clientId, history]);

  const infoOf = useMemo(() => (exerciseId: string) => lookup?.get(exerciseId), [lookup]);
  const range = useMemo(() => rangeFor(now, periods.find((item) => item.id === period)!.days), [now, period]);
  const all = entries ?? [];
  const scoped = useMemo(() => entriesInRange(filterHistory(all, filter), range), [all, filter, range]);
  const summary = useMemo(() => summarize(scoped, infoOf), [scoped, infoOf]);
  const nameOf = (exerciseId: string) => lookup?.get(exerciseId)?.name ?? "Упражнение";

  const toItems = (result: ReturnType<typeof buckets>): readonly BarChartItem[] =>
    result.items.map((item) => ({ key: item.key, label: bucketLabel(item.key, result.scale), value: item.value }));
  const workoutsChart = useMemo(() => buckets(scoped, range, (entry) => entry.status === "COMPLETED" ? 1 : 0, 0), [scoped, range]);
  const setsChart = useMemo(() => buckets(scoped, range, (entry) => entry.exercises.reduce(
    (sum, exercise) => sum + exercise.facts.filter(isWorkingSet).length, 0), 0), [scoped, range]);
  const tonnageChart = useMemo(() => buckets(scoped, range, (entry) => entryTonnage(entry, infoOf).kg, null), [scoped, range, infoOf]);
  const statuses = useMemo(() => statusCounts(scoped), [scoped]);
  const groups = useMemo(() => muscleGroups(scoped, infoOf), [scoped, infoOf]);
  const activity = useMemo(() => exerciseActivity(scoped), [scoped]);
  const records = useMemo(() => recordsInRange(all, scoped, range, infoOf), [all, scoped, range, infoOf]);

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
          <HistoryFilterBar entries={all} filter={filter} onChange={setFilter} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {periods.map((item) => <SelectionChip key={item.id} group="Период" label={item.label} selected={period === item.id}
              onPress={() => setPeriod(item.id)} />)}
          </ScrollView>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryCard label="Проведено" value={number(summary.completed)} caption={`из ${number(summary.workouts)} занятий с результатами`} />
          <SummaryCard label="Рабочих подходов" value={number(summary.workingSets)} caption="без разминки" />
          <SummaryCard label="Тоннаж" value={summary.tonnageKg === null ? "Нет данных" : kg(summary.tonnageKg)}
            caption={incomplete ? "Неполные данные" : undefined} warning />
          <SummaryCard label="Средняя длительность" value="Нет данных" caption="время начала и конца не записывается" />
        </View>
        {incomplete ? <Text style={[styles.caption, { color: colors.warning }]}>{incompleteNote}</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {sections.map((item) => <SelectionChip key={item.id} group="Раздел" label={item.label} selected={section === item.id}
            onPress={() => setSection(item.id)} />)}
        </ScrollView>

        {scoped.length === 0 ? <EmptyState reason="no-data" title="Нет данных"
          body="За выбранный период и программу нет занятий с записанными подходами или исходом." /> : null}

        {scoped.length > 0 && section === "workouts" ? <>
          <ChartCard title="Проведённые тренировки" note={`Завершённые, ${scaleCaption[workoutsChart.scale]}.`}>
            <BarChart items={toItems(workoutsChart)} format={(value) => number(value)}
              accessibilityLabel={`Проведённые тренировки ${scaleCaption[workoutsChart.scale]}: всего ${summary.completed}`} />
          </ChartCard>
          <ChartCard title="Исходы занятий">
            {(["COMPLETED", "IN_PROGRESS", "MISSED", "CANCELLED"] as const).map((status) => (
              <View key={status} style={styles.row}>
                <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{statusLabels[status]}</Text>
                <Text style={[styles.rowValue, { color: colors.textPrimary }]}>{number(statuses.get(status) ?? 0)}</Text>
              </View>
            ))}
          </ChartCard>
        </> : null}

        {scoped.length > 0 && section === "load" ? <>
          <ChartCard title="Рабочие подходы" note={`Подтверждённые, без разминки, ${scaleCaption[setsChart.scale]}.`}>
            <BarChart items={toItems(setsChart)} format={(value) => number(value)}
              accessibilityLabel={`Рабочие подходы ${scaleCaption[setsChart.scale]}: всего ${summary.workingSets}`} />
          </ChartCard>
          <ChartCard title="Тоннаж" note={incomplete ? incompleteNote : `${scaleCaption[tonnageChart.scale][0]!.toUpperCase()}${scaleCaption[tonnageChart.scale].slice(1)}; период без вычислимых подходов — без столбца.`}>
            {summary.tonnageKg === null ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Нет данных для расчёта тоннажа.</Text>
              : <BarChart items={toItems(tonnageChart)} format={kg} accessibilityLabel={`Тоннаж ${scaleCaption[tonnageChart.scale]}: всего ${kg(summary.tonnageKg)}`} />}
          </ChartCard>
        </> : null}

        {scoped.length > 0 && section === "muscles" ? (
          <ChartCard title="Подходы по мышечным группам"
            note="Рабочие подходы по категории упражнения. Сумма по группам может отличаться от общего числа подходов.">
            {groups.length === 0 ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Нет рабочих подходов.</Text> : groups.map((group) => (
              <View key={group.id} accessible accessibilityLabel={`${group.label}: ${group.sets} подходов`} style={styles.groupRow}>
                <View style={styles.row}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{group.label}</Text>
                  <Text style={[styles.rowValue, { color: colors.textPrimary }]}>{number(group.sets)}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: colors.surfaceRaised }]}>
                  <View style={[styles.fill, { backgroundColor: colors.accentInk, width: `${Math.max(group.sets / max * 100, 2)}%` }]} />
                </View>
              </View>
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
  summary: { ...shadow.card, flexBasis: "47%", flexGrow: 1, borderRadius: 20, padding: 14, gap: 2, minHeight: 92 },
  summaryLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  summaryValue: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 8 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  rowValue: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  groupRow: { gap: 4 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  record: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, gap: 1 },
});
