import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarInterval } from "../apps/mobile/src/features/calendar/domain/CalendarModel.ts";
import { mergeDutyRange } from "../apps/mobile/src/features/calendar/domain/CalendarRules.ts";
import { MAX_DUTY_PRESETS, normalizeDutyPresets } from "../apps/mobile/src/shared/domain/DutyPreset.ts";

const date = "2026-10-28";
const duty = (id: string, startMinute: number, endMinute: number, kind: "DUTY" | "BLOCKED" = "DUTY"): CalendarInterval =>
  ({ id, kind, localDate: date, startMinute, endMinute });

test("дежурство из окна дня: свободный диапазон создаётся как есть", () => {
  assert.deepEqual(mergeDutyRange([], date, 540, 720, null),
    { removeIds: [], create: { kind: "DUTY", localDate: date, startMinute: 540, endMinute: 720 } });
});

test("дежурство сливается с пересекающимся и соседним, дальнее и блокировка не трогаются", () => {
  const rows = [duty("a", 480, 600), duty("b", 720, 780), duty("far", 900, 960), duty("block", 600, 720, "BLOCKED")];
  assert.deepEqual(mergeDutyRange(rows, date, 570, 720, null),
    { removeIds: ["a", "b"], create: { kind: "DUTY", localDate: date, startMinute: 480, endMinute: 780 } });
});

test("дежурства другого дня не попадают в слияние", () => {
  const other = { ...duty("x", 480, 720), localDate: "2026-10-29" };
  assert.deepEqual(mergeDutyRange([other], date, 540, 600, null),
    { removeIds: [], create: { kind: "DUTY", localDate: date, startMinute: 540, endMinute: 600 } });
});

test("правка дежурства заменяет его прежние границы, а не расширяет ими результат", () => {
  const rows = [duty("a", 480, 720), duty("b", 900, 960)];
  assert.deepEqual(mergeDutyRange(rows, date, 540, 600, "a"),
    { removeIds: ["a"], create: { kind: "DUTY", localDate: date, startMinute: 540, endMinute: 600 } });
});

test("пресеты дежурства: неверные записи отбрасываются, имя обрезается по краям, не больше восьми", () => {
  const good = { id: "p1", name: "  Утро ", startMinute: 480, endMinute: 720 };
  assert.deepEqual(normalizeDutyPresets([good, { ...good, id: "p1" }, { ...good, id: "p2", endMinute: 480 },
    { ...good, id: "p3", startMinute: 485 }, { ...good, id: "p4", name: " " }, { ...good, id: "p5", name: "x".repeat(25) },
    { ...good, id: "p6", endMinute: 1500 }, null, "text"]), [{ ...good, name: "Утро" }]);
  assert.deepEqual(normalizeDutyPresets("нет"), []);
  const many = Array.from({ length: 12 }, (_, at) => ({ ...good, id: `m${at}` }));
  assert.equal(normalizeDutyPresets(many).length, MAX_DUTY_PRESETS);
});
