import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { AppButton, EmptyState, InlineNotice, LoadingState, StatusTag } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import { dateText, originText, setLabel, statusKinds, statusLabels } from "./historyFormat.ts";
import { durationText, timeText } from "../../../../shared/format/clockText.ts";
import type { TrainingHistoryEntry } from "./trainingHistory.ts";
import { useClientHistory } from "./useClientHistory.ts";

/** Время занятия: «Начало 10:30 · Окончание 11:35 · Длительность 1 ч 05 мин»; отметок нет — «Время не указано» (значения не выдумываются). */
function timeLine(entry: TrainingHistoryEntry): string {
  if (entry.startedAt === null && entry.finishedAt === null) return "Время не указано";
  const parts = [entry.startedAt === null ? null : `Начало ${timeText(entry.startedAt)}`, entry.finishedAt === null ? null : `Окончание ${timeText(entry.finishedAt)}`,
    entry.durationSec === null ? "Длительность: нет данных" : `Длительность ${durationText(entry.durationSec)}`];
  return parts.filter((part) => part !== null).join(" · ");
}

/**
 * «Детали выполнения» (UX-контракт v1.2): тренировка в истории только для просмотра — подходы, значения, стороны, RPE, заметки, время.
 * Открытие не создаёт выполнение и не меняет выбранный план. «Открыть в дневнике» — только если у занятия есть слот плана.
 */
export function ExecutionDetailsScreen({ clientId, sessionKey, history, exercises, onOpenInDiary, onOpenExercise }: Readonly<{
  clientId: string;
  sessionKey: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  /** Справочник тренировок: названия, включая архивные свои упражнения. */
  exercises: ExerciseLookupPort;
  onOpenInDiary: (entry: TrainingHistoryEntry) => void;
  onOpenExercise: (exerciseId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const names = (exerciseId: string) => {
    const info = lookup?.get(exerciseId);
    return `${info?.name ?? "Упражнение"}${info?.archived === true ? " (архив)" : ""}`;
  };
  const { entries, failed } = useClientHistory(history, clientId);
  const entry = useMemo(() => entries?.find((item) => item.key === sessionKey), [entries, sessionKey]);
  if (failed) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}><View style={styles.pad}>
    <InlineNotice kind="error">Не удалось загрузить занятие.</InlineNotice></View></View>;
  if (entries === null) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем занятие…" /></View>;
  if (entry === undefined) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
    <EmptyState reason="no-data" title="Занятие не найдено" body="Возможно, результаты этой тренировки удалены." /></View>;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.head}>
          <Text style={[styles.date, { color: colors.accentInk }]}>{dateText(entry.actualDate)}</Text>
          <StatusTag kind={statusKinds[entry.status]} label={statusLabels[entry.status]} />
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{entry.workoutTitle ?? (entry.planDeleted ? "Тренировка" : "Тренировки больше нет в плане")}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{originText(entry)}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{timeLine(entry)}</Text>
        {entry.planDeleted
          ? <Text style={[styles.meta, { color: colors.textMuted }]}>Исходный план удалён — занятие доступно только для просмотра.</Text>
          : entry.workoutTitle === null
            ? <Text style={[styles.meta, { color: colors.textMuted }]}>Тренировки больше нет в плане — занятие доступно только для просмотра.</Text>
            : <AppButton variant="secondary" label="Открыть в дневнике" onPress={() => onOpenInDiary(entry)} />}
      </View>
      {entry.exercises.length === 0 ? <Text style={[styles.meta, { color: colors.textMuted }]}>Подходы не записаны.</Text> : null}
      {entry.exercises.map((exercise, index) => {
        let ordinal = 0;
        return (
          <View key={`${exercise.exerciseId}:${index}`} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${names(exercise.exerciseId)}. История и прогресс упражнения`}
              onPress={() => onOpenExercise(exercise.exerciseId)} style={styles.exerciseHead}>
              <Text style={[styles.exerciseName, { color: colors.textPrimary }]}>{names(exercise.exerciseId)}</Text>
              <ChevronRight size={18} color={colors.accentInk} strokeWidth={2.2} />
            </Pressable>
            {exercise.facts.map((fact) => {
              if (fact.setType !== "WARMUP") ordinal += 1;
              return <Text key={fact.id} style={[styles.set, { color: fact.confirmed ? colors.textPrimary : colors.textMuted }]}>{setLabel(fact, ordinal)}</Text>;
            })}
            {exercise.note !== null ? <Text style={[styles.note, { color: colors.textSecondary, borderColor: colors.border }]}>{`Заметка: ${exercise.note}`}</Text> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  date: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  exerciseHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 48 },
  exerciseName: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  set: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, marginTop: 4 },
});
