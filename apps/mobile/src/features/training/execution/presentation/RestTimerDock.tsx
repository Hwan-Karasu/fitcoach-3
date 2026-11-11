import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { ChevronRight, Pause, Play, SkipForward, Timer } from "lucide-react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { restTimerDiagnostics } from "../../../../shared/diagnostics/RestTimerDiagnostics.ts";
import { ADJUST_STEP_SEC, isFinished, isPaused, type RestTimer } from "../domain/RestTimerRules.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { RestPanelClock } from "./RestPanelClock.tsx";
import { useRestPanelController } from "./useRestPanelController.ts";
import { ACTION_GAP, CARD_PADDING, compactTimerCount, orderedRestTimers, retainedTimerOffset, restPanelMode, timerCarouselLayout,
  timerCarouselPosition, timerCountLabel, timerInitials, restPanelSettleTarget, TIMER_GAP, type RestPanelPreference } from "./restPanelRules.ts";

type AvatarLoader = (ids: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
/** Свёрнутая строка низкая (≈34 dp); зона нажатия добирается до 48 dp невидимым краем. */
const SUMMARY_SLOP = { top: 7, bottom: 7 } as const;
/** Высота ручки над содержимым и длительность анимации появления/смены состояния панели, мс (быстро: палец и взмах ведут сами). */
const HANDLE_H = 12;
const PANEL_ANIM_MS = 160;
const shortName = (name: string) => name.trim().split(/\s+/u)[1] ?? name;

/** Владелец таймера: эмодзи/инициалы клиента; у каждого участника свой тон (по порядку в списке владельцев), чтобы отличать их в ряду. */
function Avatar({ timer, avatars, tone, small = false }: Readonly<{ timer: RestTimer; avatars: ReadonlyMap<string, string | null>; tone: number; small?: boolean }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const tones = [{ bg: colors.accentSoft, ink: colors.accentInk }, { bg: withAlpha(colors.warning, 0.28), ink: colors.textPrimary },
    { bg: withAlpha(colors.success, 0.24), ink: colors.textPrimary }] as const;
  const { bg, ink } = tones[tone % tones.length]!;
  return <View accessible={false} style={[styles.avatar, small && styles.avatarSmall, { backgroundColor: bg }]}>
    <Text style={[styles.initials, small && styles.initialsSmall, { color: ink }]}>{avatars.get(timer.clientId) ?? timerInitials(timer.clientName)}</Text>
  </View>;
}

type CardProps = Readonly<{ timer: RestTimer; timers: RestTimersPort; active: boolean; finished: boolean;
  multipleOwners: boolean; avatars: ReadonlyMap<string, string | null>; tone: number; single: boolean; fontScale: number;
  onOpen: (timer: RestTimer) => void; clockDisabled: boolean }>;

const TimerCard = memo(function TimerCard({ timer, timers, active, finished, multipleOwners, avatars, tone, single, fontScale, onOpen, clockDisabled }: CardProps) {
  const colors = usePrototypeTheme().palette.tokens;
  const paused = isPaused(timer);
  const iconSize = single ? 17 : 20;
  const action = (label: string, run: () => Promise<void>, node: ReactNode, primary = false) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${timer.clientName}, ${timer.exerciseName}: ${label}`}
      hitSlop={single ? { top: 8, bottom: 8, left: 2, right: 2 } : { top: 7, bottom: 7 }}
      onPress={() => { void run().catch(() => undefined); }}
      style={[styles.action, single ? styles.actionSingle : styles.actionCard, { backgroundColor: primary ? colors.accentFill : colors.surfaceRaised }]}>{node}</Pressable>
  );
  const minus = action(`Уменьшить отдых на ${ADJUST_STEP_SEC} секунд`, () => timers.adjust(timer.id, -ADJUST_STEP_SEC), <Text style={[styles.adjust, { color: colors.textPrimary }]}>{`−${ADJUST_STEP_SEC}`}</Text>);
  const plus = action(`Увеличить отдых на ${ADJUST_STEP_SEC} секунд`, () => timers.adjust(timer.id, ADJUST_STEP_SEC), <Text style={[styles.adjust, { color: colors.textPrimary }]}>{`+${ADJUST_STEP_SEC}`}</Text>);
  const toggle = action(paused ? "Продолжить отдых" : "Пауза", () => paused ? timers.resume(timer.id) : timers.pause(timer.id),
    paused ? <Play size={iconSize} color={colors.textPrimary} /> : <Pause size={iconSize} color={colors.textPrimary} />);
  const skip = action("Пропустить отдых", () => timers.skip(timer.id), <SkipForward size={iconSize + 2} color={colors.onAccentFill} />, true);
  const time = <View style={[styles.clockRow, single ? styles.clockSingle : { minWidth: finished ? 0 : 56 * Math.max(1, fontScale) }]}>
    <RestPanelClock timer={timer} active={active} finished={finished} disabled={clockDisabled}
      style={[styles.time, single && styles.timeSingle, finished && (single ? styles.finishedSingle : styles.finished),
        { color: finished ? colors.success : paused ? colors.textSecondary : colors.textPrimary }]} />
    {paused ? <Pause size={14} color={colors.textSecondary} /> : null}
  </View>;
  const label = `${timer.clientName}, ${timer.exerciseName}. ${finished ? "Отдых окончен" : paused ? "Пауза" : "Идёт отдых"}. Открыть тренировку`;
  if (single) {
    // Один таймер: имя и упражнение по центру; под ними «−15 +15 · время · пауза и пропуск» одним рядом (макет, сценарий 1).
    return <View style={styles.cardSingle}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={{ top: 7, bottom: 7 }} onPress={() => onOpen(timer)} style={styles.headingSingle}>
        {/* Имя и упражнение — двумя строками: ФИО и название не обрезаются, а кнопки и цифры мельче; высота панели прежняя. */}
        <Text numberOfLines={1} style={[styles.caption, styles.captionName, { color: colors.textPrimary }]}>{timer.clientName}</Text>
        <Text numberOfLines={1} style={[styles.caption, styles.captionExercise, { color: colors.textSecondary }]}>{timer.exerciseName}</Text>
      </Pressable>
      <View style={styles.rowSingle}>
        <View style={styles.side}>{minus}{plus}</View>
        {time}
        <View style={styles.side}>{toggle}{skip}</View>
      </View>
    </View>;
  }
  // Несколько таймеров: карточка рядом с другими; сверху владелец и упражнение, под ними время и четыре кнопки (макет, сценарии 2–4).
  return <View style={[styles.card, { backgroundColor: colors.surface }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(timer)} style={styles.heading}>
      {multipleOwners ? <Avatar timer={timer} avatars={avatars} tone={tone} /> : null}
      <Text numberOfLines={2} style={[styles.caption, styles.captionCard, { color: colors.textPrimary }]}>
        <Text style={{ fontFamily: fonts.bold }}>{shortName(timer.clientName)}</Text>{` · ${timer.exerciseName}`}
      </Text>
    </Pressable>
    {time}
    <View style={styles.actions}>{minus}{plus}{toggle}{skip}</View>
  </View>;
});

/** Постоянный контроллер + меняющееся представление внутри общей панели. */
export function RestTimerDock({ timers, onOpen, loadAvatars, renderContainer }: Readonly<{
  timers: RestTimersPort;
  onOpen: (timer: RestTimer) => void;
  loadAvatars: AvatarLoader;
  renderContainer: (area: ReactNode, hasTimers: boolean) => ReactNode;
}>) {
  restTimerDiagnostics.render("timers");
  const clockDisabled = useSyncExternalStore(restTimerDiagnostics.subscribe, restTimerDiagnostics.snapshot, restTimerDiagnostics.snapshot);
  const { list, now, active } = useRestPanelController(timers);
  const [preference, setPreference] = useState<RestPanelPreference>("expanded");
  const mode = restPanelMode(preference, list.length);
  useEffect(() => { restTimerDiagnostics.event(mode); }, [mode]);
  const colors = usePrototypeTheme().palette.tokens;
  const dimensions = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(0, dimensions.width - 16));
  const ordered = useMemo(() => orderedRestTimers(list), [list]);
  const ids = ordered.map((timer) => timer.id);
  const idsKey = JSON.stringify(ids);
  const ownersKey = JSON.stringify([...new Set(ordered.map((timer) => timer.clientId))].sort());
  const multipleOwners = new Set(ordered.map((timer) => timer.clientId)).size > 1;
  // Тон владельца — по месту в отсортированном списке владельцев: не зависит от порядка и числа таймеров.
  const toneOf = (clientId: string) => Math.max(0, (JSON.parse(ownersKey) as string[]).indexOf(clientId));
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    let live = true;
    const owners = JSON.parse(ownersKey) as string[];
    if (owners.length === 0) return undefined;
    void loadAvatars(owners).then((result) => { if (live) setAvatars(result); }).catch(() => undefined);
    return () => { live = false; };
  }, [ownersKey, loadAvatars]);
  const openRef = useRef(onOpen); openRef.current = onOpen;
  const open = useCallback((timer: RestTimer) => openRef.current(timer), []);
  // Панель ведёт один общий прогресс 0…1 (0 — свёрнута, 1 — развёрнута): высота и прозрачность слоёв считаются на UI-потоке,
  // палец ведёт панель сразу (onUpdate), а не после отпускания; ход времени и обновления JS на анимацию не влияют.
  const progress = useSharedValue(1);
  const present = useSharedValue(mode === "hidden" ? 0 : 1);
  const expandedH = useSharedValue(0);
  const collapsedH = useSharedValue(0);
  const startProgress = useSharedValue<0 | 1>(1);
  const prefRef = useRef(preference); prefRef.current = preference;
  const driven = useRef(false);
  // Выбранное состояние (1 — развёрнута, 0 — свёрнута) для откатов жеста на UI-потоке.
  const prefProgress = useSharedValue<0 | 1>(1);
  // Пока слои не измерены (первый кадр), высота нулевая: иначе область «прыгает» без анимации.
  const areaStyle = useAnimatedStyle(() => ({
    height: expandedH.value > 0 && collapsedH.value > 0
      ? present.value * (HANDLE_H + collapsedH.value + (expandedH.value - collapsedH.value) * progress.value) : 0,
  }));
  const expandedLayer = useAnimatedStyle(() => ({ opacity: progress.value }));
  const collapsedLayer = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const gone = mode === "hidden";
  useEffect(() => { present.value = withTiming(gone ? 0 : 1, { duration: PANEL_ANIM_MS }); }, [gone, present]);
  useEffect(() => {
    prefProgress.value = preference === "expanded" ? 1 : 0;
    // После жеста панель уже доводится пружиной с начальной скоростью пальца: повторная анимация её бы сбила.
    if (driven.current) { driven.current = false; return; }
    progress.value = withTiming(preference === "expanded" ? 1 : 0, { duration: PANEL_ANIM_MS });
  }, [preference, progress, prefProgress]);
  const collapse = useCallback(() => setPreference("collapsed"), []);
  const expand = useCallback(() => setPreference("expanded"), []);
  const settled = useCallback((expanded: boolean) => {
    restTimerDiagnostics.event(expanded ? "gesture-up" : "gesture-down");
    if (prefRef.current !== (expanded ? "expanded" : "collapsed")) driven.current = true;
    setPreference(expanded ? "expanded" : "collapsed");
  }, []);
  const gesture = useMemo(() => Gesture.Pan().activeOffsetY([-8, 8]).failOffsetX([-14, 14])
    .onBegin(() => {
      "worklet";
      cancelAnimation(progress);
      startProgress.value = progress.value >= 0.5 ? 1 : 0;
    })
    .onUpdate((event) => {
      "worklet";
      const range = Math.max(1, expandedH.value - collapsedH.value);
      progress.value = Math.min(1, Math.max(0, startProgress.value - event.translationY / range));
    })
    .onEnd((event, success) => {
      "worklet";
      // Отменённый системой жест состояние не меняет: панель вернёт onFinalize к выбранному.
      if (!success) return;
      const range = Math.max(1, expandedH.value - collapsedH.value);
      const reached = Math.min(1, Math.max(0, startProgress.value - event.translationY / range));
      const target = restPanelSettleTarget(startProgress.value, reached, event.velocityY, range);
      progress.value = withSpring(target, { velocity: -event.velocityY / range, damping: 30, stiffness: 420, overshootClamping: true });
      scheduleOnRN(settled, target === 1);
    })
    .onFinalize((_event, success) => {
      "worklet";
      // Жест не дошёл до конца (касание без движения, отмена системой): панель возвращается к ВЫБРАННОМУ состоянию, а не к началу жеста.
      if (!success) progress.value = withTiming(prefProgress.value, { duration: PANEL_ANIM_MS });
    }), [progress, startProgress, prefProgress, expandedH, collapsedH, settled]);
  const measureExpanded = useCallback((event: LayoutChangeEvent) => { expandedH.value = event.nativeEvent.layout.height; }, [expandedH]);
  const measureCollapsed = useCallback((event: LayoutChangeEvent) => { collapsedH.value = event.nativeEvent.layout.height; }, [collapsedH]);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const previousIds = useRef<readonly string[]>([]);
  const pendingIndex = useRef<number | null>(null);
  const [page, setPage] = useState(0);
  const layout = timerCarouselLayout(width, ordered.length, dimensions.fontScale);
  const previousStep = useRef(layout.step);
  useEffect(() => {
    const nextIds = JSON.parse(idsKey) as string[];
    const next = pendingIndex.current === null
      ? retainedTimerOffset(previousIds.current, nextIds, offset.current, layout.step, layout.maxOffset, previousStep.current)
      : Math.min(layout.maxOffset, pendingIndex.current * layout.step);
    previousIds.current = nextIds;
    previousStep.current = layout.step;
    offset.current = next;
    if (mode !== "expanded") return;
    pendingIndex.current = null;
    scroll.current?.scrollTo({ x: next, animated: false });
    setPage(timerCarouselPosition(next, layout.step, layout.maxOffset, layout.stops));
  }, [idsKey, layout.step, layout.maxOffset, layout.stops, mode]);
  const visibleCount = compactTimerCount(width, ordered.length, multipleOwners, dimensions.fontScale);
  const hidden = ordered.length - visibleCount;
  const first = ordered[0];
  const grip = <View style={[styles.grip, { backgroundColor: colors.textMuted }]} />;
  // Имя владельца в свёрнутой строке ведёт сразу к упражнению, не разворачивая панель; ручка и время разворачивают.
  const openFirst = () => { if (first) open(first); };
  const area = <Animated.View testID="rest-panel-area" style={[styles.area, areaStyle]}>
    {mode === "hidden" ? null : <>
      {/* Read during dispatch: RN releases the event before a queued state updater may run. */}
      <View testID="rest-panel-width" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <GestureDetector gesture={gesture}>
          <View collapsable={false}>
            <Pressable accessibilityRole="button" accessibilityLabel={mode === "collapsed" ? "Развернуть таймеры отдыха" : "Свернуть таймеры отдыха"}
              accessibilityState={{ expanded: mode === "expanded" }} hitSlop={{ top: 18, bottom: 18 }}
              onPress={mode === "collapsed" ? expand : collapse} style={styles.handle}>{grip}</Pressable>
          </View>
        </GestureDetector>
      </View>
      {/* Невидимый слой скрыт и для читалок экрана: иначе TalkBack читает и нажимает кнопки, которых не видно. */}
      <Animated.View testID="rest-panel-expanded" onLayout={measureExpanded} pointerEvents={mode === "expanded" ? "auto" : "none"}
        importantForAccessibility={mode === "expanded" ? "auto" : "no-hide-descendants"} accessibilityElementsHidden={mode !== "expanded"}
        style={[styles.layer, expandedLayer]}>
        <ScrollView ref={scroll} horizontal scrollEnabled={layout.stops > 1} showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cards} snapToInterval={layout.step} decelerationRate="fast"
          scrollEventThrottle={32} onScroll={(event) => {
            offset.current = event.nativeEvent.contentOffset.x;
            const next = timerCarouselPosition(offset.current, layout.step, layout.maxOffset, layout.stops);
            setPage((old) => old === next ? old : next);
          }}>
          {ordered.map((timer) => <View key={timer.id} style={{ width: layout.cardWidth }}>
            <TimerCard timer={timer} timers={timers} active={active} finished={isFinished(timer, now)} multipleOwners={multipleOwners}
              avatars={avatars} tone={toneOf(timer.clientId)} single={ordered.length === 1}
              fontScale={dimensions.fontScale} onOpen={open} clockDisabled={clockDisabled} />
          </View>)}
        </ScrollView>
        {layout.stops > 1 ? <View accessible accessibilityLabel={`Таймеры, позиция ${page + 1} из ${layout.stops}`} style={styles.indicator}>
          {Array.from({ length: layout.stops }, (_, index) => <View key={index} style={[styles.segment, { backgroundColor: index === page ? colors.accentFill : colors.border }]} />)}
        </View> : null}
      </Animated.View>
      <Animated.View testID="rest-panel-collapsed" onLayout={measureCollapsed} pointerEvents={mode === "collapsed" ? "auto" : "none"}
        importantForAccessibility={mode === "collapsed" ? "auto" : "no-hide-descendants"} accessibilityElementsHidden={mode !== "collapsed"}
        style={[styles.layer, collapsedLayer]}>
        {first ? <View style={styles.summary}>
          <Pressable accessibilityRole="button"
            accessibilityLabel={multipleOwners ? "Развернуть панель таймеров отдыха" : `${first.clientName}, ${first.exerciseName}. Открыть упражнение`}
            onPress={multipleOwners ? expand : openFirst} hitSlop={SUMMARY_SLOP} style={[styles.summaryLead, ordered.length === 1 && styles.summaryLeadFit]}>
            <Timer size={20} color={colors.accentInk} />
            <Text numberOfLines={1} style={[styles.summaryLabel, ordered.length === 1 && styles.summaryLabelFit, { color: colors.textPrimary }]}>
              {multipleOwners ? timerCountLabel(ordered.length) : `${shortName(first.clientName)}${ordered.length > 1 ? ` · ${timerCountLabel(ordered.length)}` : " ·"}`}
            </Text>
          </Pressable>
          {ordered.slice(0, visibleCount).map((timer) => {
            const done = isFinished(timer, now);
            // Идущий таймер — узкий чип с цифрами; завершённый шире и выше: «Отдых окончен» помещается в одну строку.
            return <Pressable key={timer.id} accessibilityRole="button" onPress={multipleOwners ? () => open(timer) : expand} hitSlop={SUMMARY_SLOP}
              accessibilityLabel={multipleOwners ? `${timer.clientName}, ${timer.exerciseName}. Открыть упражнение` : `${timer.clientName}, ${timer.exerciseName}. Развернуть таймеры`}
              style={[styles.summaryToken, done ? styles.summaryTokenDone : { width: (multipleOwners ? 84 : 54) * Math.max(1, dimensions.fontScale) },
                { backgroundColor: colors.surfaceRaised }]}>
              {multipleOwners ? <Avatar timer={timer} avatars={avatars} tone={toneOf(timer.clientId)} small /> : null}
              <RestPanelClock timer={timer} active={active} finished={done} disabled={clockDisabled}
                style={[styles.summaryTime, done && styles.summaryDone, { color: colors.textPrimary }]} />
            </Pressable>;
          })}
          {hidden > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Показать остальные таймеры: ещё ${hidden}`}
            onPress={() => { pendingIndex.current = visibleCount; expand(); }} hitSlop={SUMMARY_SLOP} style={[styles.more, { backgroundColor: colors.accentFill }]}>
            <Text style={[styles.moreText, { color: colors.onAccentFill }]}>{`Ещё ${hidden}`}</Text>
            <ChevronRight size={14} color={colors.onAccentFill} />
          </Pressable> : null}
        </View> : null}
      </Animated.View>
    </>}
  </Animated.View>;
  return renderContainer(area, mode !== "hidden");
}

