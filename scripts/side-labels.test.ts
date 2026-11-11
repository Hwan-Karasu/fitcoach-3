import assert from "node:assert/strict";
import test from "node:test";
import { sideLabels, sideWords } from "../apps/mobile/src/features/measurements/domain/SideLabels.ts";

// Ожидаемое — из русской грамматики (род существительного), а не вычислено кодом.
test("подписи сторон согласуются в роде с частью тела", () => {
  assert.deepEqual(sideLabels("BICEPS"), ["Левое", "Правое"], "плечо — среднего рода");
  assert.deepEqual(sideLabels("FOREARM"), ["Левое", "Правое"], "предплечье — среднего рода");
  assert.deepEqual(sideLabels("THIGH"), ["Левое", "Правое"], "бедро — среднего рода");
  assert.deepEqual(sideLabels("CALF"), ["Левая", "Правая"], "голень — женского рода");
  assert.deepEqual(sideLabels("NECK"), ["Левый", "Правый"], "запасной вариант");
  assert.deepEqual(sideWords("CALF"), ["левая", "правая"]);
});
