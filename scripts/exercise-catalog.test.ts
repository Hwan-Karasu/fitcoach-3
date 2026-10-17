import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecord, systemExerciseId, trackingProfileOf, validateCatalog, type RepdbRecord } from
  "./catalog/normalize-repdb.ts";

// Синтетические записи в формате RepDB schema 3 (не копии набора).
const base: RepdbRecord = { id: "synthetic-press", name_en: "Synthetic Press", category: "strength", force_type: "push",
  mechanic: "compound", difficulty: "beginner", equipment: "barbell", body_part: "chest",
  primary_muscles: ["pectoralis_major"], instructions_en: ["Step one."],
  images: { flat: { start: "images/flat/synthetic-press-start.webp", peak: "images/flat/synthetic-press-peak.webp" } } };

test("X01 профиль учёта по §33.4: штанга — вес+повторы, своим весом — повторы, удержание — время", () => {
  assert.equal(trackingProfileOf(base), "LOAD_REPS");
  assert.equal(trackingProfileOf({ ...base, equipment: null }), "REPS");
  assert.equal(trackingProfileOf({ ...base, equipment: "pull_up_bar" }), "REPS", "турник — не внешняя нагрузка");
  assert.equal(trackingProfileOf({ ...base, equipment: "dumbbell", is_bodyweight: true }), "REPS");
  assert.equal(trackingProfileOf({ ...base, equipment: null, force_type: "static" }), "DURATION");
  assert.equal(trackingProfileOf({ ...base, equipment: "plates", force_type: "static" }), "LOAD_DURATION");
  assert.equal(trackingProfileOf({ ...base, category: "stretching" }), "DURATION");
  assert.equal(trackingProfileOf({ ...base, category: "cardio", equipment: "stationary_bike" }), "DURATION");
  // Явные решения таблицы исключений.
  assert.equal(trackingProfileOf({ ...base, id: "weighted-pull-up" }), "ADDED_LOAD_REPS");
  assert.equal(trackingProfileOf({ ...base, id: "assisted-pull-ups" }), "ASSISTANCE_REPS");
  assert.equal(trackingProfileOf({ ...base, id: "running", category: "cardio" }), "DISTANCE_DURATION");
  assert.equal(trackingProfileOf({ ...base, id: "suitcase-carry" }), "LOAD_DISTANCE");
});

test("X01 нормализация: свой стабильный ID, русское название с запасным английским, ссылка на источник", () => {
  const ru = normalizeRecord(base, "Синтетический жим");
  assert.equal(ru.id, "sys:repdb:synthetic-press");
  assert.equal(ru.id, systemExerciseId("synthetic-press"));
  assert.equal(ru.name, "Синтетический жим");
  assert.equal(ru.nameEn, "Synthetic Press");
  assert.deepEqual(ru.source, { provider: "REPDB", sourceId: "synthetic-press" });
  assert.deepEqual(ru.media, { start: "images/flat/synthetic-press-start.webp",
    peak: "images/flat/synthetic-press-peak.webp", main: null });
  assert.equal(normalizeRecord(base, undefined).name, "Synthetic Press", "без перевода — английское название");
  assert.equal(normalizeRecord({ ...base, mechanic: "unknown" }, "x").mechanic, null, "неизвестное значение не выдумывается");
  assert.throws(() => normalizeRecord({ ...base, body_part: "tail" }, "x"), /REPDB_BODY_PART_UNKNOWN/);
});

test("X01 проверка набора: дубликаты и неверный формат ID не проходят", () => {
  const one = normalizeRecord(base, "Жим");
  assert.deepEqual(validateCatalog([one]), []);
  assert.equal(validateCatalog([one, one]).length, 1);
  assert.equal(validateCatalog([{ ...one, id: "repdb:Synthetic" }]).length, 1);
});
