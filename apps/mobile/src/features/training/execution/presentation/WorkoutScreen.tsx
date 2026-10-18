import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useKeepAwake } from "expo-keep-awake";
import { usePreventRemove, useNavigation } from "@react-navigation/native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { CalendarDays, Check, NotebookPen, Plus, Timer, Trash2, X } from "lucide-react-native";
import { ConfirmDialog, DurationWheelPicker, InlineNotice, LoadingState, pickDate, StatusTag,
  type StatusKind } from "../../../../shared/ui/components/public.ts";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { formatDuration, REST_DEFAULT_SEC, REST_MAX_SEC, REST_MIN_SEC, useExerciseLookup, type ExerciseLookupPort,
  type PlannedExercise, type PlannedSet, type TrainingPlansRepositoryPort } from "../../plans/public.ts";
import { DROPS_MAX, EMPTY_VALUES, NOTE_MAX, type ConfirmationMode, type PreviousSet, type SetFact, type SetType, type SetValues, type Side,
  type WorkoutOutcome, type WorkoutSlot, type WorkoutStatus } from "../domain/ExecutionModel.ts";
import { displayOrder, localDateOf, nextOutcome, type SetField } from "../domain/ExecutionRules.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { RpeSheet, SetTypeSheet } from "./SetPickers.tsx";
import { compactValues, compactWithDrops, diaryFields, fieldHeaders, fieldNames, parseField, rawOf, rpeTone, setTypeLabels,
  setTypeTone, shortDate, workoutStatusLabels } from "./setFormat.ts";
import { extraWarmups, useWorkoutDiary, type SetPatch } from "./useWorkoutDiary.ts";

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
type SetTarget = Readonly<{ exercise: PlannedExercise; set: PlannedSet; position: number }>;

const hasValues = (values: SetValues) => Object.values(values).some((value) => value !== null);

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
  const raw = rawOf({ ...EMPTY_VALUES, [field]: value }, field);
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

/**
 * Заметка о выполнении упражнения (§48.67): запись через паузу после ввода или при уходе фокуса; отложенная
 * запись дописывается перед сменой исхода, как у значений подходов.
 */
function NoteField({ noteKey, value, pending, onCommit }: Readonly<{
  noteKey: string; value: string; pending: PendingRegistry; onCommit: (text: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(value !== "");
  const focused = useRef(false);
  const textRef = useRef(value);
  const valueRef = useRef(value);
  const commitRef = useRef(onCommit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  valueRef.current = value;
  commitRef.current = onCommit;
  useEffect(() => {
    if (focused.current) return;
    textRef.current = value;
    setText(value);
    if (value !== "") setOpen(true);
  }, [value]);
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.delete(noteKey);
    if (textRef.current.trim() !== valueRef.current.trim()) commitRef.current(textRef.current);
  }, [noteKey, pending]);
  useEffect(() => () => { if (pending.has(noteKey)) flush(); }, [flush, noteKey, pending]);
  if (!open) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Добавить заметку о выполнении" hitSlop={6}
        onPress={() => setOpen(true)} style={styles.noteAdd}>
        <NotebookPen size={15} color={colors.textSecondary} strokeWidth={1.8} />
        <Text style={[styles.noteAddText, { color: colors.textSecondary }]}>Заметка о выполнении</Text>
      </Pressable>
    );
  }
  return (
    <TextInput value={text} multiline maxLength={NOTE_MAX} placeholder="Как прошло: самочувствие, техника, замены…"
      placeholderTextColor={colors.textMuted} accessibilityLabel="Заметка о выполнении"
      autoFocus={value === "" && text === ""}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; flush(); if (textRef.current.trim() === "") setOpen(false); }}
      onChangeText={(next) => {
        textRef.current = next;
        setText(next);
        if (timer.current !== null) clearTimeout(timer.current);
        pending.set(noteKey, flush);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
      }}
      style={[styles.note, { color: colors.textPrimary, backgroundColor: colors.input, borderColor: colors.border }]} />
  );
}

