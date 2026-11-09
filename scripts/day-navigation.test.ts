import assert from "node:assert/strict";
import test from "node:test";
import { dateOfTab, dayTabOf, isFutureDay, shiftIsoDate } from "../apps/mobile/src/features/nutrition/domain/DayNavigation.ts";

test("UIX-05: вкладки «Вчера | Сегодня | Завтра» соответствуют датам относительно сегодняшней (границы месяца и года)", () => {
  assert.equal(dateOfTab("YESTERDAY", "2026-11-01"), "2026-10-31");
  assert.equal(dateOfTab("TODAY", "2026-11-09"), "2026-11-09");
  assert.equal(dateOfTab("TOMORROW", "2026-12-31"), "2027-01-01");
  assert.equal(dayTabOf("2026-11-08", "2026-11-09"), "YESTERDAY");
  assert.equal(dayTabOf("2026-11-09", "2026-11-09"), "TODAY");
  assert.equal(dayTabOf("2026-11-10", "2026-11-09"), "TOMORROW");
  assert.equal(dayTabOf("2026-11-20", "2026-11-09"), null, "другая дата — ни одна вкладка не выбрана");
});

test("UIX-05: будущий день — только питание; сегодня и прошлое редактируются", () => {
  assert.equal(isFutureDay("2026-11-10", "2026-11-09"), true);
  assert.equal(isFutureDay("2026-11-09", "2026-11-09"), false);
  assert.equal(isFutureDay("2026-11-08", "2026-11-09"), false);
});

test("UIX-05: сдвиг даты через февраль високосного и обычного года", () => {
  assert.equal(shiftIsoDate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftIsoDate("2027-02-28", 1), "2027-03-01");
  assert.equal(shiftIsoDate("2026-03-01", -1), "2026-02-28");
});
