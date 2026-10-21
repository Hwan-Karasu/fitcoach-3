import assert from "node:assert/strict";
import test from "node:test";
import { msUntilNextLocalDay } from "../apps/mobile/src/features/nutrition/presentation/todayClock.ts";

test("NUT-022: до смены суток — до первой секунды следующих локальных суток", () => {
  assert.equal(msUntilNextLocalDay(new Date(2026, 9, 20, 23, 59, 0)), 61_000, "23:59:00 → 00:00:01");
  assert.equal(msUntilNextLocalDay(new Date(2026, 9, 20, 12, 0, 0)), 12 * 3_600_000 + 1000);
  assert.equal(msUntilNextLocalDay(new Date(2026, 9, 20, 0, 0, 0)), 24 * 3_600_000 + 1000);
  assert.equal(msUntilNextLocalDay(new Date(2026, 11, 31, 23, 59, 59)), 2000, "через границу года");
});
