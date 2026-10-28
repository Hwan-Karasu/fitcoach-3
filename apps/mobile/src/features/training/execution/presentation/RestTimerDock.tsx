import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type TextStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight, useAnimatedProps, useAnimatedStyle, useFrameCallback,
  useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play, SkipForward } from "lucide-react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { ADJUST_STEP_SEC, isFinished, isPaused, nextFinishAt, remainingSec, type RestTimer } from "../domain/RestTimerRules.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { useBottomBarHeight, useEditorDockHeight } from "../../../../shared/ui/components/public.ts";

/** Сколько секунд закончившийся таймер остаётся на панели с надписью «Готово». */
const FINISHED_VISIBLE_MS = 4000;
/** Отступ от края экрана, когда нижней панели вкладок на экране нет. */
const EDGE_GAP = 8;
/** Сдвиг пальца, после которого свайп сворачивает панель к краю. */
const SWIPE_DISTANCE = 48;
/** Рядом помещаются два таймера; остальные — под кнопкой «Ещё N» (§48.62). */
const SIDE_BY_SIDE = 2;
/** Длительности анимаций: уход панели за край, выезд «таблетки», разворот. */
const SLIDE_OUT_MS = 200;
const PILL_MS = 260;
const EASE = Easing.out(Easing.cubic);

type Side = "left" | "right";

function clock(seconds: number): string {
  "worklet";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Цифры отсчёта считает UI-поток (как в PerformanceMonitor самого Reanimated: текст нередактируемого поля через animatedProps):
 * пока идёт отдых, JS-поток панель не перерисовывает и не мешает длинным правкам плана (PERF-REST-DOCK). Секунды сравниваются
 * каждый кадр, текст меняется раз в секунду. На паузе кадры не идут — остаток постоянный.
 */
function RestClock({ timer, style }: Readonly<{ timer: RestTimer; style: StyleProp<TextStyle> }>) {
  const endAt = useSharedValue(timer.endAt);
  const seconds = useSharedValue(remainingSec(timer, Date.now()));
  const paused = timer.pausedLeftMs !== null;
  const frame = useFrameCallback(() => {
    "worklet";
    const left = Math.max(0, Math.ceil((endAt.value - Date.now()) / 1000));
    if (left !== seconds.value) seconds.value = left;
  }, !paused);
  useEffect(() => {
    endAt.value = timer.endAt;
    seconds.value = remainingSec(timer, Date.now());
    frame.setActive(timer.pausedLeftMs === null);
  }, [timer, endAt, seconds, frame]);
  const animatedProps = useAnimatedProps(() => {
    const text = clock(seconds.value);
    // `text` нет в типах props TextInput, но это штатный способ Reanimated менять значение поля на UI-потоке.
    return { text, defaultValue: text } as never;
  });
  return <AnimatedTextInput editable={false} pointerEvents="none" accessible={false} importantForAccessibility="no" caretHidden
    underlineColorAndroid="transparent" defaultValue={clock(remainingSec(timer, Date.now()))} animatedProps={animatedProps}
    style={[styles.clockInput, style]} />;
}

/** Порядок карточек стабилен — по времени запуска: ±15, пауза и ход времени не переставляют их под пальцем (иначе нажатие попадает в соседний таймер). */
function stableOrder(list: readonly RestTimer[]): readonly RestTimer[] {
  return [...list].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

/** Идущий таймер, который закончится первым: его карточка выделяется рамкой, а не местом. */
function nearestRunning(list: readonly RestTimer[], now: number): RestTimer | null {
  const running = list.filter((timer) => !isPaused(timer) && !isFinished(timer, now));
  return running.sort((a, b) => a.endAt - b.endAt)[0] ?? null;
}

/** Подпись для экранного диктора: без бегущих секунд (иначе подпись менялась бы каждую секунду); на паузе остаток постоянный. */
function restState(timer: RestTimer, finished: boolean): string {
  if (finished) return "Отдых окончен";
  return isPaused(timer) ? `Пауза, осталось ${clock(remainingSec(timer, 0))}` : "Идёт отдых";
}

/** Перерисовывается только при смене своего таймера, окончания или раскладки — не каждую секунду (PERF-REST-DOCK). */
const TimerCard = memo(function TimerCard({ timer, finished, compact, nearest, timers, onOpen }: Readonly<{ timer: RestTimer; finished: boolean;
  compact: boolean; nearest: boolean; timers: RestTimersPort; onOpen: (timer: RestTimer) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const paused = isPaused(timer);
  const timeColor = finished ? colors.success : paused ? colors.textSecondary : colors.textPrimary;
  const button = (key: string, accessibilityLabel: string, onPress: () => void, content: React.ReactNode, primary = false) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={4}
      style={[styles.button, compact && styles.buttonCompact, { backgroundColor: primary ? colors.accentFill : colors.input }]}>{content}</Pressable>
  );
  const adjust = (delta: number) => (
    button(delta < 0 ? "minus" : "plus", `Отдых ${delta < 0 ? "меньше" : "больше"} на ${ADJUST_STEP_SEC} секунд`, () => { timers.adjust(timer.id, delta).catch(() => undefined); },
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color: colors.textPrimary }]}>{`${delta < 0 ? "−" : "+"}${ADJUST_STEP_SEC}`}</Text>)
  );
  const pause = finished ? null : button("pause", paused ? "Продолжить отдых" : "Поставить отдых на паузу",
    () => { (paused ? timers.resume(timer.id) : timers.pause(timer.id)).catch(() => undefined); },
    paused ? <Play size={18} color={colors.textPrimary} strokeWidth={2} /> : <Pause size={18} color={colors.textPrimary} strokeWidth={2} />);
  const skip = button("skip", "Пропустить отдых", () => { timers.skip(timer.id).catch(() => undefined); }, <SkipForward size={18} color={colors.onAccentFill} strokeWidth={2} />, true);
  const timeStyle = [styles.time, compact && styles.timeCompact, { color: timeColor }];
  const timeView = finished ? <Text numberOfLines={1} style={timeStyle}>Готово</Text> : <RestClock timer={timer} style={timeStyle} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLiveRegion="polite"
      accessibilityLabel={`${timer.clientName}, ${timer.exerciseName}. ${restState(timer, finished)}. Открыть тренировку`}
      accessibilityHint="Смахните в сторону, чтобы свернуть панель к краю экрана" onPress={() => onOpen(timer)}
      style={[styles.card, compact && styles.cardCompact, { backgroundColor: colors.surface, borderColor: finished ? colors.success : nearest ? colors.accentFill : colors.border }]}>
      <Text style={[styles.owner, compact && styles.ownerCompact, { color: colors.textSecondary }]} numberOfLines={1}>
        <Text style={{ color: colors.textPrimary, fontFamily: fonts.semibold }}>{timer.clientName}</Text>
        {` · ${timer.exerciseName}${paused ? " · Пауза" : ""}`}
      </Text>
      {compact ? <>
        <View style={styles.lineCenter}>{timeView}</View>
        <View style={[styles.line, styles.lineCompact]}>{adjust(-ADJUST_STEP_SEC)}{adjust(ADJUST_STEP_SEC)}{pause}{skip}</View>
      </> : (
        <View style={styles.line}>{adjust(-ADJUST_STEP_SEC)}{timeView}{adjust(ADJUST_STEP_SEC)}{pause}{skip}</View>
      )}
    </Pressable>
  );
});

