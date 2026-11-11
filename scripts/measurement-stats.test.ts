import assert from "node:assert/strict";
import test from "node:test";
import type { DailyPoint, Measurement } from "../apps/mobile/src/features/measurements/domain/MeasurementModel.ts";
import { statsOfPoints } from "../apps/mobile/src/features/measurements/domain/MeasurementStats.ts";

const row = (id: string, valueX100: number, localDate: string): Measurement => ({ id, clientId: "c", type: "WEIGHT", valueX100, localDate, localMinute: null, method: "MANUAL", revision: 1 });
const value = (id: string, valueX100: number, localDate: string): DailyPoint => ({ kind: "VALUE", type: "WEIGHT", localDate, measurement: row(id, valueX100, localDate), chosen: false });
const ambiguous = (localDate: string): DailyPoint => ({ kind: "AMBIGUOUS", type: "WEIGHT", localDate, candidates: [row("a", 800, localDate), row("b", 810, localDate)] });

test("UIX-09: начало, сейчас, изменение, среднее, минимум и максимум на известных точках (десятые доли)", () => {
  // 85,0 → 84,2 → 83,4 → 83,9: среднее (850 + 842 + 834 + 839) / 4 = 841,25 → 841.
  const stats = statsOfPoints([value("1", 850, "2026-10-12"), value("2", 842, "2026-10-19"), value("3", 834, "2026-10-26"), value("4", 839, "2026-11-02")]);
  assert.deepEqual(stats, { count: 4, ambiguousDays: 0, startX100: 850, nowX100: 839, changeX100: -11, averageX100: 841, minX100: 834, maxX100: 850 });
});

test("UIX-09: один день — изменения нет (не ноль); пустой период — всё «нет данных»", () => {
  const one = statsOfPoints([value("1", 850, "2026-11-02")]);
  assert.equal(one.changeX100, null);
  assert.equal(one.nowX100, 850);
  assert.equal(one.startX100, 850);
  const none = statsOfPoints([]);
  assert.deepEqual([none.count, none.startX100, none.nowX100, none.changeX100, none.averageX100, none.minX100, none.maxX100], [0, null, null, null, null, null, null]);
});

test("UIX-09: день с несколькими записями без основной не входит в расчёт и не подменяется средним", () => {
  const stats = statsOfPoints([value("1", 850, "2026-10-12"), ambiguous("2026-10-19"), value("3", 830, "2026-10-26")]);
  assert.equal(stats.count, 2);
  assert.equal(stats.ambiguousDays, 1);
  assert.equal(stats.averageX100, 840);
  assert.equal(stats.changeX100, -20);
  const onlyAmbiguous = statsOfPoints([ambiguous("2026-10-19")]);
  assert.deepEqual([onlyAmbiguous.count, onlyAmbiguous.ambiguousDays, onlyAmbiguous.nowX100], [0, 1, null]);
});
