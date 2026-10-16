import { SLOT_MINUTES, type Appointment, type CalendarInterval, type LocalDate } from "./CalendarModel.ts";
import { addDays, mondayOf, overlaps } from "./CalendarRules.ts";

/** The visible day window of the timeline, in minutes from local midnight. */
export interface TimeWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * §13.6 / §13.23: a day column is one continuous surface; Y maps to the 30-minute slot that
 * contains it (12:00–12:29 → 12:00, 12:30 → 12:30), clamped so a slot never starts at the end.
 */
export function slotAtY(y: number, height: number, window: TimeWindow): number {
  "worklet";
  const span = window.endMinute - window.startMinute;
  if (height <= 0 || span < SLOT_MINUTES) return window.startMinute;
  const minute = window.startMinute + (Math.min(Math.max(y, 0), height) / height) * span;
  const slot = window.startMinute + Math.floor((minute - window.startMinute) / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.min(slot, window.endMinute - SLOT_MINUTES);
}

/** Exact (unsnapped) minute under a point, for hit-testing existing blocks. */
export function minuteAtY(y: number, height: number, window: TimeWindow): number {
  "worklet";
  const span = window.endMinute - window.startMinute;
  return window.startMinute + (Math.min(Math.max(y, 0), height) / Math.max(height, 1)) * span;
}

export function yOfMinute(minute: number, height: number, window: TimeWindow): number {
  "worklet";
  return ((minute - window.startMinute) / (window.endMinute - window.startMinute)) * height;
}

export function columnAtX(x: number, width: number, columns: number): number | null {
  "worklet";
  if (columns <= 0 || width <= 0 || x < 0 || x >= width) return null;
  return Math.min(columns - 1, Math.floor((x / width) * columns));
}

/** Long-press drag between two slots selects both, in either direction (08:30 ↔ 11:00 → 08:30–11:30). */
export function dragRange(anchorSlot: number, currentSlot: number): Readonly<{ start: number; end: number }> {
  "worklet";
  return { start: Math.min(anchorSlot, currentSlot), end: Math.max(anchorSlot, currentSlot) + SLOT_MINUTES };
}

/* Functions marked "worklet" also run on the UI thread during gestures; they stay pure. */

/** Visible part of a block inside the window; null when it lies fully outside. */
export function clipToWindow(start: number, end: number, window: TimeWindow): Readonly<{ start: number; end: number }> | null {
  const from = Math.max(start, window.startMinute);
  const to = Math.min(end, window.endMinute);
  return to > from ? { start: from, end: to } : null;
}

export type MoveVerdict = "OK" | "OUTSIDE_WINDOW" | "OVERLAP" | "BLOCKED";

/**
 * Drop preview check mirroring the repository rules (§13.10–13.11); the store still decides on
 * commit. Duty is background and never blocks a move.
 */
export function moveVerdict(moving: Appointment, date: LocalDate, start: number, window: TimeWindow,
  appointments: readonly Appointment[], intervals: readonly CalendarInterval[]): MoveVerdict {
  const end = start + moving.durationMinutes;
  if (start < window.startMinute || end > window.endMinute) return "OUTSIDE_WINDOW";
  if (appointments.some((row) => row.id !== moving.id && row.localDate === date && row.lifecycle !== "CANCELLED"
    && overlaps(start, end, row.startMinute, row.startMinute + row.durationMinutes))) return "OVERLAP";
  if (intervals.some((row) => row.kind === "BLOCKED" && row.localDate === date
    && overlaps(start, end, row.startMinute, row.endMinute))) return "BLOCKED";
  return "OK";
}

/** §13.2: Monday-first rows covering the month, 4–6 of them; neighbour dates fill the edges. */
export function monthGridWeeks(anyDateOfMonth: LocalDate): readonly (readonly LocalDate[])[] {
  const first = `${anyDateOfMonth.slice(0, 7)}-01`;
  const month = first.slice(0, 7);
  const weeks: LocalDate[][] = [];
  let monday = mondayOf(first);
  for (;;) {
    const start = monday;
    const week = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    if (!week.some((date) => date.slice(0, 7) === month)) return weeks;
    weeks.push(week);
    monday = addDays(monday, 7);
  }
}

export function addMonths(anyDateOfMonth: LocalDate, months: number): LocalDate {
  const year = Number(anyDateOfMonth.slice(0, 4));
  const month = Number(anyDateOfMonth.slice(5, 7)) - 1 + months;
  const normalized = new Date(Date.UTC(year, month, 1));
  return `${String(normalized.getUTCFullYear()).padStart(4, "0")}-${String(normalized.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
