import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { importHistoricalFixture } from "./support/import-historical-fixture.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { RestTimerService } from "../apps/mobile/src/features/training/execution/application/RestTimerService.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { RestSignalPort } from "../apps/mobile/src/features/training/execution/domain/RestTimerPorts.ts";
import { adjustTimer, isFinished, nextFinishAt, pauseTimer, remainingSec, resumeTimer, runningTimers, startTimer } from
  "../apps/mobile/src/features/training/execution/domain/RestTimerRules.ts";
import { DEV_TRAINING_EXECUTION_LEDGER, devTrainingExecutionCatalog } from
  "./d01/history/DevTrainingExecutionCatalog.ts";
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

test("R06 idle waits for a queued start, its late OS signal, and the signalId DB update", async () => {
  let finishWrite!: () => void; let finishSignal!: (value: string) => void;
  const write = new Promise<void>((resolve) => { finishWrite = resolve; });
  const signal = new Promise<string>((resolve) => { finishSignal = resolve; });
  let writes = 0; let idleDone = false;
  const service = new RestTimerService({ listTimers: async () => [], removeTimer: async () => undefined,
    putTimer: async () => { if (++writes === 1) await write; } },
  { schedule: () => signal, cancel: async () => undefined }, () => T0, () => "synthetic-timer");
  const start = service.start(bench); const idle = service.idle().then(() => { idleDone = true; });
  await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(idleDone, false);
  finishWrite(); await start; await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(idleDone, false);
  finishSignal("synthetic-signal"); await idle;
  assert.equal(writes, 2); assert.equal(service.list()[0]?.signalId, "synthetic-signal");
});

test("R06 restore reconciles imported OS IDs without permission prompt, preserves paused timers/endAt and removes expired", async () => {
  const { execution, close } = await stores();
  try {
    const running = { ...startTimer([], bench, "restored-running", T0).timer, signalId: "another-install-running" };
    const paused = { ...running, id: "restored-paused", exerciseKey: "paused", signalId: "another-install-paused", pausedLeftMs: 45_000 };
    const expired = { ...running, id: "restored-expired", exerciseKey: "expired", startedAt: T0 - 180_000, endAt: T0 - 1, signalId: "another-install-expired" };
    for (const timer of [running, paused, expired]) await execution.putTimer(timer, []);
    const events: string[] = []; const scheduled: Parameters<RestSignalPort["schedule"]>[0][] = [];
    const service = new RestTimerService(execution, {
      clearOwned: async () => { events.push("clear-owned"); }, cancel: async (id) => { events.push(id); },
      schedule: async (input) => { scheduled.push(input); return "new-install-signal"; },
    }, () => T0 + 20_000);
    await service.recover({ reconcileSignals: true }); await service.idle();
    assert.deepEqual(events, ["clear-owned"], "imported OS IDs never cancel a calendar/other notification with a matching ID");
    assert.equal(scheduled.length, 1); assert.equal(scheduled[0]!.requestPermission, false);
    assert.equal(scheduled[0]!.endAt, running.endAt); assert.deepEqual(scheduled[0]!.route,
      { clientId: bench.clientId, programId: bench.programId, weekIndex: bench.weekIndex, plannedWorkoutId: bench.plannedWorkoutId, exerciseKey: bench.exerciseKey });
    const rows = await execution.listTimers(); assert.equal(rows.length, 2);
    assert.equal(rows.find((timer) => timer.id === running.id)?.signalId, "new-install-signal");
    assert.equal(rows.find((timer) => timer.id === paused.id)?.signalId, null);
    assert.equal(rows.find((timer) => timer.id === paused.id)?.pausedLeftMs, 45_000);
    assert.deepEqual(service.list(), runningTimers(rows, T0 + 20_000).map((timer) => ({ ...timer })));
  } finally { await close(); }
});

test("R06 suspend drains a late OS schedule before clearing signals and leaves persisted timer times intact", async () => {
  const { execution, close } = await stores();
  try {
    let release!: (id: string) => void; const events: string[] = [];
    const service = new RestTimerService(execution, { schedule: () => new Promise((resolve) => { release = resolve; }),
      cancel: async (id) => { events.push(`cancel:${id}`); }, clearOwned: async () => { events.push("clear"); } }, () => T0);
    await service.start(bench); const original = service.list()[0]!;
    let done = false; const suspending = service.suspendSignals().then(() => { done = true; });
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(done, false); assert.deepEqual(events, []);
    release("late-before-close"); await suspending;
    assert.deepEqual(events, ["clear"]);
    const stored = (await execution.listTimers())[0]!; assert.equal(stored.endAt, original.endAt); assert.equal(stored.signalId, "late-before-close");
  } finally { await close(); }
});

