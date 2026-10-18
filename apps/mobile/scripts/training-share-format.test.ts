import assert from "node:assert/strict";
import test from "node:test";
import { labeledPlan, labeledWithDrops } from "../src/features/training/execution/presentation/shareFormat.ts";

// Число без единиц, как в таблице дневника.
const raw = (values: { loadGrams: number | null; durationSec: number | null; reps: number | null; distanceM: number | null }, field: "reps" | "loadGrams" | "durationSec" | "distanceM") =>
  field === "loadGrams" ? String((values.loadGrams ?? 0) / 1000).replace(".", ",")
    : field === "durationSec" ? `${Math.floor((values.durationSec ?? 0) / 60)}:${String((values.durationSec ?? 0) % 60).padStart(2, "0")}`
      : String(values[field]);

const values = (reps: number | null, loadKg: number | null, durationSec: number | null = null) =>
  ({ reps, loadGrams: loadKg === null ? null : loadKg * 1000, durationSec, distanceM: null });

test("«Поделиться тренировкой»: у чисел подписи единиц — повторы и кг различимы", () => {
  assert.equal(labeledWithDrops(values(20, 20), [], ["reps", "loadGrams"], raw), "20 повт. × 20 кг");
  assert.equal(labeledWithDrops(values(8, 100), [values(6, 80)], ["reps", "loadGrams"], raw), "8 повт. × 100 кг / 6 повт. × 80 кг");
  assert.equal(labeledWithDrops(values(null, 62.5), [], ["reps", "loadGrams"], raw), "62,5 кг");
  assert.equal(labeledWithDrops(values(null, null, 45), [], ["durationSec"], raw), "0:45");
  assert.equal(labeledPlan("8–12", ["reps", "loadGrams"]),
    "8–12 повт.");
});
