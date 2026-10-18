import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type Animated from "react-native-reanimated";
import type { AnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ChevronRight, Dumbbell, GripVertical, Plus, Timer, Trash2 } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, DurationWheelPicker, TextField } from
  "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseInfo } from "../domain/ExerciseLookupPort.ts";
import { addSet, addWorkout, fillSets, removeExercise, removeSet, removeWorkout, renameWorkout, reorderExercises, setInstruction,
  setRest, setSetCount, SETS_MAX, updateSet } from "../domain/SimplePlanEdits.ts";
import { REST_DEFAULT_SEC, REST_MAX_SEC, REST_MIN_SEC, type PlannedExercise, type SimpleProgramDraft } from
  "../domain/SimplePlanModel.ts";
import { formatDuration, parseDuration, parseLoad, setFieldsOf, type PlanIssue, type SetField } from "../domain/SimplePlanRules.ts";
import { SetsEditorSheet } from "./SetsEditorSheet.tsx";

let counter = 0;
/** Новый стабильный ID строки структуры (тренировка, упражнение, подход). */
export function newPlanId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}:${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const fieldLabels: Readonly<Record<SetField, string>> = { reps: "Повторы", loadGrams: "Вес, кг", durationSec: "Время", distanceM: "Метры" };

function rawOf(field: SetField, value: number): string {
  if (field === "loadGrams") return String(value / 1000).replace(".", ",");
  if (field === "durationSec") return formatDuration(value);
  return String(value);
}

function parseField(field: SetField | "count", text: string): number | null | "invalid" {
  if (field === "loadGrams") return parseLoad(text);
  if (field === "durationSec") return parseDuration(text);
  const value = text.trim();
  if (value === "") return null;
  return /^\d+$/.test(value) ? Number(value) : "invalid";
}

/**
 * Поле карточки упражнения (как в 2.0): правится на месте, без открытия окна. Свой текст ввода, пока поле
 * в фокусе; снаружи — общее значение подходов («разные», если подходы отличаются).
 */
function InlineField({ label, value, placeholder, field, onCommit }: Readonly<{
  label: string; value: string; placeholder: string; field: SetField | "count";
  onCommit: (value: number | null) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setText(value); setInvalid(false); } }, [value]);
  return (
    <View style={styles.field}>
      <Text numberOfLines={1} style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput value={text} placeholder={placeholder} placeholderTextColor={colors.textMuted} selectTextOnFocus
        accessibilityLabel={label}
        keyboardType={field === "durationSec" ? "numbers-and-punctuation" : field === "loadGrams" ? "decimal-pad" : "number-pad"}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(value); setInvalid(false); }}
        onChangeText={(next) => {
          setText(next);
          const parsed = parseField(field, next);
          setInvalid(parsed === "invalid");
          if (parsed !== "invalid" && !(field === "count" && parsed === null)) onCommit(parsed);
        }}
        style={[styles.fieldInput, { color: colors.textPrimary, backgroundColor: colors.input,
          borderColor: invalid ? colors.danger : colors.border }]} />
    </View>
  );
}

/** Общее значение поля у всех подходов упражнения; разные — пусто с подсказкой «разные». */
function sharedValue(exercise: PlannedExercise, field: SetField): Readonly<{ text: string; placeholder: string }> {
  const values = exercise.sets.map((set) => set[field]);
  const first = values[0] ?? null;
  if (values.every((value) => value === first)) return { text: first === null ? "" : rawOf(field, first), placeholder: "—" };
  return { text: "", placeholder: "разные" };
}

/**
 * Редактор тренировок одной недели: общий для Простого и Расширенного конструкторов. В карточке упражнения
 * на виду «Подходов», плановые значения по профилю и отдых; каждый подход отдельно — в окне по нажатию
 * на название (§48.79).
 */