test("R06 unavailable OS signals still replace the old dock with restored timers and erase foreign signal IDs", async () => {
  const { execution, close } = await stores();
  try {
    const timer = { ...startTimer([], bench, "restored", T0).timer, signalId: "foreign-os-id" };
    await execution.putTimer(timer, []); let cancelled = false;
    const service = new RestTimerService(execution, { clearOwned: async () => { throw new Error("OS unavailable"); },
      schedule: async () => { throw new Error("permission unavailable"); }, cancel: async (id) => { cancelled = id === "foreign-os-id"; } }, () => T0 + 1000);
    await service.recover({ reconcileSignals: true });
    assert.equal(cancelled, false, "failed enumeration does not trust imported signal IDs"); assert.deepEqual(service.list(), [{ ...timer, signalId: null }]);
    assert.equal((await execution.listTimers())[0]!.signalId, null);
  } finally { await close(); }
});

test("R06 timer expiring during OS reconciliation is not scheduled again", async () => {
  const { execution, close } = await stores();
  try {
    const timer = startTimer([], bench, "expires-during-clear", T0).timer; await execution.putTimer(timer, []);
    let now = T0; let scheduled = false;
    const service = new RestTimerService(execution, { clearOwned: async () => { now = timer.endAt + 1; }, cancel: async () => undefined,
      schedule: async () => { scheduled = true; return "should-not-exist"; } }, () => now);
    await service.recover({ reconcileSignals: true }); assert.equal(scheduled, false); assert.deepEqual(service.list(), []); assert.deepEqual(await execution.listTimers(), []);
  } finally { await close(); }
});

test("R06 failed signal-ID persistence cancels the fresh OS signal and never leaves the previous dock", async () => {
  const { execution, close } = await stores();
  try {
    const timer = startTimer([], bench, "restored-new", T0).timer; await execution.putTimer(timer, []);
    const cancelled: string[] = [];
    const service = new RestTimerService({ listTimers: () => execution.listTimers(), removeTimer: (id) => execution.removeTimer(id),
      putTimer: async () => { throw new Error("SQLITE_BUSY"); } }, { clearOwned: async () => undefined,
      schedule: async () => "new-orphan", cancel: async (id) => { cancelled.push(id); } }, () => T0);
    await assert.rejects(service.recover({ reconcileSignals: true }), { message: "SQLITE_BUSY" });
    assert.deepEqual(cancelled, ["new-orphan"]); assert.deepEqual(service.list(), [timer]);
  } finally { await close(); }
});

test("R06 pause cancels an OS signal that arrives after the pause with unchanged endAt", async () => {
  const { execution, close } = await stores();
  try {
    let release!: (id: string) => void; const cancelled: string[] = [];
    const service = new RestTimerService(execution, { schedule: () => new Promise((resolve) => { release = resolve; }),
      cancel: async (id) => { cancelled.push(id); } }, () => T0);
    await service.start(bench); const id = service.list()[0]!.id;
    await service.pause(id); release("late-paused"); await service.idle();
    assert.deepEqual(cancelled, ["late-paused"]); assert.equal((await execution.listTimers())[0]!.signalId, null);
    assert.equal((await execution.listTimers())[0]!.pausedLeftMs, 180_000);
  } finally { await close(); }
});

