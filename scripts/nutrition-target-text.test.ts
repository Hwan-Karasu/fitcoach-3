import assert from "node:assert/strict";
import test from "node:test";
import { formatTargetText, parseTargetText } from "../apps/mobile/src/features/nutrition/domain/TargetText.ts";

test("ввод цели одной ячейкой: «22» — точное число, «22-30» — диапазон; значения в десятых долях", () => {
  assert.deepEqual(parseTargetText("22"), { minX10: 220, maxX10: 220 }, "точная цель — равные границы (§49.8.1.1)");
  assert.deepEqual(parseTargetText("22-30"), { minX10: 220, maxX10: 300 });
  assert.deepEqual(parseTargetText(" 1900 – 2100 "), { minX10: 19000, maxX10: 21000 }, "пробелы и длинное тире");
  assert.deepEqual(parseTargetText("1900—2100"), { minX10: 19000, maxX10: 21000 }, "длинное тире без пробелов");
  assert.deepEqual(parseTargetText("12,5-14.5"), { minX10: 125, maxX10: 145 }, "запятая и точка");
  assert.deepEqual(parseTargetText("140-140"), { minX10: 1400, maxX10: 1400 });
});

test("пусто — «цели нет» (null, не 0); порядок границ молча не меняется; мусор — invalid", () => {
  assert.equal(parseTargetText(""), null);
  assert.equal(parseTargetText("   "), null);
  for (const bad of ["30-22", "22-", "-30", "abc", "22-30-40", "1,25", "22 30", "0-0x", "--"]) assert.equal(parseTargetText(bad), "invalid", bad);
  assert.deepEqual(parseTargetText("0"), { minX10: 0, maxX10: 0 }, "явный ноль — допустимая цель, а не «нет цели»");
});

test("обратное форматирование: равные границы — одно число, иначе «мин-макс»", () => {
  assert.equal(formatTargetText({ minX10: 220, maxX10: 220 }), "22");
  assert.equal(formatTargetText({ minX10: 220, maxX10: 300 }), "22-30");
  assert.equal(formatTargetText({ minX10: 125, maxX10: 145 }), "12,5-14,5");
  assert.equal(formatTargetText(null), "");
  assert.deepEqual(parseTargetText(formatTargetText({ minX10: 19000, maxX10: 21000 })), { minX10: 19000, maxX10: 21000 }, "формат читается обратно");
});
