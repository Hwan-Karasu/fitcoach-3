import { useActiveWorkoutCards } from "./useActiveWorkoutCards.ts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { navigationPerformance } from "../../../../shared/diagnostics/NavigationPerformance.ts";
import { workoutNavigationProbe } from "../../../../shared/diagnostics/WorkoutNavigationProbe.ts";
import { Image, Keyboard, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import { usePreventRemove, useNavigation } from "@react-navigation/native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import Sortable from "react-native-sortables";
import { CalendarDays, ChevronRight, Clock, EllipsisVertical, GripVertical, LayoutGrid, Plus, Share2, Timer, Trash2,
  Users } from "lucide-react-native";
import { AppButton, ConfirmDialog, DurationWheelPicker, InlineNotice, LoadingState, pickDate, StatusTag, SupersetBorder, TimeWheelPicker, WeekCards, useWeekNavigation,
  type StatusKind } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { useReportScreenTone } from "../../../../shared/ui/theme/ScreenTone.tsx";
import { weekTypeTone, DiaryEditDialog, formatDuration, formatRange, supersetNumber, supersetRuns, REST_DEFAULT_SEC, REST_MAX_SEC, REST_MIN_SEC, useExerciseLookupState,
  type DiaryEdit, type ExerciseLookupPort, type PickedExercise, type PlannedExercise, type PlannedSet, type TrainingPlansRepositoryPort,
  type WorkoutWeekNavigation } from "../../plans/public.ts";
import { type ActiveWorkoutsPort, type SessionStatus, type SetFact, type SetType, type SetValues, type Side, type TrackingMetric,
  type WorkoutOutcome, type WorkoutSlot, type WorkoutStatus } from "../domain/ExecutionModel.ts";
import type { CalendarOutcomeEffect } from "../domain/WorkoutOutcomePort.ts";
import { currentMaxLoads, displayOrder, endInstantAfter, instantFromLocal, localDateOf, localMinuteOfDay, nextOutcome } from "../domain/ExecutionRules.ts";
import { timeText } from "../../../../shared/format/clockText.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { ActiveWorkoutsSheet, ExerciseMenuSheet, RpeSheet, SetTypeSheet, SupersetPickSheet, type ExerciseMenuAction } from "./SetPickers.tsx";
import { factVolume } from "./programMatrix.ts";
import { WorkoutSharePoster } from "./WorkoutSharePoster.tsx";
import { labeledPlan, labeledWithDrops } from "./shareFormat.ts";
import { diaryFields, fieldHeaders, planText, rawOf, shortDate, weekCardLabels, weekCardMarkers, workoutStatusLabels } from "./setFormat.ts";
import { weekCardStates, weekCardTone } from "../domain/WeekCardStatus.ts";
import { statusToneColor } from "../../../../shared/ui/theme/statusTone.ts";
import { diaryTimeNote } from "../domain/DiaryTimeNote.ts";
import { extraWarmups, useWorkoutDiary, type SetPatch } from "./useWorkoutDiary.ts";
import { PendingInputWrites } from "../domain/PendingInputWrites.ts";
import { NoteField, SetRow, type SetTarget } from "./WorkoutSetRow.tsx";
import { styles } from "./workoutStyles.ts";

const statusKinds: Readonly<Record<WorkoutStatus, StatusKind>> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", COMPLETED: "success", MISSED: "warning", CANCELLED: "warning",
};

const outcomeLabels: Readonly<Record<WorkoutOutcome, readonly [string, string]>> = {
  COMPLETED: ["Завершить тренировку", "Отменить завершение"],
  MISSED: ["Пропущена", "Отменить пропуск"],
  CANCELLED: ["Отменена", "Отменить отмену"],
};

const hasValues = (values: SetValues) => Object.values(values).some((value) => value !== null);

/** Величины упражнения, которого нет в справочнике: один и тот же массив, чтобы колонки не пересоздавались. */
const NO_METRICS: readonly TrackingMetric[] = [];
/** Неделя без занятия: шапка показывается теми же строками, но неактивными. */
const NO_SESSION = { actualDate: null, startedAt: null, finishedAt: null } as const;

