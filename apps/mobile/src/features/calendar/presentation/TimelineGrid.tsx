import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, Vibration, View, type GestureResponderEvent } from "react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { Appointment, CalendarInterval, LocalDate } from "../domain/CalendarModel.ts";
import { clipToWindow, columnAtX, dragRange, minuteAtY, moveVerdict, slotAtY, yOfMinute, type MoveVerdict,
  type TimeWindow } from "../domain/CalendarGeometry.ts";
import { appointmentEnded, appointmentLabel, formatMinute, weekdayIndex } from "../domain/CalendarRules.ts";
import type { CalendarParticipant } from "../domain/CalendarParticipantDirectoryPort.ts";
import { weekdayShort } from "./calendarPresentation.ts";

const LONG_PRESS_MS = 350;
const TAP_SLOP = 8;
const SWIPE_DISTANCE = 60;
const GUTTER = 34;

type Preview =
  | Readonly<{ kind: "RANGE"; column: number; start: number; end: number }>
  | Readonly<{ kind: "MOVE"; appointment: Appointment; column: number; start: number; verdict: MoveVerdict }>;

interface Gesture {
  x: number; y: number; column: number | null; slot: number; hit: Appointment | null;
  mode: "PENDING" | "RANGE" | "MOVE" | "SWIPE"; timer: ReturnType<typeof setTimeout> | null;
}

export interface TimelineHandlers {
  readonly onTapSlot: (date: LocalDate, startMinute: number) => void;
  readonly onTapBlocked: (interval: CalendarInterval) => void;
  readonly onOpenAppointment: (appointment: Appointment) => void;
  readonly onRangeSelected: (date: LocalDate, start: number, end: number) => void;
  readonly onMove: (appointment: Appointment, date: LocalDate, start: number) => void;
  readonly onSwipe: (direction: 1 | -1) => void;
  readonly onLockScroll: (locked: boolean) => void;
}

/**
 * §13.4–13.6 / §13.23: one continuous surface per day column. Tap = create at the 30-minute slot
 * or open a block; long press + vertical drag = range with live preview; long press on a future
 * appointment + drag = move with a valid/invalid drop preview; horizontal swipe = page.
 * PanResponder keeps it dependency-free; a UI-thread gesture engine is the open R09 spike.
 */
