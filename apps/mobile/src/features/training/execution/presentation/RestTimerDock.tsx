import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play, SkipForward } from "lucide-react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { ADJUST_STEP_SEC, isFinished, isPaused, remainingSec, type RestTimer } from "../domain/RestTimerRules.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { useEditorDockHeight } from "../../../../shared/ui/components/public.ts";

/** Сколько секунд закончившийся таймер остаётся на панели с надписью «Готово». */
const FINISHED_VISIBLE_MS = 4000;
/** Высота нижней навигации над краем экрана: панель таймеров — над ней. */
const TAB_BAR_HEIGHT = 80;
/** Сдвиг пальца, после которого свайп сворачивает панель к краю. */
const SWIPE_DISTANCE = 48;
/** Рядом помещаются два таймера; остальные — под кнопкой «Ещё N» (§48.62). */
const SIDE_BY_SIDE = 2;

type Side = "left" | "right";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Ближайший к окончанию — первым; приостановленные упорядочены по остатку. */
function byRemaining(list: readonly RestTimer[], now: number): readonly RestTimer[] {
  const left = (timer: RestTimer) => timer.pausedLeftMs ?? timer.endAt - now;
  return [...list].sort((a, b) => left(a) - left(b));
}

function TimerCard({ timer, now, compact, timers, onOpen }: Readonly<{ timer: RestTimer; now: number; compact: boolean;
  timers: RestTimersPort; onOpen: (timer: RestTimer) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const left = remainingSec(timer, now);
  const paused = isPaused(timer);
  const finished = isFinished(timer, now);
  const timeText = finished ? "Готово" : clock(left);
  const timeColor = finished ? colors.success : paused ? colors.textSecondary : colors.textPrimary;
  const button = (key: string, accessibilityLabel: string, onPress: () => void, content: React.ReactNode, primary = false) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={4}
      style={[styles.button, compact && styles.buttonCompact, { backgroundColor: primary ? colors.accentFill : colors.input }]}>{content}</Pressable>
  );
  const adjust = (delta: number) => (
    button(delta < 0 ? "minus" : "plus", `Отдых ${delta < 0 ? "меньше" : "больше"} на ${ADJUST_STEP_SEC} секунд`, () => { void timers.adjust(timer.id, delta); },
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color: colors.textPrimary }]}>{`${delta < 0 ? "−" : "+"}${ADJUST_STEP_SEC}`}</Text>)
  );
  const pause = finished ? null : button("pause", paused ? "Продолжить отдых" : "Поставить отдых на паузу",
    () => { void (paused ? timers.resume(timer.id) : timers.pause(timer.id)); },
    paused ? <Play size={18} color={colors.textPrimary} strokeWidth={2} /> : <Pause size={18} color={colors.textPrimary} strokeWidth={2} />);
  const skip = button("skip", "Пропустить отдых", () => { void timers.skip(timer.id); }, <SkipForward size={18} color={colors.onAccentFill} strokeWidth={2} />, true);
  const timeView = (
    <Text accessibilityLabel={finished ? "Отдых окончен" : `Осталось ${clock(left)}`} numberOfLines={1}
      style={[styles.time, compact && styles.timeCompact, { color: timeColor }]}>{timeText}</Text>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLiveRegion="polite"
      accessibilityLabel={`${timer.clientName}, ${timer.exerciseName}. ${finished ? "Отдых окончен" : paused ? `Пауза, осталось ${clock(left)}` : `Осталось ${clock(left)}`}. Открыть тренировку`}
      accessibilityHint="Смахните в сторону, чтобы свернуть панель к краю экрана" onPress={() => onOpen(timer)}
      style={[styles.card, compact && styles.cardCompact, { backgroundColor: colors.surface, borderColor: finished ? colors.success : colors.border }]}>
      <Text style={[styles.owner, { color: colors.textSecondary }]} numberOfLines={1}>
        <Text style={{ color: colors.textPrimary, fontFamily: fonts.semibold }}>{timer.clientName}</Text>
        {` · ${timer.exerciseName}${paused ? " · Пауза" : ""}`}
      </Text>
      {compact ? <>
        <View style={styles.lineCenter}>{timeView}</View>
        <View style={styles.line}>{adjust(-ADJUST_STEP_SEC)}{adjust(ADJUST_STEP_SEC)}{pause}{skip}</View>
      </> : (
        <View style={styles.line}>{adjust(-ADJUST_STEP_SEC)}{timeView}{adjust(ADJUST_STEP_SEC)}{pause}{skip}</View>
      )}
    </Pressable>
  );
}

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
  const subscribe = useCallback((listener: () => void) => timers.subscribe(listener), [timers]);
  const list = useSyncExternalStore(subscribe, () => timers.list());
  const [now, setNow] = useState(() => Date.now());
  const [side, setSide] = useState<Side | null>(null);
  const [showAll, setShowAll] = useState(false);
  const signalled = useRef(new Set<string>());
  const pendingDismiss = useRef(new Set<ReturnType<typeof setTimeout>>());
  const offset = useSharedValue(0);

  const anyRunning = list.some((timer) => !isPaused(timer));
  const latestId = list.length === 0 ? null : [...list].sort((a, b) => b.startedAt - a.startedAt)[0]!.id;

  useEffect(() => () => {
    for (const handle of pendingDismiss.current) clearTimeout(handle);
    pendingDismiss.current.clear();
  }, []);

  // Отсчёт перерисовывается, пока хоть один таймер идёт; на паузе остаток не меняется.
  useEffect(() => {
    if (!anyRunning) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [anyRunning, list.length]);

  // Новый запуск разворачивает панель, чтобы тренер увидел, что таймер пошёл.
  useEffect(() => { setSide(null); offset.value = 0; }, [latestId, offset]);
  useEffect(() => { if (list.length <= SIDE_BY_SIDE) setShowAll(false); }, [list.length]);

  // Окончание в открытом приложении: одна вибрация на всю пачку закончившихся (сигналы не накладываются), панель разворачивается,
  // через несколько секунд каждый закончившийся таймер уходит. Скрытые за «Ещё N» тоже сигналят.
  useEffect(() => {
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
  const expand = useCallback(() => { setSide(null); offset.value = withTiming(0, { duration: 120 }); }, [offset]);

  // Объекты жестов создаются один раз; на JS переходим через scheduleOnRN (правила проекта).
  const swipeToCollapse = useMemo(() => Gesture.Pan().activeOffsetX([-14, 14]).failOffsetY([-14, 14])
    .onUpdate((event) => { "worklet"; offset.value = event.translationX; })
    .onEnd((event) => {
      "worklet";
      if (event.translationX > SWIPE_DISTANCE) scheduleOnRN(collapse, "right");
      else if (event.translationX < -SWIPE_DISTANCE) scheduleOnRN(collapse, "left");
      offset.value = withTiming(0, { duration: 120 });
    }), [collapse, offset]);
  const swipeToExpand = useMemo(() => Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-14, 14])
    .onEnd((event) => {
      "worklet";
      if (Math.abs(event.translationX) > 16) scheduleOnRN(expand);
    }), [expand]);
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  if (list.length === 0) return null;
  const ordered = byRemaining(list, now);
  const bottom = insets.bottom + TAB_BAR_HEIGHT + editorHeight;

  if (side !== null) {
    const first = ordered[0]!;
    const Hint = side === "left" ? ChevronRight : ChevronLeft;
    const finished = isFinished(first, now);
    const timeText = finished ? "Готово" : clock(remainingSec(first, now));
    const more = ordered.length - 1;
    return (
      <View key="collapsed" pointerEvents="box-none" style={[styles.edge, { bottom }, side === "left" ? styles.edgeLeft : styles.edgeRight]}>
        <GestureDetector gesture={swipeToExpand}>
          <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)}>
            <Pressable accessibilityRole="button" accessibilityLiveRegion="polite"
              accessibilityLabel={`${finished ? "Отдых окончен" : isPaused(first) ? `Отдых на паузе, осталось ${timeText}` : `Идёт отдых, осталось ${timeText}`}${more > 0 ? `, ещё таймеров: ${more}` : ""}. Развернуть панель`}
              onPress={expand}
              style={[styles.pill, side === "left" ? styles.pillLeft : styles.pillRight,
                { backgroundColor: colors.surface, borderColor: finished ? colors.success : colors.border }]}>
              {side === "right" ? <Hint size={16} color={colors.accentInk} strokeWidth={2.5} /> : null}
              {isPaused(first) ? <Pause size={14} color={colors.textSecondary} strokeWidth={2.5} /> : null}
              <Text style={[styles.pillTime, { color: finished ? colors.success : isPaused(first) ? colors.textSecondary : colors.textPrimary }]} numberOfLines={1}>{timeText}</Text>
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
        <Animated.View entering={FadeIn.duration(120)} style={panelStyle}>
          <View style={styles.row}>
            {visible.map((timer) => <TimerCard key={timer.id} timer={timer} now={now} compact={visible.length > 1} timers={timers} onOpen={onOpen} />)}
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
            {hidden.map((timer) => <TimerCard key={timer.id} timer={timer} now={now} compact={false} timers={timers} onOpen={onOpen} />)}
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
  cardCompact: { paddingHorizontal: 6 },
  owner: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center" },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  lineCenter: { alignItems: "center" },
  time: { flex: 1, minWidth: 64, textAlign: "center", fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  timeCompact: { flex: 0, fontSize: 18, lineHeight: 23 },
  button: { flex: 1, minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  buttonCompact: { minWidth: 0, borderRadius: 9 },
  buttonText: { fontFamily: fonts.semibold, fontSize: 13 },
  buttonTextCompact: { fontSize: 11 },
  more: { alignSelf: "flex-end", minHeight: 36, marginTop: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 4, elevation: 8 },
  moreText: { fontFamily: fonts.medium, fontSize: 12 },
  hintLeft: { position: "absolute", left: -11, top: 20 },
  hintRight: { position: "absolute", right: -11, top: 20 },
  pill: { minHeight: 44, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4, elevation: 8 },
  pillLeft: { borderTopRightRadius: 22, borderBottomRightRadius: 22, borderLeftWidth: 0 },
  pillRight: { borderTopLeftRadius: 22, borderBottomLeftRadius: 22, borderRightWidth: 0 },
  pillTime: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  pillMore: { fontFamily: fonts.bold, fontSize: 12 },
});
