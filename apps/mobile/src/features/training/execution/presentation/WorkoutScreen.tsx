import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import { usePreventRemove, useNavigation } from "@react-navigation/native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import Sortable from "react-native-sortables";
import { CalendarDays, Check, ChevronRight, Clock, EllipsisVertical, Gauge, GripVertical, LayoutGrid, NotebookPen, Plus, Share2, Timer, Trash2,
  Users, X } from "lucide-react-native";
import { AppButton, ConfirmDialog, DurationWheelPicker, InlineNotice, LoadingState, pickDate, StatusTag, TimeWheelPicker, WeekCards, useWeekNavigation,
  type StatusKind } from "../../../../shared/ui/components/public.ts";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { useReportScreenTone } from "../../../../shared/ui/theme/ScreenTone.tsx";
import { weekTypeTone, DiaryEditDialog, formatDuration, formatRange, supersetNumber, REST_DEFAULT_SEC, REST_MAX_SEC, REST_MIN_SEC, useExerciseLookup,
  type DiaryEdit, type ExerciseLookupPort, type PickedExercise, type PlannedExercise, type PlannedSet, type TrainingPlansRepositoryPort,
  type WorkoutWeekNavigation } from "../../plans/public.ts";
import { DROPS_MAX, EMPTY_VALUES, NOTE_MAX, type ActiveWorkoutCard, type ActiveWorkoutsPort, type ConfirmationMode, type PreviousSet, type SetFact, type SetType, type SetValues, type Side,
  type WorkoutOutcome, type WorkoutSlot, type WorkoutStatus } from "../domain/ExecutionModel.ts";
import { displayOrder, endInstantAfter, instantFromLocal, localDateOf, localMinuteOfDay, nextOutcome, sessionDurationSec, type SetField } from "../domain/ExecutionRules.ts";
import { durationText, timeText } from "../../../../shared/format/clockText.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { ActiveWorkoutsSheet, ExerciseMenuSheet, RpeSheet, SetTypeSheet, SupersetPickSheet, type ExerciseMenuAction } from "./SetPickers.tsx";
import { factVolume } from "./programMatrix.ts";
import { WorkoutSharePoster } from "./WorkoutSharePoster.tsx";
import { labeledPlan, labeledWithDrops } from "./shareFormat.ts";
import { compactValues, compactWithDrops, diaryFields, fieldHeaders, fieldNames, parseField, planText, rawOf, rpeTone, sanitizeField,
  setTypeLabels, setTypeTone, shortDate, workoutStatusLabels } from "./setFormat.ts";
import { extraWarmups, useWorkoutDiary, type SetPatch } from "./useWorkoutDiary.ts";
import { PendingInputWrites } from "../domain/PendingInputWrites.ts";

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

type PendingRegistry = PendingInputWrites;
type SetTarget = Readonly<{ exercise: PlannedExercise; set: PlannedSet; position: number }>;

const hasValues = (values: SetValues) => Object.values(values).some((value) => value !== null);

/** Заголовок колонки в одну строку: при нехватке места шрифт ужимается. */
const oneLine = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7 } as const;

/**
 * Ячейка фактического значения: свой текст ввода; запись — через паузу после ввода или при уходе фокуса.
 * Отложенная запись регистрируется, чтобы смена исхода сначала дописала последнее значение (§48.23 п. 5).
 * Кнопка клавиатуры: «Далее» — в соседнюю ячейку строки (повторы → кг), на последней — «Готово».
 */
const ValueCell = forwardRef(function ValueCell({ cellKey, field, value, pending, onNext, onCommit }: Readonly<{
  cellKey: string; field: SetField; value: number | null; pending: PendingRegistry;
  /** Следующая ячейка строки; нет — ячейка последняя. */
  onNext: (() => void) | null;
  onCommit: (value: number | null) => Promise<unknown>;
}>, ref: Ref<TextInput>) {
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
    if (focused.current || pending.has(cellKey)) return;
    textRef.current = raw;
    setText(raw);
    setInvalid(false);
  }, [raw, pending, cellKey]);

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    return pending.flush(cellKey);
  }, [cellKey, pending]);

  useEffect(() => () => { if (pending.has(cellKey)) flush(); }, [cellKey, flush, pending]);

  return (
    <TextInput ref={ref} value={text} placeholder="—" placeholderTextColor={colors.textMuted} selectTextOnFocus
      keyboardType={field === "durationSec" ? "numbers-and-punctuation" : field === "loadGrams" ? "decimal-pad" : "number-pad"}
      accessibilityLabel={fieldNames[field]}
      returnKeyType={onNext === null ? "done" : "next"} submitBehavior={onNext === null ? "blurAndSubmit" : "submit"}
      onSubmitEditing={() => onNext?.()}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; flush(); }}
      onChangeText={(typed) => {
        const next = sanitizeField(field, typed);
        textRef.current = next;
        setText(next);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
        const parsed = parseField(field, next);
        setInvalid(parsed === "invalid");
        pending.set(cellKey, async () => {
          if (parsed === "invalid") return false;
          if (parsed === valueRef.current) return true;
          return await commitRef.current(parsed) !== null;
        });
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
      }}
      style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.surface,
        borderColor: invalid ? colors.danger : colors.border }]} />
  );
});

/**
 * Заметка о выполнении упражнения (§48.67): запись через паузу после ввода или при уходе фокуса; отложенная
 * запись дописывается перед сменой исхода, как у значений подходов.
 */