test("T03 правила таймера: перезапуск того же упражнения того же участника, остальные независимы, ±15 не в прошлое, ближайший первым", () => {
  const first = startTimer([], bench, "t1", T0);
  assert.equal(first.timer.endAt, T0 + 180_000);
  assert.deepEqual([first.timer.programId, first.timer.weekIndex, first.timer.plannedWorkoutId, first.timer.pausedLeftMs], ["prog-1", 2, "w-1", null],
    "происхождение для возврата в тренировку");
  const curl = startTimer(first.timers, { ...bench, exerciseKey: "pe-curl", exerciseName: "Сгибания", durationSec: 90 }, "t2", T0);
  const otherClient = startTimer(curl.timers, { ...bench, clientId: "b", clientName: "SyntheticB", durationSec: 60 }, "t3", T0);
  assert.equal(otherClient.timers.length, 3, "другое упражнение и другой участник — свои таймеры");
  assert.deepEqual(otherClient.replaced, []);
  const restart = startTimer(otherClient.timers, bench, "t4", T0 + 30_000);
  assert.deepEqual(restart.replaced.map((timer) => timer.id), ["t1"], "тот же участник и упражнение — перезапуск только своего таймера");
  assert.deepEqual(runningTimers(restart.timers, T0 + 30_000).map((timer) => timer.id), ["t3", "t2", "t4"]);
  assert.equal(adjustTimer(first.timer, 15, T0).endAt, T0 + 195_000);
  assert.equal(adjustTimer(first.timer, -15, T0 + 170_000).endAt, T0 + 170_000, "−15 не делает время отрицательным");
  assert.equal(remainingSec(first.timer, T0 + 179_001), 1);
  assert.equal(remainingSec(first.timer, T0 + 200_000), 0);
  assert.throws(() => startTimer([], { ...bench, durationSec: 0 }, "t0", T0), { message: "REST_DURATION_INVALID" });
});

