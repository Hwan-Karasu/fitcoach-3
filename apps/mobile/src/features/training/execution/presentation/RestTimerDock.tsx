import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { ChevronDown, Pause, Play, SkipForward, Timer } from "lucide-react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { restTimerDiagnostics } from "../../../../shared/diagnostics/RestTimerDiagnostics.ts";
import { ADJUST_STEP_SEC, isFinished, isPaused, type RestTimer } from "../domain/RestTimerRules.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { RestPanelClock } from "./RestPanelClock.tsx";
import { useRestPanelController } from "./useRestPanelController.ts";
import { compactTimerCount, orderedRestTimers, retainedTimerOffset, restPanelMode, timerCarouselLayout,
  timerCarouselPosition, timerCountLabel, timerInitials, TIMER_GAP, type RestPanelPreference } from "./restPanelRules.ts";

type AvatarLoader = (ids: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
const shortName = (name: string) => name.trim().split(/\s+/u)[1] ?? name;

function Avatar({ timer, avatars }: Readonly<{ timer: RestTimer; avatars: ReadonlyMap<string, string | null> }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <View accessible={false} style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
    <Text style={[styles.initials, { color: colors.accentInk }]}>{avatars.get(timer.clientId) ?? timerInitials(timer.clientName)}</Text>
  </View>;
}

type CardProps = Readonly<{ timer: RestTimer; timers: RestTimersPort; clock: SharedValue<number>; finished: boolean;
  multipleOwners: boolean; avatars: ReadonlyMap<string, string | null>; grid: boolean; single: boolean; fontScale: number;
  onOpen: (timer: RestTimer) => void; onElapsed: () => void; clockDisabled: boolean; inline: boolean }>;

const TimerCard = memo(function TimerCard({ timer, timers, clock, finished, multipleOwners, avatars, grid, single, fontScale, onOpen, onElapsed, clockDisabled, inline }: CardProps) {
  const colors = usePrototypeTheme().palette.tokens;
  const paused = isPaused(timer);
  const action = (label: string, run: () => Promise<void>, node: ReactNode, primary = false) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${timer.clientName}, ${timer.exerciseName}: ${label}`}
      onPress={() => { void run().catch(() => undefined); }}
      style={[styles.action, grid ? styles.gridAction : null, { backgroundColor: primary ? colors.accentFill : colors.input }]}>{node}</Pressable>
  );
  const actions = [
    action(`Уменьшить отдых на ${ADJUST_STEP_SEC} секунд`, () => timers.adjust(timer.id, -ADJUST_STEP_SEC), <Text style={[styles.adjust, { color: colors.textPrimary }]}>{`−${ADJUST_STEP_SEC}`}</Text>),
    action(`Увеличить отдых на ${ADJUST_STEP_SEC} секунд`, () => timers.adjust(timer.id, ADJUST_STEP_SEC), <Text style={[styles.adjust, { color: colors.textPrimary }]}>{`+${ADJUST_STEP_SEC}`}</Text>),
    action(paused ? "Продолжить отдых" : "Пауза", () => paused ? timers.resume(timer.id) : timers.pause(timer.id),
      paused ? <Play size={20} color={colors.textPrimary} /> : <Pause size={20} color={colors.textPrimary} />),
    action("Пропустить отдых", () => timers.skip(timer.id), <SkipForward size={22} color={colors.onAccentFill} />, true),
  ];
  const time = <View style={[styles.clockRow, { minHeight: Math.max(48, 38 * fontScale) }, inline && { flex: 1, minWidth: 82 * fontScale }]}>
    <RestPanelClock timer={timer} clock={clock} finished={finished} onElapsed={onElapsed} disabled={clockDisabled}
      style={[styles.time, single && styles.timeSingle, finished && styles.finished,
        { color: finished ? colors.success : paused ? colors.textSecondary : colors.textPrimary }]} />
    {paused && !inline ? <Pause size={14} color={colors.textSecondary} /> : null}
  </View>;
  return <View style={[styles.card, !single ? { backgroundColor: colors.surface } : null]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${timer.clientName}, ${timer.exerciseName}. ${finished ? "Отдых окончен" : paused ? "Пауза" : "Идёт отдых"}. Открыть тренировку`}
      onPress={() => onOpen(timer)} style={[styles.heading, { minHeight: Math.max(48, 34 * fontScale) }]}>
      {multipleOwners ? <Avatar timer={timer} avatars={avatars} /> : null}
      <Text numberOfLines={2} style={[styles.caption, { color: colors.textPrimary }]}>
        <Text style={{ fontFamily: fonts.bold }}>{single ? timer.clientName : shortName(timer.clientName)}</Text>{` · ${timer.exerciseName}`}
      </Text>
    </Pressable>
    {inline ? <View style={styles.actions}>{actions[0]}{actions[1]}{time}{actions[2]}{actions[3]}</View>
      : <>{time}<View style={[styles.actions, grid ? styles.actionsGrid : null]}>{actions}</View></>}
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
  const { list, now, wake, active } = useRestPanelController(timers);
  const [preference, setPreference] = useState<RestPanelPreference>("expanded");
  const mode = restPanelMode(preference, list.length);
  const colors = usePrototypeTheme().palette.tokens;
  const dimensions = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(0, dimensions.width - 42));
  const ordered = useMemo(() => orderedRestTimers(list), [list]);
  const ids = ordered.map((timer) => timer.id);
  const idsKey = JSON.stringify(ids);
  const ownersKey = JSON.stringify([...new Set(ordered.map((timer) => timer.clientId))].sort());
  const multipleOwners = new Set(ordered.map((timer) => timer.clientId)).size > 1;
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
  const clock = useSharedValue(Date.now());
  const frame = useFrameCallback(() => { "worklet"; clock.value = Date.now(); }, false);
  const running = active && !clockDisabled && list.some((timer) => !isPaused(timer) && !isFinished(timer, now));
  useEffect(() => { clock.value = Date.now(); frame.setActive(running); }, [running, frame, clock]);
  const height = useSharedValue(0);
  const animatedHeight = useAnimatedStyle(() => ({ height: height.value }));
  useEffect(() => { if (mode === "hidden") height.value = withTiming(0, { duration: 180 }); }, [mode, height]);
  const collapse = useCallback(() => setPreference("collapsed"), []);
  const expand = useCallback(() => setPreference("expanded"), []);
  const gesture = useMemo(() => Gesture.Pan().activeOffsetY([-10, 10]).failOffsetX([-14, 14])
    .onEnd((event) => {
      "worklet";
      if (event.translationY > 24 || event.velocityY > 300) scheduleOnRN(collapse);
      else if (event.translationY < -24 || event.velocityY < -300) scheduleOnRN(expand);
    }), [collapse, expand]);
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
  const area = <Animated.View testID="rest-panel-area" style={[styles.area, animatedHeight]}>
    {mode === "hidden" ? null : <View style={styles.measured}
      onLayout={(event) => { height.value = withTiming(event.nativeEvent.layout.height, { duration: 180 }); }}>
      <View onLayout={(event) => setWidth((old) => old === event.nativeEvent.layout.width ? old : event.nativeEvent.layout.width)}>
        <GestureDetector gesture={gesture}>
          <View collapsable={false}>
            <Pressable accessibilityRole="button" accessibilityLabel={mode === "collapsed" ? "Развернуть таймеры отдыха" : "Свернуть таймеры отдыха"}
              accessibilityState={{ expanded: mode === "expanded" }} hitSlop={{ top: 12, bottom: 12 }}
              onPress={mode === "collapsed" ? expand : collapse} style={styles.handle}>{grip}</Pressable>
          </View>
        </GestureDetector>
        {mode === "collapsed" && first ? <View style={styles.summary}>
          <Pressable accessibilityRole="button" accessibilityLabel="Развернуть панель таймеров отдыха" onPress={expand} style={styles.summaryLead}>
            <Timer size={22} color={colors.accentInk} />
            <Text numberOfLines={1} style={[styles.summaryLabel, { color: colors.textPrimary }]}>
              {multipleOwners ? timerCountLabel(ordered.length) : `${shortName(first.clientName)}${ordered.length > 1 ? ` · ${timerCountLabel(ordered.length)}` : ""}`}
            </Text>
          </Pressable>
          {ordered.slice(0, visibleCount).map((timer) => <Pressable key={timer.id} accessibilityRole="button" onPress={expand}
            accessibilityLabel={`${timer.clientName}, ${timer.exerciseName}. Развернуть таймеры`} style={[styles.summaryToken, { width: (multipleOwners ? 84 : 54) * Math.max(1, dimensions.fontScale) }]}>
            {multipleOwners ? <Avatar timer={timer} avatars={avatars} /> : null}
            <RestPanelClock timer={timer} clock={clock} finished={isFinished(timer, now)} onElapsed={wake} disabled={clockDisabled}
              style={[styles.summaryTime, isFinished(timer, now) && styles.summaryDone, { color: colors.textPrimary }]} />
          </Pressable>)}
          {hidden > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Показать остальные таймеры: ещё ${hidden}`}
            onPress={() => { pendingIndex.current = visibleCount; expand(); }} style={[styles.more, { backgroundColor: colors.accentFill }]}>
            <Text style={[styles.moreText, { color: colors.onAccentFill }]}>{`Ещё ${hidden}`}</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Развернуть таймеры" onPress={expand} style={styles.chevron}>
            <ChevronDown size={24} color={colors.accentInk} />
          </Pressable>
        </View> : mode === "expanded" ? <>
          <ScrollView ref={scroll} horizontal scrollEnabled={ordered.length > 2} showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cards} snapToInterval={layout.step} decelerationRate="fast"
            scrollEventThrottle={32} onScroll={(event) => {
              offset.current = event.nativeEvent.contentOffset.x;
              const next = timerCarouselPosition(offset.current, layout.step, layout.maxOffset, layout.stops);
              setPage((old) => old === next ? old : next);
            }}>
            {ordered.map((timer) => <View key={timer.id} style={{ width: layout.cardWidth }}>
              <TimerCard timer={timer} timers={timers} clock={clock} finished={isFinished(timer, now)} multipleOwners={multipleOwners}
                avatars={avatars} grid={layout.gridButtons} single={ordered.length === 1} inline={ordered.length === 1 && layout.cardWidth >= 220 + 82 * dimensions.fontScale}
                fontScale={dimensions.fontScale} onOpen={open} onElapsed={wake} clockDisabled={clockDisabled} />
            </View>)}
          </ScrollView>
          {layout.stops > 1 ? <View accessible accessibilityLabel={`Таймеры, позиция ${page + 1} из ${layout.stops}`} style={styles.indicator}>
            {Array.from({ length: layout.stops }, (_, index) => <View key={index} style={[styles.segment, { backgroundColor: index === page ? colors.accentFill : colors.border }]} />)}
          </View> : null}
        </> : null}
      </View>
    </View>}
  </Animated.View>;
  return renderContainer(area, mode !== "hidden");
}

const styles = StyleSheet.create({
  area: { overflow: "hidden" }, measured: { position: "absolute", top: 0, left: 0, right: 0 },
  handle: { height: 24, alignItems: "center", justifyContent: "center" }, grip: { width: 40, height: 4, borderRadius: 2 },
  cards: { gap: TIMER_GAP, alignItems: "stretch", paddingBottom: 4 },
  card: { flex: 1, borderRadius: 16, paddingHorizontal: 6, paddingBottom: 6, gap: 4 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  caption: { flex: 1, textAlign: "center", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  avatar: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  initials: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  clockRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 4 },
  time: { textAlign: "center", fontFamily: fonts.bold, fontSize: 28, lineHeight: 36, flexShrink: 1 },
  timeSingle: { fontSize: 34, lineHeight: 42 }, finished: { fontSize: 16, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 4 }, actionsGrid: { flexWrap: "wrap" },
  action: { minWidth: 48, minHeight: 48, flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  gridAction: { flexBasis: "45%" }, adjust: { fontFamily: fonts.bold, fontSize: 14 },
  indicator: { flexDirection: "row", gap: 4, justifyContent: "center", paddingVertical: 4, paddingHorizontal: 40 },
  segment: { flex: 1, maxWidth: 32, height: 5, borderRadius: 3 },
  summary: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48 },
  summaryLead: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 },
  summaryLabel: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  summaryToken: { flexDirection: "row", minHeight: 48, alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0 },
  summaryTime: { textAlign: "center", fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, flex: 1 },
  summaryDone: { fontSize: 11, lineHeight: 14 },
  more: { minHeight: 48, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  moreText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 }, chevron: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
