import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { BarChart, EmptyState, InlineNotice, LoadingState, type BarChartItem } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { filterHistory, HistoryFilterBar, type HistoryFilter, useClientHistory, type TrainingHistoryEntry } from "../../archive/public.ts";
import type { WorkoutSlot } from "../../execution/public.ts";
import { useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import { useBodyOf } from "./useBodyOf.ts";
import { attentionNotes, bestResult, loadSetsOf, monthPhrase, trainingEntriesMissed } from "./monthInsights.ts";
import { ChartCard, DrillDownModal, bucketLabel, kg, number, scaleCaption, type DrillTarget } from "./statsParts.tsx";
import { readStatsFilters, writeStatsFilters } from "./statsFilters.ts";
import { bucketKeyOf, buckets, compareMonths, delta, entriesInRange, entryTonnage, isWorkingSet, monthOf, muscleGroups, sanitizeFilter, summarize,
  trimToGroup, type BodyweightSource, type Delta, type MonthRef } from "./trainingStats.ts";

const NOMINATIVE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const todayOf = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const spanText = (from: string, to: string) => `${Number(from.slice(8, 10))}–${Number(to.slice(8, 10))} ${GENITIVE[Number(to.slice(5, 7)) - 1] ?? ""}`;

/** Разница с предыдущим: «+2 (+25%)», процент — только при ненулевой базе; нельзя сравнить — «—» (§48.86.14). */
function deltaText(value: Delta, format: (amount: number) => string): string {
  if (value.abs === null) return "—";
  const sign = value.abs > 0 ? "+" : value.abs < 0 ? "−" : "";
  const percent = value.pct === null ? "" : ` (${value.pct > 0 ? "+" : value.pct < 0 ? "−" : ""}${number(Math.abs(value.pct))}%)`;
  return `${sign}${format(Math.abs(value.abs))}${percent}`;
}

/** Карточка сравнения «месяц против прошлого»: значение, «было» и разница. */
function CompareCard({ label, now, before, change }: Readonly<{ label: string; now: string; before: string; change: string }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <View accessible accessibilityLabel={`${label}: сейчас ${now}, раньше ${before}, разница ${change}`} style={[styles.compareCard, { backgroundColor: colors.surface }]}>
      <Text numberOfLines={1} style={[styles.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.compareValue, { color: colors.textPrimary }]}>{now}</Text>
      <Text numberOfLines={2} style={[styles.caption, { color: colors.textMuted }]}>{`было ${before}`}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.rowValue, { color: colors.accentInk }]}>{change}</Text>
    </View>
  );
}

/**
 * «Итоги месяца» клиента (UIX-11, UI-OWN-079; §48.86.11, .14, .18, .20, .21, .28) (§48.86.11, .14, .18, .20, .21, .28): фраза-вывод, три карточки «месяц против прошлого», лучший результат и «на что обратить внимание»; ниже — подробные графики.
 * Выбранный календарный месяц с переходом к любому прошлому, сравнение с предыдущим календарным месяцем (неполный месяц — с такой же по длине частью), те же
 * определения и фильтры, что в общей статистике. Считается по актуальным фактам, снимок не сохраняется.
 */
