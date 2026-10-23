import { isCalendarDay as isWorkoutDay } from "../../../../shared/format/calendarDay.ts";
export { compareOptionalDays as compareWorkoutDays, isCalendarDay as isWorkoutDay } from "../../../../shared/format/calendarDay.ts";

/** Precision belongs to the imported fact, independently of import time or a
 * later display timezone. Normal diary sessions have an explicit DAY. */
export interface WorkoutDateEvidence {
  readonly precision: "DAY" | "INSTANT" | "LOCAL_DATETIME" | "DERIVED" | "UNKNOWN";
  readonly actualDate: string | null;
  readonly timestamp: string | null;
  readonly estimatedDate: string | null;
  readonly importedAt: string | null;
}

/** A recorded instant is displayed in the explicitly supplied timezone. Local
 * clocks keep their recorded calendar day; estimates do not become actual days.
 * Corrupt evidence/configuration returns unknown, never NaN or an invented day. */
export function workoutDayFromEvidence(evidence: WorkoutDateEvidence, timeZone: string): string | null {
  if (evidence.precision === "UNKNOWN" || evidence.precision === "DERIVED") return null;
  if (!isWorkoutDay(evidence.actualDate)) return null;
  if (evidence.precision === "DAY") return evidence.timestamp === null && evidence.estimatedDate === null ? evidence.actualDate : null;
  if (typeof evidence.timestamp !== "string" || evidence.timestamp.slice(0, 10) !== evidence.actualDate || evidence.estimatedDate !== null) return null;
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/u.exec(evidence.timestamp);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) return null;
  if (evidence.precision === "LOCAL_DATETIME") return match[4] === undefined ? evidence.actualDate : null;
  if (evidence.precision !== "INSTANT" || match[4] === undefined || !Number.isFinite(Date.parse(evidence.timestamp))) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(evidence.timestamp));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const day = `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
    return isWorkoutDay(day) ? day : null;
  } catch { return null; }
}
