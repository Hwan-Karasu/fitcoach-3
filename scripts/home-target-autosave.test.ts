import assert from "node:assert/strict";
import test from "node:test";
import { HomeTargetSaveQueue } from "../apps/mobile/src/features/nutrition/presentation/HomeTargetSaveQueue.ts";
import { uniformWeek } from "../apps/mobile/src/features/nutrition/domain/TargetRules.ts";
import type { TargetVersion } from "../apps/mobile/src/features/nutrition/domain/TargetModel.ts";

test("UIX audit: позднее автосохранение не подтверждает новый черновик; второе поле пишет новую ревизию без потерь", async () => {
  const calls: { revision: number | null; finish: (value: TargetVersion) => void }[] = [];
  const queue = new HomeTargetSaveQueue("synthetic-a", { saveVersion: async (_client, _input, revision) =>
    new Promise<TargetVersion>((finish) => { calls.push({ revision, finish }); }) });
  const input = { effectiveFrom: "2026-11-10", days: uniformWeek({ kcal: null, protein: { minX10: 1000, maxX10: 1000 }, fat: null, carbs: null }) };
  queue.markEdited();
  const first = queue.save(input);
  assert.equal(queue.save(input), first, "Done и blur одного ввода не пишут дважды");
  await Promise.resolve();
  queue.markEdited();
  const second = queue.save({ ...input, days: uniformWeek({ kcal: null, protein: { minX10: 1100, maxX10: 1100 }, fat: null, carbs: null }) });
  assert.equal(calls.length, 1);
  const saved = { id: "v1", clientId: "synthetic-a", effectiveFrom: input.effectiveFrom, days: input.days, revision: 1,
    createdAt: "2026-11-10T09:00:00Z", updatedAt: "2026-11-10T09:00:00Z", homeAdjustment: null } as TargetVersion;
  calls[0]!.finish(saved);
  const ack1 = await first;
  assert.equal(queue.isCurrent(ack1.edit), false, "новый текст остаётся грязным после первого ACK");
  await Promise.resolve();
  assert.equal(calls[1]!.revision, 1);
  calls[1]!.finish({ ...saved, revision: 2 });
  const ack2 = await second;
  assert.equal(queue.isCurrent(ack2.edit), true);
});

test("UIX audit: ошибка автосохранения допускает повтор того же ввода", async () => {
  let calls = 0;
  const queue = new HomeTargetSaveQueue("synthetic-a", { saveVersion: async () => { calls += 1; throw new Error("TARGET_STALE"); } });
  const input = { effectiveFrom: "2026-11-10", days: uniformWeek({ kcal: null, protein: null, fat: null, carbs: null }) };
  queue.markEdited();
  await assert.rejects(queue.save(input), /TARGET_STALE/u);
  await assert.rejects(queue.save(input), /TARGET_STALE/u);
  assert.equal(calls, 2);
});
