import { useMemo, type ReactNode } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, X } from "lucide-react-native";
import { StatusTag, type StatusKind } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { MONTHS, dateText, factText, type TrainingHistoryEntry } from "../../archive/public.ts";
import type { WorkoutStatus } from "../../execution/public.ts";
import type { ExerciseInfo } from "../../plans/public.ts";
import { factTonnage, isWorkingSet, type BodyOf, type PlanCompletion, type Scale } from "./trainingStats.ts";

export const number = (value: number, digits = 0) => value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
export const kg = (value: number) => `${number(value)} кг`;

/** Подпись столбца: день/неделя — «5 окт», месяц — «окт 2026». */
export function bucketLabel(key: string, scale: Scale): string {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number | undefined];
  return scale === "month" ? `${MONTHS[month - 1] ?? ""} ${year}` : `${day} ${MONTHS[month - 1] ?? ""}`;
}
export const scaleCaption: Readonly<Record<Scale, string>> = { day: "по дням", week: "по неделям", month: "по месяцам" };
export const statusLabels: Readonly<Record<WorkoutStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", MISSED: "Пропущена", CANCELLED: "Отменена",
};
const statusKinds: Readonly<Record<WorkoutStatus, StatusKind>> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", COMPLETED: "success", MISSED: "warning", CANCELLED: "warning",
};

export function SummaryCard({ label, value, caption, warning, onPress }: Readonly<{
  label: string; value: string; caption?: string; warning?: boolean; onPress?: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole={onPress === undefined ? undefined : "button"} disabled={onPress === undefined}
      accessibilityLabel={`${label}: ${value}${caption === undefined ? "" : `. ${caption}`}${onPress === undefined ? "" : ". Показать источники"}`}
      onPress={onPress} style={({ pressed }) => [styles.summary, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.summaryValue, { color: colors.textPrimary }]}>{value}</Text>
      {caption === undefined ? null : <Text style={[styles.caption, { color: warning === true ? colors.warning : colors.textMuted }]}>{caption}</Text>}
    </Pressable>
  );
}

