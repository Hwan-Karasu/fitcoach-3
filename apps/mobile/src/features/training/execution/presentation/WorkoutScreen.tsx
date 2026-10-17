import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useKeepAwake } from "expo-keep-awake";
import { usePreventRemove, useNavigation } from "@react-navigation/native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Check } from "lucide-react-native";
import { ConfirmDialog, InlineNotice, LoadingState, StatusTag, type StatusKind } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { useExerciseLookup, type ExerciseLookupPort, type PlannedExercise, type PlannedSet,
  type TrainingPlansRepositoryPort } from "../../plans/public.ts";
import type { ConfirmationMode, PreviousSet, SetFact, SetValues, WorkoutOutcome, WorkoutSlot,
  WorkoutStatus } from "../domain/ExecutionModel.ts";
import { nextOutcome, type SetField } from "../domain/ExecutionRules.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { SetOptionsSheet } from "./SetOptionsSheet.tsx";
import { compactValues, diaryFields, fieldHeaders, fieldNames, parseField, rawOf, setMarker, shortDate,
  workoutStatusLabels } from "./setFormat.ts";
import { useWorkoutDiary, type SetPatch } from "./useWorkoutDiary.ts";

/** Пауза после последнего нажатия, после которой значение ячейки записывается. */
const SAVE_DELAY_MS = 700;

const statusKinds: Readonly<Record<WorkoutStatus, StatusKind>> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", COMPLETED: "success", MISSED: "warning", CANCELLED: "warning",
};

const outcomeLabels: Readonly<Record<WorkoutOutcome, readonly [string, string]>> = {
  COMPLETED: ["Завершить тренировку", "Отменить завершение"],
  MISSED: ["Пропущена", "Отменить пропуск"],
  CANCELLED: ["Отменена", "Отменить отмену"],
};

type PendingRegistry = Map<string, () => void>;

/**
 * Ячейка фактического значения: свой текст ввода; запись — через паузу после ввода или при уходе фокуса.
 * Отложенная запись регистрируется, чтобы смена исхода сначала дописала последнее значение (§48.23 п. 5).
 */
function ValueCell({ cellKey, field, value, pending, onCommit }: Readonly<{
  cellKey: string; field: SetField; value: number | null; pending: PendingRegistry;
  onCommit: (value: number | null) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const raw = rawOf({ reps: null, loadGrams: null, durationSec: null, distanceM: null, [field]: value }, field);
  const [text, setText] = useState(raw);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const textRef = useRef(raw);
  const valueRef = useRef(value);
  const commitRef = useRef(onCommit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  valueRef.current = value;
  commitRef.current = onCommit;

  useEffect(() => {
    if (focused.current) return;
    textRef.current = raw;
    setText(raw);
    setInvalid(false);
  }, [raw]);

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.delete(cellKey);
    const parsed = parseField(field, textRef.current);
    if (parsed !== "invalid" && parsed !== valueRef.current) commitRef.current(parsed);
  }, [cellKey, field, pending]);

  useEffect(() => () => { if (pending.has(cellKey)) flush(); }, [cellKey, flush, pending]);

  return (
    <TextInput value={text} placeholder="—" placeholderTextColor={colors.textMuted} selectTextOnFocus
      keyboardType={field === "durationSec" ? "numbers-and-punctuation" : field === "loadGrams" ? "decimal-pad" : "number-pad"}
      accessibilityLabel={fieldNames[field]}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; flush(); }}
      onChangeText={(next) => {
        textRef.current = next;
        setText(next);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
        const parsed = parseField(field, next);
        setInvalid(parsed === "invalid");
        if (parsed === "invalid") { pending.delete(cellKey); return; }
        pending.set(cellKey, flush);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
      }}
      style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.input,
        borderColor: invalid ? colors.danger : colors.border }]} />
  );
}

