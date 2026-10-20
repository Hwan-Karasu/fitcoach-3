import assert from "node:assert/strict";
import test from "node:test";
import { navyBodyFat } from "../apps/mobile/src/features/measurements/domain/NavyBodyFat.ts";

test("§49.16 ВМС США: мужчина 180 см, шея 40, талия 90 → 18,4 %; женщина 165 см, шея 32, талия 75, бёдра 98 → 28,9 %", () => {
  assert.equal(navyBodyFat({ sex: "MALE", heightCm: 180, neckCm: 40, waistCm: 90, hipsCm: null }), 18.4, "495 / (1,0324 − 0,19077·lg 50 + 0,15456·lg 180) − 450 = 18,37");
  assert.equal(navyBodyFat({ sex: "FEMALE", heightCm: 165, neckCm: 32, waistCm: 75, hipsCm: 98 }), 28.9, "495 / (1,29579 − 0,35004·lg 141 + 0,221·lg 165) − 450 = 28,94");
  assert.equal(navyBodyFat({ sex: "MALE", heightCm: 180, neckCm: 40, waistCm: 90, hipsCm: 120 }), 18.4, "бёдра мужчине не нужны");
});

test("§49.16: неполные, нулевые, отрицательные и несовместимые измерения — null, а не 0", () => {
  const base = { sex: "MALE", heightCm: 180, neckCm: 40, waistCm: 90, hipsCm: null } as const;
  assert.equal(navyBodyFat({ ...base, sex: null }), null, "пол не выбран");
  for (const bad of [{ heightCm: null }, { neckCm: null }, { waistCm: null }, { heightCm: 0 }, { neckCm: -1 }, { waistCm: 0 }, { waistCm: 40 }, { waistCm: 30 }]) {
    assert.equal(navyBodyFat({ ...base, ...bad }), null, JSON.stringify(bad));
  }
  const woman = { sex: "FEMALE", heightCm: 165, neckCm: 32, waistCm: 75, hipsCm: 98 } as const;
  assert.equal(navyBodyFat({ ...woman, hipsCm: null }), null, "женщине нужны бёдра");
  assert.equal(navyBodyFat({ ...woman, hipsCm: 0 }), null);
  assert.equal(navyBodyFat({ ...woman, neckCm: 300 }), null, "шея больше талии и бёдер вместе");
  assert.equal(navyBodyFat({ ...woman, heightCm: 20 }), null, "результат вне допустимых 2–75 % не выдаётся");
});
