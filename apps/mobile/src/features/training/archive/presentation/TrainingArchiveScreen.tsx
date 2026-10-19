import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { EmptyState, InlineNotice, LoadingState, SegmentedControl, SelectionChip, StatusTag, type StatusKind } from
  "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { SetFact, SetValues, WorkoutStatus } from "../../execution/public.ts";
import { formatDuration, useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import { completedCount, filterHistory, type HistoryFilter, type TrainingHistoryEntry } from "./trainingHistory.ts";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dateText = (date: string) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""} ${year}`;
};
const statusLabels: Readonly<Record<WorkoutStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", MISSED: "Пропущена", CANCELLED: "Отменена",
};
const statusKinds: Readonly<Record<WorkoutStatus, StatusKind>> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", COMPLETED: "success", MISSED: "warning", CANCELLED: "warning",
};

/** «80 кг × 8», «1:30», «500 м» — только введённые величины. */
function valuesText(values: SetValues): string {
  const parts = [values.loadGrams === null ? null : `${(values.loadGrams / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} кг`,
    values.reps === null ? null : `${values.reps} повт.`, values.durationSec === null ? null : formatDuration(values.durationSec),
    values.distanceM === null ? null : `${values.distanceM} м`].filter((part): part is string => part !== null);
  return parts.length === 0 ? "—" : parts.join(" × ");
}
function factText(fact: SetFact): string {
  if (fact.sides !== null) return `Л ${valuesText(fact.sides.left.values)} · П ${valuesText(fact.sides.right.values)}`;
  return [fact.values, ...fact.drops].map(valuesText).join(" → ");
}

function HistoryCard({ entry, names }: Readonly<{ entry: TrainingHistoryEntry; names: (exerciseId: string) => string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [open, setOpen] = useState(false);
  const origin = [entry.archived ? `${entry.programTitle} (архив)` : entry.programTitle, entry.mesocycleTitle, `Неделя ${entry.weekIndex}`]
    .filter((part): part is string => part !== null).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={`${dateText(entry.actualDate)}, ${entry.workoutTitle ?? "тренировка"}, ${statusLabels[entry.status]}`}
      onPress={() => setOpen((value) => !value)}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <Text style={[styles.date, { color: colors.accentInk }]}>{dateText(entry.actualDate)}</Text>
        <StatusTag kind={statusKinds[entry.status]} label={statusLabels[entry.status]} />
        <View style={styles.grow} />
        {open ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}
      </View>
      <Text numberOfLines={2} style={[styles.title, { color: entry.workoutTitle === null ? colors.textMuted : colors.textPrimary }]}>
        {entry.workoutTitle ?? "Тренировки больше нет в плане"}</Text>
      <Text numberOfLines={2} style={[styles.meta, { color: colors.textSecondary }]}>{origin}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {`Подходов: ${entry.confirmedSets} · Объём: ${Math.round(entry.volumeKg).toLocaleString("ru-RU")} кг`}</Text>
      {open ? <View style={[styles.details, { borderColor: colors.border }]}>
        {entry.exercises.length === 0 ? <Text style={[styles.meta, { color: colors.textMuted }]}>Подходы не записаны.</Text> : null}
        {entry.exercises.map((exercise, index) => (
          <View key={`${exercise.exerciseId}:${index}`} style={styles.exercise}>
            <Text style={[styles.exerciseName, { color: colors.textPrimary }]}>{names(exercise.exerciseId)}</Text>
            {exercise.facts.map((fact, number) => (
              <Text key={fact.id} style={[styles.set, { color: fact.confirmed ? colors.textPrimary : colors.textMuted }]}>
                {`${fact.extra ? "Р" : number + 1 - exercise.facts.filter((item, at) => at < number && item.extra).length}. ${factText(fact)}`}
              </Text>
            ))}
          </View>
        ))}
      </View> : null}
    </Pressable>
  );
}

/**
 * Архив клиента (§50.1, АР1 = A): «История занятий» — единая хронология фактов дневника из всех программ (§48.85) с
 * фильтрами программа → мезоцикл; «Архив программ» — архивные программы (их подставляет навигация). Отборы не
 * меняют факты; «Проведено» — только завершённые тренировки (§48.51).
 */
export function TrainingArchiveScreen({ clientId, history, exercises, renderPrograms }: Readonly<{
  clientId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  exercises: ExerciseLookupPort;
  renderPrograms: () => ReactNode;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const [tab, setTab] = useState<"history" | "programs">("history");
  const [entries, setEntries] = useState<readonly TrainingHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<HistoryFilter>({ programId: null, mesocycleId: null });

  useEffect(() => {
    let active = true;
    history.list(clientId).then((next) => { if (active) { setEntries(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, history, version]);
  useEffect(() => history.subscribe(clientId, () => setVersion((value) => value + 1)), [clientId, history]);

  const programs = useMemo(() => {
    const seen = new Map<string, TrainingHistoryEntry>();
    for (const entry of entries ?? []) if (!seen.has(entry.programId)) seen.set(entry.programId, entry);
    return [...seen.values()];
  }, [entries]);
  const selectedProgram = programs.find((entry) => entry.programId === filter.programId);
  const mesocycles = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries ?? []) {
      if (entry.programId === filter.programId && entry.mesocycleId !== null) seen.set(entry.mesocycleId, entry.mesocycleTitle ?? "Мезоцикл");
    }
    return [...seen.entries()];
  }, [entries, filter.programId]);
  const visible = useMemo(() => filterHistory(entries ?? [], filter), [entries, filter]);
  const names = (exerciseId: string) => lookup?.get(exerciseId)?.name ?? "Упражнение";

  const tabs = <View style={styles.tabs}>
    <SegmentedControl items={[{ id: "history", label: "История занятий" }, { id: "programs", label: "Архив программ" }]}
      selectedId={tab} onSelect={setTab} />
  </View>;
  if (tab === "programs") return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{tabs}{renderPrograms()}</View>;
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {tabs}
      {failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить историю занятий.</InlineNotice></View> : null}
      {entries === null && !failed ? <LoadingState label="Собираем историю занятий…" /> : null}
      {entries !== null ? <FlatList data={visible as TrainingHistoryEntry[]} keyExtractor={(entry) => entry.key}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<View style={styles.header}>
          {programs.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <SelectionChip group="Программа" label="Все программы" selected={filter.programId === null}
              onPress={() => setFilter({ programId: null, mesocycleId: null })} />
            {programs.map((entry) => <SelectionChip key={entry.programId} group="Программа"
              label={entry.archived ? `${entry.programTitle} (архив)` : entry.programTitle} selected={filter.programId === entry.programId}
              onPress={() => setFilter({ programId: entry.programId, mesocycleId: null })} />)}
          </ScrollView> : null}
          {selectedProgram?.programKind === "PERIODIZED" && mesocycles.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <SelectionChip group="Мезоцикл" label="Все мезоциклы" selected={filter.mesocycleId === null}
                onPress={() => setFilter({ ...filter, mesocycleId: null })} />
              {mesocycles.map(([id, title]) => <SelectionChip key={id} group="Мезоцикл" label={title} selected={filter.mesocycleId === id}
                onPress={() => setFilter({ ...filter, mesocycleId: id })} />)}
            </ScrollView>
          ) : null}
          <Text style={[styles.summary, { color: colors.textSecondary }]}>
            {`Проведено тренировок: ${completedCount(visible)} · записей: ${visible.length}`}</Text>
        </View>}
        ListEmptyComponent={<EmptyState reason="no-data" title="Занятий пока нет"
          body="Здесь появятся тренировки, в которые записаны подходы или исход — из всех программ клиента." />}
        renderItem={({ item }) => <HistoryCard entry={item} names={names} />} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  pad: { paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  header: { gap: 8, paddingTop: 4 },
  chips: { gap: 8, paddingRight: 8 },
  summary: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  date: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  grow: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  details: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6, paddingTop: 8, gap: 8 },
  exercise: { gap: 2 },
  exerciseName: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  set: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
