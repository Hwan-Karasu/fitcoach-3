import assert from "node:assert/strict";
import test from "node:test";
import { datesIn, mondayOf, periodLabel, recentMonths, spanOf, stepAnchor, summarizeSeries } from "../apps/mobile/src/features/nutrition/domain/MetricPeriods.ts";

// 10 ноября 2026 — вторник (1 ноября 2026 — воскресенье).
test("UIX-08: неделя — понедельник–воскресенье, месяц — календарный, день — одна дата", () => {
  assert.equal(mondayOf("2026-11-10"), "2026-11-09");
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
  assert.equal(mondayOf("2026-11-15"), "2026-11-09", "воскресенье относится к неделе, начавшейся в понедельник");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.deepEqual(spanOf("DAY", "2026-11-10"), { from: "2026-11-10", to: "2026-11-10" });
  assert.deepEqual(spanOf("WEEK", "2026-11-10"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(spanOf("MONTH", "2026-11-10"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(spanOf("MONTH", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" }, "високосный год");
  assert.deepEqual(spanOf("MONTH", "2027-02-10"), { from: "2027-02-01", to: "2027-02-28" });
  assert.deepEqual(spanOf("PERIOD", "2026-11-10", { from: "2026-10-01", to: "2026-10-20" }), { from: "2026-10-01", to: "2026-10-20" });
  assert.deepEqual(spanOf("PERIOD", "2026-11-10"), { from: "2026-11-09", to: "2026-11-15" }, "период не выбран — неделя опорной даты");
});

test("UIX-08: шаг навигатора — день ±1, неделя ±7, месяц к первому числу соседнего (через границу года)", () => {
  assert.equal(stepAnchor("DAY", "2026-11-10", -1), "2026-11-09");
  assert.equal(stepAnchor("DAY", "2026-12-31", 1), "2027-01-01");
  assert.equal(stepAnchor("WEEK", "2026-11-10", 1), "2026-11-17");
  assert.equal(stepAnchor("MONTH", "2026-01-15", -1), "2025-12-01");
  assert.equal(stepAnchor("MONTH", "2026-12-31", 1), "2027-01-01");
  assert.equal(stepAnchor("MONTH", "2026-03-31", -1), "2026-02-01", "31 марта не даёт несуществующего 31 февраля");
});

test("UIX-08: подписи периодов и список последних месяцев", () => {
  assert.equal(periodLabel("DAY", spanOf("DAY", "2026-11-10")), "10 нояб.");
  assert.equal(periodLabel("WEEK", spanOf("WEEK", "2026-11-10")), "9–15 нояб.");
  assert.equal(periodLabel("WEEK", spanOf("WEEK", "2026-11-02")), "2–8 нояб.");
  assert.equal(periodLabel("WEEK", { from: "2026-10-26", to: "2026-11-01" }), "26 окт. – 1 нояб.");
  assert.equal(periodLabel("MONTH", spanOf("MONTH", "2026-11-10")), "Ноябрь 2026");
  assert.deepEqual(recentMonths("2026-11-10", 3), [{ anchor: "2026-11-01", label: "Ноябрь 2026" }, { anchor: "2026-10-01", label: "Октябрь 2026" },
    { anchor: "2026-09-01", label: "Сентябрь 2026" }]);
  assert.deepEqual(recentMonths("2026-01-20", 2).map((month) => month.label), ["Январь 2026", "Декабрь 2025"]);
});

test("UIX-08: ряд по дням — неизвестные дни не нули и не входят в среднее, минимум и максимум", () => {
  assert.deepEqual(datesIn({ from: "2026-11-09", to: "2026-11-11" }), ["2026-11-09", "2026-11-10", "2026-11-11"]);
  assert.deepEqual(datesIn({ from: "2026-11-11", to: "2026-11-09" }), []);
  const values = new Map([["2026-11-09", 8000], ["2026-11-11", 11000], ["2026-11-12", 5001]]);
  const week = summarizeSeries(values, spanOf("WEEK", "2026-11-10"));
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.days.map((day) => day.value), [8000, null, 11000, 5001, null, null, null]);
  assert.equal(week.known, 3);
  assert.equal(week.total, 24001);
  assert.equal(week.average, 8000, "24 001 / 3 = 8 000,33 — округляется");
  assert.equal(week.min, 5001);
  assert.equal(week.max, 11000);
  const empty = summarizeSeries(new Map(), spanOf("DAY", "2026-11-10"));
  assert.deepEqual([empty.known, empty.total, empty.average, empty.min, empty.max], [0, 0, null, null, null]);
});