/**
 * Панель таймеров отдыха над нижней навигацией, на всех экранах (§48.62): один таймер — во всю ширину, два — рядом, больше — два ближайших
 * к окончанию и «Ещё N» со списком остальных. Таймер принадлежит упражнению и участнику, а не экрану: смена экрана, недели или участника
 * отсчёт не сбрасывает (время считается от сохранённого окончания). У каждого свои ±15, пауза и пропуск; нажатие на карточку возвращает в её
 * тренировку. Свайп вбок сворачивает панель к краю экрана — виден ближайший отсчёт; галочки ‹ › подсказывают этот жест.
 */
export function RestTimerDock({ timers, onOpen }: Readonly<{ timers: RestTimersPort; onOpen: (timer: RestTimer) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const editorHeight = useEditorDockHeight();
  const barHeight = useBottomBarHeight();
  const subscribe = useCallback((listener: () => void) => timers.subscribe(listener), [timers]);
  const list = useSyncExternalStore(subscribe, () => timers.list());
  const [now, setNow] = useState(() => Date.now());
  const [side, setSide] = useState<Side | null>(null);
  const [showAll, setShowAll] = useState(false);
  const signalled = useRef(new Set<string>());
  const pendingDismiss = useRef(new Set<ReturnType<typeof setTimeout>>());
  const offset = useSharedValue(0);
  const { width: screenWidth } = useWindowDimensions();

  const latestId = list.length === 0 ? null : [...list].sort((a, b) => b.startedAt - a.startedAt)[0]!.id;
  // Колбэк из оболочки — новая стрелка на каждый её рендер; через ref карточки (memo) не перерисовываются из-за него.
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const open = useCallback((timer: RestTimer) => openRef.current(timer), []);

  useEffect(() => () => {
    for (const handle of pendingDismiss.current) clearTimeout(handle);
    pendingDismiss.current.clear();
  }, []);

  // Цифры идут на UI-потоке (RestClock); JS просыпается только к ближайшему окончанию — показать «Готово» и дать вибрацию.
  useEffect(() => {
    const at = nextFinishAt(list, now);
    if (at === null) return undefined;
    const handle = setTimeout(() => setNow(Date.now()), Math.max(0, at - Date.now()));
    return () => clearTimeout(handle);
  }, [list, now]);

  // Новый запуск разворачивает панель, чтобы тренер увидел, что таймер пошёл.
  useEffect(() => { setSide(null); offset.value = 0; }, [latestId, offset]);
  useEffect(() => { if (list.length <= SIDE_BY_SIDE) setShowAll(false); }, [list.length]);

  // Окончание в открытом приложении: одна вибрация на всю пачку закончившихся (сигналы не накладываются), панель разворачивается,
  // через несколько секунд каждый закончившийся таймер уходит. Скрытые за «Ещё N» тоже сигналят.
  useEffect(() => {
    // Ушедший из списка таймер забывается: набор не растёт за сессию, а перезапущенный таймер сигналит заново.
    const present = new Set(list.map((timer) => timer.id));
    for (const id of signalled.current) if (!present.has(id)) signalled.current.delete(id);
    const fresh = list.filter((timer) => isFinished(timer, now) && !signalled.current.has(timer.id));
    if (fresh.length === 0) return;
    setSide(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    for (const timer of fresh) {
      signalled.current.add(timer.id);
      const id = timer.id;
      const handle = setTimeout(() => {
        pendingDismiss.current.delete(handle);
        void timers.dismiss(id).catch(() => undefined);
      }, FINISHED_VISIBLE_MS);
      pendingDismiss.current.add(handle);
    }
  }, [list, now, timers]);

  // Сдвиг от жеста обнуляется до смены вида: иначе свёрнутая «таблетка» унаследует смещение и окажется за краем экрана.
  const collapse = useCallback((next: Side) => { offset.value = 0; setSide(next); }, [offset]);
  const expand = useCallback(() => { offset.value = 0; setSide(null); }, [offset]);

  // Объекты жестов создаются один раз; на JS переходим через scheduleOnRN (правила проекта).
  const swipeToCollapse = useMemo(() => Gesture.Pan().activeOffsetX([-14, 14]).failOffsetY([-14, 14])
    .onUpdate((event) => { "worklet"; offset.value = event.translationX; })
    .onEnd((event) => {
      "worklet";
      if (Math.abs(event.translationX) > SWIPE_DISTANCE) {
        // Панель плавно уезжает за тот край, куда её смахнули, и только потом заменяется «таблеткой», выезжающей с этого края.
        const toRight = event.translationX > 0;
        offset.value = withTiming(toRight ? screenWidth : -screenWidth, { duration: SLIDE_OUT_MS, easing: EASE }, (finished) => {
          "worklet";
          if (finished) scheduleOnRN(collapse, toRight ? "right" : "left");
        });
      } else {
        offset.value = withSpring(0, { damping: 22, stiffness: 260 });
      }
    }), [collapse, offset, screenWidth]);
  const swipeToExpand = useMemo(() => Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-14, 14])
    .onEnd((event) => {
      "worklet";
      if (Math.abs(event.translationX) > 16) scheduleOnRN(expand);
    }), [expand]);
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  if (list.length === 0) return null;
  const ordered = stableOrder(list);
  const nearest = nearestRunning(list, now);
  // Над фактической нижней панелью вкладок; без неё — у нижнего края с учётом системной полосы.
  const bottom = (barHeight > 0 ? barHeight : insets.bottom + EDGE_GAP) + editorHeight;

  if (side !== null) {
    const first = nearest ?? ordered[0]!;
    const Hint = side === "left" ? ChevronRight : ChevronLeft;
    const finished = isFinished(first, now);
    const pillStyle = [styles.pillTime, { color: finished ? colors.success : isPaused(first) ? colors.textSecondary : colors.textPrimary }];
    const more = ordered.length - 1;
    return (
      <View key="collapsed" pointerEvents="box-none" style={[styles.edge, { bottom }, side === "left" ? styles.edgeLeft : styles.edgeRight]}>
        <GestureDetector gesture={swipeToExpand}>
          <Animated.View entering={(side === "left" ? SlideInLeft : SlideInRight).duration(PILL_MS).easing(EASE)}
            exiting={(side === "left" ? SlideOutLeft : SlideOutRight).duration(SLIDE_OUT_MS).easing(EASE)}>
            <Pressable accessibilityRole="button" accessibilityLiveRegion="polite"
              accessibilityLabel={`${restState(first, finished)}${more > 0 ? `, ещё таймеров: ${more}` : ""}. Развернуть панель`}
              onPress={expand}
              style={[styles.pill, side === "left" ? styles.pillLeft : styles.pillRight,
                { backgroundColor: colors.surface, borderColor: finished ? colors.success : colors.border }]}>
              {side === "right" ? <Hint size={16} color={colors.accentInk} strokeWidth={2.5} /> : null}
              {isPaused(first) ? <Pause size={14} color={colors.textSecondary} strokeWidth={2.5} /> : null}
              {finished ? <Text style={pillStyle} numberOfLines={1}>Готово</Text> : <RestClock timer={first} style={pillStyle} />}
              {more > 0 ? <Text style={[styles.pillMore, { color: colors.accentInk }]}>{`+${more}`}</Text> : null}
              {side === "left" ? <Hint size={16} color={colors.accentInk} strokeWidth={2.5} /> : null}
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </View>
    );
  }

  const visible = ordered.slice(0, SIDE_BY_SIDE);
  const hidden = ordered.slice(SIDE_BY_SIDE);
  return (
    <View key="expanded" pointerEvents="box-none" style={[styles.dock, { bottom }]}>
      <GestureDetector gesture={swipeToCollapse}>
        <Animated.View entering={FadeIn.duration(PILL_MS).easing(EASE)} style={panelStyle}>
          <View style={styles.row}>
            {visible.map((timer) => <TimerCard key={timer.id} timer={timer} finished={isFinished(timer, now)} compact={visible.length > 1}
              nearest={timer.id === nearest?.id && ordered.length > 1} timers={timers} onOpen={open} />)}
          </View>
          {hidden.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAll }}
              accessibilityLabel={showAll ? "Скрыть остальные таймеры" : `Показать остальные таймеры: ещё ${hidden.length}`}
              onPress={() => setShowAll((value) => !value)}
              style={[styles.more, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.moreText, { color: colors.accentInk }]}>{showAll ? "Скрыть" : `Ещё ${hidden.length}`}</Text>
              {showAll ? <ChevronUp size={16} color={colors.accentInk} strokeWidth={2.5} /> : <ChevronDown size={16} color={colors.accentInk} strokeWidth={2.5} />}
            </Pressable>
          ) : null}
          {showAll ? <View style={styles.rest}>
            {hidden.map((timer) => <TimerCard key={timer.id} timer={timer} finished={isFinished(timer, now)} compact={false}
              nearest={timer.id === nearest?.id} timers={timers} onOpen={open} />)}
          </View> : null}
          <ChevronLeft size={14} color={colors.textMuted} strokeWidth={2.5} style={styles.hintLeft} />
          <ChevronRight size={14} color={colors.textMuted} strokeWidth={2.5} style={styles.hintRight} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 12, right: 12 },
  edge: { position: "absolute", left: 0, right: 0, flexDirection: "row" },
  edgeLeft: { justifyContent: "flex-start" },
  edgeRight: { justifyContent: "flex-end" },
  row: { flexDirection: "row", gap: 8 },
  rest: { gap: 6, marginTop: 6 },
  card: { flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 8, gap: 6, elevation: 8 },
  cardCompact: { paddingHorizontal: 6, paddingVertical: 6, gap: 3, borderRadius: 12 },
  owner: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center" },
  ownerCompact: { fontSize: 11, lineHeight: 14 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  lineCenter: { alignItems: "center" },
  /** Поле отсчёта выглядит как текст: без отступов поля ввода Android. */
  clockInput: { padding: 0, margin: 0, borderWidth: 0, backgroundColor: "transparent" },
  time: { flex: 1, minWidth: 64, textAlign: "center", fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  timeCompact: { flex: 0, fontSize: 17, lineHeight: 21 },
  button: { flex: 1, minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  buttonCompact: { minWidth: 0, minHeight: 34, borderRadius: 8 },
  lineCompact: { gap: 4 },
  buttonText: { fontFamily: fonts.semibold, fontSize: 13 },
  buttonTextCompact: { fontSize: 11 },
  more: { alignSelf: "flex-end", minHeight: 36, marginTop: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 4, elevation: 8 },
  moreText: { fontFamily: fonts.medium, fontSize: 12 },
  hintLeft: { position: "absolute", left: -11, top: 14 },
  hintRight: { position: "absolute", right: -11, top: 14 },
  pill: { minHeight: 44, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4, elevation: 8 },
  pillLeft: { borderTopRightRadius: 22, borderBottomRightRadius: 22, borderLeftWidth: 0 },
  pillRight: { borderTopLeftRadius: 22, borderBottomLeftRadius: 22, borderRightWidth: 0 },
  pillTime: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  pillMore: { fontFamily: fonts.bold, fontSize: 12 },
});