test("PERF-REST-DOCK панель просыпается только к ближайшему окончанию идущего таймера; пауза и закончившиеся не будят", () => {
  const bench180 = startTimer([], bench, "t1", T0);
  const curl90 = startTimer(bench180.timers, { ...bench, exerciseKey: "pe-curl", durationSec: 90 }, "t2", T0);
  assert.equal(nextFinishAt(curl90.timers, T0), T0 + 90_000, "ближайшее окончание — сгибания через 90 с");
  assert.equal(nextFinishAt(curl90.timers, T0 + 90_000), T0 + 180_000, "закончившийся таймер больше не будит");
  const paused = curl90.timers.map((timer) => timer.id === "t2" ? pauseTimer(timer, T0 + 10_000) : timer);
  assert.equal(nextFinishAt(paused, T0 + 10_000), T0 + 180_000, "таймер на паузе не заканчивается");
  assert.equal(nextFinishAt(paused, T0 + 180_000), null);
  assert.equal(nextFinishAt([], T0), null);
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

test("T03 сервис: у каждого таймера свой сигнал; ±15, пауза и «Пропустить» одного не трогают другой; повтор подхода перезапускает только свой (§48.62, §48.64, §44.9)", async () => {
  const { execution, close } = await stores();
  try {
    let now = T0;
    const signal = fakeSignal();
    const service = new RestTimerService(execution, signal.port, () => now);
    await service.start(bench);
    await service.start({ ...bench, clientId: "b", clientName: "SyntheticB", exerciseKey: "pe-row", durationSec: 90 });
    await service.idle();
    const [a, b] = [service.list().find((timer) => timer.clientId === "a")!, service.list().find((timer) => timer.clientId === "b")!];
    assert.deepEqual([...signal.scheduled.values()].sort(), [T0 + 90_000, T0 + 180_000], "сигнал у каждого сразу при старте");
    now = T0 + 10_000;
    await service.adjust(a.id, 15);
    await service.idle();
    const moved = service.list().find((timer) => timer.id === a.id)!;
    assert.equal(moved.endAt, T0 + 195_000);
    assert.ok(signal.cancelled.includes(a.signalId!), "старый сигнал отменён");
    assert.equal(signal.scheduled.get(moved.signalId!), T0 + 195_000, "новый — на новое окончание");
    assert.equal(service.list().find((timer) => timer.id === b.id)!.endAt, T0 + 90_000, "таймер B не сдвинулся");
    await service.pause(a.id);
    assert.equal(service.list().find((timer) => timer.id === b.id)!.pausedLeftMs, null, "пауза A не останавливает B");
    await service.resume(a.id);
    await service.skip(b.id);
    await service.idle();
    assert.deepEqual(service.list().map((timer) => timer.id), [a.id], "«Пропустить» у B не трогает A");
    assert.equal(signal.scheduled.has(b.signalId!), false);
    await service.start(bench);
    await service.idle();
    assert.equal(service.list().length, 1, "повторное подтверждение того же упражнения — перезапуск его таймера, не второй таймер");
    assert.equal(service.list()[0]!.endAt, now + 180_000);
    assert.equal((await execution.listTimers()).length, 1);
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

test("T03 таймеры без системного сигнала работают; после перезапуска приложения идущие возвращаются с прежним endAt и происхождением, закончившиеся убираются (§44.7, §44.14)", async () => {
  const { execution, close } = await stores();
  try {
    const before = new RestTimerService(execution, fakeSignal(false).port, () => T0);
    await before.start(bench);
    await before.start({ ...bench, exerciseKey: "pe-short", durationSec: 30 });
    await before.idle();
    assert.equal(before.list().length, 2);
    assert.equal(before.list()[0]!.signalId, null, "нет разрешения на уведомления — таймер всё равно идёт");
    const after = new RestTimerService(execution, fakeSignal().port, () => T0 + 60_000);
    await after.recover();
    assert.deepEqual(after.list().map((timer) => [timer.exerciseKey, timer.endAt, timer.programId, timer.weekIndex, timer.plannedWorkoutId]),
      [["pe-bench", T0 + 180_000, "prog-1", 2, "w-1"]], "идущий восстановлен, закончившийся убран без перезапуска");
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

test("миграция v10: прежние таймеры сохраняются без происхождения и не на паузе, идущие восстанавливаются", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  await runMigrations(new WriterCoordinator(nodeSqlitePort(db)), devTrainingExecutionCatalog.filter((step) => step.version <= 9), DEV_TRAINING_EXECUTION_LEDGER);
  const insert = db.prepare("INSERT INTO training_rest_timers (id, workspace_id, client_id, client_name, exercise_key, exercise_name, started_at, end_at, signal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)");
  insert.run("old-1", WS, "a", "SyntheticA", "pe-1", "Жим", T0, T0 + 600_000);
  insert.run("old-2", WS, "a", "SyntheticA", "pe-2", "Тяга", T0 + 5_000, T0 + 700_000);
  const imported = await importHistoricalFixture(db, devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER);
  const execution = new DevTrainingExecutionRepository(imported.shared, WS);
  await execution.initialize();
  try {
    const rows = await execution.listTimers();
    assert.deepEqual(rows.map((row) => [row.id, row.programId, row.weekIndex, row.plannedWorkoutId, row.pausedLeftMs]),
      [["old-1", null, null, null, null], ["old-2", null, null, null, null]]);
    const service = new RestTimerService(execution, fakeSignal().port, () => T0 + 10_000);
    await service.recover();
    assert.deepEqual(service.list().map((timer) => timer.id), ["old-1", "old-2"], "оба идущих восстановлены независимо");
  } finally { await execution.close(); await clients.close(); }
});

test("AUD-03 сбой записи в хранилище откатывает экран: пауза, продолжение и ±15 не расходятся с базой", async () => {
  const { execution, close } = await stores();
  try {
    let fail = false;
    const flaky = {
      listTimers: () => execution.listTimers(),
      putTimer: (timer: Parameters<typeof execution.putTimer>[0], replaced: readonly string[]) => fail ? Promise.reject(new Error("SQLITE_BUSY")) : execution.putTimer(timer, replaced),
      removeTimer: (id: string) => execution.removeTimer(id),
    };
    const service = new RestTimerService(flaky, fakeSignal().port, () => T0 + 10_000);
    await service.start(bench);
    await service.idle();
    const id = service.list()[0]!.id;
    const before = service.list()[0]!;
    fail = true;
    await assert.rejects(service.pause(id), { message: "SQLITE_BUSY" });
    assert.equal(service.list()[0]!.pausedLeftMs, null, "пауза не показана, раз не записана");
    await assert.rejects(service.adjust(id, 15), { message: "SQLITE_BUSY" });
    assert.equal(service.list()[0]!.endAt, before.endAt, "±15 не применены");
    fail = false;
    await service.pause(id);
    fail = true;
    await assert.rejects(service.resume(id), { message: "SQLITE_BUSY" });
    assert.notEqual(service.list()[0]!.pausedLeftMs, null, "продолжение не показано, раз не записано");
    assert.equal((await execution.listTimers())[0]!.pausedLeftMs, service.list()[0]!.pausedLeftMs, "экран и база совпадают");
  } finally { await close(); }
});