export function TimelineGrid({ dates, window, appointments, intervals, people, now, height, handlers }: Readonly<{
  dates: readonly LocalDate[];
  window: TimeWindow;
  appointments: readonly Appointment[];
  intervals: readonly CalendarInterval[];
  people: ReadonlyMap<string, CalendarParticipant>;
  now: Date;
  height: number;
  handlers: TimelineHandlers;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const live = useRef({ dates, window, appointments, intervals, now, height, width, handlers });
  live.current = { dates, window, appointments, intervals, now, height, width, handlers };
  const gesture = useRef<Gesture | null>(null);

  const responder = useMemo(() => {
    const locate = (event: GestureResponderEvent) => {
      const state = live.current;
      const { locationX: x, locationY: y } = event.nativeEvent;
      const column = columnAtX(x, state.width, state.dates.length);
      const date = column === null ? null : state.dates[column] ?? null;
      const minute = minuteAtY(y, state.height, state.window);
      const hit = date === null ? null : state.appointments.find((row) => row.localDate === date
        && minute >= row.startMinute && minute < row.startMinute + row.durationMinutes) ?? null;
      return { x, y, column, date, slot: slotAtY(y, state.height, state.window), hit };
    };
    const finish = () => {
      const current = gesture.current;
      if (current?.timer) clearTimeout(current.timer);
      if (current !== null && (current.mode === "RANGE" || current.mode === "MOVE")) live.current.handlers.onLockScroll(false);
      gesture.current = null;
      setPreview(null);
    };
    const movable = (row: Appointment) => row.lifecycle === "SCHEDULED" && !appointmentEnded(row, live.current.now);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const start = locate(event);
        const state: Gesture = { x: start.x, y: start.y, column: start.column, slot: start.slot, hit: start.hit,
          mode: "PENDING", timer: null };
        state.timer = setTimeout(() => {
          if (gesture.current !== state || state.column === null) return;
          if (state.hit !== null && !movable(state.hit)) return;
          state.mode = state.hit === null ? "RANGE" : "MOVE";
          live.current.handlers.onLockScroll(true);
          Vibration.vibrate(12);
          setPreview(state.hit === null
            ? { kind: "RANGE", column: state.column, ...dragRange(state.slot, state.slot) }
            : { kind: "MOVE", appointment: state.hit, column: state.column, start: state.hit.startMinute, verdict: "OK" });
        }, LONG_PRESS_MS);
        gesture.current = state;
      },
      onPanResponderMove: (event, move) => {
        const state = gesture.current;
        if (state === null) return;
        if (state.mode === "PENDING") {
          if (Math.abs(move.dx) > TAP_SLOP || Math.abs(move.dy) > TAP_SLOP) {
            if (state.timer) clearTimeout(state.timer);
            state.mode = "SWIPE";
          }
          return;
        }
        const point = locate(event);
        const view = live.current;
        if (state.mode === "RANGE" && state.column !== null) {
          const range = dragRange(state.slot, point.slot);
          setPreview((old) => old?.kind === "RANGE" && old.start === range.start && old.end === range.end
            ? old : { kind: "RANGE", column: state.column ?? 0, ...range });
        } else if (state.mode === "MOVE" && state.hit !== null) {
          const column = point.column ?? state.column ?? 0;
          const date = view.dates[column];
          // Keep the grab offset: the block moves by whole slots from where it was picked up.
          const start = state.hit.startMinute + (point.slot - state.slot);
          if (date === undefined) return;
          const verdict = moveVerdict(state.hit, date, start, view.window, view.appointments, view.intervals);
          setPreview((old) => old?.kind === "MOVE" && old.start === start && old.column === column
            ? old : { kind: "MOVE", appointment: state.hit as Appointment, column, start, verdict });
        }
      },
      onPanResponderRelease: (event, move) => {
        const state = gesture.current;
        const view = live.current;
        if (state === null) return;
        if (state.mode === "PENDING" && state.column !== null) {
          const date = view.dates[state.column];
          if (date !== undefined) {
            const minute = minuteAtY(state.y, view.height, view.window);
            const blocked = view.intervals.find((row) => row.kind === "BLOCKED" && row.localDate === date
              && minute >= row.startMinute && minute < row.endMinute);
            if (state.hit !== null) view.handlers.onOpenAppointment(state.hit);
            else if (blocked !== undefined) view.handlers.onTapBlocked(blocked);
            else view.handlers.onTapSlot(date, state.slot);
          }
        } else if (state.mode === "SWIPE" && Math.abs(move.dx) > SWIPE_DISTANCE && Math.abs(move.dx) > Math.abs(move.dy)) {
          view.handlers.onSwipe(move.dx < 0 ? 1 : -1);
        } else if (state.mode === "RANGE" && state.column !== null) {
          const date = view.dates[state.column];
          const point = locate(event);
          const range = dragRange(state.slot, point.slot);
          if (date !== undefined) { Vibration.vibrate(8); view.handlers.onRangeSelected(date, range.start, range.end); }
        } else if (state.mode === "MOVE" && state.hit !== null) {
          const point = locate(event);
          const column = point.column ?? state.column ?? 0;
          const date = view.dates[column];
          const start = state.hit.startMinute + (point.slot - state.slot);
          if (date !== undefined && (date !== state.hit.localDate || start !== state.hit.startMinute)
            && moveVerdict(state.hit, date, start, view.window, view.appointments, view.intervals) === "OK") {
            Vibration.vibrate(8);
            view.handlers.onMove(state.hit, date, start);
          }
        }
        finish();
      },
      // Before a long press the parent ScrollView may take a vertical scroll; after it, never.
      onPanResponderTerminationRequest: () => gesture.current === null || gesture.current.mode === "PENDING"
        || gesture.current.mode === "SWIPE",
      onPanResponderTerminate: finish,
    });
  }, []);

  const columns = Math.max(dates.length, 1);
  const columnWidth = width / columns;
  const top = (minute: number) => yOfMinute(minute, height, window);
  const hours = [];
  for (let minute = Math.ceil(window.startMinute / 60) * 60; minute <= window.endMinute; minute += 60) hours.push(minute);
  const halfHours = [];
  for (let minute = window.startMinute; minute < window.endMinute; minute += 30) if (minute % 60 !== 0) halfHours.push(minute);
  const dense = columns > 3;

  return (
    <View>
      <View style={styles.headerRow}>
        <View style={{ width: GUTTER }} />
        {dates.map((date) => (
          <View key={date} style={styles.headerCell}>
            <Text style={[styles.headerDay, { color: colors.textSecondary }]}>{weekdayShort[weekdayIndex(date)]}</Text>
            <Text style={[styles.headerDate, { color: colors.textPrimary }]}>{Number(date.slice(8, 10))}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.body, { height }]}>
        <View style={{ width: GUTTER, height }}>
          {hours.map((minute) => (
            <Text key={minute} style={[styles.hour, { top: Math.max(top(minute) - 7, 0), color: colors.textMuted }]}>
              {formatMinute(minute).slice(0, 2)}
            </Text>
          ))}
        </View>
        <View style={[styles.surface, { height, borderColor: colors.border, backgroundColor: colors.surface }]}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers}
          accessibilityHint="Касание — запись на это время; долгое нажатие и протягивание — выбрать интервал">
          {hours.map((minute) => (
            <View key={`h${minute}`} pointerEvents="none" style={[styles.line, { top: top(minute), backgroundColor: colors.border }]} />
          ))}
          {halfHours.map((minute) => (
            <View key={`m${minute}`} pointerEvents="none"
              style={[styles.line, styles.halfLine, { top: top(minute), backgroundColor: colors.border }]} />
          ))}
          {dates.map((date, column) => column === 0 ? null : (
            <View key={`c${date}`} pointerEvents="none"
              style={[styles.columnLine, { left: column * columnWidth, height, backgroundColor: colors.border }]} />
          ))}
          {intervals.map((row) => {
            const column = dates.indexOf(row.localDate);
            const clip = clipToWindow(row.startMinute, row.endMinute, window);
            if (column < 0 || clip === null || width === 0) return null;
            const blocked = row.kind === "BLOCKED";
            return (
              <View key={row.id} pointerEvents="none" style={[styles.band, {
                left: column * columnWidth, width: columnWidth, top: top(clip.start), height: top(clip.end) - top(clip.start),
                backgroundColor: blocked ? colors.danger : colors.charts[1], opacity: blocked ? 0.22 : 0.14,
              }]}>
                {!dense ? <Text style={[styles.bandText, { color: blocked ? colors.danger : colors.textPrimary }]}>
                  {blocked ? "Заблокировано" : "Дежурство"}</Text> : null}
              </View>
            );
          })}
          {appointments.map((row) => {
            const column = dates.indexOf(row.localDate);
            const clip = clipToWindow(row.startMinute, row.startMinute + row.durationMinutes, window);
            if (column < 0 || clip === null || width === 0) return null;
            const person = row.clientId === null ? null : people.get(row.clientId) ?? null;
            const label = `${person?.emoji ? `${person.emoji} ` : ""}${appointmentLabel(row, person?.displayName ?? null)}`;
            const closed = row.lifecycle === "COMPLETED" || appointmentEnded(row, now);
            const moving = preview?.kind === "MOVE" && preview.appointment.id === row.id;
            const blockHeight = top(clip.end) - top(clip.start);
            return (
              <View key={row.id} pointerEvents="none" style={[styles.block, {
                left: column * columnWidth + 1, width: columnWidth - 2, top: top(clip.start) + 1, height: blockHeight - 2,
                backgroundColor: closed ? colors.surfaceRaised : colors.accentFill,
                borderColor: row.lifecycle === "SCHEDULED" && closed ? colors.warning : colors.accentFill,
                opacity: moving ? 0.35 : 1,
              }]}>
                <Text numberOfLines={Math.max(1, Math.floor(blockHeight / 13))}
                  style={[dense ? styles.blockTextDense : styles.blockText, { color: closed ? colors.textPrimary : colors.onAccentFill }]}>
                  {dense ? label : `${formatMinute(row.startMinute)} ${label} · ${row.sessionTypeName}`}
                </Text>
              </View>
            );
          })}
          {preview !== null && width > 0 ? (() => {
            const start = preview.start;
            const end = preview.kind === "RANGE" ? preview.end : preview.start + preview.appointment.durationMinutes;
            const invalid = preview.kind === "MOVE" && preview.verdict !== "OK";
            const clip = clipToWindow(start, end, window) ?? { start, end };
            return (
              <View pointerEvents="none" style={[styles.preview, {
                left: preview.column * columnWidth, width: columnWidth, top: top(clip.start),
                height: Math.max(top(clip.end) - top(clip.start), 6),
                borderColor: invalid ? colors.danger : colors.accentInk,
                backgroundColor: invalid ? colors.danger : colors.accentInk,
              }]}>
                <Text style={[styles.previewText, { color: colors.onAccentFill }]}>
                  {formatMinute(start)}–{formatMinute(end)}
                </Text>
              </View>
            );
          })() : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", paddingBottom: 4 },
  headerCell: { flex: 1, alignItems: "center" },
  headerDay: { fontSize: 11, lineHeight: 14 },
  headerDate: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
  body: { flexDirection: "row" },
  hour: { position: "absolute", right: 4, fontSize: 10, lineHeight: 14 },
  surface: { flex: 1, borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  line: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  halfLine: { opacity: 0.45 },
  columnLine: { position: "absolute", top: 0, width: StyleSheet.hairlineWidth },
  band: { position: "absolute", justifyContent: "center", alignItems: "center" },
  bandText: { fontSize: 11, fontWeight: "700" },
  block: { position: "absolute", borderRadius: 5, borderWidth: 1, paddingHorizontal: 2, paddingVertical: 1, overflow: "hidden" },
  blockText: { fontSize: 12, lineHeight: 15, fontWeight: "700" },
  blockTextDense: { fontSize: 10, lineHeight: 12, fontWeight: "700" },
  preview: { position: "absolute", borderWidth: 2, borderRadius: 6, opacity: 0.75, alignItems: "center", justifyContent: "center" },
  previewText: { fontSize: 10, fontWeight: "700" },
});
