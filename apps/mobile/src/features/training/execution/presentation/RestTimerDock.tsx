import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { SkipForward } from "lucide-react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { ADJUST_STEP_SEC, remainingSec, type RestTimer } from "../domain/RestTimerRules.ts";
import type { RestTimersPort } from "../domain/RestTimerPorts.ts";
import { useEditorDockHeight } from "../../../../shared/ui/components/public.ts";

/** Сколько секунд закончившийся таймер остаётся на панели с надписью «Отдых окончен». */
const FINISHED_VISIBLE_MS = 4000;
/** Высота нижней навигации над краем экрана: панель таймеров — над ней. */
const TAB_BAR_HEIGHT = 80;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function TimerSegment({ timer, now, compact, timers }: Readonly<{ timer: RestTimer; now: number; compact: boolean;
  timers: RestTimersPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const left = remainingSec(timer, now);
  const finished = left === 0;
  const button = (label: string, accessibilityLabel: string, onPress: () => void, primary = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={4}
      style={[styles.button, { backgroundColor: primary ? colors.accentFill : colors.input }]}>
      {label === "skip" ? <SkipForward size={18} color={colors.onAccentFill} strokeWidth={2} />
        : <Text style={[styles.buttonText, { color: colors.textPrimary }]}>{label}</Text>}
    </Pressable>
  );
  return (
    <View accessibilityLiveRegion="polite" style={[styles.segment, { backgroundColor: colors.surface,
      borderColor: finished ? colors.success : colors.border }]}>
      <Text style={[styles.owner, { color: colors.textSecondary }]} numberOfLines={1}>
        <Text style={{ color: colors.textPrimary, fontFamily: fonts.semibold }}>{timer.clientName}</Text>
        {` · ${timer.exerciseName}`}
      </Text>
      <View style={[styles.line, compact && styles.lineCompact]}>
        {!compact ? button(`−${ADJUST_STEP_SEC}`, `Отдых меньше на ${ADJUST_STEP_SEC} секунд`, () => { void timers.adjust(timer.id, -ADJUST_STEP_SEC); }) : null}
        <Text accessibilityLabel={finished ? "Отдых окончен" : `Осталось ${clock(left)}`}
          numberOfLines={1} style={[styles.time, compact && styles.timeCompact, { color: finished ? colors.success : colors.textPrimary }]}>
          {finished ? "Готово" : clock(left)}
        </Text>
        {!compact ? button(`+${ADJUST_STEP_SEC}`, `Отдых больше на ${ADJUST_STEP_SEC} секунд`, () => { void timers.adjust(timer.id, ADJUST_STEP_SEC); }) : null}
        {!compact ? button("skip", "Пропустить отдых", () => { void timers.skip(timer.id); }, true) : null}
      </View>
      {compact ? (
        <View style={styles.line}>
          {button(`−${ADJUST_STEP_SEC}`, `Отдых меньше на ${ADJUST_STEP_SEC} секунд`, () => { void timers.adjust(timer.id, -ADJUST_STEP_SEC); })}
          {button(`+${ADJUST_STEP_SEC}`, `Отдых больше на ${ADJUST_STEP_SEC} секунд`, () => { void timers.adjust(timer.id, ADJUST_STEP_SEC); })}
          {button("skip", "Пропустить отдых", () => { void timers.skip(timer.id); }, true)}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Панель таймеров отдыха над нижней навигацией, на всех экранах (§48.62): один таймер — во всю ширину,
 * два — рядом; больше двух — ближайшие к окончанию и кнопка переключения к остальным. Смена клиента или
 * вкладки отсчёты не сбрасывает: время считается от сохранённого окончания.
 */
export function RestTimerDock({ timers }: Readonly<{ timers: RestTimersPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const editorHeight = useEditorDockHeight();
  const subscribe = useCallback((listener: () => void) => timers.subscribe(listener), [timers]);
  const list = useSyncExternalStore(subscribe, () => timers.list());
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const signalled = useRef(new Set<string>());
  const pendingDismiss = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    for (const handle of pendingDismiss.current) clearTimeout(handle);
    pendingDismiss.current.clear();
  }, []);

  useEffect(() => {
    if (list.length === 0) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [list.length]);

  // Окончание в открытом приложении: вибрация один раз, через несколько секунд таймер уходит с панели.
  useEffect(() => {
    for (const timer of list) {
      if (timer.endAt > now || signalled.current.has(timer.id)) continue;
      signalled.current.add(timer.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      const handle = setTimeout(() => {
        pendingDismiss.current.delete(handle);
        void timers.dismiss(timer.id).catch(() => undefined);
      }, FINISHED_VISIBLE_MS);
      pendingDismiss.current.add(handle);
    }
  }, [list, now, timers]);

  if (list.length === 0) return null;
  const ordered = [...list].sort((a, b) => a.endAt - b.endAt);
  const start = offset < ordered.length ? offset : 0;
  const visible = ordered.slice(start, start + 2);
  const hidden = ordered.length - visible.length;
  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom: insets.bottom + TAB_BAR_HEIGHT + editorHeight }]}>
      <View style={styles.row}>
        {visible.map((timer) => <TimerSegment key={timer.id} timer={timer} now={now} compact={visible.length > 1} timers={timers} />)}
      </View>
      {hidden > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Другие таймеры: ещё ${hidden}`}
          onPress={() => setOffset(start + 2 >= ordered.length ? 0 : start + 2)}
          style={[styles.more, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.moreText, { color: colors.accentInk }]}>{`Ещё таймеры: ${hidden}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 12, right: 12, gap: 6 },
  row: { flexDirection: "row", gap: 8 },
  segment: { flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, gap: 6, elevation: 8 },
  owner: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  lineCompact: { justifyContent: "center" },
  time: { minWidth: 76, textAlign: "center", fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  timeCompact: { fontSize: 18, lineHeight: 23 },
  button: { flex: 1, minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: fonts.semibold, fontSize: 13 },
  more: { alignSelf: "flex-end", minHeight: 36, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, justifyContent: "center",
    elevation: 8 },
  moreText: { fontFamily: fonts.medium, fontSize: 12 },
});
