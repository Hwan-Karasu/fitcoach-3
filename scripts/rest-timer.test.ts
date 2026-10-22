import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { RestTimerService } from "../apps/mobile/src/features/training/execution/application/RestTimerService.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { RestSignalPort } from "../apps/mobile/src/features/training/execution/domain/RestTimerPorts.ts";
import { adjustTimer, isFinished, pauseTimer, remainingSec, resumeTimer, runningTimers, startTimer } from
  "../apps/mobile/src/features/training/execution/domain/RestTimerRules.ts";
import { DEV_TRAINING_EXECUTION_LEDGER, devTrainingExecutionCatalog } from
  "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionCatalog.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
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

const bench = { clientId: "a", clientName: "SyntheticA", exerciseKey: "pe-bench", exerciseName: "Жим", durationSec: 180,
  programId: "prog-1", weekIndex: 2, plannedWorkoutId: "w-1" };

test("T03 правила таймера: новый запуск заменяет любой идущий (один таймер), ±15 не в прошлое", () => {
  const first = startTimer([], bench, "t1", T0);
  assert.equal(first.timer.endAt, T0 + 180_000);
  assert.deepEqual([first.timer.programId, first.timer.weekIndex, first.timer.plannedWorkoutId, first.timer.pausedLeftMs], ["prog-1", 2, "w-1", null],
    "происхождение для возврата в тренировку");
  const curl = startTimer(first.timers, { ...bench, exerciseKey: "pe-curl", exerciseName: "Сгибания", durationSec: 90 }, "t2", T0);
  assert.deepEqual(curl.timers.map((timer) => timer.id), ["t2"], "другое упражнение заменяет, а не добавляется");
  assert.deepEqual(curl.replaced.map((timer) => timer.id), ["t1"]);
  const otherClient = startTimer(curl.timers, { ...bench, clientId: "b", clientName: "SyntheticB", durationSec: 60, programId: "prog-2" }, "t3", T0 + 30_000);
  assert.deepEqual(otherClient.timers.map((timer) => [timer.id, timer.clientId, timer.programId]), [["t3", "b", "prog-2"]], "другой клиент — тоже один таймер");
  assert.equal(adjustTimer(first.timer, 15, T0).endAt, T0 + 195_000);
  assert.equal(adjustTimer(first.timer, -15, T0 + 170_000).endAt, T0 + 170_000, "−15 не делает время отрицательным");
  assert.equal(remainingSec(first.timer, T0 + 179_001), 1);
  assert.equal(remainingSec(first.timer, T0 + 200_000), 0);
  assert.throws(() => startTimer([], { ...bench, durationSec: 0 }, "t0", T0), { message: "REST_DURATION_INVALID" });
});

test("пауза: остаток замирает, продолжение считает окончание заново, ±15 на паузе меняет остаток, пауза не заканчивается", () => {
  const timer = startTimer([], bench, "t1", T0).timer;
  const paused = pauseTimer(timer, T0 + 60_000);
  assert.equal(paused.pausedLeftMs, 120_000);
  assert.equal(remainingSec(paused, T0 + 60_000), 120);
  assert.equal(remainingSec(paused, T0 + 500_000), 120, "время на паузе не идёт");
  assert.equal(isFinished(paused, T0 + 500_000), false);
  assert.equal(pauseTimer(paused, T0 + 70_000), paused, "повторная пауза ничего не меняет");
  assert.equal(adjustTimer(paused, 15, T0 + 70_000).pausedLeftMs, 135_000);
  assert.equal(adjustTimer(paused, -300, T0 + 70_000).pausedLeftMs, 1000, "на паузе остаётся не меньше секунды");
  const resumed = resumeTimer(paused, T0 + 200_000);
  assert.deepEqual([resumed.endAt, resumed.pausedLeftMs, resumed.signalId], [T0 + 320_000, null, null]);
  assert.equal(resumeTimer(timer, T0 + 10_000), timer, "идущий таймер не меняется");
  assert.equal(pauseTimer(timer, T0 + 180_000), timer, "закончившийся нельзя поставить на паузу");
  assert.equal(isFinished(timer, T0 + 180_000), true);
  assert.deepEqual(runningTimers([paused], T0 + 999_999_999).map((item) => item.id), ["t1"], "приостановленный не отсеивается как закончившийся");
});

test("T03 сервис: сигнал на endAt, ±15 переносит сигнал, новый запуск заменяет таймер и снимает его сигнал, «Пропустить» убирает таймер (§44.3, §44.9)", async () => {
  const { execution, close } = await stores();
  try {
    let now = T0;
    const signal = fakeSignal();
    const service = new RestTimerService(execution, signal.port, () => now);
    await service.start(bench);
    await service.idle();
    const a = service.list()[0]!;
    assert.deepEqual([...signal.scheduled.values()], [T0 + 180_000], "сигнал сразу при старте");
    now = T0 + 10_000;
    await service.adjust(a.id, 15);
    await service.idle();
    const moved = service.list()[0]!;
    assert.equal(moved.endAt, T0 + 195_000);
    assert.ok(signal.cancelled.includes(a.signalId!), "старый сигнал отменён");
    assert.equal(signal.scheduled.get(moved.signalId!), T0 + 195_000, "новый — на новое окончание");
    await service.start({ ...bench, clientId: "b", clientName: "SyntheticB", exerciseKey: "pe-row", durationSec: 90 });
    await service.idle();
    assert.equal(service.list().length, 1, "второй таймер не создаётся");
    assert.equal(service.list()[0]!.clientId, "b");
    assert.equal(signal.scheduled.has(moved.signalId!), false, "сигнал прежнего таймера снят");
    assert.deepEqual([...signal.scheduled.values()], [now + 90_000]);
    assert.equal((await execution.listTimers()).length, 1, "и в хранилище остался один");
    await service.skip(service.list()[0]!.id);
    assert.deepEqual(service.list(), []);
    assert.equal(signal.scheduled.size, 0);
  } finally { await close(); }
});