function NoteField({ noteKey, value, pending, onCommit }: Readonly<{
  noteKey: string; value: string; pending: PendingRegistry; onCommit: (text: string) => Promise<unknown>;
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
    if (focused.current || pending.has(noteKey)) return;
    textRef.current = value;
    setText(value);
    if (value !== "") setOpen(true);
  }, [value, pending, noteKey]);
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    return pending.flush(noteKey);
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
        pending.set(noteKey, async () => next.trim() === valueRef.current.trim() || await commitRef.current(next) !== null);
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
  onSave: (target: SetTarget, patch: SetPatch) => Promise<unknown>;
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
    : confirmed ? withAlpha(colors.success, 0.14) : colors.surfaceRaised;
  const manualSpacer = mode === "MANUAL" ? <View style={styles.side} /> : null;
  const inputs = useRef(new Map<string, TextInput | null>()).current;
  /** Ячейки одной строки (подход, сторона или мини-сет) с переходом «Далее» слева направо. */
  const cells = (prefix: string, valueOf: (field: SetField) => number | null, commit: (field: SetField, value: number | null) => Promise<unknown>) =>
    fields.map((field, index) => {
      const next = fields[index + 1];
      return (
        <ValueCell key={field} ref={(node) => { inputs.set(`${prefix}:${field}`, node); }} cellKey={`${prefix}:${field}`}
          field={field} value={valueOf(field)} pending={pending}
          onNext={next === undefined ? null : () => inputs.get(`${prefix}:${next}`)?.focus()}
          onCommit={(value) => commit(field, value)} />
      );
    });
  // §48.80: одна засчитанная сторона — подход частично выполнен (номер подсвечен наполовину).
  const partial = sided && confirmed && fact?.sides?.left.confirmed !== fact?.sides?.right.confirmed;
  const full = confirmed && !partial;
  const sideRow = (side: Side) => {
    const sideFact = side === "L" ? fact?.sides?.left : fact?.sides?.right;
    const done = sideFact?.confirmed === true;
    return <>
      <Text accessibilityLabel={`${side === "L" ? "Левая" : "Правая"} сторона${done ? ", выполнена" : ""}`}
        style={[styles.sideLabel, { color: done ? colors.success : colors.textSecondary }]}>{side === "L" ? "Л" : "П"}</Text>
      {cells(`${set.id}:${side}`, (field) => sideFact?.values[field] ?? null,
        (field, value) => onSave(target, { side: { side, fields: { [field]: value } } }))}
    </>;
  };
  const sideCheck = (side: Side) => {
    const done = (side === "L" ? fact?.sides?.left.confirmed : fact?.sides?.right.confirmed) === true;
    return (
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} hitSlop={6}
        accessibilityLabel={`${side === "L" ? "Левая" : "Правая"} сторона: ${done ? "снять отметку" : "отметить выполненной"}`}
        onPress={() => onToggle(target, side)}
        style={[styles.check, { borderColor: done ? colors.success : colors.border, backgroundColor: done ? colors.success : colors.surface }]}>
        <Check size={18} color={done ? colors.canvas : colors.border} strokeWidth={2.4} />
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
        <Text style={[styles.plan, { color: colors.textSecondary }]} numberOfLines={1}>{number === null ? "—" : planText(set, fields)}</Text>
        {/* «Пред.» — кнопка-плашка (UI-OWN-037): нажатие переносит прошлый результат в подход. */}
        <Pressable accessibilityRole="button" disabled={previous === undefined} hitSlop={6}
          style={({ pressed }) => [styles.previous, previous === undefined ? null : [styles.previousChip, {
            borderColor: withAlpha(colors.accentInk, 0.45), backgroundColor: withAlpha(colors.accentInk, pressed ? 0.22 : 0.1) }]]}
          accessibilityLabel={previous === undefined ? "Прошлого результата нет" : `Перенести прошлый результат ${previousText}`}
          onPress={() => {
            if (previous === undefined) return;
            if (previous.sides !== null) { onSave(target, { sidesFrom: previous.sides }); return; }
            onSave(target, type === "DROP" ? { fields: previous.values, drops: previous.drops } : { fields: previous.values });
          }}>
          <Text style={[styles.previousText, { color: previous === undefined ? colors.textMuted : colors.accentInk }]} numberOfLines={1}
            adjustsFontSizeToFit minimumFontScale={0.85}>
            {previousText}
          </Text>
        </Pressable>
        {sided ? sideRow("L") : cells(set.id, (field) => fact?.values[field] ?? null,
          (field, value) => onSave(target, { fields: { [field]: value } }))}
        <Pressable accessibilityRole="button" accessibilityLabel={fact?.rpe ? `RPE ${fact.rpe}. Изменить` : "Указать RPE"} hitSlop={6}
          onPress={() => onPickRpe(target)} style={styles.side}>
          {fact?.rpe ? <Text style={[styles.rpeText, { color: rpeTone(fact.rpe, colors) }]}>{fact.rpe}</Text>
            : <Gauge size={20} color={colors.textMuted} strokeWidth={1.8} />}
        </Pressable>
        {mode === "MANUAL" && sided ? sideCheck("L") : null}
        {mode === "MANUAL" && !sided ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}
            accessibilityLabel={confirmed ? "Снять отметку выполнения" : "Отметить подход выполненным"} hitSlop={6}
            onPress={() => onToggle(target)}
            style={[styles.check, { borderColor: confirmed ? colors.success : colors.border,
              backgroundColor: confirmed ? colors.success : colors.surface }]}>
            <Check size={18} color={confirmed ? colors.canvas : colors.border} strokeWidth={2.4} />
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
            {cells(`${set.id}:d${index}`, (field) => drop[field],
              (field, value) => onSave(target, { drop: { index, fields: { [field]: value } } }))}
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
export function WorkoutScreen({ slot, clientName, plans, execution, restTimers, activeWorkouts, onOpenWorkout,
  exercises, onChangeWeek, onEditWeek, onOpenMatrix, onPickExercises, picked, onOpenExercise, renderParticipants }: Readonly<{
  slot: WorkoutSlot;
  /** Подпись таймера отдыха — таймеры разных клиентов различимы (§48.62). */
  clientName: string;
  plans: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  restTimers: RestTimersPort;
  /** §48.83: тренировки «в работе» у других клиентов и переход к их дневнику. */
  activeWorkouts: ActiveWorkoutsPort;
  onOpenWorkout: (slot: WorkoutSlot) => void;
  exercises: ExerciseLookupPort;
  onChangeWeek: (weekIndex: number, workoutId: string | null, mesocycleId: string | null) => void;
  onEditWeek: (mesocycleId: string | null) => void;
  /** «Обзор программы» и щипок — матрица недель (UI-OWN-037). */
  onOpenMatrix: () => void;
  /** UI-OWN-043: полоса участников группы; `finishInput` дописывает ввод перед переключением. */
  renderParticipants?: (finishInput: () => Promise<boolean>) => ReactNode;
  /** Каталог: добавить упражнения или (`replace`) заменить это. Результат приходит в `picked`. */
  onPickExercises: (replace?: string) => void;
  picked: PickedExercise | null;
  /** «›» у названия — карточка упражнения. */
  onOpenExercise?: (exerciseId: string) => void;
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
  const pending = useRef(new PendingInputWrites()).current;
  const typeSheet = useRef<BottomSheetModal>(null);
  const rpeSheet = useRef<BottomSheetModal>(null);
  const [target, setTarget] = useState<SetTarget | null>(null);
  const [removeDrops, setRemoveDrops] = useState<Readonly<{ target: SetTarget; setType: SetType }> | null>(null);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  /** Какая отметка времени сейчас правится (PC §48.86.13). */
  const [timeEdit, setTimeEdit] = useState<"start" | "end" | null>(null);
  const [exitAction, setExitAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [busy, setBusy] = useState(false);
  const [restFor, setRestFor] = useState<PlannedExercise | null>(null);
  const [restError, setRestError] = useState<string | null>(null);
  const { saveSet, toggleSet, setOutcome, addWarmup, removeWarmup } = diary;
  const [removeWarm, setRemoveWarm] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeSheet = useRef<BottomSheetModal>(null);
  const [others, setOthers] = useState<readonly ActiveWorkoutCard[]>([]);
  const [weekNavigation, setWeekNavigation] = useState<WorkoutWeekNavigation | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const navigationAuthorized = useRef(false);
  // UI-OWN-037: правка плана из дневника — действие на месте, затем выбор области в окне.
  const menuSheet = useRef<BottomSheetModal>(null);
  const supersetSheet = useRef<BottomSheetModal>(null);
  const [menuFor, setMenuFor] = useState<PlannedExercise | null>(null);
  const [edit, setEdit] = useState<DiaryEdit | null>(null);
  const [ordering, setOrdering] = useState<readonly string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // Запас снизу под панель таймеров отдыха — только пока она видна (иначе внизу пустое место).
  const [timers, setTimers] = useState(() => restTimers.list().length);
  useEffect(() => restTimers.subscribe(() => setTimers(restTimers.list().length)), [restTimers]);
  const posterRef = useRef<View>(null);
  const appliedPick = useRef<string | null>(null);
  useEffect(() => {
    if (!picked || appliedPick.current === picked.token) return;
    appliedPick.current = picked.token;
    const [first] = picked.exerciseIds;
    if (picked.replace !== undefined && first !== undefined) setEdit({ kind: "replace", exerciseId: picked.replace, newExerciseId: first });
    else if (picked.exerciseIds.length > 0) setEdit({ kind: "addExercises", exerciseIds: picked.exerciseIds });
  }, [picked]);
  useEffect(() => {
    let active = true;
    const load = () => { void plans.getWorkoutWeekNavigation(slot.clientId, slot.programId, slot.plannedWorkoutId)
      .then((value) => { if (active) setWeekNavigation(value); })
      .catch(() => { if (active) setNavigationError("Не удалось загрузить недели программы."); }); };
    load();
    const unsubscribe = plans.subscribeCommittedChanges((change) => { if (change.clientIds.includes(slot.clientId)) load(); });
    return () => { active = false; unsubscribe(); };
  }, [plans, slot.clientId, slot.programId, slot.plannedWorkoutId]);
  useEffect(() => {
    let active = true;
    const load = () => {
      activeWorkouts.list().then((cards) => {
        if (!active) return;
        setOthers(cards.filter((card) => !(card.slot.clientId === slot.clientId && card.slot.programId === slot.programId
          && card.slot.weekIndex === slot.weekIndex && card.slot.plannedWorkoutId === slot.plannedWorkoutId)));
      }).catch(() => undefined);
    };
    load();
    const unsubscribe = activeWorkouts.subscribe(load);
    return () => { active = false; unsubscribe(); };
  }, [activeWorkouts, slot.clientId, slot.plannedWorkoutId, slot.programId, slot.weekIndex]);

  /** §48.56: отдых упражнения сохраняется в план — у каждого упражнения свой таймер. */
  const saveRest = (exercise: PlannedExercise, restSec: number | null) => {
    setRestError(null);
    void plans.setExerciseRest(slot.clientId, slot.programId, exercise.id, restSec).catch(() => {
      setRestError("Не удалось изменить отдых. План не изменён — повторите.");
    });
  };

  const flushPending = useCallback(() => pending.flushAll(), [pending]);
  const finishInput = async () => {
    const inputsSaved = await flushPending();
    const queueSaved = await diary.finishSaving();
    if (!inputsSaved || !queueSaved) {
      setNavigationError("Не удалось сохранить весь ввод. Проверьте поля и повторите переход — введённые значения оставлены на экране.");
      return false;
    }
    setNavigationError(null);
    return true;
  };
  const changeWeek = async (index: number) => {
    if (busy || index === slot.weekIndex) return;
    const targetWeek = weekNavigation?.weeks.find((week) => week.index === index);
    if (!targetWeek) return;
    setBusy(true);
    try {
      if (!await finishInput()) return;
      // Без соответствующей тренировки — уход к списку недели (экран закрывается); иначе тот же экран, другая неделя.
      if (targetWeek.workoutId === null) navigationAuthorized.current = true;
      Keyboard.dismiss();
      onChangeWeek(index, targetWeek.workoutId, weekNavigation?.mesocycleId ?? null);
    } finally { setBusy(false); }
  };
  const currentWeek = weekNavigation?.weeks.findIndex((week) => week.index === slot.weekIndex) ?? -1;
  // Дневник в цвете типа своей недели (UI-OWN-039); «Индивидуальная» — цвет темы.
  const weekType = weekNavigation?.weeks[currentWeek]?.type;
  useReportScreenTone(weekType === undefined || weekType === "base" ? null : weekTypeTone(weekType, colors));
  const previousWeek = weekNavigation?.weeks[currentWeek - 1];
  const nextWeek = weekNavigation?.weeks[currentWeek + 1];
  useWeekNavigation(weekNavigation === null ? null : { week: slot.weekIndex, busy,
    previous: previousWeek ? () => { void changeWeek(previousWeek.index); } : null,
    next: nextWeek ? () => { void changeWeek(nextWeek.index); } : null });

  const onSave = useCallback((item: SetTarget, patch: SetPatch) =>
    saveSet(item.exercise, item.set, item.position, patch), [saveSet]);
  // Перед отметкой дописываются только ячейки этого подхода: ошибка в другом подходе её не блокирует.
  const onToggle = useCallback((item: SetTarget, side?: Side) => {
    void pending.flushPrefix(`${item.set.id}:`).then((saved) => {
      if (saved) { setNavigationError(null); void toggleSet(item.exercise, item.set, item.position, side); return; }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      setNavigationError("В этом подходе неверное значение — исправьте подсвеченную ячейку и отметьте снова.");
    });
  }, [pending, toggleSet]);
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
  usePreventRemove(true, ({ data }) => {
    if (navigationAuthorized.current) { navigation.dispatch(data.action); return; }
    if (busy) return;
    setBusy(true);
    void finishInput().then((saved) => {
      if (!saved) return;
      if (diary.status === "IN_PROGRESS") setExitAction(data.action);
      else navigation.dispatch(data.action);
    }).finally(() => setBusy(false));
  });

  const incomplete = useMemo(() => (diary.workout?.exercises.some((exercise) => exercise.sets.some((set) =>
    diary.state?.facts.get(set.id)?.confirmed !== true)) ?? false)
    || [...(diary.state?.facts.values() ?? [])].some((fact) => fact.extra && !fact.confirmed), [diary.state, diary.workout]);

  const applyOutcome = async (next: WorkoutOutcome | null) => {
    setBusy(true);
    try { if (!await finishInput()) return null; return await setOutcome(next); } finally { setBusy(false); }
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
  const volumeOf = (exerciseId: string) => [...state.facts.values()].filter((fact) => fact.plannedExerciseId === exerciseId)
    .reduce((sum, fact) => sum + factVolume(fact), 0);
  const workoutVolume = workout.exercises.reduce((sum, exercise) => sum + volumeOf(exercise.id), 0);
  const kg = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} кг`;
  const shareRows = workout.exercises.map((exercise) => {
    const fields = diaryFields(lookup.get(exercise.exerciseId)?.metrics ?? []);
    return { name: lookup.get(exercise.exerciseId)?.name ?? "Упражнение", sets: exercise.sets.map((set) => {
      const fact = state.facts.get(set.id);
      return fact !== undefined && hasValues(fact.values) ? labeledWithDrops(fact.values, fact.drops, fields, rawOf)
        : `план: ${labeledPlan(planText(set, fields), fields)}`;
    }) };
  });
  const share = () => {
    if (sharing) return;
    setNotice(null);
    setSharing(true);
    // Как в календаре: картинка рисуется вне экрана один кадр, снимается и уходит в «Поделиться».
    setTimeout(() => {
      void (async () => {
        try {
          if (!(await Sharing.isAvailableAsync())) throw new Error("SHARE_UNAVAILABLE");
          const uri = await captureRef(posterRef, { format: "png", quality: 1, result: "tmpfile", width: 1080 });
          await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Тренировка" });
        } catch { setNavigationError("Не удалось подготовить картинку тренировки. Дневник не изменён."); }
        finally { setSharing(false); }
      })();
    }, 150);
  };
  const openMatrix = () => {
    if (busy) return;
    setBusy(true);
    void finishInput().then((saved) => { if (saved) { Keyboard.dismiss(); onOpenMatrix(); } }).finally(() => setBusy(false));
  };
  const pinch = Gesture.Pinch().onEnd((event) => {
    "worklet";
    if (event.scale < 0.75) scheduleOnRN(openMatrix);
  });
  const indexOf = (exercise: PlannedExercise) => workout.exercises.findIndex((item) => item.id === exercise.id);
  const menuAction = (action: ExerciseMenuAction) => {
    menuSheet.current?.dismiss();
    const exercise = menuFor;
    if (exercise === null) return;
    flushPending();
    if (action === "order") setOrdering(workout.exercises.map((item) => item.id));
    else if (action === "replace") onPickExercises(exercise.id);
    else if (action === "superset") supersetSheet.current?.present();
    else if (action === "leaveSuperset") setEdit({ kind: "leaveSuperset", exerciseId: exercise.id });
    else if (action === "remove") setEdit({ kind: "remove", exerciseId: exercise.id });
    else if (weekNavigation !== null) {
      const cycleId = weekNavigation.mesocycleId;
      setBusy(true);
      void finishInput().then((saved) => { if (saved) { Keyboard.dismiss(); onEditWeek(cycleId); } }).finally(() => setBusy(false));
    }
  };

  const chooseType = async (setType: SetType) => {
    typeSheet.current?.dismiss();
    if (target === null || setType === (targetFact?.setType ?? "NORMAL")) return;
    if (!await finishInput()) return;
    // Как в 2.0: разминка — новый подход сверху, выбранный подход не меняется.
    if (setType === "WARMUP") { void addWarmup(target.exercise); return; }
    // Заполненные мини-сеты не убираются молча: сначала вопрос.
    if (targetFact?.setType === "DROP" && targetFact.drops.some(hasValues)) { setRemoveDrops({ target, setType }); return; }
    onSave(target, { setType });
  };

  return (
    <>
      {renderParticipants?.(finishInput)}
      <GestureDetector gesture={pinch}>
      <KeyboardAwareScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={[styles.content, { paddingBottom: timers > 0 ? 200 : 24 }]}
        keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <View style={[styles.topCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.titleRow}>
            <View style={[styles.stripe, { backgroundColor: colors.accentFill }]} />
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.heading, { color: colors.textPrimary }]}>{workout.title}</Text>
            <View style={styles.volume}>
              <Text style={[styles.volumeLabel, { color: colors.textMuted }]}>Объём</Text>
              <Text style={[styles.volumeValue, { color: colors.textPrimary }]}>{kg(workoutVolume)}</Text>
            </View>
          </View>
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
                  style={[styles.dateButton, { backgroundColor: colors.surfaceRaised }]}>
                  <CalendarDays size={15} color={colors.accentInk} strokeWidth={2} />
                  <Text style={[styles.dateText, { color: colors.accentInk }]}>{shortDate(state.session.actualDate)}</Text>
                </Pressable>
              ) : null}
              {others.length > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Другие тренировки в работе: ${others.length}. Перейти`}
                  hitSlop={6} onPress={() => { flushPending(); Keyboard.dismiss(); activeSheet.current?.present(); }}
                  style={[styles.othersButton, { backgroundColor: colors.surfaceRaised }]}>
                  <Users size={14} color={colors.accentInk} strokeWidth={2} />
                  <Text style={[styles.othersText, { color: colors.accentInk }]}>{`ещё ${others.length}`}</Text>
                </Pressable>
              ) : null}
            </View>
            <StatusTag kind={statusKinds[diary.status]} label={workoutStatusLabels[diary.status]} />
          </View>
          {state.session !== null ? (
            // PC §48.86.13: начало ставится по первому подтверждённому подходу, окончание — при «Завершить»; обе отметки можно исправить.
            <View style={styles.timeRow}>
              {([["start", "Начало", state.session.startedAt], ["end", "Окончание", state.session.finishedAt]] as const).map(([kind, label, instant]) => (
                <Pressable key={kind} accessibilityRole="button" hitSlop={6}
                  accessibilityLabel={`${label} тренировки ${instant === null ? "не указано" : timeText(instant)}. Изменить`}
                  onPress={() => { flushPending(); Keyboard.dismiss(); setTimeEdit(kind); }}
                  style={[styles.dateButton, { backgroundColor: colors.surfaceRaised }]}>
                  <Clock size={15} color={colors.accentInk} strokeWidth={2} />
                  <Text style={[styles.dateText, { color: colors.accentInk }]}>{`${label} ${instant === null ? "—" : timeText(instant)}`}</Text>
                </Pressable>
              ))}
              {state.session.startedAt !== null && state.session.finishedAt !== null
                ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{sessionDurationSec(state.session.startedAt, state.session.finishedAt) === null
                  ? "Длительность: нет данных" : durationText(sessionDurationSec(state.session.startedAt, state.session.finishedAt)!)}</Text> : null}
            </View>
          ) : null}
          <View style={styles.actions}>
            {([
              { label: "Добавить упражнение", icon: <Plus size={16} color={colors.accentInk} strokeWidth={2.2} />,
                onPress: () => { flushPending(); Keyboard.dismiss(); onPickExercises(); } },
              { label: "Обзор программы", icon: <LayoutGrid size={16} color={colors.accentInk} strokeWidth={2} />, onPress: openMatrix },
              { label: "Поделиться", icon: <Share2 size={16} color={colors.accentInk} strokeWidth={2} />, onPress: share },
            ] as const).map((action) => (
              <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} disabled={busy || sharing}
                onPress={action.onPress} style={({ pressed }) => [styles.action, {
                  backgroundColor: pressed ? colors.surfaceRaised : colors.accentSoft, opacity: busy || sharing ? 0.6 : 1 }]}>
                {action.icon}
                <Text numberOfLines={2} style={[styles.actionText, { color: colors.accentInk }]}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
          {weekNavigation !== null ? (
            <WeekCards weeks={weekNavigation.weeks} selected={slot.weekIndex} disabled={busy || diary.switching}
              onSelect={(index) => { void changeWeek(index); }} />
          ) : null}
        </View>
        {diary.message !== null ? <InlineNotice kind="error">{diary.message}</InlineNotice> : null}
        {navigationError !== null ? <InlineNotice kind="error">{navigationError}</InlineNotice> : null}
        {restError !== null ? <InlineNotice kind="error">{restError}</InlineNotice> : null}
        {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
        {ordering !== null ? <>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>Перетащите упражнения за ручку, затем «Готово».</Text>
          <Sortable.Grid data={[...ordering]} keyExtractor={(id) => id} columns={1} rowGap={8} customHandle activeItemScale={1.03}
            renderItem={({ item }: Readonly<{ item: string }>) => {
              const exercise = workout.exercises.find((value) => value.id === item);
              return (
                <View style={[styles.orderRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Sortable.Handle>
                    <View accessible accessibilityLabel={`Перетащить: ${lookup.get(exercise?.exerciseId ?? "")?.name ?? "упражнение"}`} style={styles.handle}>
                      <GripVertical size={20} color={colors.textMuted} strokeWidth={1.8} />
                    </View>
                  </Sortable.Handle>
                  <Text style={[styles.exercise, styles.grow, { color: colors.textPrimary }]}>
                    {lookup.get(exercise?.exerciseId ?? "")?.name ?? "Упражнение"}
                  </Text>
                </View>
              );
            }}
            onDragEnd={({ data }) => setOrdering(data)} />
          <View style={styles.orderActions}>
            <View style={styles.grow}><AppButton compact variant="secondary" label="Отмена" onPress={() => setOrdering(null)} /></View>
            <View style={styles.grow}><AppButton compact label="Готово" onPress={() => {
              const order = ordering;
              setOrdering(null);
              if (order.some((id, index) => workout.exercises[index]?.id !== id)) setEdit({ kind: "reorder", order });
            }} /></View>
          </View>
        </> : null}
        {/* Смена недели — тот же экран: пока грузится новая неделя, прежние значения приглушены и не нажимаются. */}
        {ordering === null ? <View pointerEvents={diary.switching ? "none" : "auto"} style={[styles.body, diary.switching && styles.switching]}>
        {workout.exercises.map((exercise) => {
          const info = lookup.get(exercise.exerciseId);
          const group = supersetNumber(workout, exercise);
          const fields = diaryFields(info?.metrics ?? []);
          const extras = extraWarmups(state, exercise.id).map((fact) => ({ set: { id: fact.plannedSetId, reps: null, repsMax: null,
            loadGrams: null, durationSec: null, distanceM: null }, position: fact.position, setType: fact.setType }));
          const rows = displayOrder([...extras, ...exercise.sets.map((set, position) => ({ set, position,
            setType: state.facts.get(set.id)?.setType ?? "NORMAL" }))]);
          const done = rows.filter(({ item }) => state.facts.get(item.set.id)?.confirmed === true).length;
          const extraIds = new Set(extras.map((extra) => extra.set.id));
          // Ключи — по месту в плане, а не по ID недели: при смене недели строки не пересоздаются.
          return (
            <View key={exercise.lineageId ?? exercise.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {group !== null ? <Text style={[styles.meta, { color: colors.accentInk }]}>{`Суперсет ${group}`}</Text> : null}
              <View style={styles.cardHead}>
                {info?.thumbnail != null ? <Image source={info.thumbnail} style={[styles.thumb, { backgroundColor: colors.input }]} /> : null}
                <View style={styles.exerciseText}>
                  <Pressable accessibilityRole={onOpenExercise === undefined ? undefined : "button"} disabled={onOpenExercise === undefined}
                    accessibilityLabel={`${info?.name ?? "Упражнение"}. Открыть карточку упражнения`} hitSlop={4}
                    onPress={() => onOpenExercise?.(exercise.exerciseId)} style={styles.nameRow}>
                    <Text style={[styles.exercise, styles.nameText, { color: colors.textPrimary }]}>{info?.name ?? "Упражнение"}</Text>
                    {onOpenExercise !== undefined ? <ChevronRight size={16} color={colors.accentInk} strokeWidth={2.4} /> : null}
                  </Pressable>
                  <View style={styles.subRow}>
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { Keyboard.dismiss(); setRestFor(exercise); }}
                    accessibilityLabel={exercise.restSec === null ? "Таймер отдыха выключен. Изменить"
                      : `Отдых ${formatDuration(exercise.restSec)}. Изменить`}
                    style={styles.rest}>
                    <Timer size={15} color={exercise.restSec === null ? colors.textMuted : colors.accentInk} strokeWidth={2} />
                    <Text style={[styles.restText, { color: exercise.restSec === null ? colors.textMuted : colors.accentInk }]}>
                      {exercise.restSec === null ? "Без таймера" : formatDuration(exercise.restSec)}
                    </Text>
                  </Pressable>
                  {exercise.rir !== null ? (
                    <Text accessibilityLabel={`Плановый RIR ${formatRange(exercise.rir)}`}
                      style={[styles.restText, { color: colors.textSecondary }]}>{`RIR ${formatRange(exercise.rir)}`}</Text>
                  ) : null}
                  <Text accessibilityLabel={`Объём ${kg(volumeOf(exercise.id))}, выполнено ${done} из ${rows.length}`}
                    style={[styles.restText, styles.cardVolume, { color: colors.textSecondary }]}>
                    <Text style={{ color: colors.accentInk }}>{kg(volumeOf(exercise.id))}</Text>{` · ${done}/${rows.length}`}
                  </Text>
                  </View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Действия: ${info?.name ?? "упражнение"}`} hitSlop={6}
                  onPress={() => { flushPending(); Keyboard.dismiss(); setMenuFor(exercise); menuSheet.current?.present(); }}
                  style={styles.more}>
                  <EllipsisVertical size={20} color={colors.textPrimary} strokeWidth={2} />
                </Pressable>
              </View>
              {exercise.instruction !== null ? (
                <Text accessibilityLabel={`Указание тренера: ${exercise.instruction}`}
                  style={[styles.instructionText, { color: colors.textSecondary, borderColor: colors.border }]}>
                  {exercise.instruction}
                </Text>
              ) : null}
              <View style={[styles.row, styles.headRow]}>
                {/* Заголовки — в одну строку: в ручном режиме колонкам теснее, шрифт ужимается, а не переносится. */}
                <Text {...oneLine} style={[styles.markerSpace, styles.head, { color: colors.textMuted }]}>Сет</Text>
                <Text {...oneLine} style={[styles.grow, styles.head, { color: colors.textMuted }]}>План</Text>
                <Text {...oneLine} style={[styles.grow, styles.head, { color: colors.textMuted }]}>Пред.</Text>
                {fields.map((field) => <Text key={field} {...oneLine} style={[styles.inputHead, styles.head, { color: colors.textMuted }]}>{fieldHeaders[field]}</Text>)}
                <Text {...oneLine} style={[styles.sideHead, styles.head, { color: colors.textMuted }]}>RPE</Text>
                {mode === "MANUAL" ? <View style={styles.side} /> : null}
              </View>
              {rows.map(({ item, number }) => (
                <SetRow key={extraIds.has(item.set.id) ? item.set.id : `p:${item.position}`} target={{ exercise, set: item.set, position: item.position }} number={number}
                  fact={state.facts.get(item.set.id)} previous={previous.get(item.set.id)} fields={fields} mode={mode}
                  sided={info?.unilateral === true}
                  pending={pending} onSave={onSave} onToggle={onToggle} onPickType={onPickType} onPickRpe={onPickRpe} />
              ))}
              <Pressable accessibilityRole="button" accessibilityLabel={`Добавить подход: ${info?.name ?? "упражнение"}`}
                onPress={() => { flushPending(); setEdit({ kind: "addSet", exerciseId: exercise.id }); }}
                style={({ pressed }) => [styles.addSet, { borderColor: colors.accentInk, backgroundColor: pressed ? colors.accentSoft : "transparent" }]}>
                <Plus size={15} color={colors.accentInk} strokeWidth={2.2} />
                <Text style={[styles.addSetText, { color: colors.accentInk }]}>Подход</Text>
              </Pressable>
              <NoteField noteKey={`note:${exercise.id}`} value={state.notes.get(exercise.id) ?? ""} pending={pending}
                onCommit={(text) => diary.saveNote(exercise.id, text)} />
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
        </View> : null}
      </KeyboardAwareScrollView>
      </GestureDetector>
      {/* PC §48.86.13: ручная правка отметок; окончание после полуночи учитывается, длительность — только при валидной паре. */}
      <TimeWheelPicker visible={timeEdit !== null} minuteStep={1} min={0} max={24 * 60 - 1}
        title={timeEdit === "end" ? "Окончание тренировки" : "Начало тренировки"}
        value={(() => {
          const known = timeEdit === "end" ? state.session?.finishedAt : state.session?.startedAt;
          return known === null || known === undefined ? localMinuteOfDay(new Date().toISOString()) : localMinuteOfDay(known);
        })()}
        clearLabel="Убрать отметку"
        onClear={() => {
          const session = state.session;
          if (session !== null && timeEdit !== null) void diary.setTimes({ startedAt: timeEdit === "start" ? null : session.startedAt,
            finishedAt: timeEdit === "end" ? null : session.finishedAt });
        }}
        onConfirm={(minute) => {
          const session = state.session;
          if (session === null || timeEdit === null) return;
          void diary.setTimes(timeEdit === "start"
            ? { startedAt: instantFromLocal(session.actualDate, minute), finishedAt: session.finishedAt }
            : { startedAt: session.startedAt, finishedAt: endInstantAfter(session.startedAt, session.actualDate, minute) });
        }}
        onClose={() => setTimeEdit(null)} />
      <DurationWheelPicker visible={restFor !== null} title="Отдых после подхода"
        value={restFor?.restSec ?? REST_DEFAULT_SEC} min={REST_MIN_SEC} max={REST_MAX_SEC}
        clearLabel={restFor?.restSec === null ? undefined : "Без таймера"}
        onConfirm={(seconds) => { if (restFor !== null) saveRest(restFor, seconds); }}
        onClear={() => { if (restFor !== null) saveRest(restFor, null); }}
        onClose={() => setRestFor(null)} />
      <ActiveWorkoutsSheet ref={activeSheet} cards={others}
        onOpen={(card) => {
          if (busy) return;
          setBusy(true);
          void finishInput().then((saved) => {
            if (saved) { activeSheet.current?.dismiss(); onOpenWorkout(card.slot); }
          }).finally(() => setBusy(false));
        }} />
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
          void finishInput().then((saved) => saved ? diary.deleteExecution() : null)
            .finally(() => { setBusy(false); setConfirmDelete(false); });
        }} />
      <ConfirmDialog visible={confirmIncomplete} title="Не все подходы выполнены"
        description="Тренировку можно завершить и так: незаполненные подходы останутся пустыми, введённые результаты сохранятся."
        confirmLabel="Завершить" cancelLabel="Вернуться" confirmBusy={busy}
        onCancel={() => setConfirmIncomplete(false)}
        onConfirm={() => { void applyOutcome("COMPLETED").finally(() => setConfirmIncomplete(false)); }} />
      <ExerciseMenuSheet ref={menuSheet} title={lookup.get(menuFor?.exerciseId ?? "")?.name ?? "Упражнение"}
        inSuperset={menuFor?.supersetId !== undefined} canReorder={workout.exercises.length > 1}
        canSuperset={menuFor !== null && workout.exercises.length > 1} onSelect={menuAction} />
      <SupersetPickSheet ref={supersetSheet}
        above={menuFor === null ? null : lookup.get(workout.exercises[indexOf(menuFor) - 1]?.exerciseId ?? "")?.name ?? null}
        below={menuFor === null ? null : lookup.get(workout.exercises[indexOf(menuFor) + 1]?.exerciseId ?? "")?.name ?? null}
        onSelect={(side) => {
          supersetSheet.current?.dismiss();
          if (menuFor === null) return;
          const neighbour = workout.exercises[indexOf(menuFor) + (side === "above" ? -1 : 1)];
          if (neighbour !== undefined) setEdit({ kind: "superset", exerciseIds: side === "above" ? [neighbour.id, menuFor.id] : [menuFor.id, neighbour.id] });
        }} />
      <DiaryEditDialog clientId={slot.clientId} programId={slot.programId} mesocycleId={weekNavigation?.mesocycleId ?? null}
        weekIndex={slot.weekIndex} workoutId={slot.plannedWorkoutId} repository={plans} exercises={exercises} edit={edit}
        onClose={() => setEdit(null)} onDone={(text) => { setEdit(null); setNotice(text); }} />
      {sharing ? (
        <View pointerEvents="none" style={styles.offscreen}>
          <WorkoutSharePoster posterRef={posterRef} title={workout.title}
            subtitle={[clientName, `Неделя ${slot.weekIndex}`, state.session !== null ? shortDate(state.session.actualDate) : null]
              .filter(Boolean).join(" · ")} exercises={shareRows} />
        </View>
      ) : null}
      <ConfirmDialog visible={exitAction !== null} title="Завершить тренировку?"
        description="«Нет» — выйти и оставить тренировку в работе. Введённые результаты сохранятся."
        confirmLabel="Да" tertiaryLabel="Нет" cancelLabel="Остаться" confirmBusy={busy}
        onCancel={() => setExitAction(null)}
        onTertiary={() => {
          const action = exitAction;
          setBusy(true);
          void finishInput().then((saved) => {
            if (saved && action !== null) { setExitAction(null); navigation.dispatch(action); }
          }).finally(() => setBusy(false));
        }}
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
  content: { padding: 16, gap: 12 },
  heading: { flex: 1, fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  topCard: { ...shadow.card, borderRadius: 22, padding: 16, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stripe: { width: 4, alignSelf: "stretch", minHeight: 26, borderRadius: 2 },
  volume: { alignItems: "flex-end" },
  cardVolume: { marginLeft: "auto" },
  volumeLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, textTransform: "uppercase", letterSpacing: 1 },
  volumeValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  actions: { flexDirection: "row", gap: 6 },
  action: { flex: 1, minHeight: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 3,
    paddingHorizontal: 4, paddingVertical: 6 },
  actionText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 14, textAlign: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  nameText: { flexShrink: 1 },
  more: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  addSet: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderWidth: 1.5,
    borderStyle: "dashed", borderRadius: 14, marginTop: 4 },
  addSetText: { fontFamily: fonts.bold, fontSize: 14 },
  orderRow: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 12, paddingRight: 12, minHeight: 52 },
  handle: { width: 44, minHeight: 48, alignItems: "center", justifyContent: "center" },
  orderActions: { flexDirection: "row", gap: 8 },
  offscreen: { position: "absolute", left: -10000, top: 0 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  dateButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 28, borderRadius: 10, paddingHorizontal: 9 },
  dateText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  meta: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  card: { ...shadow.card, borderRadius: 22, padding: 14, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2, paddingHorizontal: 2 },
  thumb: { width: 40, height: 40, borderRadius: 12 },
  exerciseText: { flex: 1, gap: 0 },
  exercise: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rest: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 28 },
  restText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  block: { borderRadius: 12, paddingVertical: 3, paddingHorizontal: 4, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
  headRow: { minHeight: 20, paddingHorizontal: 2 },
  head: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.6 },
  grow: { flex: 1 },
  markerSpace: { width: 40 },
  marker: { width: 40, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  markerText: { fontFamily: fonts.bold, fontSize: 15 },
  plan: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, textAlign: "center" },
  previous: { flex: 1, minHeight: 34, justifyContent: "center" },
  previousChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 2 },
  previousText: { fontFamily: fonts.semibold, fontSize: 12, textAlign: "center" },
  instructionText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, borderLeftWidth: 2, paddingLeft: 8,
    marginHorizontal: 2, marginBottom: 2 },
  noteAdd: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, alignSelf: "flex-start", paddingHorizontal: 2 },
  noteAddText: { fontFamily: fonts.semibold, fontSize: 14 },
  note: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: "top",
    fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, marginTop: 4 },
  othersButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 28, borderRadius: 10, paddingHorizontal: 9 },
  othersText: { fontFamily: fonts.bold, fontSize: 12 },
  deleteRun: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 48, marginTop: 4 },
  deleteRunText: { fontFamily: fonts.medium, fontSize: 13 },
  sideLabel: { width: 14, textAlign: "center", fontFamily: fonts.semibold, fontSize: 12 },
  dropLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 12, textAlign: "right", paddingRight: 4 },
  inputHead: { width: 46 },
  input: { width: 46, height: 44, borderWidth: 1.5, borderRadius: 12, textAlign: "center", fontFamily: fonts.bold,
    fontSize: 15, paddingHorizontal: 2, paddingVertical: 0 },
  side: { width: 34, minHeight: 40, alignItems: "center", justifyContent: "center" },
  sideHead: { width: 34 },
  rpeText: { fontFamily: fonts.semibold, fontSize: 13, textAlign: "center" },
  check: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addDrop: { flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6 },
  addDropText: { fontFamily: fonts.medium, fontSize: 12 },
  dim: { opacity: 0.4 },
  body: { gap: 12 },
  switching: { opacity: 0.55 },
  outcomes: { flexDirection: "row", gap: 8, marginTop: 4 },
  outcome: { flex: 1, minHeight: 56, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6 },
  outcomeText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 15, textAlign: "center" },
});
