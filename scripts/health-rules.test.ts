import assert from "node:assert/strict";
import test from "node:test";
import { isValidHealthValue } from "../apps/mobile/src/features/health/domain/HealthModel.ts";
import { lastValuePerDay, sleepMinutesByWakeDate, toTenths } from "../apps/mobile/src/features/health/domain/HealthRules.ts";

/** Москва, UTC+3 без перехода: локальная дата = дата момента, сдвинутого на 3 часа. */
const msk = (instant: string): string => new Date(Date.parse(instant) + 3 * 3_600_000).toISOString().slice(0, 10);

test("Health: сон относится к дате пробуждения; сессия через полночь не делится", () => {
  // 22:30 → 06:30 по Москве (19:30Z → 03:30Z) = 8 ч 480 мин, дата пробуждения 2026-11-10.
  const map = sleepMinutesByWakeDate([{ startTime: "2026-11-09T19:30:00Z", endTime: "2026-11-10T03:30:00Z" }], msk);
  assert.deepEqual([...map], [["2026-11-10", 480]]);
});

test("Health: этапы бодрствования вычитаются (1, 3, 7), лёгкий/глубокий/REM — сон", () => {
  const map = sleepMinutesByWakeDate([{ startTime: "2026-11-09T20:00:00Z", endTime: "2026-11-10T04:00:00Z", stages: [
    { startTime: "2026-11-09T20:00:00Z", endTime: "2026-11-09T23:00:00Z", stage: 4 },
    { startTime: "2026-11-09T23:00:00Z", endTime: "2026-11-09T23:30:00Z", stage: 1 },
    { startTime: "2026-11-09T23:30:00Z", endTime: "2026-11-10T02:00:00Z", stage: 5 },
    { startTime: "2026-11-10T02:00:00Z", endTime: "2026-11-10T02:15:00Z", stage: 7 },
    { startTime: "2026-11-10T02:15:00Z", endTime: "2026-11-10T04:00:00Z", stage: 6 },
  ] }], msk);
  // 8 ч − 30 мин − 15 мин = 7 ч 15 мин = 435 мин.
  assert.deepEqual([...map], [["2026-11-10", 435]]);
});

test("Health: две записи одной ночи (телефон и часы) считаются один раз; разные ночи — раздельно; пустая сессия пропускается", () => {
  const map = sleepMinutesByWakeDate([
    { startTime: "2026-11-09T19:00:00Z", endTime: "2026-11-10T03:00:00Z" },
    { startTime: "2026-11-09T19:30:00Z", endTime: "2026-11-10T03:30:00Z" },
    { startTime: "2026-11-10T19:00:00Z", endTime: "2026-11-11T02:00:00Z" },
    { startTime: "2026-11-12T10:00:00Z", endTime: "2026-11-12T10:00:00Z" },
  ], msk);
  // Первые две — объединение 19:00–03:30 = 8 ч 30 мин = 510; третья — 7 ч = 420.
  assert.deepEqual([...map].sort(), [["2026-11-10", 510], ["2026-11-11", 420]]);
});

test("Health: дневной сон отдельной сессией суммируется с ночным в день пробуждения", () => {
  const map = sleepMinutesByWakeDate([
    { startTime: "2026-11-09T20:00:00Z", endTime: "2026-11-10T03:00:00Z" },
    { startTime: "2026-11-10T10:00:00Z", endTime: "2026-11-10T11:00:00Z" },
  ], msk);
  assert.deepEqual([...map], [["2026-11-10", 420 + 60]]);
});

test("Health: последнее значение за локальный день; вес в десятых; мусор отбрасывается", () => {
  const map = lastValuePerDay([
    { time: "2026-11-10T04:00:00Z", value: 80.14 }, { time: "2026-11-10T16:00:00Z", value: 79.96 },
    { time: "2026-11-10T21:30:00Z", value: 79.5 }, // 00:30 МСК 11 ноября — уже другой день
    { time: "не время", value: 70 }, { time: "2026-11-12T08:00:00Z", value: Number.NaN },
  ], msk);
  assert.deepEqual([...map].sort(), [["2026-11-10", 79.96], ["2026-11-11", 79.5]]);
  assert.equal(toTenths(80.14), 801);
  assert.equal(toTenths(79.96), 800);
  assert.equal(toTenths(18.25), 183);
});

test("Health: допустимые значения — границы шагов, сна, расхода, веса и процента жира", () => {
  assert.equal(isValidHealthValue("STEPS", 0), true);
  assert.equal(isValidHealthValue("STEPS", 200_000), true);
  assert.equal(isValidHealthValue("STEPS", 200_001), false);
  assert.equal(isValidHealthValue("SLEEP_MIN", 1440), true);
  assert.equal(isValidHealthValue("SLEEP_MIN", 1441), false);
  assert.equal(isValidHealthValue("TOTAL_KCAL", 20_000), true);
  assert.equal(isValidHealthValue("WEIGHT_X10", 199), false);
  assert.equal(isValidHealthValue("WEIGHT_X10", 200), true);
  assert.equal(isValidHealthValue("WEIGHT_X10", 4000), true);
  assert.equal(isValidHealthValue("WEIGHT_X10", 4001), false);
  assert.equal(isValidHealthValue("BODY_FAT_X10", 19), false);
  assert.equal(isValidHealthValue("BODY_FAT_X10", 750), true);
  assert.equal(isValidHealthValue("STEPS", -1), false);
  assert.equal(isValidHealthValue("STEPS", 1.5), false);
});
import { readHealthPages } from "../apps/mobile/src/features/health/domain/HealthRules.ts";

test("UIX audit: все страницы Health Connect читаются, неполный или зацикленный ответ отклоняется", async () => {
  assert.deepEqual(await readHealthPages(async (token) => token === undefined ? { records: [1], pageToken: "next" } : { records: [2] }), [1, 2]);
  await assert.rejects(readHealthPages(async () => ({ records: [1], pageToken: "same" })), /HEALTH_READ_PAGINATION/u);
  let page = 0;
  await assert.rejects(readHealthPages(async () => ({ records: [page], pageToken: String(++page) }), 2), /HEALTH_READ_LIMIT/u);
});