export function ChartCard({ title, note, children }: Readonly<{ title: string; note?: string; children: ReactNode }>) {
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

/** §48.86.9: «10 из 12 · 83%» по выбранной программе или мезоциклу; без плановых тренировок процента нет. */
export function PlanCompletionCard({ completion }: Readonly<{ completion: PlanCompletion }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const percent = completion.pct === null ? null : Math.min(completion.pct, 100);
  return (
    <View accessible accessibilityLabel={completion.pct === null ? "Выполнение плана: нет данных"
      : `Выполнение плана: ${completion.done} из ${completion.planned}, ${number(completion.pct)} процентов`} style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text accessibilityRole="header" style={[styles.cardTitle, { color: colors.textPrimary }]}>Выполнение плана</Text>
      <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>
        {completion.pct === null ? "Нет данных" : `${completion.done} из ${completion.planned} · ${number(completion.pct)}%`}</Text>
      {percent === null ? null : <View style={[styles.planTrack, { backgroundColor: colors.surfaceRaised }]}>
        <View style={[styles.planFill, { backgroundColor: colors.accentInk, width: `${Math.max(percent, 1)}%` }]} />
      </View>}
      <Text style={[styles.caption, { color: colors.textMuted }]}>
        {`Завершённые плановые тренировки всей выбранной программы или мезоцикла; период не учитывается. Пропущено: ${completion.missed} · отменено: ${completion.cancelled}`}</Text>
    </View>
  );
}

/** Что раскрывает окно: исходы занятий, конкретные подходы или подходы с пометкой, что вошло в тоннаж (§48.86.19 п. 3). */
export type DrillMode = "workouts" | "sets" | "tonnage";

export interface DrillTarget {
  readonly title: string;
  readonly mode: DrillMode;
  readonly entries: readonly TrainingHistoryEntry[];
}

function DrillEntry({ entry, mode, infoOf, nameOf, bodyOf, onOpenWorkout }: Readonly<{
  entry: TrainingHistoryEntry; mode: DrillMode; infoOf: (id: string) => ExerciseInfo | undefined; nameOf: (id: string) => string; bodyOf: BodyOf;
  onOpenWorkout: (entry: TrainingHistoryEntry) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const body = mode === "tonnage" ? bodyOf(entry.actualDate) : null;
  const origin = [entry.planDeleted ? `${entry.programTitle} (план удалён)` : entry.archived ? `${entry.programTitle} (архив)` : entry.programTitle,
    entry.mesocycleTitle, `Неделя ${entry.weekIndex}`].filter((part): part is string => part !== null).join(" · ");
  return (
    <Pressable accessibilityRole="button" disabled={entry.planDeleted}
      accessibilityLabel={`${dateText(entry.actualDate)}, ${entry.workoutTitle ?? "тренировка"}, ${statusLabels[entry.status]}. Открыть тренировку`}
      onPress={() => onOpenWorkout(entry)}
      style={({ pressed }) => [styles.drill, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface, borderColor: colors.border }]}>
      <View style={styles.drillHead}>
        <Text style={[styles.drillDate, { color: colors.accentInk }]}>{dateText(entry.actualDate)}</Text>
        <StatusTag kind={statusKinds[entry.status]} label={statusLabels[entry.status]} />
        <View style={styles.grow} />
        {entry.planDeleted ? null : <ChevronRight size={18} color={colors.textMuted} />}
      </View>
      <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{entry.workoutTitle ?? "Тренировка"}</Text>
      <Text style={[styles.caption, { color: colors.textSecondary }]}>{origin}</Text>
      {mode === "workouts" ? null : entry.exercises.map((exercise, index) => {
        const facts = exercise.facts.filter(isWorkingSet);
        if (facts.length === 0) return null;
        return (
          <View key={`${exercise.exerciseId}:${index}`} style={styles.drillExercise}>
            <Text style={[styles.exerciseName, { color: colors.textPrimary }]}>{nameOf(exercise.exerciseId)}</Text>
            {facts.map((fact, number) => {
              // «Не вошёл в тоннаж» — подход без вычислимого значения (нет веса/повторов/массы тела), а не нулевой.
              const info = infoOf(exercise.exerciseId);
              const missing = mode === "tonnage" && factTonnage(fact, info, body)?.kg === null;
              // Дата использованного замера показывается, чтобы было видно, насколько он старый (§48.86.36 п. 2).
              const usesBody = body !== null && (info?.metrics.includes("addedLoad") === true || info?.metrics.includes("assistance") === true);
              return <Text key={fact.id} style={[styles.set, { color: missing ? colors.warning : colors.textPrimary }]}>
                {`${number + 1}. ${factText(fact)}${usesBody ? ` · масса тела ${body.kg.toLocaleString("ru-RU")} кг (замер ${dateText(body.date)})` : ""}${missing ? " — не вошёл в тоннаж" : ""}`}</Text>;
            })}
          </View>
        );
      })}
    </Pressable>
  );
}

/**
 * Детализация показателя (§48.86.19): ровно те занятия и подходы, из которых сложено значение. Окно лежит поверх
 * экрана, поэтому закрытие возвращает к тем же фильтрам и положению; данные не меняются и таймеры не запускаются.
 */
export function DrillDownModal({ target, infoOf, nameOf, bodyOf, onClose, onOpenWorkout }: Readonly<{
  target: DrillTarget | null; infoOf: (id: string) => ExerciseInfo | undefined; nameOf: (id: string) => string; bodyOf: BodyOf;
  onClose: () => void; onOpenWorkout: (entry: TrainingHistoryEntry) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const entries = useMemo(() => [...(target?.entries ?? [])].sort((a, b) => b.actualDate.localeCompare(a.actualDate) || a.key.localeCompare(b.key)),
    [target]);
  return (
    <Modal visible={target !== null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.canvas }]}>
        <View style={styles.modalHead}>
          <Text accessibilityRole="header" numberOfLines={2} style={[styles.modalTitle, { color: colors.textPrimary }]}>{target?.title ?? ""}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" hitSlop={8} onPress={onClose} style={styles.close}>
            <X size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        <FlatList data={entries as TrainingHistoryEntry[]} keyExtractor={(entry) => entry.key} contentContainerStyle={styles.drillList}
          ListHeaderComponent={<Text style={[styles.caption, { color: colors.textSecondary }]}>{`Занятий: ${entries.length}`}</Text>}
          renderItem={({ item }) => target === null ? null : <DrillEntry entry={item} mode={target.mode} infoOf={infoOf} nameOf={nameOf} bodyOf={bodyOf}
            onOpenWorkout={onOpenWorkout} />} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  summary: { ...shadow.card, flexBasis: "47%", flexGrow: 1, borderRadius: 20, padding: 14, gap: 2, minHeight: 92 },
  summaryLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  summaryValue: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 8 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  rowLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  grow: { flex: 1 },
  planTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  planFill: { height: 8, borderRadius: 4 },
  modal: { flex: 1, paddingTop: 48 },
  modalHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  modalTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  drillList: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  drill: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  drillHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  drillDate: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  drillExercise: { gap: 2, marginTop: 4 },
  exerciseName: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  set: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
