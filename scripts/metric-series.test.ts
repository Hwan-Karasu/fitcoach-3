import assert from "node:assert/strict";
import test from "node:test";
import { expenditureByDay, valueOnOrBefore } from "../apps/mobile/src/features/nutrition/domain/MetricSeries.ts";
import type { CalcProfile } from "../apps/mobile/src/features/nutrition/domain/CalcRules.ts";

const profile: CalcProfile = { goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 3, minutes: 60, intensity: "MEDIUM", stepKcal: 100 };
const body = { sex: "MALE" as const, age: 30, heightCm: 180 };

test("UIX-08: последнее известное значение на дату — без будущих и без выдуманных", () => {
  const weights = [{ date: "2026-11-01", value: 80 }, { date: "2026-11-05", value: 79 }];
  assert.equal(valueOnOrBefore(weights, "2026-10-31"), null);
  assert.equal(valueOnOrBefore(weights, "2026-11-01"), 80);
  assert.equal(valueOnOrBefore(weights, "2026-11-04"), 80);
  assert.equal(valueOnOrBefore(weights, "2026-11-09"), 79);
  assert.equal(valueOnOrBefore([], "2026-11-09"), null);
});

// Миффлин–Сан-Жеор для мужчины 30 лет, 180 см, 80 кг: 10·80 + 6,25·180 − 5·30 + 5 = 1 780 (REE).
// NEAT по шагам: 8 000 × min(0,06; max(0,03; 80 × 0,00045 = 0,036)) = 288. EAT: 5 × 3,5 × 80 / 200 × 60 × 3 / 7 = 180.
test("UIX-08: расход дня — REE + NEAT по шагам этого дня + EAT; дни без шагов или без веса пропускаются", () => {
  const result = expenditureByDay({ profile, body, dates: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    steps: new Map([["2026-11-02", 8000], ["2026-11-04", 10000], ["2026-11-05", 0], ["2026-11-06", 8000]]),
    weights: [{ date: "2026-11-03", value: 80 }], fats: [] });
  assert.equal(result.has("2026-11-02"), false, "до первого веса расчёта нет");
  assert.equal(result.has("2026-11-03"), false, "шагов в этот день нет — расход не выдумывается");
  assert.equal(result.get("2026-11-04"), 2320, "REE 1 780 + NEAT 360 (10 000 × 0,036) + EAT 180");
  assert.equal(result.get("2026-11-06"), 2248, "REE 1 780 + NEAT 288 + EAT 180");
  assert.equal(result.has("2026-11-05"), false, "нулевые шаги — «нет данных», расход не подменяется нормой по образу жизни");
});
