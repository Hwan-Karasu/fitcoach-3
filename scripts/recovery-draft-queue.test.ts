import assert from "node:assert/strict";
import test from "node:test";
import { RecoveryDraftQueue } from "../apps/mobile/src/features/training/plans/domain/RecoveryDraftQueue.ts";

test("I07 deleting a draft drains in-flight autosave and cancels pending writes and unmount flush", async () => {
  let disk: number | null = null; let release!: () => void; let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const queue = new RecoveryDraftQueue<number>(async (value) => { started(); await blocked; disk = value; }, () => undefined);
  queue.schedule(1); const writing = queue.flush(); await entered; queue.schedule(2);
  const removing = queue.discard(async () => { disk = null; }); release(); await writing; await removing;
  queue.schedule(3); queue.dispose(); await queue.flush(); assert.equal(disk, null);
});

test("I07 failed deletion retains the newest pending draft for save or retry", async () => {
  let disk: number | null = null;
  const queue = new RecoveryDraftQueue<number>(async (value) => { disk = value; }, () => undefined);
  queue.schedule(7); await assert.rejects(queue.discard(async () => { throw new Error("DELETE_FAILED"); }));
  await queue.publish(); assert.equal(disk, 7); queue.dispose();
});

test("I07 failed save stays retryable and explicit publication prevents later autosave", async () => {
  let fail = true; let disk = 0;
  const queue = new RecoveryDraftQueue<number>(async (value) => { if (fail) throw new Error("WRITE_FAILED"); disk = value; }, () => undefined);
  queue.schedule(4); await assert.rejects(queue.publish()); assert.equal(disk, 0);
  fail = false; await queue.publish(); assert.equal(disk, 4);
  queue.schedule(5); queue.dispose(); await queue.flush(); assert.equal(disk, 4);
  queue.resume(); queue.schedule(6); await queue.flush(); assert.equal(disk, 6); queue.dispose();
});

test("I07 a completed deletion is never written back by unmount, even after resume", async () => {
  let disk: number | null = null;
  const queue = new RecoveryDraftQueue<number>(async (value) => { disk = value; }, () => undefined);
  queue.schedule(1); await queue.flush(); assert.equal(disk, 1);
  await queue.discard(async () => { disk = null; });
  queue.resume(); queue.dispose(); await queue.flush(); assert.equal(disk, null);
});

test("I07 a repeated deletion that fails keeps the content still shown by the editor, not an older draft", async () => {
  let disk: number | null = null;
  const queue = new RecoveryDraftQueue<number>(async (value) => { disk = value; }, () => undefined);
  queue.schedule(1); await queue.flush(); await queue.discard(async () => { disk = null; });
  queue.resume(); queue.schedule(2);
  await assert.rejects(queue.discard(async () => { throw new Error("DELETE_FAILED"); }));
  await queue.publish(); assert.equal(disk, 2); queue.dispose();
});
