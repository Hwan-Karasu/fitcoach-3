import assert from "node:assert/strict";
import test from "node:test";
import { dateOfTab, dayTabOf, daySwipeOf, isFutureDay, shiftIsoDate, swipedDay } from "../apps/mobile/src/features/nutrition/domain/DayNavigation.ts";

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

// Ожидаемые значения заданы из требования владельца (свайп влево — к завтрашнему дню, вправо — к вчерашнему; на краях день не меняется).
test("UIX-FIT-10: свайп по дням — сторона и порог", () => {
  assert.equal(daySwipeOf(-80, 0), "NEXT", "палец влево на 80 dp — вперёд");
  assert.equal(daySwipeOf(80, 0), "PREV", "палец вправо — назад");
  assert.equal(daySwipeOf(-30, 0), null, "короткий медленный сдвиг — не свайп");
  assert.equal(daySwipeOf(-20, -900), "NEXT", "быстрый короткий взмах влево — свайп");
  assert.equal(daySwipeOf(4, 2000), null, "почти без сдвига — случайное касание");
});

test("UIX-FIT-10: свайп по дням — соседние вкладки, края и дата из календаря", () => {
  const today = "2026-11-11";
  assert.equal(swipedDay("2026-11-11", today, "NEXT"), "2026-11-12", "Сегодня → Завтра");
  assert.equal(swipedDay("2026-11-11", today, "PREV"), "2026-11-10", "Сегодня → Вчера");
  assert.equal(swipedDay("2026-11-10", today, "NEXT"), "2026-11-11", "Вчера → Сегодня");
  assert.equal(swipedDay("2026-11-10", today, "PREV"), null, "назад от «Вчера» — край");
  assert.equal(swipedDay("2026-11-12", today, "NEXT"), null, "вперёд от «Завтра» — край");
  assert.equal(swipedDay("2026-11-12", today, "PREV"), "2026-11-11", "Завтра → Сегодня");
  assert.equal(swipedDay("2026-11-20", today, "NEXT"), "2026-11-21", "дата из календаря — на сутки вперёд");
  assert.equal(swipedDay("2026-11-01", today, "PREV"), "2026-10-31", "дата из календаря — на сутки назад через границу месяца");
});