/**
 * Строка подхода. Тип красит строку (разминка — жёлтым, отказ — красным, дроп — синим), номер у рабочих
 * подходов не меняется; под дроп-сетом — строки мини-сетов (§48.60), их состав заморожен, пока подход выполнен.
 */
const SetRow = memo(function SetRow({ target, number, fact, previous, fields, mode, sided, pending,
  onSave, onToggle, onPickType, onPickRpe }: Readonly<{
  target: SetTarget; number: number | null; fact: SetFact | undefined; previous: PreviousSet | undefined;
  fields: readonly SetField[]; mode: ConfirmationMode;
  /** Одностороннее упражнение: две строки «Л» / «П» со своими значениями и отметками (§48.66, §48.70). */
  sided: boolean;
  pending: PendingRegistry;
  onSave: (target: SetTarget, patch: SetPatch) => void;
  onToggle: (target: SetTarget, side?: Side) => void;
  onPickType: (target: SetTarget) => void;
  onPickRpe: (target: SetTarget) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { set } = target;
  const confirmed = fact?.confirmed === true;
  const type: SetType = fact?.setType ?? "NORMAL";
  const tone = setTypeTone(type, colors);
  const drops = fact?.drops ?? [];
  const marker = number === null ? "Р" : String(number);
  const background = tone !== null ? withAlpha(tone, confirmed ? 0.3 : 0.14)
    : confirmed ? withAlpha(colors.success, 0.14) : "transparent";
  const manualSpacer = mode === "MANUAL" ? <View style={styles.side} /> : null;
  // §48.80: одна засчитанная сторона — подход частично выполнен (номер подсвечен наполовину).
  const partial = sided && confirmed && fact?.sides?.left.confirmed !== fact?.sides?.right.confirmed;
  const full = confirmed && !partial;
  const sideRow = (side: Side) => {
    const sideFact = side === "L" ? fact?.sides?.left : fact?.sides?.right;
    const done = sideFact?.confirmed === true;
    return <>
      <Text accessibilityLabel={`${side === "L" ? "Левая" : "Правая"} сторона${done ? ", выполнена" : ""}`}
        style={[styles.sideLabel, { color: done ? colors.success : colors.textSecondary }]}>{side === "L" ? "Л" : "П"}</Text>
      {fields.map((field) => (
        <ValueCell key={field} cellKey={`${set.id}:${side}:${field}`} field={field} value={sideFact?.values[field] ?? null}
          pending={pending} onCommit={(value) => onSave(target, { side: { side, fields: { [field]: value } } })} />
      ))}
    </>;
  };
  const sideCheck = (side: Side) => {
    const done = (side === "L" ? fact?.sides?.left.confirmed : fact?.sides?.right.confirmed) === true;
    return (
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} hitSlop={6}
        accessibilityLabel={`${side === "L" ? "Левая" : "Правая"} сторона: ${done ? "снять отметку" : "отметить выполненной"}`}
        onPress={() => onToggle(target, side)}
        style={[styles.check, { borderColor: done ? colors.success : colors.border, backgroundColor: done ? colors.success : colors.surface }]}>
        {done ? <Check size={18} color={colors.canvas} strokeWidth={2.4} /> : null}
      </Pressable>
    );
  };
  const previousText = previous === undefined ? "—" : previous.sides !== null
    ? `Л ${previous.sides.left === null ? "—" : compactValues(previous.sides.left, fields)}\nП ${previous.sides.right === null ? "—"
      : compactValues(previous.sides.right, fields)}`
    : compactWithDrops(previous.values, previous.drops, fields);
  return (
    <View style={[styles.block, { backgroundColor: background }]}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" hitSlop={6} onPress={() => onPickType(target)}
          accessibilityLabel={`Подход ${marker}, ${setTypeLabels[type].toLowerCase()}${full ? ", выполнен" : partial ? ", выполнен частично" : ""}. Сменить тип`}
          style={[styles.marker, { borderColor: confirmed ? colors.success : tone ?? colors.border,
            backgroundColor: full ? colors.success : partial ? withAlpha(colors.success, 0.35) : colors.surface }]}>
          <Text style={[styles.markerText, { color: full ? colors.canvas : tone ?? colors.textPrimary }]}>{marker}</Text>
        </Pressable>
        <Text style={[styles.plan, { color: colors.textSecondary }]} numberOfLines={1}>{compactValues(set, fields)}</Text>
        <Pressable accessibilityRole="button" disabled={previous === undefined} hitSlop={6} style={styles.previous}
          accessibilityLabel={previous === undefined ? "Прошлого результата нет" : `Перенести прошлый результат ${previousText}`}
          onPress={() => {
            if (previous === undefined) return;
            if (previous.sides !== null) { onSave(target, { sidesFrom: previous.sides }); return; }
            onSave(target, type === "DROP" ? { fields: previous.values, drops: previous.drops } : { fields: previous.values });
          }}>
          <Text style={[styles.previousText, { color: previous === undefined ? colors.textMuted : colors.accentInk }]} numberOfLines={2}>
            {previousText}
          </Text>
        </Pressable>
        {sided ? sideRow("L") : fields.map((field) => (
          <ValueCell key={field} cellKey={`${set.id}:${field}`} field={field} value={fact?.values[field] ?? null} pending={pending}
            onCommit={(value) => onSave(target, { fields: { [field]: value } })} />
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel={fact?.rpe ? `RPE ${fact.rpe}. Изменить` : "Указать RPE"} hitSlop={6}
          onPress={() => onPickRpe(target)} style={styles.side}>
          <Text style={[styles.rpeText, { color: fact?.rpe ? rpeTone(fact.rpe, colors) : colors.textMuted }]}>{fact?.rpe ?? "—"}</Text>
        </Pressable>
        {mode === "MANUAL" && sided ? sideCheck("L") : null}
        {mode === "MANUAL" && !sided ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}
            accessibilityLabel={confirmed ? "Снять отметку выполнения" : "Отметить подход выполненным"} hitSlop={6}
            onPress={() => onToggle(target)}
            style={[styles.check, { borderColor: confirmed ? colors.success : colors.border,
              backgroundColor: confirmed ? colors.success : colors.surface }]}>
            {confirmed ? <Check size={18} color={colors.canvas} strokeWidth={2.4} /> : null}
          </Pressable>
        ) : null}
      </View>
      {sided ? (
        <View style={styles.row}>
          <View style={styles.markerSpace} />
          <View style={styles.plan} />
          <View style={styles.grow} />
          {sideRow("R")}
          <View style={styles.side} />
          {mode === "MANUAL" ? sideCheck("R") : null}
        </View>
      ) : null}
      {type === "DROP" ? <>
        {drops.map((drop, index) => (
          <View key={`drop-${index}`} style={styles.row}>
            <View style={styles.markerSpace} />
            <View style={styles.plan} />
            <Text style={[styles.dropLabel, { color: colors.textSecondary }]}>{`↳ ${index + 2}`}</Text>
            {fields.map((field) => (
              <ValueCell key={field} cellKey={`${set.id}:d${index}:${field}`} field={field} value={drop[field]} pending={pending}
                onCommit={(value) => onSave(target, { drop: { index, fields: { [field]: value } } })} />
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel={`Убрать мини-сет ${index + 2}`} hitSlop={6}
              disabled={confirmed || drops.length <= 1} style={[styles.side, (confirmed || drops.length <= 1) && styles.dim]}
              onPress={() => onSave(target, { drops: drops.filter((_, item) => item !== index) })}>
              <X size={18} color={colors.danger} strokeWidth={2} />
            </Pressable>
            {manualSpacer}
          </View>
        ))}
        <View style={styles.row}>
          <View style={styles.markerSpace} />
          <Pressable accessibilityRole="button" disabled={confirmed || drops.length >= DROPS_MAX}
            accessibilityLabel="Добавить мини-сет"
            accessibilityHint={confirmed ? "Подход выполнен — сначала снимите выполнение" : undefined}
            onPress={() => onSave(target, { drops: [...drops, EMPTY_VALUES] })}
            style={[styles.addDrop, { borderColor: tone ?? colors.border }, (confirmed || drops.length >= DROPS_MAX) && styles.dim]}>
            <Plus size={16} color={colors.accentInk} strokeWidth={2.2} />
            <Text style={[styles.addDropText, { color: colors.accentInk }]}>Мини-сет</Text>
          </Pressable>
        </View>
      </> : null}
    </View>
  );
});

/**
 * Дневник тренировки (Feature 10): план, «Пред.», факт по профилю упражнения, RPE; три исхода под последним
 * упражнением (§48.31). После завершения экран остаётся тем же (§48.68). Выход из начатой тренировки без
 * исхода спрашивает «Завершить тренировку?» (§48.36).
 */
export function WorkoutScreen({ slot, clientName, plans, execution, restTimers, exercises }: Readonly<{
  slot: WorkoutSlot;
  /** Подпись таймера отдыха — таймеры разных клиентов различимы (§48.62). */
  clientName: string;
  plans: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  restTimers: RestTimersPort;
  exercises: ExerciseLookupPort;
}>) {
  useKeepAwake();
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const navigation = useNavigation();
  const lookup = useExerciseLookup(exercises);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  // §48.56: таймер упражнения со своей длительностью; выключенный в плане — не запускается.
  const startRest = useCallback((exercise: PlannedExercise) => {
    if (exercise.restSec === null) return;
    void restTimers.start({ clientId: slot.clientId, clientName, exerciseKey: exercise.id,
      exerciseName: lookup?.get(exercise.exerciseId)?.name ?? "Упражнение", durationSec: exercise.restSec }).catch(() => undefined);
  }, [clientName, lookup, restTimers, slot.clientId]);
  const unilateralOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.unilateral === true, [lookup]);
  const diary = useWorkoutDiary(slot, plans, execution, metricsOf, unilateralOf, startRest);
  const pending = useRef<PendingRegistry>(new Map()).current;
  const typeSheet = useRef<BottomSheetModal>(null);
  const rpeSheet = useRef<BottomSheetModal>(null);
  const [target, setTarget] = useState<SetTarget | null>(null);
  const [removeDrops, setRemoveDrops] = useState<Readonly<{ target: SetTarget; setType: SetType }> | null>(null);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [exitAction, setExitAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [busy, setBusy] = useState(false);
  const [restFor, setRestFor] = useState<PlannedExercise | null>(null);
  const [restError, setRestError] = useState<string | null>(null);
  const { saveSet, toggleSet, setOutcome, addWarmup, removeWarmup } = diary;
  const [removeWarm, setRemoveWarm] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** §48.56: отдых упражнения сохраняется в план — у каждого упражнения свой таймер. */
  const saveRest = (exercise: PlannedExercise, restSec: number | null) => {
    setRestError(null);
    void plans.setExerciseRest(slot.clientId, slot.programId, exercise.id, restSec).catch(() => {
      setRestError("Не удалось изменить отдых. План не изменён — повторите.");
    });
  };

  const flushPending = useCallback(() => {
    for (const flush of [...pending.values()]) flush();
  }, [pending]);

  const onSave = useCallback((item: SetTarget, patch: SetPatch) => {
    void saveSet(item.exercise, item.set, item.position, patch);
  }, [saveSet]);
  const onToggle = useCallback((item: SetTarget, side?: Side) => {
    flushPending();
    void toggleSet(item.exercise, item.set, item.position, side);
  }, [flushPending, toggleSet]);
  const onPickType = useCallback((item: SetTarget) => {
    Keyboard.dismiss();
    setTarget(item);
    typeSheet.current?.present();
  }, []);
  const onPickRpe = useCallback((item: SetTarget) => {
    Keyboard.dismiss();
    setTarget(item);
    rpeSheet.current?.present();
  }, []);

  const outcome = diary.state?.session?.outcome ?? null;
  usePreventRemove(diary.status === "IN_PROGRESS" && !busy, ({ data }) => setExitAction(data.action));

  const incomplete = useMemo(() => (diary.workout?.exercises.some((exercise) => exercise.sets.some((set) =>
    diary.state?.facts.get(set.id)?.confirmed !== true)) ?? false)
    || [...(diary.state?.facts.values() ?? [])].some((fact) => fact.extra && !fact.confirmed), [diary.state, diary.workout]);

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
  const targetFact = target === null ? undefined : state.facts.get(target.set.id);

  const chooseType = (setType: SetType) => {
    typeSheet.current?.dismiss();
    if (target === null || setType === (targetFact?.setType ?? "NORMAL")) return;
    flushPending();
    // Как в 2.0: разминка — новый подход сверху, выбранный подход не меняется.
    if (setType === "WARMUP") { void addWarmup(target.exercise); return; }
    // Заполненные мини-сеты не убираются молча: сначала вопрос.
    if (targetFact?.setType === "DROP" && targetFact.drops.some(hasValues)) { setRemoveDrops({ target, setType }); return; }
    onSave(target, { setType });
  };

  return (
    <>
      <KeyboardAwareScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{workout.title}</Text>
        <View style={styles.metaRow}>
          <View style={styles.dateRow}>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Неделя ${slot.weekIndex}`}</Text>
            {state.session !== null ? (
              // §48.84: дата проведения — по умолчанию день первого ввода, можно указать прошедший день.
              <Pressable accessibilityRole="button" hitSlop={8}
                accessibilityLabel={`Дата тренировки ${shortDate(state.session.actualDate)}. Изменить`}
                onPress={() => {
                  const current = state.session?.actualDate;
                  if (current === undefined) return;
                  void pickDate({ value: current, max: localDateOf(new Date()) }).then((date) => {
                    if (date !== null && date !== current) void diary.setActualDate(date);
                  });
                }}
                style={[styles.dateButton, { borderColor: colors.border }]}>
                <CalendarDays size={15} color={colors.accentInk} strokeWidth={2} />
                <Text style={[styles.dateText, { color: colors.accentInk }]}>{shortDate(state.session.actualDate)}</Text>
              </Pressable>
            ) : null}
          </View>
          <StatusTag kind={statusKinds[diary.status]} label={workoutStatusLabels[diary.status]} />
        </View>
        {diary.message !== null ? <InlineNotice kind="error">{diary.message}</InlineNotice> : null}
        {restError !== null ? <InlineNotice kind="error">{restError}</InlineNotice> : null}
        {workout.exercises.map((exercise) => {
          const info = lookup.get(exercise.exerciseId);
          const fields = diaryFields(info?.metrics ?? []);
          const extras = extraWarmups(state, exercise.id).map((fact) => ({ set: { id: fact.plannedSetId, reps: null,
            loadGrams: null, durationSec: null, distanceM: null }, position: fact.position, setType: fact.setType }));
          const rows = displayOrder([...extras, ...exercise.sets.map((set, position) => ({ set, position,
            setType: state.facts.get(set.id)?.setType ?? "NORMAL" }))]);
          const done = rows.filter(({ item }) => state.facts.get(item.set.id)?.confirmed === true).length;
          return (
            <View key={exercise.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHead}>
                {info?.thumbnail != null ? <Image source={info.thumbnail} style={[styles.thumb, { backgroundColor: colors.input }]} /> : null}
                <View style={styles.exerciseText}>
                  <Text style={[styles.exercise, { color: colors.textPrimary }]} numberOfLines={2}>{info?.name ?? "Упражнение"}</Text>
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { Keyboard.dismiss(); setRestFor(exercise); }}
                    accessibilityLabel={exercise.restSec === null ? "Таймер отдыха выключен. Изменить"
                      : `Отдых ${formatDuration(exercise.restSec)}. Изменить`}
                    style={styles.rest}>
                    <Timer size={15} color={exercise.restSec === null ? colors.textMuted : colors.accentInk} strokeWidth={2} />
                    <Text style={[styles.restText, { color: exercise.restSec === null ? colors.textMuted : colors.accentInk }]}>
                      {exercise.restSec === null ? "Без таймера" : formatDuration(exercise.restSec)}
                    </Text>
                  </Pressable>
                </View>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${done}/${rows.length}`}</Text>
              </View>
              {exercise.instruction !== null ? (
                <Text accessibilityLabel={`Указание тренера: ${exercise.instruction}`}
                  style={[styles.instructionText, { color: colors.textSecondary, borderColor: colors.border }]}>
                  {exercise.instruction}
                </Text>
              ) : null}
              <View style={[styles.row, styles.headRow]}>
                <Text style={[styles.head, styles.markerSpace, { color: colors.textMuted }]}>Сет</Text>
                <Text style={[styles.head, styles.plan, { color: colors.textMuted }]}>План</Text>
                <Text style={[styles.head, styles.grow, { color: colors.textMuted }]}>Пред.</Text>
                {fields.map((field) => <Text key={field} style={[styles.head, styles.inputHead, { color: colors.textMuted }]}>{fieldHeaders[field]}</Text>)}
                <Text style={[styles.head, styles.side, { color: colors.textMuted }]}>RPE</Text>
                {mode === "MANUAL" ? <View style={styles.side} /> : null}
              </View>
              {rows.map(({ item, number }) => (
                <SetRow key={item.set.id} target={{ exercise, set: item.set, position: item.position }} number={number}
                  fact={state.facts.get(item.set.id)} previous={previous.get(item.set.id)} fields={fields} mode={mode}
                  sided={info?.unilateral === true}
                  pending={pending} onSave={onSave} onToggle={onToggle} onPickType={onPickType} onPickRpe={onPickRpe} />
              ))}
              <NoteField noteKey={`note:${exercise.id}`} value={state.notes.get(exercise.id) ?? ""} pending={pending}
                onCommit={(text) => { void diary.saveNote(exercise.id, text); }} />
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
        {state.session !== null ? (
          <Pressable accessibilityRole="button" onPress={() => { flushPending(); setConfirmDelete(true); }} style={styles.deleteRun}>
            <Trash2 size={16} color={colors.danger} strokeWidth={1.8} />
            <Text style={[styles.deleteRunText, { color: colors.danger }]}>Удалить результаты тренировки</Text>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>
      <DurationWheelPicker visible={restFor !== null} title="Отдых после подхода"
        value={restFor?.restSec ?? REST_DEFAULT_SEC} min={REST_MIN_SEC} max={REST_MAX_SEC}
        clearLabel={restFor?.restSec === null ? undefined : "Без таймера"}
        onConfirm={(seconds) => { if (restFor !== null) saveRest(restFor, seconds); }}
        onClear={() => { if (restFor !== null) saveRest(restFor, null); }}
        onClose={() => setRestFor(null)} />
      <SetTypeSheet ref={typeSheet} setType={targetFact?.setType ?? "NORMAL"} extra={targetFact?.extra === true}
        noDrop={target !== null && lookup.get(target.exercise.exerciseId)?.unilateral === true}
        onSelect={chooseType}
        onRemove={() => {
          typeSheet.current?.dismiss();
          if (targetFact === undefined) return;
          flushPending();
          // Заполненную разминку не убираем молча.
          if (hasValues(targetFact.values) || targetFact.confirmed) setRemoveWarm(targetFact.plannedSetId);
          else void removeWarmup(targetFact.plannedSetId);
        }} />
      <ConfirmDialog visible={removeWarm !== null} title="Удалить разминочный подход?"
        description="Его значения уйдут из дневника, «Пред.» и статистики. Плановые подходы не изменятся."
        confirmLabel="Удалить" cancelLabel="Оставить" destructive
        onCancel={() => setRemoveWarm(null)}
        onConfirm={() => { if (removeWarm !== null) void removeWarmup(removeWarm); setRemoveWarm(null); }} />
      <RpeSheet ref={rpeSheet} rpe={targetFact?.rpe ?? null}
        onSelect={(rpe) => { rpeSheet.current?.dismiss(); if (target !== null) onSave(target, { rpe }); }} />
      <ConfirmDialog visible={removeDrops !== null} title="Убрать мини-сеты?"
        description="Подход перестанет быть дроп-сетом, заполненные мини-сеты будут убраны. Основной сет останется."
        confirmLabel="Убрать" cancelLabel="Оставить" destructive
        onCancel={() => setRemoveDrops(null)}
        onConfirm={() => { if (removeDrops !== null) onSave(removeDrops.target, { setType: removeDrops.setType }); setRemoveDrops(null); }} />
      <ConfirmDialog visible={confirmDelete} destructive confirmBusy={busy} title="Удалить результаты тренировки?"
        description="Будут удалены все веса, повторения и подходы этой тренировки, заметки о выполнении, дата и итог. Плановая тренировка останется пустой. История и статистика пересчитаются без этих данных. Вернуть можно только из резервной копии."
        confirmLabel="Удалить" cancelLabel="Отмена"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setBusy(true);
          void diary.deleteExecution().finally(() => { setBusy(false); setConfirmDelete(false); });
        }} />
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
  // Снизу место под панель таймеров отдыха, чтобы она не закрывала кнопки исходов.
  content: { padding: 16, gap: 12, paddingBottom: 200 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateButton: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 8 },
  dateText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 12, padding: 8, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2, paddingHorizontal: 2 },
  thumb: { width: 40, height: 40, borderRadius: 8 },
  exerciseText: { flex: 1, gap: 2 },
  exercise: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  rest: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 28 },
  restText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  block: { borderRadius: 10, paddingVertical: 2, paddingHorizontal: 2, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  headRow: { minHeight: 20, paddingHorizontal: 2 },
  head: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, textAlign: "center" },
  grow: { flex: 1 },
  markerSpace: { width: 34 },
  marker: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  markerText: { fontFamily: fonts.semibold, fontSize: 14 },
  plan: { flex: 1, fontFamily: fonts.regular, fontSize: 12, textAlign: "center" },
  previous: { flex: 1, minHeight: 40, justifyContent: "center" },
  previousText: { fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  instructionText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, borderLeftWidth: 2, paddingLeft: 8,
    marginHorizontal: 2, marginBottom: 2 },
  noteAdd: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, alignSelf: "flex-start", paddingHorizontal: 2 },
  noteAddText: { fontFamily: fonts.medium, fontSize: 13 },
  note: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top",
    fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 4 },
  deleteRun: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 48, marginTop: 4 },
  deleteRunText: { fontFamily: fonts.medium, fontSize: 14 },
  sideLabel: { width: 14, textAlign: "center", fontFamily: fonts.semibold, fontSize: 13 },
  dropLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 12, textAlign: "right", paddingRight: 4 },
  inputHead: { width: 54 },
  input: { width: 54, height: 40, borderWidth: 1, borderRadius: 8, textAlign: "center", fontFamily: fonts.medium,
    fontSize: 15, paddingHorizontal: 2, paddingVertical: 0 },
  side: { width: 34, minHeight: 40, alignItems: "center", justifyContent: "center" },
  rpeText: { fontFamily: fonts.semibold, fontSize: 14, textAlign: "center" },
  check: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addDrop: { flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6 },
  addDropText: { fontFamily: fonts.medium, fontSize: 13 },
  dim: { opacity: 0.4 },
  outcomes: { flexDirection: "row", gap: 8, marginTop: 4 },
  outcome: { flex: 1, minHeight: 56, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6 },
  outcomeText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, textAlign: "center" },
});