export function MonthlyReportScreen({ clientId, history, bodyweight, exercises, onOpenWorkout, now = new Date() }: Readonly<{
  clientId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  bodyweight: BodyweightSource;
  exercises: ExerciseLookupPort;
  onOpenWorkout: (slot: WorkoutSlot) => void;
  now?: Date;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const today = todayOf(now);
  const thisMonth = monthOf(today);
  const { entries, failed } = useClientHistory(history, clientId);
  const [stored, setStored] = useState(() => readStatsFilters(clientId));
  const [month, setMonth] = useState<MonthRef>(thisMonth);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const bodyOf = useBodyOf(bodyweight, clientId);


  const all = useMemo(() => entries ?? [], [entries]);
  const filter = useMemo(() => sanitizeFilter(all, stored.filter), [all, stored.filter]);
  const infoOf = useMemo(() => (exerciseId: string) => lookup?.get(exerciseId), [lookup]);
  const nameOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.name ?? "Упражнение", [lookup]);
  const comparison = useMemo(() => compareMonths(month, today), [month, today]);
  const scopedAll = useMemo(() => filterHistory(all, filter), [all, filter]);
  const current = useMemo(() => entriesInRange(scopedAll, comparison.current), [scopedAll, comparison]);
  const previous = useMemo(() => entriesInRange(scopedAll, comparison.previous), [scopedAll, comparison]);
  const now1 = useMemo(() => summarize(current, infoOf, bodyOf), [current, infoOf, bodyOf]);
  const before = useMemo(() => summarize(previous, infoOf, bodyOf), [previous, infoOf, bodyOf]);
  const workoutsChart = useMemo(() => buckets(current, comparison.current, (entry) => entry.status === "COMPLETED" ? 1 : 0, 0), [current, comparison]);
  const setsChart = useMemo(() => buckets(current, comparison.current, (entry) => entry.exercises.reduce(
    (sum, exercise) => sum + exercise.facts.filter(isWorkingSet).length, 0), 0), [current, comparison]);
  const tonnageChart = useMemo(() => buckets(current, comparison.current, (entry) => entryTonnage(entry, infoOf, bodyOf).kg, null), [current, comparison, infoOf, bodyOf]);
  const groups = useMemo(() => muscleGroups(current, infoOf), [current, infoOf]);
  const best = useMemo(() => bestResult(loadSetsOf(current, infoOf), loadSetsOf(previous, infoOf)), [current, previous, infoOf]);

  const items = (result: ReturnType<typeof buckets>): readonly BarChartItem[] =>
    result.items.map((item) => ({ key: item.key, label: bucketLabel(item.key, result.scale), value: item.value }));
  const drillBucket = (result: ReturnType<typeof buckets>, title: string, mode: DrillTarget["mode"], only?: (entry: TrainingHistoryEntry) => boolean) =>
    (item: BarChartItem) => setDrill({ title: `${title} · ${bucketLabel(item.key, result.scale)}`, mode,
      entries: current.filter((entry) => bucketKeyOf(entry.actualDate, result.scale) === item.key && (only?.(entry) ?? true)) });
  const changeFilter = (next: HistoryFilter) => setStored((value) => { const merged = { ...value, filter: next }; writeStatsFilters(clientId, merged); return merged; });
  const step = (direction: -1 | 1) => setMonth(({ year, month: value }) => {
    const index = year * 12 + (value - 1) + direction;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  });
  const atCurrent = month.year * 12 + month.month >= thisMonth.year * 12 + thisMonth.month;

  if (failed) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
    <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить итоги месяца.</InlineNotice></View></View>;
  if (entries === null) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}><LoadingState label="Считаем итоги месяца…" /></View>;

  const tonnageReliable = now1.incompleteSets === 0 && before.incompleteSets === 0;
  const rows: readonly Readonly<{ label: string; now: string; before: string; change: string }>[] = [
    { label: "Проведено", now: number(now1.completed), before: number(before.completed), change: deltaText(delta(now1.completed, before.completed), number) },
    { label: "Рабочих подходов", now: number(now1.workingSets), before: number(before.workingSets), change: deltaText(delta(now1.workingSets, before.workingSets), number) },
    { label: "Тоннаж", now: now1.tonnageKg === null ? "Нет данных" : kg(now1.tonnageKg), before: before.tonnageKg === null ? "Нет данных" : kg(before.tonnageKg),
      change: deltaText(delta(now1.tonnageKg, before.tonnageKg, tonnageReliable), kg) },
  ];
  const max = Math.max(1, ...groups.map((group) => group.sets));
  const notes = attentionNotes({ missed: trainingEntriesMissed(current), incompleteSets: now1.incompleteSets, completed: now1.completed, previousCompleted: before.completed, partial: comparison.partial });
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.monthRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Предыдущий месяц" onPress={() => step(-1)} style={styles.arrow}>
            <ChevronLeft size={24} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.grow}>
            <Text accessibilityRole="header" style={[styles.monthTitle, { color: colors.textPrimary }]}>{`${NOMINATIVE[month.month - 1]} ${month.year}`}</Text>
            <Text style={[styles.caption, { color: colors.textSecondary }]}>
              {comparison.partial ? `${spanText(comparison.current.from, comparison.current.to)} · месяц ещё не закончился` : "весь месяц"}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Следующий месяц" disabled={atCurrent} onPress={() => step(1)}
            style={[styles.arrow, { opacity: atCurrent ? 0.35 : 1 }]}>
            <ChevronRight size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
        <HistoryFilterBar entries={all} filter={filter} onChange={changeFilter} />

        {current.length === 0 ? <EmptyState reason="no-data" title="В этом месяце занятий нет"
          body="Здесь появятся тренировки с записанными подходами или исходом за выбранный месяц и программу." /> : <>
          <View style={[styles.phraseCard, { backgroundColor: colors.accentSoft }]}>
            <Text accessibilityRole="header" style={[styles.phrase, { color: colors.accentInk }]}>{monthPhrase({ month: month.month, previousMonth: monthOf(comparison.previous.from).month, completed: now1.completed, previousCompleted: before.completed, partial: comparison.partial })}</Text>
          </View>
          <View style={styles.compareRowCards}>
            {rows.map((row) => <CompareCard key={row.label} label={row.label} now={row.now} before={row.before} change={row.change} />)}
          </View>
          {!tonnageReliable && now1.tonnageKg !== null && before.tonnageKg !== null ? <Text style={[styles.caption, { color: colors.textMuted }]}>Тоннаж без разницы: в одном из месяцев неполные данные.</Text> : null}
          <ChartCard title="Лучший результат">
            {best === null ? <Text style={[styles.empty, { color: colors.textSecondary }]}>В этом месяце нет рабочих подходов с весом и повторами.</Text> : (
              <View accessible accessibilityLabel={`${nameOf(best.exerciseId)}: ${number(best.loadKg, 1)} килограмм на ${best.reps} повторений`}>
                <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{nameOf(best.exerciseId)}</Text>
                <Text style={[styles.compareValue, { color: colors.textPrimary }]}>{`${number(best.loadKg, 1)} кг × ${best.reps}`}</Text>
                <Text style={[styles.caption, { color: colors.textSecondary }]}>{best.previousLoadKg === null ? "В прошлом месяце это упражнение не выполнялось с весом."
                  : best.loadKg === best.previousLoadKg ? "Столько же, сколько в прошлом месяце."
                    : `${best.loadKg > best.previousLoadKg ? "+" : "−"}${number(Math.abs(best.loadKg - best.previousLoadKg), 1)} кг к прошлому месяцу (было ${number(best.previousLoadKg, 1)} кг)`}</Text>
              </View>
            )}
          </ChartCard>
          <ChartCard title="На что обратить внимание">
            {notes.length === 0 ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Замечаний нет.</Text>
              : notes.map((note) => <Text key={note} style={[styles.empty, { color: colors.textPrimary }]}>{note}</Text>)}
          </ChartCard>
          <ChartCard title="Проведённые тренировки" note={`Завершённые, ${scaleCaption[workoutsChart.scale]}. Нажмите на столбец — покажем занятия.`}>
            <BarChart items={items(workoutsChart)} format={(value) => number(value)}
              onPressItem={drillBucket(workoutsChart, "Проведённые тренировки", "workouts", (entry) => entry.status === "COMPLETED")}
              accessibilityLabel={`Проведённые тренировки ${scaleCaption[workoutsChart.scale]}: всего ${now1.completed}`} />
          </ChartCard>
          <ChartCard title="Рабочие подходы" note={`Подтверждённые, без разминки, ${scaleCaption[setsChart.scale]}.`}>
            <BarChart items={items(setsChart)} format={(value) => number(value)} onPressItem={drillBucket(setsChart, "Рабочие подходы", "sets")}
              accessibilityLabel={`Рабочие подходы ${scaleCaption[setsChart.scale]}: всего ${now1.workingSets}`} />
          </ChartCard>
          <ChartCard title="Тоннаж" note={now1.incompleteSets > 0 ? `Неполные данные: ${now1.incompleteSets} подх. не учтены — нет веса, повторов или массы тела` : undefined}>
            {now1.tonnageKg === null ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Нет данных для расчёта тоннажа.</Text>
              : <BarChart items={items(tonnageChart)} format={kg} onPressItem={drillBucket(tonnageChart, "Тоннаж", "tonnage")}
                accessibilityLabel={`Тоннаж ${scaleCaption[tonnageChart.scale]}: всего ${kg(now1.tonnageKg)}`} />}
          </ChartCard>
          <ChartCard title="Подходы по мышечным группам" note="Рабочие подходы по категории упражнения. Нажмите на группу — покажем упражнения.">
            {groups.map((group) => (
              <Pressable key={group.id} accessibilityRole="button" accessibilityLabel={`${group.label}: ${group.sets} подходов. Показать упражнения`}
                onPress={() => setDrill({ title: group.label, mode: "sets", entries: trimToGroup(current, infoOf, group.id) })} style={styles.groupRow}>
                <View style={styles.compareRow}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{group.label}</Text>
                  <Text style={[styles.rowValue, { color: colors.textPrimary }]}>{number(group.sets)}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: colors.surfaceRaised }]}>
                  <View style={[styles.fill, { backgroundColor: colors.accentInk, width: `${Math.max(group.sets / max * 100, 2)}%` }]} />
                </View>
              </Pressable>
            ))}
          </ChartCard>
        </>}
      </ScrollView>
      <DrillDownModal target={drill} infoOf={infoOf} nameOf={nameOf} bodyOf={bodyOf} onClose={() => setDrill(null)}
        onOpenWorkout={(entry) => { setDrill(null); onOpenWorkout({ clientId, programId: entry.programId, weekIndex: entry.weekIndex, plannedWorkoutId: entry.plannedWorkoutId }); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  phraseCard: { borderRadius: 26, padding: 16 },
  phrase: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  compareRowCards: { flexDirection: "row", gap: 8 },
  compareCard: { flex: 1, minWidth: 0, borderRadius: 22, padding: 12, gap: 2 },
  compareValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, fontVariant: ["tabular-nums"] },
  arrow: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  monthTitle: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  grow: { flex: 1 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  compareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 40 },
  values: { alignItems: "flex-end", flexShrink: 1 },
  rowLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  rowValue: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  groupRow: { gap: 4, minHeight: 48, justifyContent: "center" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
});
