import assert from "node:assert/strict";
import test from "node:test";
import { monthGrid, monthOffset, monthPage, monthStart, shiftMonth, weekOf, weekOffset } from "../apps/mobile/src/features/nutrition/domain/DiaryCalendar.ts";

test("P-10: неделя вокруг даты — с понедельника по воскресенье; 20 октября 2026 (вторник) → 19–25 октября", () => {
  assert.deepEqual(weekOf("2026-10-20"), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.equal(weekOf("2026-10-19")[0], "2026-10-19", "понедельник открывает свою неделю");
  assert.equal(weekOf("2026-10-25")[0], "2026-10-19", "воскресенье принадлежит неделе, которая началась в понедельник");
  assert.deepEqual(weekOf("2026-11-01"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"], "неделя через границу месяца");
  assert.equal(weekOf("2026-01-01")[0], "2025-12-29", "и через границу года");
});

test("P-11: сетка месяца — октябрь 2026 начинается с четверга и занимает 5 недель; пустые ячейки — null", () => {
  const grid = monthGrid("2026-10");
  assert.equal(grid.length, 5);
  assert.deepEqual(grid[0], [null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(grid[4], ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", null]);
  assert.equal(grid.flat().filter((cell) => cell !== null).length, 31);
  assert.equal(monthGrid("2026-02").flat().filter((cell) => cell !== null).length, 28, "февраль 2026 — 28 дней");
  assert.equal(monthGrid("2028-02").flat().filter((cell) => cell !== null).length, 29, "високосный год");
  assert.equal(monthGrid("2026-02").length, 5, "1 февраля 2026 — воскресенье: первая неделя почти пуста, всего 5 строк");
});

test("P-11: выбор месяца не меняет дату — вспомогательные функции работают только с «ГГГГ-ММ»", () => {
  assert.equal(monthStart("2026-10-20"), "2026-10");
  assert.equal(shiftMonth("2026-10", 1), "2026-11");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("N02: swiped months always contain six complete Monday-based weeks, including adjacent months", () => {
  for (const month of ["2026-02", "2028-02", "2026-10", "2026-12", "2027-01"]) {
    const grid = monthPage(month);
    assert.equal(grid.length, 6);
    assert.ok(grid.every((week) => week.length === 7));
    const days = grid.flat();
    assert.equal(new Set(days).size, 42);
    assert.equal(weekOf(`${month}-01`)[0], days[0]);
    for (let index = 1; index < days.length; index += 1) {
      assert.equal(Date.parse(`${days[index]}T00:00:00Z`) - Date.parse(`${days[index - 1]}T00:00:00Z`), 86_400_000);
    }
  }
  assert.ok(monthPage("2028-02").flat().includes("2028-02-29"));
  assert.equal(monthPage("2026-12")[5]![6], "2027-01-10");
});

test("N02: week paging preserves weekday across year/DST boundaries; selecting within a week keeps page", () => {
  assert.equal(weekOffset("2026-12-30", "2027-01-06"), 1);
  assert.equal(weekOffset("2026-12-30", "2026-12-28"), 0);
  assert.equal(weekOffset("2026-12-30", "2026-12-27"), -1);
  assert.equal(weekOffset("2026-03-22", "2026-03-29"), 1);
  assert.equal(weekOffset("2026-10-25", "2026-11-01"), 1);
  assert.equal(monthOffset("2026-12", "2027-01"), 1);
  assert.equal(monthOffset("2027-01", "2026-12"), -1);
  for (let offset = -120; offset <= 120; offset += 1) assert.equal(monthOffset("2026-10", shiftMonth("2026-10", offset)), offset);
});
