import assert from "node:assert/strict";
import test from "node:test";
import { compareWorkoutDays, isWorkoutDay, workoutDayFromEvidence, type WorkoutDateEvidence } from
  "../apps/mobile/src/features/training/execution/domain/WorkoutDateEvidence.ts";

const evidence = (overrides: Partial<WorkoutDateEvidence> = {}): WorkoutDateEvidence => ({
  precision: "DAY", actualDate: "2026-10-01", timestamp: null, estimatedDate: null, importedAt: null, ...overrides,
});

test("календарная дата: високосный день допустим, нормализация неверного дня и даты со временем запрещены", () => {
  assert.equal(isWorkoutDay("2028-02-29"), true);
  for (const value of [null, undefined, 0, "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "2026-10-01T00:00:00Z"])
    assert.equal(isWorkoutDay(value), false, String(value));
  assert.deepEqual([null, "2026-01-01", null, "2026-10-01"].sort(compareWorkoutDays), ["2026-10-01", "2026-01-01", null, null]);
});

test("точный день и местное время сохраняют день источника независимо от зоны чтения", () => {
  const day = evidence();
  const local = evidence({ precision: "LOCAL_DATETIME", timestamp: "2026-10-01T23:59:59.123456789" });
  for (const zone of ["Europe/Moscow", "Pacific/Honolulu", "Pacific/Kiritimati"])
    for (const item of [day, local]) assert.equal(workoutDayFromEvidence(item, zone), "2026-10-01");
  assert.equal(local.timestamp, "2026-10-01T23:59:59.123456789");
});

test("instant: явная зона проекции меняет день, точность/offset источника остаются неизменными", () => {
  const source = Object.freeze(evidence({ precision: "INSTANT", timestamp: "2026-10-01T23:30:00.123456789Z" }));
  const before = structuredClone(source);
  assert.equal(workoutDayFromEvidence(source, "Europe/Moscow"), "2026-10-02");
  assert.equal(workoutDayFromEvidence(source, "America/New_York"), "2026-10-01");
  const offset = evidence({ precision: "INSTANT", actualDate: "2026-10-02", timestamp: "2026-10-02T02:30:00.123456789+03:00" });
  assert.equal(workoutDayFromEvidence(offset, "UTC"), "2026-10-01");
  assert.equal(offset.timestamp, "2026-10-02T02:30:00.123456789+03:00");
  assert.deepEqual(source, before);
});

test("проекция instant около смены DST и через границу года использует правила выбранной зоны", () => {
  for (const [timestamp, zone, expected] of [
    ["2026-03-28T23:30:00Z", "Europe/Berlin", "2026-03-29"],
    ["2026-03-29T22:30:00Z", "Europe/Berlin", "2026-03-30"],
    ["2026-10-24T22:30:00Z", "Europe/Berlin", "2026-10-25"],
    ["2026-10-25T23:30:00Z", "Europe/Berlin", "2026-10-26"],
    ["2026-12-31T23:30:00Z", "Europe/Moscow", "2027-01-01"],
  ] as const) assert.equal(workoutDayFromEvidence(evidence({ precision: "INSTANT", actualDate: timestamp.slice(0, 10), timestamp }), zone), expected);
});

test("неизвестная/вычисленная дата не становится днём импорта или предположенным днём занятия", () => {
  const imported = "2026-10-24T12:00:00Z";
  const unknown = evidence({ precision: "UNKNOWN", actualDate: null, importedAt: imported });
  const derived = evidence({ precision: "DERIVED", actualDate: null, estimatedDate: "2026-10-01", importedAt: imported });
  assert.equal(workoutDayFromEvidence(unknown, "Europe/Moscow"), null);
  assert.equal(workoutDayFromEvidence(derived, "Europe/Moscow"), null);
  assert.equal(derived.estimatedDate, "2026-10-01");
  assert.equal(unknown.importedAt, imported);
  assert.equal(workoutDayFromEvidence(evidence({ precision: "UNKNOWN" }), "UTC"), null);
});

test("противоречивое свидетельство или неверная зона не создают дату и не роняют чтение", () => {
  for (const item of [
    evidence({ actualDate: "2026-02-29" }), evidence({ timestamp: "2026-10-01T10:00:00Z" }),
    evidence({ estimatedDate: "2026-10-01" }),
    evidence({ precision: "LOCAL_DATETIME", timestamp: "2026-10-01T10:00:00Z" }),
    evidence({ precision: "LOCAL_DATETIME", timestamp: "2026-10-01T24:00:00" }),
    evidence({ precision: "INSTANT", timestamp: "2026-10-01T10:00:00" }),
    evidence({ precision: "INSTANT", timestamp: "2026-10-02T10:00:00Z" }),
    evidence({ precision: "INSTANT", timestamp: "2026-10-01T10:00:00+24:00" }),
  ]) assert.equal(workoutDayFromEvidence(item, "UTC"), null, JSON.stringify(item));
  assert.equal(workoutDayFromEvidence(evidence({ precision: "INSTANT", timestamp: "2026-10-01T10:00:00Z" }), "invalid-zone"), null);
});