test("пауза в сервисе: снимает системный сигнал, переживает перезапуск приложения, продолжение ставит сигнал заново", async () => {
  const { execution, close } = await stores();
  try {
    let now = T0;
    const signal = fakeSignal();
    const service = new RestTimerService(execution, signal.port, () => now);
    await service.start(bench);
    await service.idle();
    now = T0 + 60_000;
    const id = service.list()[0]!.id;
    await service.pause(id);
    assert.equal(service.list()[0]!.pausedLeftMs, 120_000);
    assert.equal(signal.scheduled.size, 0, "на паузе сигнала нет");
    assert.equal((await execution.listTimers())[0]!.pausedLeftMs, 120_000, "пауза сохранена");
    now = T0 + 900_000;
    const restarted = new RestTimerService(execution, fakeSignal().port, () => now);
    await restarted.recover();
    assert.deepEqual(restarted.list().map((timer) => [timer.id, timer.pausedLeftMs]), [[id, 120_000]], "приостановленный не считается закончившимся");
    await service.adjust(id, 15);
    assert.equal(service.list()[0]!.pausedLeftMs, 135_000);
    await service.idle();
    assert.equal(signal.scheduled.size, 0, "коррекция на паузе сигнал не ставит");
    now = T0 + 1_000_000;
    await service.resume(id);
    await service.idle();
    const resumed = service.list()[0]!;
    assert.deepEqual([resumed.endAt, resumed.pausedLeftMs], [T0 + 1_135_000, null]);
    assert.deepEqual([...signal.scheduled.values()], [T0 + 1_135_000]);
    await service.resume(id);
    await service.pause("missing");
    assert.equal(service.list().length, 1, "повторные и неизвестные команды безопасны");
  } finally { await close(); }
});

test("T03 таймер без системного сигнала работает; после перезапуска приложения — прежний endAt и происхождение (§44.7, §44.14)", async () => {
  const { execution, close } = await stores();
  try {
    const before = new RestTimerService(execution, fakeSignal(false).port, () => T0);
    await before.start(bench);
    await before.idle();
    assert.equal(before.list().length, 1);
    assert.equal(before.list()[0]!.signalId, null, "нет разрешения на уведомления — таймер всё равно идёт");
    const after = new RestTimerService(execution, fakeSignal().port, () => T0 + 60_000);
    await after.recover();
    assert.deepEqual(after.list().map((timer) => [timer.exerciseKey, timer.endAt, timer.programId, timer.weekIndex, timer.plannedWorkoutId]),
      [["pe-bench", T0 + 180_000, "prog-1", 2, "w-1"]]);
    const late = new RestTimerService(execution, fakeSignal().port, () => T0 + 181_000);
    await late.recover();
    assert.deepEqual(late.list(), [], "закончившийся убран без перезапуска");
    assert.equal((await execution.listTimers()).length, 0);
  } finally { await close(); }
});

test("миграция v10: прежние таймеры сохраняются без происхождения и не на паузе; несколько старых записей сводятся к последней", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  await runMigrations(new WriterCoordinator(nodeSqlitePort(db)), devTrainingExecutionCatalog.filter((step) => step.version <= 9), DEV_TRAINING_EXECUTION_LEDGER);
  const insert = db.prepare("INSERT INTO dev_training_rest_timers (id, workspace_id, client_id, client_name, exercise_key, exercise_name, started_at, end_at, signal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)");
  insert.run("old-1", WS, "a", "SyntheticA", "pe-1", "Жим", T0, T0 + 600_000);
  insert.run("old-2", WS, "a", "SyntheticA", "pe-2", "Тяга", T0 + 5_000, T0 + 700_000);
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  try {
    const rows = await execution.listTimers();
    assert.deepEqual(rows.map((row) => [row.id, row.programId, row.weekIndex, row.plannedWorkoutId, row.pausedLeftMs]),
      [["old-1", null, null, null, null], ["old-2", null, null, null, null]]);
    const service = new RestTimerService(execution, fakeSignal().port, () => T0 + 10_000);
    await service.recover();
    assert.deepEqual(service.list().map((timer) => timer.id), ["old-2"], "остаётся последний запущенный");
    assert.deepEqual((await execution.listTimers()).map((row) => row.id), ["old-2"]);
  } finally { await execution.close(); await clients.close(); }
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

test("T03 таймер виден сразу, не дожидаясь сигнала; опоздавший сигнал после «Пропустить» отменяется (§44.9)", async () => {
  const { execution, close } = await stores();
  try {
    let release: (id: string) => void = () => undefined;
    const cancelled: string[] = [];
    const slow: RestSignalPort = {
      schedule: () => new Promise<string>((resolve) => { release = resolve; }),
      cancel: async (id) => { cancelled.push(id); },
    };
    const service = new RestTimerService(execution, slow, () => T0);
    await service.start(bench);
    assert.equal(service.list().length, 1, "отсчёт на экране, пока сигнал ещё ставится");
    assert.equal((await execution.listTimers()).length, 1, "и уже сохранён для восстановления");
    await service.skip(service.list()[0]!.id);
    release("late");
    await service.idle();
    assert.deepEqual(service.list(), []);
    assert.deepEqual(cancelled, ["late"], "сигнал, пришедший после «Пропустить», снят");
  } finally { await close(); }
});
