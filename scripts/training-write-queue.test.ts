import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { SerialWriteQueue } from "../apps/mobile/src/features/training/execution/application/SerialWriteQueue.ts";
import { DevTrainingExecutionRepository } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { SetFact, SetValues } from "../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

test("очередь записи: команды идут строго по одной, busy виден, пока очередь не опустеет", async () => {
  const queue = new SerialWriteQueue();
  const log: string[] = [];
  assert.equal(queue.busy, false);
  const first = queue.run(async () => { log.push("1 start"); await tick(); log.push("1 end"); return "a"; });
  const second = queue.run(async () => { log.push("2 start"); await tick(); log.push("2 end"); return "b"; });
  assert.equal(queue.busy, true);
  assert.deepEqual([await first, await second], ["a", "b"]);
  assert.deepEqual(log, ["1 start", "1 end", "2 start", "2 end"], "вторая начинается после завершения первой");
  assert.equal(queue.busy, false);
});

test("очередь записи: ошибка одной команды не блокирует следующие; settle сообщает о сбое один раз", async () => {
  const queue = new SerialWriteQueue();
  const errors: unknown[] = [];
  const failed = queue.run(async () => { throw new Error("INVALID_METRIC"); }, { onError: (error) => { errors.push(error); } });
  const next = queue.run(async () => "ok");
  assert.equal(await failed, null);
  assert.equal(await next, "ok", "следующая команда выполнилась");
  assert.equal((errors[0] as Error).message, "INVALID_METRIC");
  assert.equal(await queue.settle(), false, "сбой виден тому, кто ждёт сохранения (выход, смена недели)");
  assert.equal(await queue.settle(), true, "флаг сбрасывается после сообщения");
});

test("очередь записи: settle дожидается и команд, добавленных во время ожидания", async () => {
  const queue = new SerialWriteQueue();
  const done: string[] = [];
  void queue.run(async () => { await tick(); done.push("a"); void queue.run(async () => { await tick(); done.push("b"); }); });
  assert.equal(await queue.settle(), true);
  assert.deepEqual(done, ["a", "b"]);
});

test("быстрый ввод повторов и веса подряд: вторая запись берёт ревизию из ответа первой, оба значения сохранены", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, "synthetic-workspace-a", []);
  await clients.initialize();
  const execution = new DevTrainingExecutionRepository(shared, "synthetic-workspace-a");
  await execution.initialize();
  try {
    const client = await clients.create({ displayName: "SyntheticQueue" });
    const slot = { clientId: client.id, programId: "p1", weekIndex: 1, plannedWorkoutId: "w1" };
    const empty: SetValues = { reps: null, loadGrams: null, durationSec: null, distanceM: null };
    const queue = new SerialWriteQueue();
    let acked: SetFact | null = null;
    // Как useWorkoutDiary: каждая команда читает ревизию последнего ACK, а не снимка экрана.
    const write = (patch: Partial<SetValues>) => queue.run(async () => {
      const result = await execution.saveSet({ slot, plannedExerciseId: "e1", exerciseId: "sys:repdb:bench", plannedSetId: "s1", position: 0,
        metrics: ["load", "reps"], values: { ...(acked?.values ?? empty), ...patch }, setType: "NORMAL", drops: [], rpe: null,
        expectedRevision: acked?.revision ?? null });
      acked = result.fact;
    });
    await Promise.all([write({ reps: 8 }), write({ loadGrams: 60_000 })]);
    assert.equal(await queue.settle(), true);
    const saved = (await execution.getWorkout(slot)).facts.get("s1")!;
    assert.deepEqual([saved.values.reps, saved.values.loadGrams], [8, 60_000]);
    // Без очереди и ACK обе команды увидели бы «факта ещё нет» — вторая получила бы STALE_SESSION.
    await assert.rejects(execution.saveSet({ slot, plannedExerciseId: "e1", exerciseId: "sys:repdb:bench", plannedSetId: "s1", position: 0,
      metrics: ["load", "reps"], values: { ...empty, reps: 9 }, setType: "NORMAL", drops: [], rpe: null, expectedRevision: null }),
    (error: unknown) => error instanceof Error && error.message === "STALE_SESSION");
  } finally { await execution.close(); await clients.close(); }
});
