import assert from "node:assert/strict";
import test from "node:test";
import { PendingInputWrites } from "../apps/mobile/src/features/training/execution/domain/PendingInputWrites.ts";

test("T03 переход ждёт ACK; повторный flush не дублирует запись", async () => {
  const pending = new PendingInputWrites();
  let ack!: (saved: boolean) => void;
  let writes = 0;
  pending.set("kg", () => { writes++; return new Promise((resolve) => { ack = resolve; }); });
  const first = pending.flushAll();
  const second = pending.flushAll();
  await Promise.resolve();
  assert.equal(writes, 1);
  assert.equal(pending.has("kg"), true);
  ack(true);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(pending.has("kg"), false);
});

test("T03 ошибка оставляет ввод для повторной записи; успех другой ячейки не скрывает отказ", async () => {
  const pending = new PendingInputWrites();
  let available = false;
  pending.set("kg", async () => available);
  pending.set("reps", async () => true);
  assert.equal(await pending.flushAll(), false);
  assert.equal(pending.has("kg"), true);
  assert.equal(pending.has("reps"), false);
  available = true;
  assert.equal(await pending.flushAll(), true);
});

test("T03 ввод во время записи не теряется после ACK старого значения", async () => {
  const pending = new PendingInputWrites();
  let ack!: (saved: boolean) => void;
  const writes: number[] = [];
  pending.set("kg", () => { writes.push(10); return new Promise((resolve) => { ack = resolve; }); });
  const saving = pending.flushAll();
  await Promise.resolve();
  pending.set("kg", async () => { writes.push(105); return true; });
  ack(true);
  assert.equal(await saving, true);
  assert.deepEqual(writes, [10, 105]);
});

test("T03 отметка подхода дописывает только его ячейки: ошибка в другом подходе её не блокирует", async () => {
  const pending = new PendingInputWrites();
  const writes: string[] = [];
  pending.set("set-1:reps", async () => { writes.push("set-1:reps"); return true; });
  pending.set("set-1:L:loadGrams", async () => { writes.push("set-1:L:loadGrams"); return true; });
  pending.set("set-2:reps", async () => false);
  assert.equal(await pending.flushPrefix("set-1:"), true);
  assert.deepEqual(writes.sort(), ["set-1:L:loadGrams", "set-1:reps"]);
  assert.equal(pending.has("set-2:reps"), true, "неверное значение другого подхода остаётся на экране");
  assert.equal(await pending.flushPrefix("set-2:"), false, "ошибка своего подхода — отметка не ставится");
});
