import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { EmptyState, InlineNotice, LineChart, LoadingState, SegmentedControl, SelectionChip } from
  "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { MONTHS, dateText, factText, filterHistory, HistoryFilterBar, type HistoryFilter, type TrainingHistoryEntry } from
  "../../archive/public.ts";
import type { SetFact } from "../../execution/public.ts";
import { formatDuration, useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import { periodRange } from "./statsFilters.ts";
import { PeriodPill, type PeriodValue } from "./PeriodPill.tsx";
import { exerciseSessions, progressMetrics, progressSeries, repRecords, sessionValue, type ExerciseSession,
  type ProgressMetricId } from "./exerciseProgress.ts";

type Tab = "overview" | "history" | "progress";

const metricLabels: Readonly<Record<ProgressMetricId, string>> = {
  e1rm: "Оценка 1ПМ", maxLoad: "Макс. вес", volume: "Тоннаж", maxReps: "Макс. повторы", totalReps: "Всего повторов",
  maxDuration: "Время", maxDistance: "Дистанция",
};

const number = (value: number, digits = 1) => value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
function formatMetric(metric: ProgressMetricId, value: number): string {
  switch (metric) {
    case "e1rm": case "maxLoad": return `${number(value)} кг`;
    case "volume": return `${number(value, 0)} кг`;
    case "maxReps": case "totalReps": return `${number(value, 0)} повт.`;
    case "maxDuration": return formatDuration(Math.round(value));
    case "maxDistance": return value >= 1000 ? `${number(value / 1000, 2)} км` : `${number(value, 0)} м`;
  }
}
const shortDate = (date: string) => {
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""}`;
};

function setLabel(fact: SetFact, ordinal: number): string {
  const marks = [fact.setType === "FAILURE" ? "отказ" : null, fact.setType === "DROP" ? "дроп-сет" : null,
    fact.rpe === null ? null : `RPE ${number(fact.rpe)}`, fact.confirmed ? null : "не засчитан"].filter((mark) => mark !== null);
  return `${fact.setType === "WARMUP" ? "Р" : ordinal}. ${factText(fact)}${marks.length > 0 ? ` · ${marks.join(" · ")}` : ""}`;
}

function SessionCard({ session, onOpen }: Readonly<{ session: ExerciseSession; onOpen: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { entry } = session;
  const origin = [entry.planDeleted ? `${entry.programTitle} (план удалён)` : entry.archived ? `${entry.programTitle} (архив)` : entry.programTitle,
    entry.mesocycleTitle, `Неделя ${entry.weekIndex}`].filter((part): part is string => part !== null).join(" · ");
  let ordinal = 0;
  return (
    <Pressable accessibilityRole="button" disabled={entry.planDeleted}
      accessibilityLabel={`${dateText(entry.actualDate)}, ${entry.workoutTitle ?? "тренировка"}. Открыть тренировку`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <View style={styles.cardHead}>
        <Text style={[styles.date, { color: colors.accentInk }]}>{dateText(entry.actualDate)}</Text>
        <View style={styles.grow} />
        {entry.planDeleted ? null : <ChevronRight size={18} color={colors.textMuted} />}
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{entry.workoutTitle ?? "Тренировка"}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{origin}</Text>
      <View style={[styles.sets, { borderColor: colors.border }]}>
        {session.facts.map((fact) => {
          if (fact.setType !== "WARMUP") ordinal += 1;
          return <Text key={fact.id} style={[styles.set, { color: fact.confirmed ? colors.textPrimary : colors.textMuted }]}>
            {setLabel(fact, ordinal)}</Text>;
        })}
      </View>
    </Pressable>
  );
}

/**
 * Упражнение глазами клиента (§37, X02): «Обзор» — карточка каталога, «История» — все занятия с упражнением из всех
 * программ клиента, «Прогресс» — графики по профилю учёта и рекорды. Фильтр программы/мезоцикла общий для истории
 * и прогресса, период — только для прогресса (§37.4). Данные — хронология занятий; экран ничего не записывает.
 */
export function ClientExerciseScreen({ clientId, exerciseId, history, exercises, renderOverview, onOpenWorkout, now = new Date() }: Readonly<{
  clientId: string;
  exerciseId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  exercises: ExerciseLookupPort;
  renderOverview: () => ReactNode;
  onOpenWorkout: (target: Readonly<{ programId: string; weekIndex: number; plannedWorkoutId: string }>) => void;
  now?: Date;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const [tab, setTab] = useState<Tab>("history");
  const [entries, setEntries] = useState<readonly TrainingHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<HistoryFilter>({ programId: null, mesocycleId: null });
  const [period, setPeriod] = useState<PeriodValue>({ period: "all", custom: null });
  const [chosen, setChosen] = useState<ProgressMetricId | null>(null);

  useEffect(() => {
    let active = true;
    history.list(clientId).then((next) => { if (active) { setEntries(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, history, version]);
  useEffect(() => history.subscribe(clientId, () => setVersion((value) => value + 1)), [clientId, history]);

  const own = useMemo(() => (entries ?? []).filter((entry) => entry.exercises.some((exercise) => exercise.exerciseId === exerciseId)),
    [entries, exerciseId]);
  const sessions = useMemo(() => exerciseSessions(filterHistory(own, filter), exerciseId), [own, filter, exerciseId]);
  const range = useMemo(() => periodRange(now, period), [now, period]);
  const inPeriod = useMemo(() => sessions.filter((session) => (range.from === null || session.entry.actualDate >= range.from)
    && session.entry.actualDate <= range.to), [sessions, range]);
  const metrics = progressMetrics(lookup?.get(exerciseId)?.metrics ?? []);
  const metric = chosen !== null && metrics.includes(chosen) ? chosen : metrics[0] ?? null;
  const points = useMemo(() => metric === null ? [] : progressSeries(inPeriod, metric), [inPeriod, metric]);
  const records = useMemo(() => metrics.includes("e1rm") ? repRecords(inPeriod) : [], [inPeriod, metrics]);
  const bestE1rm = useMemo(() => {
    const values = inPeriod.map((session) => sessionValue(session, "e1rm")).filter((value): value is number => value !== null);
    return metrics.includes("e1rm") && values.length > 0 ? Math.max(...values) : null;
  }, [inPeriod, metrics]);
  const open = (session: ExerciseSession) => onOpenWorkout({ programId: session.entry.programId, weekIndex: session.entry.weekIndex,
    plannedWorkoutId: session.entry.plannedWorkoutId });

  const tabs = <View style={styles.tabs}>
    <SegmentedControl items={[{ id: "overview", label: "Обзор" }, { id: "history", label: "История" }, { id: "progress", label: "Прогресс" }]}
      selectedId={tab} onSelect={setTab} />
  </View>;
  if (tab === "overview") return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{tabs}{renderOverview()}</View>;
  if (failed) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{tabs}
    <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить историю упражнения.</InlineNotice></View></View>;
  if (entries === null) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{tabs}<LoadingState label="Собираем историю…" /></View>;
  const filters = <HistoryFilterBar entries={own} filter={filter} onChange={setFilter} />;

  if (tab === "history") {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {tabs}
        <FlatList data={sessions as ExerciseSession[]} keyExtractor={(session) => session.entry.key} contentContainerStyle={styles.list}
          ListHeaderComponent={<View style={styles.header}>{filters}
            <Text style={[styles.summary, { color: colors.textSecondary }]}>{`Занятий с упражнением: ${sessions.length}`}</Text></View>}
          ListEmptyComponent={<EmptyState reason="no-data" title="Упражнение ещё не выполнялось"
            body="Здесь появятся занятия с записанными подходами этого упражнения — из всех программ клиента." />}
          renderItem={({ item }) => <SessionCard session={item} onOpen={() => open(item)} />} />
      </View>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const best = points.length === 0 ? null : Math.max(...points.map((point) => point.value));
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {tabs}
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.header}>
          {filters}
          <View style={styles.pills}><PeriodPill value={period} today={range.to} onChange={setPeriod} /></View>
          {metrics.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {metrics.map((item) => <SelectionChip key={item} group="Показатель" label={metricLabels[item]} selected={metric === item}
              onPress={() => setChosen(item)} />)}
          </ScrollView> : null}
        </View>
        {metric === null ? <EmptyState reason="no-data" title="Прогресс не строится"
          body="У этого упражнения нет величин для графика." /> : points.length === 0 ? <EmptyState reason="no-data" title="Нет данных"
          body="За выбранный период нет засчитанных рабочих подходов с этой величиной. Разминка в прогресс не входит." /> : <>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{metricLabels[metric]}</Text>
            <View style={styles.tiles}>
              <View style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>Последнее</Text>
                <Text style={[styles.tileValue, { color: colors.textPrimary }]}>{formatMetric(metric, last!.value)}</Text>
              </View>
              <View style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>Лучшее</Text>
                <Text style={[styles.tileValue, { color: colors.accentInk }]}>{formatMetric(metric, best!)}</Text>
              </View>
              <View style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>Изменение</Text>
                <Text style={[styles.tileValue, { color: colors.textPrimary }]}>{points.length < 2 ? "—"
                  : `${last!.value - first!.value >= 0 ? "+" : "−"}${formatMetric(metric, Math.abs(last!.value - first!.value))}`}</Text>
              </View>
            </View>
            <LineChart points={points.map((point) => ({ key: point.key, label: shortDate(point.date), value: point.value }))}
              format={(value) => formatMetric(metric, value).replace(/ (кг|повт\.|м|км)$/, "")}
              accessibilityLabel={`${metricLabels[metric]}: ${points.length} занятий, последнее ${formatMetric(metric, last!.value)}`} />
            {metric === "e1rm" ? <Text style={[styles.note, { color: colors.textMuted }]}>
              Расчёт по формуле Бжицки для подходов до 12 повторений — не поднятый вес.</Text> : null}
          </View>
          {records.length > 0 ? <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Рекорды по повторениям</Text>
            {records.map((record) => {
              const session = inPeriod.find((item) => item.entry.key === record.sessionKey);
              return <Pressable key={record.reps} accessibilityRole="button" disabled={session === undefined || session.entry.planDeleted}
                accessibilityLabel={`${record.reps} повторений: ${number(record.loadKg)} килограмм, ${dateText(record.date)}. Открыть тренировку`}
                onPress={() => { if (session !== undefined) open(session); }} style={[styles.record, { borderColor: colors.border }]}>
                <Text style={[styles.recordReps, { color: colors.textSecondary }]}>{`${record.reps} ПМ`}</Text>
                <Text style={[styles.recordValue, { color: colors.textPrimary }]}>{`${number(record.loadKg)} кг`}</Text>
                <Text style={[styles.recordDate, { color: colors.textMuted }]}>{dateText(record.date)}</Text>
              </Pressable>;
            })}
            {bestE1rm !== null ? <Text style={[styles.note, { color: colors.textMuted }]}>
              {`Оценка 1ПМ (расчёт): ${number(bestE1rm)} кг${records[0]?.reps === 1 ? "" : " — фактического 1ПМ нет"}`}</Text> : null}
          </View> : null}
        </>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  pad: { paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  header: { gap: 8, paddingTop: 4 },
  chips: { gap: 8, paddingRight: 8 },
  pills: { flexDirection: "row", gap: 8 },
  summary: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  date: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  grow: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  sets: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 6, gap: 2 },
  set: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  tiles: { flexDirection: "row", gap: 8, marginBottom: 6 },
  tile: { flex: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  tileLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  tileValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  record: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth },
  recordReps: { width: 56, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  recordValue: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  recordDate: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
});