const SetRow = memo(function SetRow({ exercise, set, position, ordinal, fact, previous, fields, mode, pending,
  onSave, onToggle, onOptions }: Readonly<{
  exercise: PlannedExercise; set: PlannedSet; position: number; ordinal: number; fact: SetFact | undefined;
  previous: PreviousSet | undefined; fields: readonly SetField[]; mode: ConfirmationMode; pending: PendingRegistry;
  onSave: (exercise: PlannedExercise, set: PlannedSet, position: number, patch: SetPatch) => void;
  onToggle: (exercise: PlannedExercise, set: PlannedSet, position: number) => void;
  onOptions: (exercise: PlannedExercise, set: PlannedSet, position: number) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const confirmed = fact?.confirmed === true;
  const type = fact?.setType ?? "NORMAL";
  const values: SetValues | undefined = fact?.values;
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Подход ${position + 1}: тип и RPE${confirmed ? ", выполнен" : ""}`}
        hitSlop={6} onPress={() => onOptions(exercise, set, position)}
        style={[styles.marker, { borderColor: confirmed ? colors.success : colors.border,
          backgroundColor: confirmed ? colors.success : colors.surface }]}>
        <Text style={[styles.markerText, { color: confirmed ? colors.canvas : colors.textPrimary }]}>{setMarker(type, ordinal)}</Text>
      </Pressable>
      <Text style={[styles.plan, { color: colors.textSecondary }]} numberOfLines={1}>{compactValues(set, fields)}</Text>
      <Pressable accessibilityRole="button" disabled={previous === undefined}
        accessibilityLabel={previous === undefined ? "Прошлого результата нет" : `Перенести прошлый результат ${compactValues(previous.values, fields)}`}
        hitSlop={6} onPress={() => { if (previous !== undefined) onSave(exercise, set, position, { fields: previous.values }); }}
        style={styles.previous}>
        <Text style={[styles.previousText, { color: previous === undefined ? colors.textMuted : colors.accentInk }]} numberOfLines={1}>
          {previous === undefined ? "—" : compactValues(previous.values, fields)}
        </Text>
      </Pressable>
      {fields.map((field) => (
        <ValueCell key={field} cellKey={`${set.id}:${field}`} field={field} value={values?.[field] ?? null} pending={pending}
          onCommit={(value) => onSave(exercise, set, position, { fields: { [field]: value } })} />
      ))}
      <Pressable accessibilityRole="button" accessibilityLabel={fact?.rpe ? `RPE ${fact.rpe}` : "RPE не указан"} hitSlop={6}
        onPress={() => onOptions(exercise, set, position)} style={styles.rpe}>
        <Text style={[styles.rpeText, { color: fact?.rpe ? colors.textPrimary : colors.textMuted }]}>{fact?.rpe ?? "—"}</Text>
      </Pressable>
      {mode === "MANUAL" ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}
          accessibilityLabel={confirmed ? "Снять отметку выполнения" : "Отметить подход выполненным"} hitSlop={6}
          onPress={() => onToggle(exercise, set, position)}
          style={[styles.check, { borderColor: confirmed ? colors.success : colors.border,
            backgroundColor: confirmed ? colors.success : colors.surface }]}>
          {confirmed ? <Check size={18} color={colors.canvas} strokeWidth={2.4} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
});

/**
 * Дневник тренировки (Feature 10): план, «Пред.», факт по профилю упражнения, RPE; три исхода под последним
 * упражнением (§48.31). После завершения экран остаётся тем же (§48.68). Выход из начатой тренировки без
 * исхода спрашивает «Завершить тренировку?» (§48.36).
 */
export function WorkoutScreen({ slot, plans, execution, exercises }: Readonly<{
  slot: WorkoutSlot;
  plans: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  exercises: ExerciseLookupPort;
}>) {
  useKeepAwake();
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const navigation = useNavigation();
  const lookup = useExerciseLookup(exercises);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const diary = useWorkoutDiary(slot, plans, execution, metricsOf);
  const pending = useRef<PendingRegistry>(new Map()).current;
  const sheet = useRef<BottomSheetModal>(null);
  const [options, setOptions] = useState<Readonly<{ exercise: PlannedExercise; set: PlannedSet; position: number }> | null>(null);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [exitAction, setExitAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [busy, setBusy] = useState(false);
  const { saveSet, toggleSet, setOutcome } = diary;

  const flushPending = useCallback(() => {
    for (const flush of [...pending.values()]) flush();
  }, [pending]);

  const onSave = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number, patch: SetPatch) => {
    void saveSet(exercise, set, position, patch);
  }, [saveSet]);
  const onToggle = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number) => {
    flushPending();
    void toggleSet(exercise, set, position);
  }, [flushPending, toggleSet]);
  const onOptions = useCallback((exercise: PlannedExercise, set: PlannedSet, position: number) => {
    Keyboard.dismiss();
    setOptions({ exercise, set, position });
    sheet.current?.present();
  }, []);

  const outcome = diary.state?.session?.outcome ?? null;
  usePreventRemove(diary.status === "IN_PROGRESS" && !busy, ({ data }) => setExitAction(data.action));

  const incomplete = useMemo(() => diary.workout?.exercises.some((exercise) => exercise.sets.some((set) =>
    diary.state?.facts.get(set.id)?.confirmed !== true)) ?? false, [diary.state, diary.workout]);

  const applyOutcome = async (next: WorkoutOutcome | null) => {
    flushPending();
    setBusy(true);
    try { return await setOutcome(next); } finally { setBusy(false); }
  };

  const press = (pressed: WorkoutOutcome) => {
    const next = nextOutcome(outcome, pressed);
    if (next === "COMPLETED" && incomplete) { flushPending(); setConfirmIncomplete(true); return; }
    void applyOutcome(next);
  };

  if (diary.workout === undefined || diary.state === null || diary.mode === null || lookup === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем тренировку…" /></View>;
  }
  if (diary.workout === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <InlineNotice kind="error">Тренировка не найдена в программе.</InlineNotice>
      </View>
    );
  }
  const { workout, state, previous, mode } = diary;
  const optionsFact = options === null ? undefined : state.facts.get(options.set.id);
  return (
    <>
      <KeyboardAwareScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{workout.title}</Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {`Неделя ${slot.weekIndex}${state.session !== null ? ` · ${shortDate(state.session.actualDate)}` : ""}`}
          </Text>
          <StatusTag kind={statusKinds[diary.status]} label={workoutStatusLabels[diary.status]} />
        </View>
        {diary.message !== null ? <InlineNotice kind="error">{diary.message}</InlineNotice> : null}
        {workout.exercises.map((exercise) => {
          const info = lookup.get(exercise.exerciseId);
          const fields = diaryFields(info?.metrics ?? []);
          const done = exercise.sets.filter((set) => state.facts.get(set.id)?.confirmed === true).length;
          let normal = 0;
          return (
            <View key={exercise.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHead}>
                {info?.thumbnail != null ? <Image source={info.thumbnail} style={[styles.thumb, { backgroundColor: colors.input }]} /> : null}
                <Text style={[styles.exercise, { color: colors.textPrimary }]} numberOfLines={2}>{info?.name ?? "Упражнение"}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${done}/${exercise.sets.length}`}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.head, styles.markerHead, { color: colors.textMuted }]}>Сет</Text>
                <Text style={[styles.head, styles.plan, { color: colors.textMuted }]}>План</Text>
                <Text style={[styles.head, styles.grow, { color: colors.textMuted }]}>Пред.</Text>
                {fields.map((field) => <Text key={field} style={[styles.head, styles.inputHead, { color: colors.textMuted }]}>{fieldHeaders[field]}</Text>)}
                <Text style={[styles.head, styles.markerHead, { color: colors.textMuted }]}>RPE</Text>
                {mode === "MANUAL" ? <View style={styles.checkHead} /> : null}
              </View>
              {exercise.sets.map((set, position) => {
                const fact = state.facts.get(set.id);
                if ((fact?.setType ?? "NORMAL") === "NORMAL") normal += 1;
                return <SetRow key={set.id} exercise={exercise} set={set} position={position} ordinal={normal} fact={fact}
                  previous={previous.get(set.id)} fields={fields} mode={mode} pending={pending}
                  onSave={onSave} onToggle={onToggle} onOptions={onOptions} />;
              })}
            </View>
          );
        })}
        <View style={styles.outcomes}>
          {(["COMPLETED", "MISSED", "CANCELLED"] as const).map((item) => {
            const active = outcome === item;
            const primary = item === "COMPLETED";
            return (
              <Pressable key={item} accessibilityRole="button" disabled={busy} onPress={() => press(item)}
                style={[styles.outcome, { borderColor: primary || active ? colors.accentFill : colors.border,
                  backgroundColor: primary && !active ? colors.accentFill : colors.surface }]}>
                <Text style={[styles.outcomeText, { color: primary && !active ? colors.onAccentFill : colors.textPrimary }]}
                  numberOfLines={2}>{outcomeLabels[item][active ? 1 : 0]}</Text>
              </Pressable>
            );
          })}
        </View>
      </KeyboardAwareScrollView>
      <SetOptionsSheet ref={sheet} title={options === null ? "Подход" : `Подход ${options.position + 1}`}
        setType={optionsFact?.setType ?? "NORMAL"} rpe={optionsFact?.rpe ?? null}
        onSetType={(setType) => { if (options !== null) onSave(options.exercise, options.set, options.position, { setType }); }}
        onRpe={(rpe) => { if (options !== null) onSave(options.exercise, options.set, options.position, { rpe }); }} />
      <ConfirmDialog visible={confirmIncomplete} title="Не все подходы выполнены"
        description="Тренировку можно завершить и так: незаполненные подходы останутся пустыми, введённые результаты сохранятся."
        confirmLabel="Завершить" cancelLabel="Вернуться" confirmBusy={busy}
        onCancel={() => setConfirmIncomplete(false)}
        onConfirm={() => { void applyOutcome("COMPLETED").finally(() => setConfirmIncomplete(false)); }} />
      <ConfirmDialog visible={exitAction !== null} title="Завершить тренировку?"
        description="Результаты уже сохранены. «Нет» — выйти, тренировка останется в работе."
        confirmLabel="Да" tertiaryLabel="Нет" cancelLabel="Остаться" confirmBusy={busy}
        onCancel={() => setExitAction(null)}
        onTertiary={() => { const action = exitAction; flushPending(); setExitAction(null); if (action !== null) navigation.dispatch(action); }}
        onConfirm={() => {
          const action = exitAction;
          void applyOutcome("COMPLETED").then((saved) => {
            setExitAction(null);
            if (saved !== null && action !== null) navigation.dispatch(action);
          });
        }} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  thumb: { width: 40, height: 40, borderRadius: 8 },
  exercise: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  head: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, textAlign: "center" },
  markerHead: { width: 34 },
  grow: { flex: 1 },
  marker: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  markerText: { fontFamily: fonts.semibold, fontSize: 14 },
  plan: { flex: 1, fontFamily: fonts.regular, fontSize: 12, textAlign: "center" },
  previous: { flex: 1, minHeight: 40, justifyContent: "center" },
  previousText: { fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  inputHead: { width: 54 },
  input: { width: 54, height: 40, borderWidth: 1, borderRadius: 8, textAlign: "center", fontFamily: fonts.medium,
    fontSize: 15, paddingHorizontal: 2, paddingVertical: 0 },
  rpe: { width: 34, minHeight: 40, justifyContent: "center" },
  rpeText: { fontFamily: fonts.medium, fontSize: 13, textAlign: "center" },
  check: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  checkHead: { width: 34 },
  outcomes: { flexDirection: "row", gap: 8, marginTop: 4 },
  outcome: { flex: 1, minHeight: 56, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6 },
  outcomeText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, textAlign: "center" },
});
