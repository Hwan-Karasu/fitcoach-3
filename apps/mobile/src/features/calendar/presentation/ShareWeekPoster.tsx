import type { RefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Appointment, CalendarInterval, LocalDate } from "../domain/CalendarModel.ts";
import { clipToWindow, yOfMinute, type TimeWindow } from "../domain/CalendarGeometry.ts";
import { appointmentLabel, formatMinute, weekdayIndex } from "../domain/CalendarRules.ts";
import type { CalendarParticipant } from "../domain/CalendarParticipantDirectoryPort.ts";
import { weekdayShort } from "./calendarPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

/** Как в 2.0: широкий лист и подпись в две строки (фамилия / имя отчество); при съёмке шириной 1080 всё читается крупно. */
const WIDTH = 760;
const HOUR_HEIGHT = 52;
const GUTTER = 52;
/** A fixed light poster: it is read in other apps, so it must not depend on the trainer's theme. */
const ink = { paper: "#FFFFFF", text: "#13262B", muted: "#5B6B70", line: "#D5DEE0", block: "#0E6E73", blocked: "#B8C2C4",
  duty: "#DCEFEF" };

/** Первая строка — эмодзи и фамилия (или всё имя гостя), вторая — остальное. */
function nameLines(label: string, emoji: string | null): string[] {
  const [first = "", ...rest] = label.trim().split(/\s+/u);
  const head = `${emoji ? `${emoji} ` : ""}${first}`;
  return rest.length === 0 ? [head] : [head, rest.join(" ")];
}

/**
 * §13.18 Share Week poster: the selected week, visible day columns and day window. Shows only
 * time, client emoji and name; Blocked is «недоступно»; Duty is an unlabelled background band by
 * the owner's decision of 2026-10-16. Never notes, types, credits, payments, cancelled rows or IDs.
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
  const gridHeight = Math.round(Math.max(1, (window.endMinute - window.startMinute) / 60) * HOUR_HEIGHT);
  const columnWidth = (WIDTH - 32 - GUTTER) / Math.max(dates.length, 1);
  const top = (minute: number) => yOfMinute(minute, gridHeight, window);
  const hours = [];
  for (let minute = Math.ceil(window.startMinute / 60) * 60; minute <= window.endMinute; minute += 60) hours.push(minute);
  return (
    <View ref={posterRef} collapsable={false} style={styles.poster}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.headerRow}>
        <View style={{ width: GUTTER }} />
        {dates.map((date) => (
          <View key={date} style={[styles.headerCell, { width: columnWidth }]}>
            <Text style={styles.headerDay}>{weekdayShort[weekdayIndex(date)]}</Text>
            <Text style={styles.headerDate}>{Number(date.slice(8, 10))}</Text>
          </View>
        ))}
      </View>
      <View style={styles.body}>
        <View style={{ width: GUTTER, height: gridHeight }}>
          {hours.map((minute) => (
            <Text key={minute} style={[styles.hour, { top: Math.max(top(minute) - 8, 0) }]}>
              {formatMinute(minute)}
            </Text>
          ))}
        </View>
        <View style={[styles.grid, { width: columnWidth * dates.length, height: gridHeight }]}>
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
                {duty ? null : <Text style={styles.blockedText}>недоступно</Text>}
              </View>
            );
          })}
          {appointments.filter((row) => row.lifecycle !== "CANCELLED").map((row) => {
            const at = dates.indexOf(row.localDate);
            const clip = clipToWindow(row.startMinute, row.startMinute + row.durationMinutes, window);
            if (at < 0 || clip === null) return null;
            const person = row.clientId === null ? null : people.get(row.clientId) ?? null;
            const height = top(clip.end) - top(clip.start);
            const lines = nameLines(appointmentLabel(row, person?.displayName ?? null), person?.emoji ?? null);
            return (
              <View key={row.id} style={[styles.block, { left: at * columnWidth + 2, width: columnWidth - 4,
                top: top(clip.start) + 2, height: height - 4 }]}>
                {lines.slice(0, height >= 36 ? 2 : 1).map((line, index) => (
                  <Text key={index} numberOfLines={1} style={index === 0 ? styles.blockText : styles.blockSub}>{line}</Text>
                ))}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { width: WIDTH, padding: 16, backgroundColor: ink.paper, gap: 10 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: fonts.bold, color: ink.text, textAlign: "center" },
  headerRow: { flexDirection: "row" },
  headerCell: { alignItems: "center" },
  headerDay: { fontSize: 13, lineHeight: 16, fontFamily: fonts.semibold, color: ink.muted },
  headerDate: { fontSize: 18, lineHeight: 22, fontFamily: fonts.bold, color: ink.text },
  body: { flexDirection: "row" },
  hour: { position: "absolute", right: 6, fontFamily: fonts.regular, fontSize: 13, lineHeight: 16, color: ink.muted },
  grid: { borderWidth: 1, borderColor: ink.line, overflow: "hidden" },
  line: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: ink.line },
  blocked: { position: "absolute", backgroundColor: ink.blocked, alignItems: "center", justifyContent: "center" },
  blockedText: { fontFamily: fonts.semibold, fontSize: 13, color: ink.text },
  duty: { position: "absolute", backgroundColor: ink.duty },
  block: { position: "absolute", borderRadius: 6, backgroundColor: ink.block, paddingHorizontal: 5, justifyContent: "center", overflow: "hidden" },
  blockText: { fontSize: 13, lineHeight: 16, fontFamily: fonts.bold, color: "#FFFFFF" },
  blockSub: { fontSize: 12, lineHeight: 15, fontFamily: fonts.regular, color: "#FFFFFF" },
});
