import type { RefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Appointment, CalendarInterval, LocalDate } from "../domain/CalendarModel.ts";
import { clipToWindow, yOfMinute, type TimeWindow } from "../domain/CalendarGeometry.ts";
import { appointmentLabel, formatMinute, weekdayIndex } from "../domain/CalendarRules.ts";
import type { CalendarParticipant } from "../domain/CalendarParticipantDirectoryPort.ts";
import { weekdayShort } from "./calendarPresentation.ts";

const WIDTH = 380;
const GRID_HEIGHT = 560;
const GUTTER = 30;
/** A fixed light poster: it is read in other apps, so it must not depend on the trainer's theme. */
const ink = { paper: "#FFFFFF", text: "#13262B", muted: "#5B6B70", line: "#D5DEE0", block: "#0E6E73", blocked: "#B8C2C4",
  duty: "#DCEFEF" };

/**
 * §13.18 Share Week poster: the selected week, visible day columns and day window. Shows only
 * time, client emoji and name; Blocked is «недоступно»; Duty is shown as a background band by the
 * owner's decision of 2026-10-16. Never notes, types, credits, payments, cancelled rows or IDs.
 */
export function ShareWeekPoster({ posterRef, title, dates, window, appointments, intervals, people }: Readonly<{
  posterRef: RefObject<View | null>;
  title: string;
  dates: readonly LocalDate[];
  window: TimeWindow;
  appointments: readonly Appointment[];
  intervals: readonly CalendarInterval[];
  people: ReadonlyMap<string, CalendarParticipant>;
}>) {
  const columnWidth = (WIDTH - 24 - GUTTER) / Math.max(dates.length, 1);
  const top = (minute: number) => yOfMinute(minute, GRID_HEIGHT, window);
  const hours = [];
  for (let minute = Math.ceil(window.startMinute / 60) * 60; minute <= window.endMinute; minute += 60) hours.push(minute);
  return (
    <View ref={posterRef} collapsable={false} style={styles.poster}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.headerRow}>
        <View style={{ width: GUTTER }} />
        {dates.map((date) => (
          <Text key={date} style={[styles.headerCell, { width: columnWidth }]}>
            {`${weekdayShort[weekdayIndex(date)]} ${Number(date.slice(8, 10))}`}
          </Text>
        ))}
      </View>
      <View style={styles.body}>
        <View style={{ width: GUTTER, height: GRID_HEIGHT }}>
          {hours.map((minute) => (
            <Text key={minute} style={[styles.hour, { top: Math.max(top(minute) - 6, 0) }]}>
              {formatMinute(minute).slice(0, 2)}
            </Text>
          ))}
        </View>
        <View style={[styles.grid, { width: columnWidth * dates.length }]}>
          {hours.map((minute) => <View key={minute} style={[styles.line, { top: top(minute) }]} />)}
          {/* Duty first: a background band under appointments, as in the Calendar itself. */}
          {[...intervals].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "DUTY" ? -1 : 1)).map((row) => {
            const at = dates.indexOf(row.localDate);
            const clip = clipToWindow(row.startMinute, row.endMinute, window);
            if (at < 0 || clip === null) return null;
            const duty = row.kind === "DUTY";
            return (
              <View key={row.id} style={[duty ? styles.duty : styles.blocked, { left: at * columnWidth, width: columnWidth,
                top: top(clip.start), height: top(clip.end) - top(clip.start) }]}>
                <Text style={duty ? styles.dutyText : styles.blockedText}>{duty ? "дежурство" : "недоступно"}</Text>
              </View>
            );
          })}
          {appointments.filter((row) => row.lifecycle !== "CANCELLED").map((row) => {
            const at = dates.indexOf(row.localDate);
            const clip = clipToWindow(row.startMinute, row.startMinute + row.durationMinutes, window);
            if (at < 0 || clip === null) return null;
            const person = row.clientId === null ? null : people.get(row.clientId) ?? null;
            const height = top(clip.end) - top(clip.start);
            return (
              <View key={row.id} style={[styles.block, { left: at * columnWidth + 1, width: columnWidth - 2,
                top: top(clip.start) + 1, height: height - 2 }]}>
                <Text numberOfLines={Math.max(1, Math.floor(height / 12))} style={styles.blockText}>
                  {`${person?.emoji ? `${person.emoji} ` : ""}${appointmentLabel(row, person?.displayName ?? null)}`}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { width: WIDTH, padding: 12, backgroundColor: ink.paper, gap: 8 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "700", color: ink.text, textAlign: "center" },
  headerRow: { flexDirection: "row" },
  headerCell: { textAlign: "center", fontSize: 10, lineHeight: 14, fontWeight: "700", color: ink.text },
  body: { flexDirection: "row" },
  hour: { position: "absolute", right: 3, fontSize: 9, lineHeight: 12, color: ink.muted },
  grid: { height: GRID_HEIGHT, borderWidth: 1, borderColor: ink.line, overflow: "hidden" },
  line: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: ink.line },
  blocked: { position: "absolute", backgroundColor: ink.blocked, alignItems: "center", justifyContent: "center" },
  blockedText: { fontSize: 8, color: ink.text },
  duty: { position: "absolute", backgroundColor: ink.duty, alignItems: "center", paddingTop: 1 },
  dutyText: { fontSize: 8, color: ink.muted },
  block: { position: "absolute", borderRadius: 4, backgroundColor: ink.block, paddingHorizontal: 2, overflow: "hidden" },
  blockText: { fontSize: 9, lineHeight: 11, fontWeight: "700", color: "#FFFFFF" },
});
