import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { RestTimerService } from "../apps/mobile/src/features/training/execution/application/RestTimerService.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { RestSignalPort } from "../apps/mobile/src/features/training/execution/domain/RestTimerPorts.ts";
import { adjustTimer, remainingSec, runningTimers, startTimer } from
  "../apps/mobile/src/features/training/execution/domain/RestTimerRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const T0 = 1_760_000_000_000;

/** Внешняя граница — системные уведомления: записываем, что запланировано и отменено. */
function fakeSignal(available = true) {
  const scheduled = new Map<string, number>();
  const cancelled: string[] = [];
  let next = 0;
  const port: RestSignalPort = {
    schedule: async ({ endAt }) => {
      if (!available) return null;
      next += 1;
      scheduled.set(`n${next}`, endAt);
      return `n${next}`;
    },
    cancel: async (id) => { cancelled.push(id); scheduled.delete(id); },
  };
  return { port, scheduled, cancelled };
}

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  return { clients, execution, close: async () => { await execution.close(); await clients.close(); } };
}

const bench = { clientId: "a", clientName: "SyntheticA", exerciseKey: "pe-bench", exerciseName: "Жим", durationSec: 180 };

test("T03 правила таймера: перезапуск того же упражнения, ±15 не в прошлое, ближайший первым", () => {
  const first = startTimer([], bench, "t1", T0);
  assert.equal(first.timer.endAt, T0 + 180_000);
  const curl = startTimer(first.timers, { ...bench, exerciseKey: "pe-curl", exerciseName: "Сгибания", durationSec: 90 }, "t2", T0);
  const otherClient = startTimer(curl.timers, { ...bench, clientId: "b", clientName: "SyntheticB", durationSec: 60 }, "t3", T0);
  assert.equal(otherClient.timers.length, 3, "другое упражнение и другой клиент — свои таймеры");
  const restart = startTimer(otherClient.timers, bench, "t4", T0 + 30_000);
  assert.equal(restart.replaced?.id, "t1", "тот же клиент и упражнение — перезапуск");
  assert.deepEqual(runningTimers(restart.timers, T0 + 30_000).map((timer) => timer.id), ["t3", "t2", "t4"]);
  assert.equal(adjustTimer(first.timer, 15, T0).endAt, T0 + 195_000);
  assert.equal(adjustTimer(first.timer, -15, T0 + 170_000).endAt, T0 + 170_000, "−15 не делает время отрицательным");
  assert.equal(remainingSec(first.timer, T0 + 179_001), 1);
  assert.equal(remainingSec(first.timer, T0 + 200_000), 0);
});

test("T03 сервис таймеров: сигнал на endAt, ±15 переносит сигнал, «Пропустить» снимает только свой (§48.62, §48.64, §44.9)", async () => {
  const { execution, close } = await stores();
  try {
    let now = T0;
    const signal = fakeSignal();
    const service = new RestTimerService(execution, signal.port, () => now);
    await service.start(bench);
    await service.start({ ...bench, clientId: "b", clientName: "SyntheticB", exerciseKey: "pe-row", durationSec: 90 });
    const [a, b] = [service.list().find((timer) => timer.clientId === "a")!, service.list().find((timer) => timer.clientId === "b")!];
    assert.deepEqual([...signal.scheduled.values()].sort(), [T0 + 90_000, T0 + 180_000], "сигнал сразу при старте");
    now = T0 + 10_000;
    await service.adjust(a.id, 15);
    const moved = service.list().find((timer) => timer.id === a.id)!;
    assert.equal(moved.endAt, T0 + 195_000);
    assert.ok(signal.cancelled.includes(a.signalId!), "старый сигнал отменён");
    assert.equal(signal.scheduled.get(moved.signalId!), T0 + 195_000, "новый — на новое окончание");
    await service.skip(b.id);
    assert.deepEqual(service.list().map((timer) => timer.id), [a.id], "«Пропустить» у B не трогает A");
    assert.equal(signal.scheduled.has(b.signalId!), false);
    await service.start(bench);
    assert.equal(service.list().length, 1, "повторное подтверждение — перезапуск того же таймера");
    assert.equal(service.list()[0]!.endAt, now + 180_000);
  } finally { await close(); }
});

test("T03 таймер без системного сигнала работает; после перезапуска приложения — прежний endAt (§44.7, §44.14)", async () => {
  const { execution, close } = await stores();
  try {
    const before = new RestTimerService(execution, fakeSignal(false).port, () => T0);
    await before.start(bench);
    await before.start({ ...bench, exerciseKey: "pe-short", durationSec: 30 });
    assert.equal(before.list().length, 2);
    assert.equal(before.list()[0]!.signalId, null, "нет разрешения на уведомления — таймер всё равно идёт");
    const after = new RestTimerService(execution, fakeSignal().port, () => T0 + 60_000);
    await after.recover();
    assert.deepEqual(after.list().map((timer) => [timer.exerciseKey, timer.endAt]), [["pe-bench", T0 + 180_000]],
      "идущий восстановлен с прежним окончанием, закончившийся убран без перезапуска");
    assert.equal((await execution.listTimers()).length, 1);
  } finally { await close(); }
});

test("T03 таймеры клиента удаляются вместе с ним", async () => {
  const { clients, execution, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "SyntheticGone" });
    const service = new RestTimerService(execution, fakeSignal().port, () => T0);
    await service.start({ ...bench, clientId: gone.id });
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.equal((await execution.listTimers()).length, 0);
  } finally { await close(); }
});
