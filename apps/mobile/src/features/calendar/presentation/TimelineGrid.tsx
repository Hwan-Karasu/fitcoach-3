import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, Vibration, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { SLOT_MINUTES, type Appointment, type CalendarInterval, type LocalDate } from "../domain/CalendarModel.ts";
import { clipToWindow, columnAtX, dragRange, minuteAtY, moveVerdict, slotAtY, yOfMinute,
  type TimeWindow } from "../domain/CalendarGeometry.ts";
import { appointmentEnded, appointmentLabel, formatMinute, localDateOf, weekdayIndex } from "../domain/CalendarRules.ts";
import type { CalendarParticipant } from "../domain/CalendarParticipantDirectoryPort.ts";
import { weekdayShort } from "./calendarPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const LONG_PRESS_MS = 350;
const EDGE_PX = 14;
/** Ширина неподвижной колонки часов слева от ленты дней. */
export const TIMELINE_GUTTER = 40;
/** Высота строки заголовков дней — на неё же отступает колонка часов. */
export const TIMELINE_HEADER = 36;
/** Протянул и подержал столько — интервал становится блокировкой; быстро отпустил — дежурство. */
const HOLD_MS = 600;

const MODE_NONE = 0;
const MODE_RANGE = 1;
const MODE_MOVE = 2;
const MODE_RESIZE = 3;
/** Ползунок у нижнего края дежурства или блокировки. */
const MODE_RESIZE_BAND = 4;

/** Plain numbers only, so the UI-thread worklets can hit-test without touching JS objects. */
interface Block {
  readonly index: number;
  readonly column: number;
  readonly start: number;
  readonly end: number;
  readonly movable: boolean;
}

export interface TimelineHandlers {
  readonly onTapSlot: (date: LocalDate, startMinute: number) => void;
  readonly onTapBlocked: (interval: CalendarInterval) => void;
  /** Удержание на блокировке — снять её сразу. */
  readonly onLongPressBlocked: (interval: CalendarInterval) => void;
  /** Ползунок у нижнего края интервала: новая граница конца. */
  readonly onResizeInterval: (interval: CalendarInterval, endMinute: number) => void;
  readonly onOpenAppointment: (appointment: Appointment) => void;
  readonly onRangeSelected: (date: LocalDate, start: number, end: number, kind: "DUTY" | "BLOCKED") => void;
  readonly onMove: (appointment: Appointment, date: LocalDate, start: number) => void;
  readonly onResize: (appointment: Appointment, durationMinutes: number) => void;
  readonly onLockScroll: (locked: boolean) => void;
}

/**
 * §13.4–13.6 / §13.23 on RNGH + Reanimated: one continuous surface per day column. Tap = create at
 * the 30-minute slot or open a block; long press + drag = interval (quick release — Duty, holding
 * still for HOLD_MS before release — Blocked; owner decision); long press on a future block =
 * move, or resize when grabbed at its bottom edge. The preview geometry runs on the UI thread; JS
 * only learns a new slot (label and drop verdict) when the snapped value actually changes.
 */
