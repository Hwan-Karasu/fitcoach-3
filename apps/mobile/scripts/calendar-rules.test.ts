import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonths, applyRangeTap, clampToBounds, daysInMonth, formatLong, formatNumeric, isIsoDate, leadingBlanks, maskTyped, monthOfPage, monthPageCount,
  monthPageOf, parseTyped, resolveBounds, yearList,
} from "../src/shared/ui/components/calendar/calendarRules.ts";

// Ожидаемые значения — из реального календаря: 1 ноября 2026 — воскресенье, 1 октября 2026 — четверг, 1 февраля 2027 — понедельник.
test("сетка месяца с понедельника: пустые клетки перед 1-м числом", () => {
  assert.equal(leadingBlanks(2026, 11), 6);
  assert.equal(leadingBlanks(2026, 10), 3);
  assert.equal(leadingBlanks(2027, 2), 0);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 11), 30);
});

test("сдвиг на месяцы подтягивает день к концу месяца", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2026-11-15", -11), "2025-12-15");
  assert.equal(addMonths("2026-12-10", 1), "2027-01-10");
});

test("страницы-месяцы между границами", () => {
  assert.equal(monthPageOf("1920-03-17", "1920-01-01"), 2);
  assert.equal(monthPageOf("2026-11-12", "1920-01-01"), 1282);
  assert.equal(monthOfPage(1282, "1920-01-01"), "2026-11-01");
  assert.equal(monthPageCount("2026-11-12", "2026-11-30"), 1);
  assert.equal(monthPageCount("2026-11-12", "2027-01-01"), 3);
});

test("границы по умолчанию: с 1920 года и на 10 лет вперёд; свои границы не трогаются", () => {
  assert.deepEqual(resolveBounds({}, "2026-11-12"), { min: "1920-01-01", max: "2036-12-31" });
  assert.deepEqual(resolveBounds({ max: "2026-11-11" }, "2026-11-12"), { min: "1920-01-01", max: "2026-11-11" });
  assert.equal(clampToBounds("1900-05-05", "1920-01-01", "2036-12-31"), "1920-01-01");
  assert.equal(clampToBounds("2040-05-05", "1920-01-01", "2036-12-31"), "2036-12-31");
  assert.equal(clampToBounds("1991-05-05", "1920-01-01", "2036-12-31"), "1991-05-05");
});

test("список лет", () => {
  assert.deepEqual(yearList("1920-01-01", "1923-06-01"), [1920, 1921, 1922, 1923]);
  assert.equal(yearList("1920-01-01", "2036-12-31").length, 117);
});

test("диапазон: первое нажатие — начало, второе — конец, раньше начала — границы меняются, третье начинает заново", () => {
  const first = applyRangeTap({ from: null, to: null }, "2026-11-10");
  assert.deepEqual(first, { from: "2026-11-10", to: null });
  assert.deepEqual(applyRangeTap(first, "2026-11-20"), { from: "2026-11-10", to: "2026-11-20" });
  assert.deepEqual(applyRangeTap(first, "2026-11-03"), { from: "2026-11-03", to: "2026-11-10" });
  assert.deepEqual(applyRangeTap(first, "2026-11-10"), { from: "2026-11-10", to: "2026-11-10" });
  assert.deepEqual(applyRangeTap({ from: "2026-11-03", to: "2026-11-10" }, "2026-11-15"), { from: "2026-11-15", to: null });
});

test("ввод цифрами: маска и разбор", () => {
  assert.equal(maskTyped("05031991"), "05.03.1991");
  assert.equal(maskTyped("0503"), "05.03");
  assert.equal(maskTyped("5a0b"), "50");
  assert.equal(maskTyped("050319912222"), "05.03.1991");
  const min = "1920-01-01", max = "2026-11-11";
  assert.deepEqual(parseTyped("05.03", min, max), { kind: "incomplete" });
  assert.deepEqual(parseTyped("05.03.1991", min, max), { kind: "ok", value: "1991-03-05" });
  assert.deepEqual(parseTyped("31.02.2026", min, max), { kind: "error", message: "Такой даты нет" });
  assert.deepEqual(parseTyped("29.02.2026", min, max), { kind: "error", message: "Такой даты нет" });
  assert.deepEqual(parseTyped("29.02.2024", min, max), { kind: "ok", value: "2024-02-29" });
  assert.deepEqual(parseTyped("01.01.1900", min, max), { kind: "error", message: "Не раньше 01.01.1920" });
  assert.deepEqual(parseTyped("12.11.2026", min, max), { kind: "error", message: "Не позже 11.11.2026" });
});

test("подписи дат", () => {
  assert.equal(formatLong("2026-11-12"), "чт, 12 ноября 2026");
  assert.equal(formatLong("1991-03-05"), "вт, 5 марта 1991");
  assert.equal(formatNumeric("1991-03-05"), "05.03.1991");
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("26-11-12"), false);
});

// Профили календаря (UI-OWN-094): «сегодня» в тестах — 12.11.2026.
import { profileSettings } from "../src/shared/ui/components/calendar/calendarProfiles.ts";
import { resolveDatePick } from "../src/shared/ui/components/datePickStore.ts";
import { addDays } from "../src/shared/ui/components/calendar/calendarRules.ts";

const TODAY = "2026-11-12";

test("профили: дата рождения — год, ввод цифрами, до вчера; прошедшая — до сегодня; срок действия — от сегодня; период — диапазон", () => {
  assert.deepEqual(profileSettings("birthDate", TODAY), { mode: "single", startView: "year", typing: true, showToday: false, min: "1920-01-01", max: "2026-11-11" });
  assert.deepEqual(profileSettings("pastDate", TODAY), { mode: "single", startView: "day", typing: false, showToday: true, max: TODAY });
  assert.deepEqual(profileSettings("futureDate", TODAY), { mode: "single", startView: "day", typing: false, showToday: true, min: TODAY });
  assert.equal(profileSettings("period", TODAY).mode, "range");
  assert.equal(profileSettings("anyDate", TODAY).typing, false);
  assert.equal(profileSettings("nutritionDay", TODAY).typing, false);
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("запрос даты с профилем: границы, открытие без значения и пересечение настроек", () => {
  const empty = resolveDatePick({ value: null, profile: "birthDate", title: "Дата рождения" }, TODAY);
  assert.equal(empty.value, null, "пустое поле не считается выбранным");
  assert.equal(empty.cursor, "1990-01-01");
  assert.equal(empty.startView, "year");
  assert.equal(empty.typing, true);
  assert.equal(empty.max, "2026-11-11");
  const own = resolveDatePick({ value: "2026-12-01", profile: "pastDate", max: "2026-11-30" }, TODAY);
  assert.equal(own.max, "2026-11-30", "свои границы перекрывают профиль");
  assert.equal(own.value, "2026-11-30", "значение вне границ подтягивается");
  const plain = resolveDatePick({ value: "2026-11-05" }, TODAY);
  assert.equal(plain.min, "1920-01-01");
  assert.equal(plain.max, "2036-12-31");
  assert.equal(plain.showToday, true);
  assert.equal(plain.title, "Выберите дату");
  const marks = new Set(["2026-11-02"]);
  assert.equal(resolveDatePick({ value: TODAY, profile: "nutritionDay", markers: marks }, TODAY).markers, marks);
});
