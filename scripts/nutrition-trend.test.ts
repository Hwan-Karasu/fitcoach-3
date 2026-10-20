import assert from "node:assert/strict";
import test from "node:test";
import { guideLabel, trendAdjustment, weightTrendKg } from "../apps/mobile/src/features/nutrition/domain/CalcRules.ts";

test("динамика веса (2.0): нужно не менее 4 взвешиваний; среднее второй половины минус среднее первой, до 0,01 кг", () => {
  assert.equal(weightTrendKg([85.4, 85.3, 85.1, 85.0]), -0.3, "(85,1+85,0)/2 − (85,4+85,3)/2 = 85,05 − 85,35");
  assert.equal(weightTrendKg([80, 80, 80.5, 80.5]), 0.5);
  assert.equal(weightTrendKg([90, 89, 88]), null, "меньше четырёх — нет динамики, а не «0»");
  assert.equal(weightTrendKg([]), null);
  assert.equal(weightTrendKg([85, 85, 85, 85, 85.6]), 0.2, "пять значений: вторая половина больше — (85+85+85,6)/3 − 85 = 0,2");
});

test("поправка по весу при похудении: слабая динамика → −120, слишком быстрое падение (≤ −1 %) → +120, иначе 0", () => {
  assert.equal(trendAdjustment("LOSS", weightTrendKg([85.4, 85.3, 85.1, 85.0]), 85), 0, "−0,30 кг (−0,35 %) — в норме");
  assert.equal(trendAdjustment("LOSS", weightTrendKg([85, 85, 85, 85]), 85), -120, "вес не снижается — убавить 120 ккал");
  assert.equal(trendAdjustment("LOSS", weightTrendKg([90, 90, 88, 88]), 88), 120, "−2 кг (−2,3 %) — слишком быстро, прибавить");
  assert.equal(trendAdjustment("LOSS", null, 85), 0, "нет динамики — без поправки");
});

test("поправка при наборе и поддержании", () => {
  assert.equal(trendAdjustment("GAIN", weightTrendKg([80, 80, 80, 80]), 80), 120, "набор: вес не растёт — прибавить");
  assert.equal(trendAdjustment("GAIN", weightTrendKg([80, 80, 80.5, 80.5]), 80.5), -100, "+0,5 кг (+0,62 %) — слишком быстро, убавить");
  assert.equal(trendAdjustment("GAIN", weightTrendKg([80, 80, 80.2, 80.2]), 80.2), 0);
  assert.equal(trendAdjustment("MAINTENANCE", weightTrendKg([70, 70, 70.4, 70.4]), 70), -100, "поддержание: вес растёт ≥ 0,35 — убавить");
  assert.equal(trendAdjustment("MAINTENANCE", weightTrendKg([70.4, 70.4, 70, 70]), 70), 100, "падает ≥ 0,35 — прибавить");
  assert.equal(trendAdjustment("MAINTENANCE", weightTrendKg([70, 70, 70.1, 70.1]), 70), 0);
});

test("подпись суточного ориентира: «Без поправки по весу» или «Поправка −120 ккал»", () => {
  assert.equal(guideLabel(0), "Без поправки по весу");
  assert.equal(guideLabel(-120), "Поправка −120 ккал");
  assert.equal(guideLabel(100), "Поправка +100 ккал");
});
