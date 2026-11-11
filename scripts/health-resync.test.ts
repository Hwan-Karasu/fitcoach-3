import assert from "node:assert/strict";
import test from "node:test";
import { HEALTH_RESYNC_MIN_GAP_MS, shouldResyncHealth, syncedAtText } from "../apps/mobile/src/features/health/domain/HealthRules.ts";

// Ожидаемые значения — из требования владельца: возврат из Mi Fitness (секунды) подтягивает данные, но частые возвраты не дёргают систему.
test("UIX-FIT-12: первое чтение — всегда; повтор — не раньше паузы; часы устройства назад — читаем", () => {
  assert.equal(HEALTH_RESYNC_MIN_GAP_MS, 15_000);
  assert.equal(shouldResyncHealth(null, 1_000), true);
  assert.equal(shouldResyncHealth(1_000, 1_000 + 14_999), false);
  assert.equal(shouldResyncHealth(1_000, 1_000 + 15_000), true);
  assert.equal(shouldResyncHealth(50_000, 10_000), true, "часы ушли назад — паузу не считаем");
  assert.equal(shouldResyncHealth(1_000, 1_000 + 5_000, 5_000), true, "своя пауза");
});

test("UIX-FIT-12: подпись времени чтения — сегодня «обновлено ЧЧ:ММ», другой день — с датой, нет данных — «ещё не обновлялось»", () => {
  const now = new Date(2026, 10, 11, 18, 30);
  assert.equal(syncedAtText(new Date(2026, 10, 11, 15, 40).toISOString(), now), "обновлено 15:40");
  assert.equal(syncedAtText(new Date(2026, 10, 11, 9, 5).toISOString(), now), "обновлено 09:05");
  assert.equal(syncedAtText(new Date(2026, 9, 3, 9, 5).toISOString(), now), "обновлено 03.10 в 09:05");
  assert.equal(syncedAtText(null, now), "ещё не обновлялось");
  assert.equal(syncedAtText("не дата", now), "ещё не обновлялось");
});
