import assert from "node:assert/strict";
import test from "node:test";
import { macroBarGeometry } from "../apps/mobile/src/features/nutrition/domain/MacroBar.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.0005, `${actual} ≠ ${expected}`);

// Числа — из макета «Главная» (белки 52 г из цели 120 г; коридор 110–120 г): доли посчитаны вручную.
test("UI-OWN-069 точная цель: полоса — доля съеденного от цели, рамки нет", () => {
  const bar = macroBarGeometry(520, { minX10: 1200, maxX10: 1200 });
  close(bar.fill, 0.4333);
  assert.equal(bar.band, null);
});

test("UI-OWN-069 коридор: шкала на 15 % длиннее верхней границы, рамка отмечает коридор", () => {
  const bar = macroBarGeometry(520, { minX10: 1100, maxX10: 1200 });
  close(bar.fill, 0.3768);
  assert.ok(bar.band !== null);
  close(bar.band.left, 0.7971);
  close(bar.band.width, 0.0725);
});

test("UI-OWN-069 перебор цели заполняет полосу целиком, но не выходит за неё", () => {
  assert.equal(macroBarGeometry(1500, { minX10: 1200, maxX10: 1200 }).fill, 1);
});

test("UI-OWN-069 нет цели или нет данных: пустая полоса без рамки", () => {
  assert.deepEqual(macroBarGeometry(520, null), { fill: 0, band: null });
  assert.deepEqual(macroBarGeometry(null, { minX10: 1200, maxX10: 1200 }), { fill: 0, band: null });
  assert.deepEqual(macroBarGeometry(520, { minX10: 0, maxX10: 0 }), { fill: 0, band: null });
});
