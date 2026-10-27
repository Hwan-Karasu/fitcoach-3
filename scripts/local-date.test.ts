import assert from "node:assert/strict";
import test from "node:test";
import { isLocalDate } from "../apps/mobile/src/shared/domain/LocalDate.ts";
import { isLocalDate as calendar } from "../apps/mobile/src/features/calendar/domain/CalendarRules.ts";
import { isLocalDate as measurements } from "../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { isLocalDate as nutrition } from "../apps/mobile/src/features/nutrition/domain/DiaryRules.ts";
import { isLocalDate as execution } from "../apps/mobile/src/features/training/execution/domain/ExecutionRules.ts";

test("existing calendar days are accepted, including leap days by the Gregorian rule", () => {
  for (const value of ["2026-02-28", "2024-02-29", "2000-02-29", "0400-02-29", "0001-01-01", "0099-12-31", "9999-12-31", "2026-12-31"]) {
    assert.equal(isLocalDate(value), true, value);
  }
});

test("impossible or malformed dates are rejected", () => {
  for (const value of ["2026-02-29", "1900-02-29", "0100-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-01-00", "2026-01-32",
    "0000-01-01", "2026-2-03", "2026-02-3", "2026-02-03T00:00", "2026-02-03 ", " 2026-02-03", "2026/02/03", "", "abcd-ef-gh", "+2026-02-03"]) {
    assert.equal(isLocalDate(value), false, JSON.stringify(value));
  }
});

test("every feature validates local dates exactly like the shared rule", () => {
  const owners = { calendar, measurements, nutrition, execution };
  const samples = ["2026-02-28", "2026-02-29", "2024-02-29", "2026-13-01", "2026-04-31", "0000-01-01", "0001-01-01", "0099-12-31", "0100-02-29",
    "0400-02-29", "9999-12-31", "2026-2-03", "2026-02-03T00:00", ""];
  for (const [owner, check] of Object.entries(owners)) {
    for (const value of samples) assert.equal(check(value), isLocalDate(value), `${owner}: ${JSON.stringify(value)}`);
  }
});