export function WorkoutsEditor({ draft, change, lookup, issues, showIssues, scrollRef, onPickExercise }: Readonly<{
  draft: SimpleProgramDraft;
  change: (next: SimpleProgramDraft) => void;
  lookup: ReadonlyMap<string, ExerciseInfo>;
  issues: readonly PlanIssue[];
  showIssues: boolean;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  onPickExercise: (workoutId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [restFor, setRestFor] = useState<PlannedExercise | null>(null);
  const sheet = useRef<BottomSheetModal>(null);
  const editingExercise = useMemo(() => draft.plan.workouts.flatMap((workout) => workout.exercises)
    .find((exercise) => exercise.id === editing) ?? null, [draft, editing]);

  const exerciseRow = ({ item }: Readonly<{ item: PlannedExercise }>) => {
    const info = lookup.get(item.exerciseId) ?? null;
    const fields = info === null ? [] : setFieldsOf(info.metrics);
    const broken = showIssues && issues.some((issue) => issue.exerciseId === item.id);
    return (
      <View style={[styles.exerciseRow, { borderTopColor: colors.border }]}>
        <Sortable.Handle>
          <View accessible accessibilityLabel={`Перетащить: ${info?.name ?? "упражнение"}`} style={styles.handle}>
            <GripVertical size={18} color={colors.textMuted} strokeWidth={1.8} />
          </View>
        </Sortable.Handle>
        <View style={styles.grow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${info?.name ?? "Упражнение"}. Подходы по отдельности, указание`}
            onPress={() => { setEditing(item.id); sheet.current?.present(); }}
            style={({ pressed }) => [styles.exercisePress, { backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
            <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
              {info?.thumbnail != null ? <Image source={info.thumbnail} style={styles.thumbImage} />
                : <Dumbbell size={16} color={colors.accentInk} strokeWidth={1.8} />}
            </View>
            <Text numberOfLines={2} style={[styles.exerciseName, styles.grow, { color: broken ? colors.danger : colors.textPrimary }]}>
              {info?.name ?? "Упражнение не найдено в каталоге"}
            </Text>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.8} />
          </Pressable>
          <View style={styles.fields}>
            <InlineField label="Подходов" field="count" value={String(item.sets.length)} placeholder="3"
              onCommit={(count) => { if (count !== null) change(setSetCount(draft, item.id, count, () => newPlanId("s"))); }} />
            {fields.map((field) => {
              const shared = sharedValue(item, field);
              return <InlineField key={field} label={fieldLabels[field]} field={field} value={shared.text} placeholder={shared.placeholder}
                onCommit={(value) => change(fillSets(draft, item.id, field, value))} />;
            })}
            <Pressable accessibilityRole="button" hitSlop={6}
              accessibilityLabel={item.restSec === null ? "Таймер отдыха выключен. Изменить" : `Отдых ${formatDuration(item.restSec)}. Изменить`}
              onPress={() => setRestFor(item)} style={styles.rest}>
              <Text numberOfLines={1} style={[styles.fieldLabel, { color: colors.textMuted }]}>Отдых</Text>
              <View style={[styles.restValue, { borderColor: colors.border }]}>
                <Timer size={14} color={item.restSec === null ? colors.textMuted : colors.accentInk} strokeWidth={2} />
                <Text style={[styles.restText, { color: item.restSec === null ? colors.textMuted : colors.accentInk }]}>
                  {item.restSec === null ? "нет" : formatDuration(item.restSec)}
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  return <>
    {draft.plan.workouts.map((workout) => (
      <View key={workout.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.workoutHead}>
          <View style={styles.grow}>
            <TextField label="Тренировка" value={workout.title} onChangeText={(title) => change(renameWorkout(draft, workout.id, title))} />
          </View>
          <AppIconButton compact label={`Удалить тренировку ${workout.title}`} disabled={draft.plan.workouts.length === 1}
            icon={<Trash2 size={18} color={colors.textSecondary} strokeWidth={1.8} />} onPress={() => setRemoving(workout.id)} />
        </View>
        {workout.exercises.length > 0 ? (
          <Sortable.Grid data={[...workout.exercises]} keyExtractor={(item) => item.id} renderItem={exerciseRow}
            columns={1} rowGap={0} customHandle scrollableRef={scrollRef} activeItemScale={1.03}
            onDragEnd={({ data }) => change(reorderExercises(draft, workout.id, data.map((item) => item.id)))} />
        ) : (
          <Text style={[styles.empty, { color: colors.textMuted }]}>Упражнений пока нет.</Text>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={`Добавить упражнение в ${workout.title}`}
          onPress={() => onPickExercise(workout.id)}
          style={({ pressed }) => [styles.addRow, { borderTopColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
          <Plus size={16} color={colors.accentInk} strokeWidth={2} />
          <Text style={[styles.addText, { color: colors.accentInk }]}>Добавить упражнение</Text>
        </Pressable>
      </View>
    ))}
    <AppButton variant="secondary" label="Добавить тренировку" icon={(color) => <Plus size={18} color={color} strokeWidth={2} />}
      onPress={() => change(addWorkout(draft, newPlanId("w")))} />

    <SetsEditorSheet ref={sheet} exercise={editingExercise}
      info={editingExercise === null ? null : lookup.get(editingExercise.exerciseId) ?? null}
      onDismiss={() => setEditing(null)}
      onChangeSet={(setId, field, value) => { if (editing !== null) change(updateSet(draft, editing, setId, field, value)); }}
      onAddSet={() => { if (editing !== null && (editingExercise?.sets.length ?? 0) < SETS_MAX) change(addSet(draft, editing, newPlanId("s"))); }}
      onRemoveSet={(setId) => { if (editing !== null) change(removeSet(draft, editing, setId)); }}
      onFillAll={() => {
        if (editingExercise === null) return;
        const first = editingExercise.sets[0];
        const info = lookup.get(editingExercise.exerciseId);
        if (first === undefined || info === undefined) return;
        let next = draft;
        for (const field of setFieldsOf(info.metrics)) next = fillSets(next, editingExercise.id, field, first[field]);
        change(next);
        sheet.current?.dismiss();
      }}
      onChangeRest={(restSec) => { if (editing !== null) change(setRest(draft, editing, restSec)); }}
      onChangeInstruction={(text) => { if (editing !== null) change(setInstruction(draft, editing, text)); }}
      onRemoveExercise={() => { if (editing !== null) { change(removeExercise(draft, editing)); sheet.current?.dismiss(); } }} />
    <DurationWheelPicker visible={restFor !== null} title="Отдых после подхода"
      value={restFor?.restSec ?? REST_DEFAULT_SEC} min={REST_MIN_SEC} max={REST_MAX_SEC}
      clearLabel={restFor?.restSec === null ? undefined : "Без таймера"}
      onConfirm={(seconds) => { if (restFor !== null) change(setRest(draft, restFor.id, seconds)); }}
      onClear={() => { if (restFor !== null) change(setRest(draft, restFor.id, null)); }}
      onClose={() => setRestFor(null)} />
    <ConfirmDialog visible={removing !== null} destructive title="Удалить тренировку?"
      description="Тренировка и её упражнения уйдут из плана. Сохранение — кнопкой внизу; до него можно выйти без изменений."
      confirmLabel="Удалить" onCancel={() => setRemoving(null)}
      onConfirm={() => { if (removing !== null) change(removeWorkout(draft, removing)); setRemoving(null); }} />
  </>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  workoutHead: { flexDirection: "row", alignItems: "flex-end", gap: 4, padding: 12, paddingRight: 4 },
  exerciseRow: { flexDirection: "row", alignItems: "stretch", borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  handle: { width: 36, flex: 1, alignItems: "center", justifyContent: "center" },
  exercisePress: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 12, paddingVertical: 8 },
  thumb: { width: 40, height: 40, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  thumbImage: { width: 40, height: 40 },
  exerciseName: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  fields: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingRight: 12 },
  field: { flex: 1, minWidth: 0, gap: 4 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, textAlign: "center" },
  fieldInput: { minHeight: 40, borderWidth: 1, borderRadius: 8, textAlign: "center", fontFamily: fonts.medium, fontSize: 15,
    paddingHorizontal: 4, paddingVertical: 0 },
  rest: { gap: 4, minWidth: 64 },
  restValue: { minHeight: 40, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingHorizontal: 6 },
  restText: { fontFamily: fonts.medium, fontSize: 14 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 8 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
  addText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
});