const extraSets = new WeakMap<SetFact, PlannedSet>();
/** Плановая строка добавленной разминки; для одного факта — один и тот же объект (стабильные пропсы строки). */
function extraSetOf(fact: SetFact): PlannedSet {
  let set = extraSets.get(fact);
  if (set === undefined) {
    set = { id: fact.plannedSetId, reps: null, repsMax: null, loadGrams: null, durationSec: null, distanceM: null };
    extraSets.set(fact, set);
  }
  return set;
}

/** Заголовок колонки в одну строку: при нехватке места шрифт ужимается. */
const oneLine = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7 } as const;

/**
 * Дневник тренировки (Feature 10): план, «Пред.», факт по профилю упражнения, RPE; три исхода под последним
 * упражнением (§48.31). После завершения экран остаётся тем же (§48.68). Выход из начатой тренировки без
 * исхода спрашивает «Завершить тренировку?» (§48.36).
 */
export function WorkoutScreen({ slot, clientName, plans, execution, restTimers, activeWorkouts, onOpenWorkout,
  exercises, onChangeWeek, onEditWeek, onOpenMatrix, onPickExercises, picked, onOpenExercise, renderParticipants, focusExerciseId = null }: Readonly<{
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
  renderParticipants?: (finishInput: () => Promise<boolean>, mesocycleId: string | null | undefined, loading: boolean) => ReactNode;
  /** Каталог: добавить упражнения или (`replace`) заменить это. Результат приходит в `picked`. */
  onPickExercises: (replace?: string) => void;
  picked: PickedExercise | null;
  /** «›» у названия — карточка упражнения. */
  onOpenExercise?: (exerciseId: string) => void;
  /** Плановое упражнение, к которому один раз прокрутить дневник при открытии (возврат с панели таймера отдыха). */
  focusExerciseId?: string | null;
}>) {
  useKeepAwake();
  // Возврат с таймера отдыха: после раскладки прокручиваем к упражнению, из которого он запущен, один раз на открытие.
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const bodyY = useRef(0);
  const bodyRef = useRef<View>(null);
  const cardRefs = useRef(new Map<string, View>()).current;
  const focusDone = useRef<string | null>(null);
  // Положение карточки считается относительно тела дневника (measureLayout), а не её родителя: внутри рамки суперсета
  // `onLayout.y` отсчитан от рамки, и прокрутка уходила выше нужного.
  const focusExercise = useCallback((exerciseId: string) => {
    if (focusExerciseId === null || exerciseId !== focusExerciseId || focusDone.current === focusExerciseId) return;
    const card = cardRefs.get(exerciseId);
    const body = bodyRef.current;
    if (card === undefined || body === null) return;
    focusDone.current = focusExerciseId;
    card.measureLayout(body, (_x, y) => {
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, bodyY.current + y - 8), animated: true }), 50);
    }, () => { focusDone.current = null; });
  }, [cardRefs, focusExerciseId]);
  useEffect(() => { focusDone.current = null; }, [focusExerciseId]);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const navigation = useNavigation();
  const lookupState = useExerciseLookupState(exercises);
  const lookup = lookupState.lookup;
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  // §48.56: таймер упражнения со своей длительностью; выключенный в плане — не запускается.
  const startRest = useCallback((exercise: PlannedExercise) => {
    if (exercise.restSec === null) return;
    void restTimers.start({ clientId: slot.clientId, clientName, exerciseKey: exercise.id,
      exerciseName: lookup?.get(exercise.exerciseId)?.name ?? "Упражнение", durationSec: exercise.restSec,
      programId: slot.programId, weekIndex: slot.weekIndex, plannedWorkoutId: slot.plannedWorkoutId }).catch(() => undefined);
  }, [clientName, lookup, restTimers, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId]);
  const unilateralOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.unilateral === true, [lookup]);
  const [notice, setNotice] = useState<string | null>(null);
  // ADR-048: подсказка о записи календаря, отмеченной или снятой исходом тренировки.
  const calendarEffect = useCallback((effect: CalendarOutcomeEffect) => {
    const time = `${String(Math.floor(effect.startMinute / 60)).padStart(2, "0")}:${String(effect.startMinute % 60).padStart(2, "0")}`;
    setNotice(effect.kind === "MARKED" ? `Запись на ${time} в календаре отмечена проведённой.` : `Отметка «проведена» у записи на ${time} в календаре снята.`);
  }, []);
  const diary = useWorkoutDiary(slot, plans, execution, metricsOf, unilateralOf, startRest, calendarEffect);
  // «Макс.» под упражнением: лучший вес клиента за всё время в прошлых занятиях (один запрос на открытие тренировки),
  // плюс подходы открытой тренировки из состояния дневника — ввод запросов не добавляет.
  const exerciseIdsKey = diary.workout?.exercises.map((item) => item.exerciseId).join("|") ?? "";
  const maxKey = `${slot.clientId}|${slot.programId}|${slot.weekIndex}|${slot.plannedWorkoutId}|${exerciseIdsKey}`;
  const [pastMax, setPastMax] = useState<Readonly<{ key: string; loads: ReadonlyMap<string, number> }> | null>(null);
  useEffect(() => {
    if (exerciseIdsKey === "") return undefined;
    let active = true;
    execution.getMaxLoads({ clientId: slot.clientId, programId: slot.programId, weekIndex: slot.weekIndex, plannedWorkoutId: slot.plannedWorkoutId },
      exerciseIdsKey.split("|")).then((loads) => { if (active) setPastMax({ key: maxKey, loads }); }).catch(() => undefined);
    return () => { active = false; };
  }, [execution, maxKey, exerciseIdsKey, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId]);
  const openMax = useMemo(() => currentMaxLoads(diary.state?.facts.values() ?? []), [diary.state]);
  const maxLoadText = (exerciseId: string): string | null => {
    const grams = Math.max(pastMax?.key === maxKey ? pastMax.loads.get(exerciseId) ?? -1 : -1, openMax.get(exerciseId) ?? -1);
    return grams < 0 ? null : `Макс. ${String(grams / 1000).replace(".", ",")} кг`;
  };
  useEffect(() => {
    if (diary.loadFailed) { navigationPerformance.finish("workout", false); return undefined; }
    if (diary.switching || diary.workout === undefined || diary.state === null || lookup === null) return undefined;
    const frame = requestAnimationFrame(navigationPerformance.ready("workout"));
    return () => cancelAnimationFrame(frame);
  }, [diary.loadFailed, diary.switching, diary.workout, diary.state, lookup, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId]);
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
  const changingWeek = useRef(false);
  const [restFor, setRestFor] = useState<PlannedExercise | null>(null);
  const { saveSet, toggleSet, setOutcome, addWarmup, removeWarmup } = diary;
  const [removeWarm, setRemoveWarm] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeSheet = useRef<BottomSheetModal>(null);
  const others = useActiveWorkoutCards(activeWorkouts, slot);
  const [weekNavigation, setWeekNavigation] = useState<WorkoutWeekNavigation | null>(null);
  const [navigationOwner, setNavigationOwner] = useState("");
  const navigationCurrent = navigationOwner === `${slot.clientId}:${slot.programId}`
    && weekNavigation?.weeks.some((week) => week.workoutId === slot.plannedWorkoutId) === true;
  // Статусы тренировок программы для ленты недель: перечитываются после записей этой программы; чужая программа статусов не получает.
  const [weekStatuses, setWeekStatuses] = useState<Readonly<{ key: string; statuses: readonly SessionStatus[] }> | null>(null);
  useEffect(() => {
    let active = true;
    let request = 0;
    const key = `${slot.clientId}:${slot.programId}`;
    const load = () => {
      const latest = ++request;
      void execution.getProgramStatuses(slot.clientId, slot.programId)
        .then((statuses) => { if (active && latest === request) setWeekStatuses({ key, statuses }); })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = execution.subscribeCommittedChanges((change) => {
      if (change.clientId === slot.clientId && change.programId === slot.programId) load();
    });
    return () => { active = false; unsubscribe(); };
  }, [execution, slot.clientId, slot.programId]);
  /** Недели программы прочитаны (`null` — их нет): до этого панель держит прежние стрелки, а не «стрелок нет». */
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const navigationAuthorized = useRef(false);
  // UI-OWN-037: правка плана из дневника — действие на месте, затем выбор области в окне.
  const menuSheet = useRef<BottomSheetModal>(null);
  const supersetSheet = useRef<BottomSheetModal>(null);
  const [menuFor, setMenuFor] = useState<PlannedExercise | null>(null);
  const [edit, setEdit] = useState<DiaryEdit | null>(null);
  const [ordering, setOrdering] = useState<readonly string[] | null>(null);
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
    let request = 0;
    const load = () => {
      const latest = ++request;
      void plans.getWorkoutWeekNavigation(slot.clientId, slot.programId, slot.plannedWorkoutId)
        .then((value) => { if (active && latest === request) {
          setWeekNavigation(value); setNavigationOwner(`${slot.clientId}:${slot.programId}`); setNavigationLoaded(true);
        } })
        .catch(() => { if (active && latest === request) setNavigationError("Не удалось загрузить недели программы."); });
    };
    // The navigation snapshot already contains every corresponding workout of this cycle.
    if (!navigationCurrent) load();
    const unsubscribe = plans.subscribeCommittedChanges((change) => {
      if (change.selectionOnly !== true && change.orderOnly !== true && change.clientIds.includes(slot.clientId)) load();
    });
    return () => { active = false; unsubscribe(); };
  }, [plans, slot.clientId, slot.programId, slot.plannedWorkoutId]);


  /** §48.56: отдых упражнения — правка плана, как остальные правки из дневника: окно выбирает область (эта неделя / все и т. д.). */
  const editRest = (exercise: PlannedExercise, restSec: number | null) => {
    flushPending();
    setEdit({ kind: "rest", exerciseId: exercise.id, restSec });
  };

  const flushPending = useCallback(() => pending.flushAll(), [pending]);
  const finishInput = useCallback(async () => {
    const endFlush = navigationPerformance.phase("flush");
    let inputsSaved: boolean;
    let queueSaved: boolean;
    try { inputsSaved = await flushPending(); queueSaved = await diary.finishSaving(); }
    finally { endFlush(); }
    if (!inputsSaved || !queueSaved) {
      setNavigationError("Не удалось сохранить весь ввод. Проверьте поля и повторите переход — введённые значения оставлены на экране.");
      navigationPerformance.finish("workout", false);
      return false;
    }
    setNavigationError(null);
    return true;
  }, [flushPending, diary.finishSaving]);
  const changeWeek = async (index: number) => {
    if (busy || changingWeek.current || diary.switching || !navigationCurrent || index === slot.weekIndex) return;
    const targetWeek = weekNavigation?.weeks.find((week) => week.index === index);
    if (!targetWeek) return;
    navigationPerformance.begin("workout-week");
    const openTarget = () => {
      if (targetWeek.workoutId !== null && diary.isCached({ ...slot, weekIndex: index, plannedWorkoutId: targetWeek.workoutId })) {
        reportWeekTone(targetWeek.type === undefined || targetWeek.type === "base" ? null : weekTypeTone(targetWeek.type, colors));
      }
      if (targetWeek.workoutId === null) navigationAuthorized.current = true;
      Keyboard.dismiss();
      onChangeWeek(index, targetWeek.workoutId, weekNavigation?.mesocycleId ?? null);
    };
    // No input/queue to settle: keep this in the press event's batch instead of a busy/await/busy cascade.
    if (!pending.dirty && !diary.needsSaving()) {
      setNavigationError(null); openTarget(); return;
    }
    changingWeek.current = true;
    setBusy(true);
    try {
      if (!await finishInput()) return;
      // Без соответствующей тренировки — уход к списку недели (экран закрывается); иначе тот же экран, другая неделя.
      openTarget();
    } finally { changingWeek.current = false; setBusy(false); }
  };
  const currentWeek = weekNavigation?.weeks.findIndex((week) => week.index === slot.weekIndex) ?? -1;
  const changeWeekRef = useRef(changeWeek);
  changeWeekRef.current = changeWeek;
  const selectWeek = useCallback((index: number) => { void changeWeekRef.current(index); }, []);
  useEffect(() => {
    workoutNavigationProbe.update({ week: slot.weekIndex, available: weekNavigation?.weeks.filter((week) => week.workoutId !== null).map((week) => week.index) ?? [],
      ready: !busy && !diary.switching && navigationCurrent, select: selectWeek });
  });
  useEffect(() => () => workoutNavigationProbe.clear(), []);
  // Дневник в цвете типа своей недели (UI-OWN-039); «Индивидуальная» — цвет темы.
  const weekType = weekNavigation?.weeks.find((week) => week.index === diary.displayedSlot.weekIndex)?.type;
  const reportWeekTone = useReportScreenTone(weekType === undefined || weekType === "base" ? null : weekTypeTone(weekType, colors));
  const previousWeek = weekNavigation?.weeks[currentWeek - 1];
  const nextWeek = weekNavigation?.weeks[currentWeek + 1];
  // Статус недели в ленте — как в панели программы; пока статусы этой программы не пришли, карточки без статуса.
  const weekCards = useMemo(() => {
    if (weekNavigation === null) return [];
    const states = weekStatuses?.key === `${slot.clientId}:${slot.programId}`
      ? weekCardStates(weekNavigation.weeks, weekStatuses.statuses).states : null;
    return weekNavigation.weeks.map((week) => ({ index: week.index, caption: week.caption,
      ...(states === null ? {} : { status: weekCardLabels[states.get(week.index)!],
        statusTone: statusToneColor(weekCardTone(states.get(week.index)!), colors), statusMarker: weekCardMarkers[states.get(week.index)!] }) }));
  }, [colors, slot.clientId, slot.programId, weekNavigation, weekStatuses]);
  useWeekNavigation(weekNavigation === null ? null : { week: slot.weekIndex, busy,
    previous: previousWeek ? () => { void changeWeek(previousWeek.index); } : null,
    next: nextWeek ? () => { void changeWeek(nextWeek.index); } : null }, navigationLoaded);

  const saveSetRef = useRef(saveSet); saveSetRef.current = saveSet;
  const toggleSetRef = useRef(toggleSet); toggleSetRef.current = toggleSet;
  const scopeRef = useRef(diary.displayedKey); scopeRef.current = diary.displayedKey;
  const onSave = useCallback((item: SetTarget, patch: SetPatch) =>
    saveSetRef.current(item.exercise, item.set, item.position, patch), []);
  // Перед отметкой дописываются только ячейки этого подхода: ошибка в другом подходе её не блокирует.
  const onToggle = useCallback((item: SetTarget, side?: Side) => {
    void pending.flushPrefix(`${scopeRef.current}|${item.set.id}:`).then((saved) => {
      if (saved) { setNavigationError(null); void toggleSetRef.current(item.exercise, item.set, item.position, side); return; }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      setNavigationError("В этом подходе неверное значение — исправьте подсвеченную ячейку и отметьте снова.");
    });
  }, [pending]);
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

  const participants = renderParticipants?.(finishInput, navigationCurrent ? weekNavigation?.mesocycleId : undefined,
    diary.switching || diary.loadFailed || diary.workout === undefined || !navigationCurrent);
  if (lookup === null && lookupState.failed) return <>{participants}<View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <InlineNotice kind="error">Справочник упражнений не загрузился. Данные не изменены.</InlineNotice>
      <AppButton variant="secondary" label="Повторить" onPress={lookupState.retry} />
    </View></>;
  if (diary.loadFailed) return <>{participants}<View style={[styles.center, { backgroundColor: colors.canvas }]}>
    <InlineNotice kind="error">Не удалось открыть тренировку. Повторите загрузку.</InlineNotice>
    <AppButton variant="secondary" label="Повторить" onPress={diary.retry} />
  </View></>;
  if (diary.workout === undefined || diary.state === null || diary.mode === null || lookup === null) {
    return <>{participants}<View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем тренировку…" /></View></>;
  }
  if (diary.workout === null) {
    return (
      <>{participants}<View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <InlineNotice kind="error">Тренировка не найдена в программе.</InlineNotice>
      </View></>
    );
  }
  const { workout, state, previous, mode } = diary;
  const targetFact = target === null ? undefined : state.facts.get(target.set.id);
  const volumeOf = (exerciseId: string) => [...state.facts.values()].filter((fact) => fact.plannedExerciseId === exerciseId)
    .reduce((sum, fact) => sum + factVolume(fact), 0);
  const workoutVolume = workout.exercises.reduce((sum, exercise) => sum + volumeOf(exercise.id), 0);
  const kg = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} кг`;
  const shareRows = sharing ? workout.exercises.map((exercise) => {
    const fields = diaryFields(lookup.get(exercise.exerciseId)?.metrics ?? []);
    return { name: lookup.get(exercise.exerciseId)?.name ?? "Упражнение",
      rest: exercise.restSec === null ? null : formatDuration(exercise.restSec), sets: exercise.sets.map((set) => {
      const fact = state.facts.get(set.id);
      return fact !== undefined && hasValues(fact.values) ? labeledWithDrops(fact.values, fact.drops, fields, rawOf)
        : `план: ${labeledPlan(planText(set, fields), fields)}`;
    }) };
  }) : [];
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
      {participants}
      <GestureDetector gesture={pinch}>
      <KeyboardAwareScrollView ref={scrollRef} style={{ backgroundColor: colors.canvas }} contentContainerStyle={[styles.content, { paddingBottom: timers > 0 ? 200 : 24 }]}
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
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Неделя ${diary.displayedSlot.weekIndex}`}</Text>
            {/* Без занятия дата и время показываются неактивными; метаданные переносятся целыми элементами. */}
            {(
              // §48.84: дата проведения — по умолчанию день первого ввода, можно указать прошедший день.
              <Pressable accessibilityRole="button" hitSlop={8} disabled={state.session === null}
                accessibilityLabel={`Дата тренировки ${shortDate(state.session?.actualDate ?? null)}. Изменить`}
                onPress={() => {
                  const current = state.session?.actualDate;
                  if (current === undefined) return;
                  void pickDate({ value: current ?? localDateOf(new Date()), max: localDateOf(new Date()) }).then((date) => {
                    if (date !== null && date !== current) void diary.setActualDate(date);
                  });
                }}
                style={[styles.dateButton, { backgroundColor: colors.surfaceRaised }, state.session === null && styles.dim]}>
                <CalendarDays size={15} color={colors.accentInk} strokeWidth={2} />
                <Text style={[styles.dateText, { color: colors.accentInk }]}>{shortDate(state.session?.actualDate ?? null)}</Text>
              </Pressable>
            )}
            {others.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Другие тренировки в работе: ${others.length}. Перейти`}
                hitSlop={6} onPress={() => { flushPending(); Keyboard.dismiss(); activeSheet.current?.present(); }}
                style={[styles.othersButton, { backgroundColor: colors.surfaceRaised }]}>
                <Users size={14} color={colors.accentInk} strokeWidth={2} />
                <Text style={[styles.othersText, { color: colors.accentInk }]}>{`ещё ${others.length}`}</Text>
              </Pressable>
            ) : null}
            <View style={styles.statusTag}>
              <StatusTag kind={statusKinds[diary.status]} label={workoutStatusLabels[diary.status]} />
            </View>
          </View>
          {(
            // PC §48.86.13: начало ставится по первому подтверждённому подходу, окончание — при «Завершить»; обе отметки можно исправить.
            <View style={styles.timeRow}>
              {([["start", "Начало", state.session?.startedAt ?? null], ["end", "Окончание", state.session?.finishedAt ?? null]] as const).map(([kind, label, instant]) => (
                <Pressable key={kind} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                  disabled={(state.session?.actualDate ?? null) === null}
                  accessibilityLabel={`${label} тренировки ${instant === null ? "не указано" : timeText(instant)}. Изменить`}
                  onPress={() => { flushPending(); Keyboard.dismiss(); setTimeEdit(kind); }}
                  style={[styles.dateButton, { backgroundColor: colors.surfaceRaised }, (state.session?.actualDate ?? null) === null && styles.dim]}>
                  <Clock size={15} color={colors.accentInk} strokeWidth={2} />
                  <Text style={[styles.dateText, { color: colors.accentInk }]}>{`${label} ${instant === null ? "—" : timeText(instant)}`}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>{diaryTimeNote(state.session ?? NO_SESSION) || " "}</Text>
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
            <WeekCards weeks={weekCards} selected={slot.weekIndex} disabled={busy || diary.switching}
              onSelect={selectWeek} />
          ) : null}
        </View>
        {diary.message !== null ? <InlineNotice kind="error">{diary.message}</InlineNotice> : null}
        {navigationError !== null ? <InlineNotice kind="error">{navigationError}</InlineNotice> : null}
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
        {ordering === null ? <View ref={bodyRef} collapsable={false} onLayout={(event) => { bodyY.current = event.nativeEvent.layout.y; }} pointerEvents={diary.switching ? "none" : "auto"} style={[styles.body, diary.switching && styles.switching]}>
        {supersetRuns(workout.exercises).map((run) => {
        const cards = run.map((exercise) => {
          const info = lookup.get(exercise.exerciseId);
          const group = supersetNumber(workout, exercise);
          const fields = diaryFields(info?.metrics ?? NO_METRICS);
          const extras = extraWarmups(state, exercise.id).map((fact) => ({ set: extraSetOf(fact), position: fact.position, setType: fact.setType }));
          const rows = displayOrder([...extras, ...exercise.sets.map((set, position) => ({ set, position,
            setType: state.facts.get(set.id)?.setType ?? "NORMAL" }))]);
          const done = rows.filter(({ item }) => state.facts.get(item.set.id)?.confirmed === true).length;
          const extraIds = new Set(extras.map((extra) => extra.set.id));
          // Ключи — по месту в плане, а не по ID недели: при смене недели строки не пересоздаются.
          return (
            <View key={exercise.lineageId ?? exercise.id} collapsable={false}
              ref={(node) => { if (node === null) cardRefs.delete(exercise.id); else cardRefs.set(exercise.id, node); }}
              onLayout={() => focusExercise(exercise.id)} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {group !== null ? <Text style={[styles.meta, { color: colors.accentInk }]}>{`Суперсет ${group}`}</Text> : null}
              <View style={styles.cardHead}>
                {info?.thumbnail != null ? <Image source={info.thumbnail} resizeMethod="resize" style={[styles.thumb, { backgroundColor: colors.input }]} /> : null}
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
                  {maxLoadText(exercise.exerciseId) !== null ? (
                    <Text accessibilityLabel={`Максимальный вес за всё время: ${maxLoadText(exercise.exerciseId)!.slice(6)}`}
                      style={[styles.restText, { color: colors.textSecondary }]}>{maxLoadText(exercise.exerciseId)}</Text>
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
                <SetRow key={extraIds.has(item.set.id) ? item.set.id : `p:${item.position}`} scopeKey={diary.displayedKey}
                  exercise={exercise} set={item.set} position={item.position} number={number}
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
              <NoteField noteKey={`${diary.displayedKey}|note:${exercise.id}`} value={state.notes.get(exercise.id) ?? ""} pending={pending}
                onCommit={(text) => diary.saveNote(exercise.id, text)} />
            </View>
          );
        });
        // Суперсет — одна сплошная рамка вокруг всех его карточек.
        return run.length > 1 ? <SupersetBorder key={run[0]!.lineageId ?? run[0]!.id} radius={22} gap={12}>{cards}</SupersetBorder> : cards[0];
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
          if (session === null || session.actualDate === null || timeEdit === null) return;
          void diary.setTimes(timeEdit === "start"
            ? { startedAt: instantFromLocal(session.actualDate, minute), finishedAt: session.finishedAt }
            : { startedAt: session.startedAt, finishedAt: endInstantAfter(session.startedAt, session.actualDate, minute) });
        }}
        onClose={() => setTimeEdit(null)} />
      <DurationWheelPicker visible={restFor !== null} title="Отдых после подхода"
        value={restFor?.restSec ?? REST_DEFAULT_SEC} min={REST_MIN_SEC} max={REST_MAX_SEC}
        clearLabel={restFor?.restSec === null ? undefined : "Без таймера"}
        onConfirm={(seconds) => { if (restFor !== null) editRest(restFor, seconds); }}
        onClear={() => { if (restFor !== null) editRest(restFor, null); }}
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