const styles = StyleSheet.create({
  area: { overflow: "hidden" }, layer: { position: "absolute", top: HANDLE_H, left: 0, right: 0 },
  handle: { height: HANDLE_H, alignItems: "center", justifyContent: "center" }, grip: { width: 40, height: 4, borderRadius: 2 },
  cards: { gap: TIMER_GAP, alignItems: "stretch", paddingBottom: 2 },
  // Один таймер: без своей подложки, прямо на панели.
  cardSingle: { gap: 0, paddingBottom: 2 },
  headingSingle: { minHeight: 34, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  rowSingle: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  side: { flexDirection: "row", gap: 4 },
  clockSingle: { flex: 1, minWidth: 0 },
  // Карточка среди нескольких таймеров.
  card: { flex: 1, borderRadius: 24, paddingHorizontal: CARD_PADDING, paddingTop: 4, paddingBottom: 5, gap: 0 },
  heading: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  caption: { minWidth: 0, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  captionName: { alignSelf: "stretch", textAlign: "center", fontFamily: fonts.bold, fontSize: 14, lineHeight: 18 },
  captionExercise: { alignSelf: "stretch", textAlign: "center", fontSize: 12, lineHeight: 16 },
  captionCard: { flexShrink: 1, textAlign: "center" },
  avatar: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarSmall: { width: 24, height: 24, borderRadius: 8 },
  initials: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 }, initialsSmall: { fontSize: 11, lineHeight: 14 },
  clockRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 4 },
  time: { textAlign: "center", fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, flexShrink: 1 },
  timeSingle: { fontSize: 30, lineHeight: 36 }, finished: { fontSize: 15, lineHeight: 20 }, finishedSingle: { fontSize: 18, lineHeight: 24 },
  actions: { flexDirection: "row", gap: ACTION_GAP },
  action: { alignItems: "center", justifyContent: "center" },
  actionSingle: { width: 44, height: 32, borderRadius: 12 },
  actionCard: { flex: 1, minWidth: 0, height: 34, borderRadius: 12 },
  adjust: { fontFamily: fonts.bold, fontSize: 14 },
  indicator: { flexDirection: "row", gap: 4, justifyContent: "center", paddingVertical: 2, paddingHorizontal: 40 },
  segment: { flex: 1, maxWidth: 32, height: 5, borderRadius: 3 },
  summary: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, paddingBottom: 2 },
  summaryLead: { flex: 1, minWidth: 0, minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6 },
  summaryLeadFit: { flex: 0, flexShrink: 1 }, summaryLabelFit: { flex: 0, flexShrink: 1 },
  summaryLabel: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  summaryToken: { flexDirection: "row", height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0, paddingHorizontal: 4 },
  summaryTime: { textAlign: "center", fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  summaryDone: { fontSize: 13, lineHeight: 17 },
  summaryTokenDone: { height: 32, borderRadius: 16, paddingHorizontal: 12, flexShrink: 1, minWidth: 0 },
  more: { height: 28, paddingLeft: 10, paddingRight: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 14 },
  moreText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
});
