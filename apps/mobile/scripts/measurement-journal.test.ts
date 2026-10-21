import assert from "node:assert/strict";
import test from "node:test";
import type { ClientMeasurements, Measurement } from "../src/features/measurements/domain/MeasurementModel.ts";
import { measurementJournalView } from "../src/features/measurements/presentation/measurementJournalView.ts";

const row = (id: string, date: string, value: number, minute: number | null = null): Measurement => ({
  id, clientId: "c", type: "WEIGHT", valueX10: value, localDate: date, localMinute: minute, method: "MANUAL", revision: 1,
});
const data = (measurements: readonly Measurement[]): ClientMeasurements => ({ measurements, primaries: [] });

test("journal: inclusive period boundaries, no future facts, deterministic descending dates/time", () => {
  const view = measurementJournalView(data([row("old", "2026-09-20", 800), row("start", "2026-09-21", 801),
    row("today", "2026-10-20", 790), row("morning", "2026-10-20", 791, 480), row("future", "2026-10-21", 792)]), "WEIGHT", "30", "2026-10-20");
  assert.deepEqual(view.rows.map((item) => item.id), ["morning", "today", "start"]);
  assert.deepEqual(view.days.map(([date]) => date), ["2026-10-20", "2026-09-21"]);
});
test("journal: latest ambiguous day stays unknown; selecting a primary restores the delta", () => {
  const sample = data([row("first", "2026-10-01", 800), row("a", "2026-10-20", 780), row("b", "2026-10-20", 790)]);
  const ambiguous = measurementJournalView(sample, "WEIGHT", "ALL", "2026-10-20");
  assert.equal(ambiguous.latest?.kind, "AMBIGUOUS");
  assert.equal(ambiguous.changeX10, null);
  assert.equal(ambiguous.ambiguousCount, 1);
  const chosen = measurementJournalView({ ...sample, primaries: [{ type: "WEIGHT", localDate: "2026-10-20", measurementId: "b" }] }, "WEIGHT", "ALL", "2026-10-20");
  assert.equal(chosen.changeX10, -10);
  assert.equal(chosen.ambiguousCount, 0);
});
test("journal: single/empty data has no invented change, zero change is preserved", () => {
  assert.equal(measurementJournalView(data([]), "WEIGHT", "ALL", "2026-10-20").latest, null);
  assert.equal(measurementJournalView(data([row("one", "2026-10-20", 800)]), "WEIGHT", "ALL", "2026-10-20").changeX10, null);
  assert.equal(measurementJournalView(data([row("one", "2026-10-01", 800), row("two", "2026-10-20", 800)]), "WEIGHT", "ALL", "2026-10-20").changeX10, 0);
});
test("journal: types and periods stay independent; ALL never combines unlike units", () => {
  const sample = data([row("weight", "2026-10-20", 800), { ...row("fat", "2026-10-20", 200), type: "BODY_FAT" }]);
  assert.deepEqual(measurementJournalView(sample, "BODY_FAT", "90", "2026-10-20").rows.map((item) => item.id), ["fat"]);
  const all = measurementJournalView(sample, "ALL", "365", "2026-10-20");
  assert.equal(all.rows.length, 2);
  assert.deepEqual(all.points, []);
  assert.equal(all.changeX10, null);
});
