import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { ChevronLeft, ChevronRight, Pause, Play, SkipForward } from "lucide-react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { ADJUST_STEP_SEC, isFinished, isPaused, remainingSec, type RestTimer } from "../domain/RestTimerRules.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { useEditorDockHeight } from "../../../../shared/ui/components/public.ts";

/** Сколько секунд закончившийся таймер остаётся на панели с надписью «Готово». */
const FINISHED_VISIBLE_MS = 4000;
/** Высота нижней навигации над краем экрана: панель таймера — над ней. */
const TAB_BAR_HEIGHT = 80;
/** Сдвиг пальца, после которого свайп сворачивает панель к краю. */
const SWIPE_DISTANCE = 48;

type Side = "left" | "right";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Один выбранный таймер: на устройстве он один (§44.3); если в хранилище остались старые записи — берётся последний запущенный. */
function currentTimer(list: readonly RestTimer[]): RestTimer | null {
  return [...list].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

/**
 * Панель таймера отдыха над нижней навигацией, на всех экранах: один таймер, пауза, ±15, пропуск (§44.3, §48.64). Нажатие на панель возвращает в
 * тренировку, из которой он запущен. Свайп вбок сворачивает панель к краю экрана — виден только отсчёт; галочки ‹ › на развёрнутой панели
 * подсказывают, что её можно свернуть. Смена экрана отсчёт не сбрасывает: время считается от сохранённого окончания.
 */
export function RestTimerDock({ timers, onOpen }: Readonly<{ timers: RestTimersPort; onOpen: (timer: RestTimer) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const editorHeight = useEditorDockHeight();
  const subscribe = useCallback((listener: () => void) => timers.subscribe(listener), [timers]);
  const list = useSyncExternalStore(subscribe, () => timers.list());
  const timer = currentTimer(list);
  const [now, setNow] = useState(() => Date.now());
  const [side, setSide] = useState<Side | null>(null);
  const signalled = useRef(new Set<string>());
  const pendingDismiss = useRef(new Set<ReturnType<typeof setTimeout>>());
  const offset = useSharedValue(0);

  const timerId = timer?.id ?? null;
  const running = timer !== null && !isPaused(timer);

  useEffect(() => () => {
    for (const handle of pendingDismiss.current) clearTimeout(handle);
    pendingDismiss.current.clear();
  }, []);

  // Отсчёт перерисовывается только пока таймер идёт; на паузе остаток не меняется.
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [running, timerId]);

  // Новый запуск разворачивает панель, чтобы тренер увидел, что таймер пошёл.
  useEffect(() => { setSide(null); offset.value = 0; }, [timerId, offset]);

  // Окончание в открытом приложении: вибрация один раз, панель разворачивается, через несколько секунд таймер уходит.
  useEffect(() => {
    if (timer === null || !isFinished(timer, now) || signalled.current.has(timer.id)) return;
    signalled.current.add(timer.id);
    setSide(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    const id = timer.id;
    const handle = setTimeout(() => {
      pendingDismiss.current.delete(handle);
      void timers.dismiss(id).catch(() => undefined);
    }, FINISHED_VISIBLE_MS);
    pendingDismiss.current.add(handle);
  }, [timer, now, timers]);

  const collapse = useCallback((next: Side) => { setSide(next); }, []);
  const expand = useCallback(() => { setSide(null); offset.value = withTiming(0, { duration: 120 }); }, [offset]);

  // Объект жеста создаётся один раз; на JS переходим через scheduleOnRN (правила проекта).
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
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  if (timer === null) return null;
  const left = remainingSec(timer, now);
  const paused = isPaused(timer);
  const finished = isFinished(timer, now);
  const timeText = finished ? "Готово" : clock(left);
  const timeColor = finished ? colors.success : paused ? colors.textSecondary : colors.textPrimary;
  const bottom = insets.bottom + TAB_BAR_HEIGHT + editorHeight;

  const button = (key: string, accessibilityLabel: string, onPress: () => void, content: React.ReactNode, primary = false) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={4}
      style={[styles.button, { backgroundColor: primary ? colors.accentFill : colors.input }]}>{content}</Pressable>
  );

  if (side !== null) {
    const Hint = side === "left" ? ChevronRight : ChevronLeft;
    return (
      <View pointerEvents="box-none" style={[styles.edge, { bottom }, side === "left" ? styles.edgeLeft : styles.edgeRight]}>
        <GestureDetector gesture={swipeToExpand}>
          <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)}>
            <Pressable accessibilityRole="button" accessibilityLiveRegion="polite"
              accessibilityLabel={finished ? "Отдых окончен. Развернуть таймер" : `${paused ? "Отдых на паузе" : "Идёт отдых"}, осталось ${clock(left)}. Развернуть таймер`}
              onPress={expand}
              style={[styles.pill, side === "left" ? styles.pillLeft : styles.pillRight,
                { backgroundColor: colors.surface, borderColor: finished ? colors.success : colors.border }]}>
              {side === "right" ? <Hint size={16} color={colors.accentInk} strokeWidth={2.5} /> : null}
              {paused ? <Pause size={14} color={colors.textSecondary} strokeWidth={2.5} /> : null}
              <Text style={[styles.pillTime, { color: timeColor }]} numberOfLines={1}>{timeText}</Text>
              {side === "left" ? <Hint size={16} color={colors.accentInk} strokeWidth={2.5} /> : null}
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom }]}>
      <GestureDetector gesture={swipeToCollapse}>
        <Animated.View entering={FadeIn.duration(120)} style={cardStyle}>
          <Pressable accessibilityRole="button" accessibilityLiveRegion="polite"
            accessibilityLabel={`${timer.clientName}, ${timer.exerciseName}. ${finished ? "Отдых окончен" : paused ? `Пауза, осталось ${clock(left)}` : `Осталось ${clock(left)}`}. Открыть тренировку`}
            accessibilityHint="Смахните в сторону, чтобы свернуть к краю экрана"
            onPress={() => onOpen(timer)}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: finished ? colors.success : colors.border }]}>
            <View style={styles.ownerRow}>
              <ChevronLeft size={16} color={colors.textMuted} strokeWidth={2.5} />
              <Text style={[styles.owner, { color: colors.textSecondary }]} numberOfLines={1}>
                <Text style={{ color: colors.textPrimary, fontFamily: fonts.semibold }}>{timer.clientName}</Text>
                {` · ${timer.exerciseName}${paused ? " · Пауза" : ""}`}
              </Text>
              <ChevronRight size={16} color={colors.textMuted} strokeWidth={2.5} />
            </View>
            <View style={styles.line}>
              {button("minus", `Отдых меньше на ${ADJUST_STEP_SEC} секунд`, () => { void timers.adjust(timer.id, -ADJUST_STEP_SEC); },
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>{`−${ADJUST_STEP_SEC}`}</Text>)}
              <Text accessibilityLabel={finished ? "Отдых окончен" : `Осталось ${clock(left)}`} numberOfLines={1}
                style={[styles.time, { color: timeColor }]}>{timeText}</Text>
              {button("plus", `Отдых больше на ${ADJUST_STEP_SEC} секунд`, () => { void timers.adjust(timer.id, ADJUST_STEP_SEC); },
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>{`+${ADJUST_STEP_SEC}`}</Text>)}
              {finished ? null : button("pause", paused ? "Продолжить отдых" : "Поставить отдых на паузу",
                () => { void (paused ? timers.resume(timer.id) : timers.pause(timer.id)); },
                paused ? <Play size={18} color={colors.textPrimary} strokeWidth={2} /> : <Pause size={18} color={colors.textPrimary} strokeWidth={2} />)}
              {button("skip", "Пропустить отдых", () => { void timers.skip(timer.id); },
                <SkipForward size={18} color={colors.onAccentFill} strokeWidth={2} />, true)}
            </View>
          </Pressable>
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
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 8, gap: 6, elevation: 8 },
  ownerRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  owner: { flex: 1, textAlign: "center", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { flex: 1, minWidth: 64, textAlign: "center", fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  button: { flex: 1, minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: fonts.semibold, fontSize: 13 },
  pill: { minHeight: 44, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4, elevation: 8 },
  pillLeft: { borderTopRightRadius: 22, borderBottomRightRadius: 22, borderLeftWidth: 0 },
  pillRight: { borderTopLeftRadius: 22, borderBottomLeftRadius: 22, borderRightWidth: 0 },
  pillTime: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
});
