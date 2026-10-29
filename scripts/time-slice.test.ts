import assert from "node:assert/strict";
import test from "node:test";
import { createTimeSlicer } from "../apps/mobile/src/shared/runtime/timeSlice.ts";

test("AUTO-BACKUP-2 порции по времени: поток уступается, только когда работа подряд дольше бюджета", async () => {
  let clock = 0;
  let yields = 0;
  const slice = createTimeSlicer(8, () => clock, async () => { yields += 1; });
  for (const step of [3, 3, 1]) { clock += step; await slice(); }
  assert.equal(yields, 0, "7 мс подряд — без уступки");
  clock += 2; await slice();
  assert.equal(yields, 1, "9 мс — уступка");
  clock += 5; await slice();
  assert.equal(yields, 1, "отсчёт начался заново после уступки");
  clock += 4; await slice();
  assert.equal(yields, 2);
});