export function TimelineGrid({ dates, window, appointments, intervals, people, typeColors, now, height, handlers }: Readonly<{
  dates: readonly LocalDate[];
  window: TimeWindow;
  appointments: readonly Appointment[];
  intervals: readonly CalendarInterval[];
  people: ReadonlyMap<string, CalendarParticipant>;
  /** Session type colour (§13.16); the label stays the primary identification. */
  typeColors: ReadonlyMap<string, string>;
  now: Date;
  height: number;
  handlers: TimelineHandlers;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<Readonly<{ mode: number; index: number; label: string; invalid: boolean }> | null>(null);
  const [holdBlocked, setHoldBlocked] = useState(false);
  const held = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (holdTimer.current !== null) clearTimeout(holdTimer.current); }, []);

  // Каждое новое положение выделения заново запускает отсчёт «подержал — блокировка».
  const armHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    held.current = false;
    setHoldBlocked(false);
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setHoldBlocked(true);
      Vibration.vibrate(30);
    }, HOLD_MS);
  };
  const columns = Math.max(dates.length, 1);
  const columnWidth = width / columns;

  const mode = useSharedValue(MODE_NONE);
  const anchor = useSharedValue(0);
  const blockIndex = useSharedValue(-1);
  const column = useSharedValue(0);
  const start = useSharedValue(0);
  const end = useSharedValue(0);

  // movable = блокировка (удержание снимает её); дежурство протягивается как обычное выделение.
  const bands = useMemo<readonly Block[]>(() => intervals.flatMap((row, index) => {
    const at = dates.indexOf(row.localDate);
    return at < 0 ? [] : [{ index, column: at, start: row.startMinute, end: row.endMinute, movable: row.kind === "BLOCKED" }];
  }), [dates, intervals]);
  const releaseBlocked = (index: number) => {
    const row = intervals[index];
    if (row === undefined) return;
    Vibration.vibrate(20);
    handlers.onLongPressBlocked(row);
  };

  const blocks = useMemo<readonly Block[]>(() => appointments.flatMap((row, index) => {
    const at = dates.indexOf(row.localDate);
    return at < 0 ? [] : [{ index, column: at, start: row.startMinute, end: row.startMinute + row.durationMinutes,
      movable: row.lifecycle === "SCHEDULED" && !appointmentEnded(row, now) }];
  }), [appointments, dates, now]);

  const verdictFor = (kind: number, index: number, at: number, from: number, to: number) => {
    const row = appointments[index];
    const date = dates[at];
    if (kind === MODE_RANGE || kind === MODE_RESIZE_BAND || row === undefined || date === undefined) return "OK";
    return moveVerdict({ ...row, durationMinutes: to - from }, date, from, window, appointments, intervals);
  };

  const showPreview = (kind: number, index: number, at: number, from: number, to: number) => {
    if (kind === MODE_RANGE) armHold();
    // Время столбиком: в узкой колонке «13:00–16:30» не рвётся посередине.
    setPreview({ mode: kind, index, label: `${formatMinute(from)}\n–\n${formatMinute(to)}`,
      invalid: verdictFor(kind, index, at, from, to) !== "OK" });
  };

  const begin = (kind: number, index: number, at: number, from: number, to: number) => {
    handlers.onLockScroll(true);
    Vibration.vibrate(12);
    showPreview(kind, index, at, from, to);
  };

  const commit = (kind: number, index: number, at: number, from: number, to: number) => {
    const date = dates[at];
    const row = appointments[index];
    if (date === undefined) return;
    if (kind === MODE_RANGE) {
      Vibration.vibrate(8);
      handlers.onRangeSelected(date, from, to, held.current ? "BLOCKED" : "DUTY");
      return;
    }
    if (kind === MODE_RESIZE_BAND) {
      const band = intervals[index];
      if (band !== undefined && to !== band.endMinute) {
        Vibration.vibrate(8);
        handlers.onResizeInterval(band, to);
      }
      return;
    }
    if (row === undefined || verdictFor(kind, index, at, from, to) !== "OK") return;
    if (kind === MODE_MOVE && (date !== row.localDate || from !== row.startMinute)) {
      Vibration.vibrate(8);
      handlers.onMove(row, date, from);
    } else if (kind === MODE_RESIZE && to - from !== row.durationMinutes) {
      Vibration.vibrate(8);
      handlers.onResize(row, to - from);
    }
  };

  const finish = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    held.current = false;
    setHoldBlocked(false);
    handlers.onLockScroll(false);
    setPreview(null);
  };

  const tap = (x: number, y: number) => {
    const at = columnAtX(x, width, columns);
    const date = at === null ? undefined : dates[at];
    if (date === undefined) return;
    const minute = minuteAtY(y, height, window);
    const hit = appointments.find((row) => row.localDate === date && minute >= row.startMinute
      && minute < row.startMinute + row.durationMinutes);
    const blocked = intervals.find((row) => row.kind === "BLOCKED" && row.localDate === date
      && minute >= row.startMinute && minute < row.endMinute);
    if (hit !== undefined) handlers.onOpenAppointment(hit);
    else if (blocked !== undefined) handlers.onTapBlocked(blocked);
    else handlers.onTapSlot(date, slotAtY(y, height, window));
  };

  const drag = Gesture.Pan().activateAfterLongPress(LONG_PRESS_MS)
    .onStart((event) => {
      const at = columnAtX(event.x, width, columns);
      if (at === null) { mode.value = MODE_NONE; return; }
      const minute = minuteAtY(event.y, height, window);
      const slot = slotAtY(event.y, height, window);
      let hit: Block | null = null;
      for (const block of blocks) {
        if (block.column === at && minute >= block.start && minute < block.end) hit = block;
      }
      if (hit !== null && !hit.movable) { mode.value = MODE_NONE; return; }
      if (hit === null) {
        for (const band of bands) {
          if (band.column !== at || minute < band.start || minute >= band.end) continue;
          if (event.y >= yOfMinute(band.end, height, window) - EDGE_PX) {
            mode.value = MODE_RESIZE_BAND;
            column.value = at;
            anchor.value = slot;
            blockIndex.value = band.index;
            start.value = band.start;
            end.value = band.end;
            scheduleOnRN(begin, mode.value, blockIndex.value, column.value, start.value, end.value);
            return;
          }
          if (band.movable) {
            mode.value = MODE_NONE;
            scheduleOnRN(releaseBlocked, band.index);
            return;
          }
        }
      }
      column.value = at;
      anchor.value = slot;
      if (hit === null) {
        mode.value = MODE_RANGE;
        blockIndex.value = -1;
        start.value = slot;
        end.value = slot + SLOT_MINUTES;
      } else {
        mode.value = event.y >= yOfMinute(hit.end, height, window) - EDGE_PX ? MODE_RESIZE : MODE_MOVE;
        blockIndex.value = hit.index;
        start.value = hit.start;
        end.value = hit.end;
      }
      scheduleOnRN(begin, mode.value, blockIndex.value, column.value, start.value, end.value);
    })
    .onUpdate((event) => {
      if (mode.value === MODE_NONE) return;
      const slot = slotAtY(event.y, height, window);
      let nextColumn = column.value;
      let from = start.value;
      let to: number;
      if (mode.value === MODE_RANGE) {
        const range = dragRange(anchor.value, slot);
        from = range.start;
        to = range.end;
      } else if (mode.value === MODE_MOVE) {
        const at = columnAtX(event.x, width, columns);
        if (at !== null) nextColumn = at;
        let original = start.value;
        let duration = end.value - start.value;
        for (const block of blocks) {
          if (block.index === blockIndex.value) { original = block.start; duration = block.end - block.start; }
        }
        // The grab offset is kept: the block moves by whole slots from where it was picked up.
        from = original + (slot - anchor.value);
        to = from + duration;
      } else {
        // MODE_RESIZE и MODE_RESIZE_BAND: тянем нижнюю границу, минимум один слот.
        to = Math.max(slot + SLOT_MINUTES, start.value + SLOT_MINUTES);
      }
      if (from === start.value && to === end.value && nextColumn === column.value) return;
      start.value = from;
      end.value = to;
      column.value = nextColumn;
      scheduleOnRN(showPreview, mode.value, blockIndex.value, nextColumn, from, to);
    })
    .onEnd(() => {
      if (mode.value !== MODE_NONE) scheduleOnRN(commit, mode.value, blockIndex.value, column.value, start.value, end.value);
    })
    .onFinalize(() => {
      if (mode.value !== MODE_NONE) scheduleOnRN(finish);
      mode.value = MODE_NONE;
    });
  const press = Gesture.Tap().maxDuration(LONG_PRESS_MS - 50)
    .onEnd((event, success) => { if (success) scheduleOnRN(tap, event.x, event.y); });
  const gesture = Gesture.Exclusive(drag, press);

  const previewStyle = useAnimatedStyle(() => {
    const top = yOfMinute(Math.max(start.value, window.startMinute), height, window);
    const bottom = yOfMinute(Math.min(end.value, window.endMinute), height, window);
    return { opacity: mode.value === MODE_NONE ? 0 : 0.8, left: column.value * columnWidth, width: columnWidth, top,
      height: Math.max(bottom - top, 6) };
  });

  const top = (minute: number) => yOfMinute(minute, height, window);
  const hours = [];
  for (let minute = Math.ceil(window.startMinute / 60) * 60; minute <= window.endMinute; minute += 60) hours.push(minute);
  const halfHours = [];
  for (let minute = window.startMinute; minute < window.endMinute; minute += 30) if (minute % 60 !== 0) halfHours.push(minute);
  const dense = columns > 3;
  const todayDate = localDateOf(now);
  const todayColumn = dates.indexOf(todayDate);
  const rangeKind = preview?.mode === MODE_RANGE ? (holdBlocked ? "Блокировка" : "Дежурство") : null;
  const previewColor = preview?.invalid || holdBlocked ? colors.danger : colors.accentInk;

  return (
    <View>
      <View style={styles.headerRow}>
        {dates.map((date) => (
          <View key={date} style={[styles.headerCell, { borderColor: colors.border,
            borderLeftWidth: dates.indexOf(date) === 0 ? 0 : StyleSheet.hairlineWidth,
            backgroundColor: date === todayDate ? colors.surfaceRaised : "transparent" }]}>
            <Text style={[styles.headerDay, { color: date === todayDate ? colors.accentInk : colors.textSecondary }]}>
              {weekdayShort[weekdayIndex(date)]}</Text>
            <Text style={[styles.headerDate, { color: date === todayDate ? colors.accentInk : colors.textPrimary }]}>
              {Number(date.slice(8, 10))}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.body, { height }]}>
        <GestureDetector gesture={gesture}>
          <View style={[styles.surface, { height, borderColor: colors.border, backgroundColor: colors.surface }]}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            accessibilityHint="Касание — запись на это время; долгое нажатие и протягивание — выбрать интервал">
            {todayColumn >= 0 && width > 0 ? (
              <View pointerEvents="none" style={[styles.todayColumn, { left: todayColumn * columnWidth, width: columnWidth,
                height, backgroundColor: colors.accentFill }]} />
            ) : null}
            {hours.map((minute) => (
              <View key={`h${minute}`} pointerEvents="none" style={[styles.line, { top: top(minute), backgroundColor: colors.border }]} />
            ))}
            {halfHours.map((minute) => (
              <View key={`m${minute}`} pointerEvents="none"
                style={[styles.line, styles.halfLine, { top: top(minute), backgroundColor: colors.border }]} />
            ))}
            {dates.map((date, at) => at === 0 ? null : (
              <View key={`c${date}`} pointerEvents="none"
                style={[styles.columnLine, { left: at * columnWidth, height, backgroundColor: colors.border }]} />
            ))}
            {intervals.map((row) => {
              const at = dates.indexOf(row.localDate);
              const clip = clipToWindow(row.startMinute, row.endMinute, window);
              if (at < 0 || clip === null || width === 0) return null;
              const blocked = row.kind === "BLOCKED";
              return (
                <View key={row.id} pointerEvents="none" style={[styles.band, {
                  left: at * columnWidth, width: columnWidth, top: top(clip.start), height: top(clip.end) - top(clip.start),
                }]}>
                  {/* Прозрачна только подложка: подпись и ползунок остаются чёткими. */}
                  <View style={[StyleSheet.absoluteFill, {
                    backgroundColor: blocked ? colors.danger : colors.charts[1], opacity: blocked ? 0.22 : 0.14 }]} />
                  {!dense ? <Text style={[styles.bandText, { color: blocked ? colors.danger : colors.textPrimary }]}>
                    {blocked ? "Заблокировано" : "Дежурство"}</Text> : null}
                  <View style={[styles.handle, { backgroundColor: blocked ? colors.danger : colors.textSecondary, opacity: 0.8 }]} />
                </View>
              );
            })}
            {appointments.map((row, index) => {
              const at = dates.indexOf(row.localDate);
              const clip = clipToWindow(row.startMinute, row.startMinute + row.durationMinutes, window);
              if (at < 0 || clip === null || width === 0) return null;
              const person = row.clientId === null ? null : people.get(row.clientId) ?? null;
              const label = `${person?.emoji ? `${person.emoji} ` : ""}${appointmentLabel(row, person?.displayName ?? null)}`;
              const closed = row.lifecycle === "COMPLETED" || appointmentEnded(row, now);
              const active = preview !== null && preview.mode !== MODE_RANGE && preview.index === index;
              const blockHeight = top(clip.end) - top(clip.start);
              return (
                <View key={row.id} pointerEvents="none" style={[styles.block, {
                  left: at * columnWidth + 1, width: columnWidth - 2, top: top(clip.start) + 1, height: blockHeight - 2,
                  backgroundColor: closed ? colors.surfaceRaised : typeColors.get(row.sessionTypeId) ?? colors.accentFill,
                  borderColor: row.lifecycle === "SCHEDULED" && closed ? colors.warning
                    : typeColors.get(row.sessionTypeId) ?? colors.accentFill,
                  opacity: active ? 0.35 : 1,
                }]}>
                  <Text numberOfLines={Math.max(1, Math.floor(blockHeight / 13))}
                    style={[dense ? styles.blockTextDense : styles.blockText, { color: closed ? colors.textPrimary
                      : typeColors.has(row.sessionTypeId) ? "#FFFFFF" : colors.onAccentFill }]}>
                    {dense ? label : `${formatMinute(row.startMinute)} ${label} · ${row.sessionTypeName}`}
                  </Text>
                  {!closed ? <View style={[styles.handle, { backgroundColor: colors.onAccentFill }]} /> : null}
                </View>
              );
            })}
            <Animated.View pointerEvents="none" style={[styles.preview, previewStyle, {
              borderColor: previewColor, backgroundColor: previewColor,
            }]}>
              <Text style={[styles.previewText, { color: colors.onAccentFill }]}>
                {rangeKind === null ? preview?.label ?? "" : `${preview?.label ?? ""}\n${rangeKind}`}
              </Text>
            </Animated.View>
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

/** Неподвижная колонка часов слева от ленты дней (часы одинаковы для всех недель). */
export function TimelineHours({ window, height }: Readonly<{ window: TimeWindow; height: number }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const hours = [];
  for (let minute = Math.ceil(window.startMinute / 60) * 60; minute <= window.endMinute; minute += 60) hours.push(minute);
  const halfHours = [];
  for (let minute = window.startMinute; minute < window.endMinute; minute += 30) if (minute % 60 !== 0) halfHours.push(minute);
  // Колонка часов — продолжение сетки: те же линии, подпись часа внутри своей клетки у верхнего края.
  return (
    <View style={{ width: TIMELINE_GUTTER }}>
      <View style={{ height: TIMELINE_HEADER, borderBottomWidth: 1, borderColor: colors.border }} />
      <View style={{ height }}>
        {hours.map((minute) => (
          <View key={`h${minute}`} style={[styles.line, { top: yOfMinute(minute, height, window), backgroundColor: colors.border }]} />
        ))}
        {halfHours.map((minute) => (
          <View key={`m${minute}`} style={[styles.line, styles.halfLine, { top: yOfMinute(minute, height, window), backgroundColor: colors.border }]} />
        ))}
        {hours.filter((minute) => minute < window.endMinute).map((minute) => (
          <Text key={minute} style={[styles.hour, { top: yOfMinute(minute, height, window) + 2, color: colors.textMuted }]}>
            {formatMinute(minute)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", height: TIMELINE_HEADER },
  headerCell: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerDay: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  headerDate: { fontSize: 13, lineHeight: 16, fontFamily: fonts.bold },
  body: { flexDirection: "row" },
  hour: { position: "absolute", right: 4, left: 0, textAlign: "right", fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  surface: { flex: 1, borderTopWidth: 1, borderLeftWidth: 1, overflow: "hidden" },
  line: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  halfLine: { opacity: 0.45 },
  todayColumn: { position: "absolute", top: 0, opacity: 0.06 },
  columnLine: { position: "absolute", top: 0, width: StyleSheet.hairlineWidth },
  band: { position: "absolute", justifyContent: "center", alignItems: "center" },
  bandText: { fontSize: 11, fontFamily: fonts.bold },
  block: { position: "absolute", borderRadius: 5, borderWidth: 1, paddingHorizontal: 2, paddingVertical: 1, overflow: "hidden" },
  blockText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold },
  blockTextDense: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bold },
  handle: { position: "absolute", bottom: 2, alignSelf: "center", width: 14, height: 2, borderRadius: 1, opacity: 0.6 },
  preview: { position: "absolute", borderWidth: 2, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  previewText: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bold, textAlign: "center" },
});
