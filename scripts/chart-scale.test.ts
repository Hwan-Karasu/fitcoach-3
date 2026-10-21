import assert from "node:assert/strict";
import test from "node:test";
import { chartLayout, lineChartLayout, niceStep } from "../apps/mobile/src/shared/ui/components/chartScale.ts";

test("шаг шкалы округляется вверх до 1, 2, 5 × 10ⁿ", () => {
  assert.deepEqual([0, -3, Number.NaN].map(niceStep), [1, 1, 1], "нет данных — шаг 1");
  assert.deepEqual([0.7, 1.2, 3.1, 7, 120].map(niceStep), [1, 2, 5, 10, 200]);
});

test("столбцы ровно умещаются в ширину; при тесноте — не уже 2", () => {
  assert.deepEqual(chartLayout(300, 10, 28), { barWidth: 27, spacing: 3 });
  assert.deepEqual(chartLayout(300, 100, 28), { barWidth: 2, spacing: 1 });
  assert.deepEqual(chartLayout(300, 2, 28), { barWidth: 28, spacing: 122 });
});

test("одна точка не сжимает график; серия и крайние точки помещаются в ширину", () => {
  const single = lineChartLayout(320, 1, 52, 12);
  assert.deepEqual(single, { width: 268, initialSpacing: 134, endSpacing: 134, spacing: 0 });
  for (const count of [2, 3, 90]) {
    const layout = lineChartLayout(320, count, 52, 12);
    assert.equal(layout.initialSpacing + layout.spacing * (count - 1) + layout.endSpacing, layout.width);
  }
});
