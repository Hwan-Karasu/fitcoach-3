import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react-native";
import { EmptyState, InlineNotice, LineChart, LoadingState, SegmentedControl } from
  "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { MONTHS, dateText, filterHistory, HistoryFilterBar, originText, setLabel, type HistoryFilter, type TrainingHistoryEntry } from
  "../../archive/public.ts";
import { formatDuration, useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import type { SetFact } from "../../execution/public.ts";
import { isWorkingSet } from "./workingSet.ts";
import { periodRange } from "./statsFilters.ts";
import { entriesInRange, rangeFor } from "./trainingStats.ts";
import { PeriodPill, type PeriodValue } from "./PeriodPill.tsx";
import { exerciseSessions, exerciseTree, progressMetrics, progressSeries, repRecords, sessionValue, type ExerciseProgramNode,
  type ExerciseSession, type ExerciseWeekNode, type ProgressMetricId } from "./exerciseProgress.ts";

type Tab = "overview" | "history" | "progress";

const metricLabels: Readonly<Record<ProgressMetricId, string>> = {
  e1rm: "Оценка 1ПМ", maxLoad: "Макс. вес", volume: "Тоннаж", maxReps: "Макс. повторы", totalReps: "Всего повторов",
  maxDuration: "Время", maxDistance: "Дистанция",
};

/** Короткие подписи для переключателя в один ряд; полное название — в заголовке графика. */
const metricTabLabels: Readonly<Record<ProgressMetricId, string>> = {
  e1rm: "Оценка 1ПМ", maxLoad: "Макс. вес", volume: "Тоннаж", maxReps: "Макс. повт.", totalReps: "Всего повт.",
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

function SessionCard({ session, onOpen }: Readonly<{ session: ExerciseSession; onOpen: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { entry } = session;
  const origin = originText(entry);
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


const simpleRow = (fact: SetFact) => fact.sides === null && fact.drops.length === 0 && (fact.values.reps !== null || fact.values.loadGrams !== null);

function SetsTable({ session }: Readonly<{ session: ExerciseSession }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  let ordinal = 0;
  return <View>
    <View style={[styles.tableRow, { borderColor: colors.border }]}>
      {["ПОДХОД", "ПОВТ", "КГ", "RPE"].map((head) => <Text key={head} style={[styles.cell, styles.cellHead, { color: colors.textSecondary }]}>{head}</Text>)}
    </View>
    {session.facts.map((fact) => {
      if (fact.setType !== "WARMUP") ordinal += 1;
      const tone = fact.confirmed ? colors.textPrimary : colors.textMuted;
      if (!simpleRow(fact)) return <Text key={fact.id} style={[styles.set, styles.setWide, { color: tone, borderColor: colors.border }]}>
        {setLabel(fact, ordinal)}</Text>;
      return <View key={fact.id} style={[styles.tableRow, { borderColor: colors.border }]}>
        <Text style={[styles.cell, { color: colors.accentInk, fontFamily: fonts.bold }]}>{fact.setType === "WARMUP" ? "Р" : ordinal}</Text>
        <Text style={[styles.cell, { color: tone }]}>{fact.values.reps ?? "—"}</Text>
        <Text style={[styles.cell, { color: tone }]}>{fact.values.loadGrams === null ? "—" : number(fact.values.loadGrams / 1000)}</Text>
        <Text style={[styles.cell, { color: tone }]}>{fact.rpe === null ? "—" : number(fact.rpe)}</Text>
      </View>;
    })}
  </View>;
}

/** Занятие одной строкой: «Неделя 5 — Тренировка», дата и лучший подход в шапке; раскрытие — объём и таблица подходов. */
function SessionRow({ session, open, onToggle, onOpenWorkout }: Readonly<{ session: ExerciseSession; open: boolean; onToggle: () => void;
  onOpenWorkout: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { entry } = session;
  const Icon = open ? ChevronUp : ChevronDown;
  const title = `Неделя ${entry.weekIndex} — ${entry.workoutTitle ?? "Тренировка"}`;
  const volume = sessionValue(session, "volume");
  const sets = session.facts.filter(isWorkingSet).length;
  return (
    <View style={[styles.sessionBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${dateText(entry.actualDate)}. ${open ? "Свернуть" : "Развернуть"}`}
        onPress={onToggle} style={styles.sessionHead}>
        <View style={styles.sessionTitles}>
          <Text style={[styles.treeLabelBold, { color: colors.textPrimary }]}>{title}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{dateText(entry.actualDate)}</Text>
        </View>
        <Icon size={18} color={colors.textMuted} />
      </Pressable>
      {open ? <View style={styles.sessionBody}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {volume === null ? `Подходов ${sets}` : `Объём ${number(volume, 0)} кг · Подходов ${sets}`}</Text>
        <SetsTable session={session} />
        {entry.planDeleted ? null : <Pressable accessibilityRole="button" accessibilityLabel={`${title}. Открыть тренировку`} onPress={onOpenWorkout}
          style={styles.openLink}>
          <Text style={[styles.openText, { color: colors.accentInk }]}>Открыть тренировку</Text>
          <ChevronRight size={16} color={colors.accentInk} />
        </Pressable>}
      </View> : null}
    </View>
  );
}

/** Дерево «программа → цикл → занятия»: всё внутри одной карточки программы; узлы раскрываются по нажатию, без сдвига вправо. */
function HistoryTree({ programs, onOpen }: Readonly<{ programs: readonly ExerciseProgramNode[]; onOpen: (session: ExerciseSession) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const rows = (list: readonly ExerciseWeekNode[]) => list.flatMap((week) => week.sessions).map((session) => (
    <SessionRow key={session.entry.key} session={session} open={expanded.has(session.entry.key)} onToggle={() => toggle(session.entry.key)}
      onOpenWorkout={() => onOpen(session)} />));
  return <View style={styles.tree}>
    {programs.map((program) => {
      const id = program.programId;
      const open = expanded.has(id);
      const title = program.archived ? `${program.title} (архив)` : program.title;
      const Icon = open ? ChevronUp : ChevronDown;
      return <View key={id} style={[styles.programCard, shadow.card, { backgroundColor: colors.surface }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
          accessibilityLabel={`${title}, занятий ${program.sessionCount}. ${open ? "Свернуть" : "Развернуть"}`} onPress={() => toggle(id)} style={styles.programHead}>
          <Text numberOfLines={2} style={[styles.title, styles.grow, { color: colors.textPrimary }]}>{title}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{program.sessionCount}</Text>
          <Icon size={18} color={colors.textMuted} />
        </Pressable>
        {open ? <View style={styles.programBody}>
          {program.cycles.map((cycle) => {
            const cycleId = `${id}/c${cycle.id}`;
            const cycleOpen = expanded.has(cycleId);
            const CycleIcon = cycleOpen ? ChevronUp : ChevronDown;
            return <View key={cycle.id} style={styles.programBody}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: cycleOpen }}
                accessibilityLabel={`${cycle.title}, занятий ${cycle.sessionCount}. ${cycleOpen ? "Свернуть" : "Развернуть"}`}
                onPress={() => toggle(cycleId)} style={[styles.cycleHead, { backgroundColor: colors.surfaceRaised }]}>
                <Text numberOfLines={1} style={[styles.treeLabelBold, styles.grow, { color: colors.textPrimary }]}>{cycle.title}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{cycle.sessionCount}</Text>
                <CycleIcon size={18} color={colors.textMuted} />
              </Pressable>
              {cycleOpen ? rows(cycle.weeks) : null}
            </View>;
          })}
          {rows(program.weeks)}
        </View> : null}
      </View>;
    })}
  </View>;
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
  const [filter, setFilter] = useState<HistoryFilter>({ programId: null, mesocycleId: null, workoutKey: null });
  const [period, setPeriod] = useState<PeriodValue>({ period: "all", custom: null });
  const [chosen, setChosen] = useState<ProgressMetricId | null>(null);
  /** Точка графика, выбранная касанием; без выбора или после смены фильтров — последняя. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
  const inPeriod = useMemo(() => {
    const allowed = new Set(entriesInRange(sessions.map((session) => session.entry), range).map((entry) => entry.key));
    return sessions.filter((session) => allowed.has(session.entry.key));
  }, [sessions, range]);
  const tree = useMemo(() => exerciseTree(inPeriod), [inPeriod]);
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
  // Период общий для «Истории» и «Прогресса» (UX-контракт истории v1.2): одна область данных на обе вкладки.
  const filters = <HistoryFilterBar entries={own} filter={filter} onChange={setFilter}
    trailing={<PeriodPill grow value={period} today={rangeFor(now, 1).to} onChange={setPeriod} />} />;

  if (tab === "history") {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        {tabs}
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.header}>{filters}
            <Text style={[styles.summary, { color: colors.textSecondary }]}>{`Занятий с упражнением: ${inPeriod.length}`}</Text></View>
          {tree.length === 0 ? <EmptyState reason="no-data" title="Упражнение ещё не выполнялось"
            body="Здесь появятся занятия с записанными подходами этого упражнения — из всех программ клиента." />
            : <HistoryTree programs={tree} onOpen={open} />}
        </ScrollView>
      </View>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const selectedPoint = points.find((point) => point.key === selectedKey) ?? last;
  const selectedSession = selectedPoint === undefined ? undefined : inPeriod.find((session) => session.entry.key === selectedPoint.key);
  const best = points.length === 0 ? null : Math.max(...points.map((point) => point.value));
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {tabs}
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.header}>
          {filters}
          {/* Показатели — один ряд: сегменты по ширине подписи, шрифт ужимается, а не переносится. */}
          {metrics.length > 1 && metric !== null ? <SegmentedControl compact fit items={metrics.map((item) => ({ id: item, label: metricTabLabels[item] }))}
            selectedId={metric} onSelect={setChosen} /> : null}
        </View>
        {metric === null ? <EmptyState reason="no-data" title="Прогресс не строится"
          body="У этого упражнения нет величин для графика." /> : points.length === 0 ? <EmptyState reason="no-data" title="Нет данных"
          body="Для графика нужны засчитанные рабочие подходы с этой величиной и известной датой. Разминка в прогресс не входит." /> : <>
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
            <LineChart points={points.map((point) => ({ key: point.key, label: shortDate(point.date), caption: dateText(point.date), value: point.value }))}
              format={(value) => formatMetric(metric, value).replace(/ (кг|повт\.|м|км)$/, "")}
              formatValue={(value) => formatMetric(metric, value)} title={metricLabels[metric]}
              onSelect={(point) => setSelectedKey(point.key)}
              accessibilityLabel={`${metricLabels[metric]}: ${points.length} занятий, последнее ${formatMetric(metric, last!.value)}`} />
            {metric === "e1rm" ? <Text style={[styles.note, { color: colors.textMuted }]}>
              Расчёт по формуле Бжицки для подходов до 12 повторений — не поднятый вес.</Text> : null}
          </View>
          {selectedPoint !== undefined && selectedSession !== undefined ? <View style={styles.selected}>
            <Text style={[styles.selectedTitle, { color: colors.textPrimary }]}>
              {`${metricLabels[metric]}: ${formatMetric(metric, selectedPoint.value)} · ${dateText(selectedPoint.date)}`}</Text>
            <SessionCard session={selectedSession} onOpen={() => open(selectedSession)} />
          </View> : null}
        </>}
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
  tree: { gap: 10 },
  programCard: { borderRadius: 20, padding: 12, gap: 8 },
  programHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 },
  programBody: { gap: 8 },
  cycleHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 14, paddingHorizontal: 12 },
  sessionBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 },
  sessionHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, paddingHorizontal: 12, paddingVertical: 6 },
  sessionTitles: { flex: 1 },
  sessionBody: { paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 32, alignItems: "center" },
  cell: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, textAlign: "center" },
  cellHead: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  setWide: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  openLink: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", minHeight: 44, gap: 2 },
  openText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  treeLabelBold: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  selected: { gap: 6 },
  selectedTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
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
