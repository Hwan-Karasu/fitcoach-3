import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { SetValues, TrackingMetric, WorkoutSlot } from "../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import { confirmationAfterSave, matchPrevious, nextOutcome, toggleConfirmation, weekStatus } from
  "../apps/mobile/src/features/training/execution/domain/ExecutionRules.ts";
import type { SaveSetInput } from "../apps/mobile/src/features/training/execution/domain/TrainingExecutionPort.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:synthetic-bench";
const LOAD_REPS: readonly TrackingMetric[] = ["load", "reps"];
const DAY1 = new Date(2026, 9, 17, 9, 0);
const DAY2 = new Date(2026, 9, 20, 9, 0);
const values = (loadGrams: number | null, reps: number | null): SetValues => ({ reps, loadGrams, durationSec: null, distanceM: null });
const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  const close = async () => { await execution.close(); await clients.close(); };
  return { db, clients, execution, close };
}

function bench(slot: WorkoutSlot, setId: string, position: number, set: SetValues,
  expectedRevision: number | null): SaveSetInput {
  return { slot, plannedExerciseId: "pe-bench", exerciseId: BENCH, plannedSetId: setId, position, metrics: LOAD_REPS,
    values: set, rpe: null, setType: "NORMAL", expectedRevision };
}

test("T03 правила подтверждения: авто по полным обязательным полям, ручная галочка обратима", () => {
  assert.deepEqual(confirmationAfterSave("AUTO", false, values(100_000, 8), LOAD_REPS), { confirmed: true, confirmedNow: true });
  assert.deepEqual(confirmationAfterSave("AUTO", true, values(105_000, 8), LOAD_REPS), { confirmed: true, confirmedNow: false },
    "правка без опустошения поля — без нового запуска таймера");
  assert.deepEqual(confirmationAfterSave("AUTO", true, values(null, 8), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.deepEqual(confirmationAfterSave("AUTO", false, values(0, 15), LOAD_REPS), { confirmed: true, confirmedNow: true },
    "0 кг — заполненное значение");
  assert.deepEqual(confirmationAfterSave("MANUAL", false, values(100_000, 8), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.deepEqual(confirmationAfterSave("MANUAL", true, values(100_000, null), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.deepEqual(toggleConfirmation(false, values(100_000, 8), LOAD_REPS), { confirmed: true, confirmedNow: true });
  assert.deepEqual(toggleConfirmation(true, values(100_000, 8), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.throws(() => toggleConfirmation(false, values(100_000, null), LOAD_REPS), message("INVALID_METRIC"));
  assert.equal(nextOutcome("COMPLETED", "COMPLETED"), null, "повторное нажатие снимает исход");
  assert.equal(nextOutcome("MISSED", "COMPLETED"), "COMPLETED");
});

test("T03 статус недели (§48.46.1) и «Пред.» по типу и порядку (§48.75.1)", () => {
  assert.equal(weekStatus(["COMPLETED", "MISSED", "CANCELLED"]), "CLOSED_WITH_DEVIATIONS");
  assert.equal(weekStatus(["COMPLETED", "COMPLETED", "COMPLETED"]), "COMPLETED");
  assert.equal(weekStatus(["COMPLETED", "MISSED", "IN_PROGRESS"]), "IN_PROGRESS");
  assert.equal(weekStatus(["NOT_STARTED", "NOT_STARTED"]), "NOT_STARTED");
  const source = [{ setType: "WARMUP", value: "w1" }, { setType: "WARMUP", value: "w2" }, { setType: "NORMAL", value: "n1" },
    { setType: "NORMAL", value: "n2" }, { setType: "NORMAL", value: "n3" }] as const;
  const current = [{ plannedSetId: "a", setType: "WARMUP" }, { plannedSetId: "b", setType: "NORMAL" },
    { plannedSetId: "c", setType: "NORMAL" }, { plannedSetId: "d", setType: "NORMAL" }] as const;
  assert.deepEqual([...matchPrevious(current, source)], [["a", "w1"], ["b", "n1"], ["c", "n2"], ["d", "n3"]],
    "разминка не сдвигает рабочие подходы");
  assert.deepEqual([...matchPrevious([{ plannedSetId: "x", setType: "NORMAL" }, { plannedSetId: "y", setType: "FAILURE" },
    { plannedSetId: "z", setType: "NORMAL" }], [{ setType: "NORMAL", value: 1 }, { setType: "WARMUP", value: 2 }])],
  [["x", 1]], "нет подходящего типа или номера — пусто, без подстановки соседнего");
});

test("T03 авто-режим: первый ввод начинает тренировку, правка — тот же факт, очистка и повтор — новый переход", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const slot: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    assert.equal(await execution.getConfirmationMode(), "AUTO", "режим по умолчанию — автоматический");
    assert.equal((await execution.getWorkout(slot)).session, null, "открытие дневника ничего не записывает");
    assert.deepEqual(await execution.getProgramStatuses(client.id, "program-a"), []);
    const first = await execution.saveSet(bench(slot, "s1", 0, values(100_000, 8), null), DAY1);
    assert.equal(first.fact.confirmed, true);
    assert.equal(first.confirmedNow, true);
    assert.equal(first.session.actualDate, "2026-10-17", "фактическая дата по умолчанию — сегодня");
    assert.deepEqual(await execution.getProgramStatuses(client.id, "program-a"),
      [{ weekIndex: 1, plannedWorkoutId: "w1", status: "IN_PROGRESS" }]);
    const fixed = await execution.saveSet(bench(slot, "s1", 0, values(105_000, 8), first.fact.revision), DAY1);
    assert.equal(fixed.fact.id, first.fact.id, "исправление — тот же факт");
    assert.equal(fixed.confirmedNow, false);
    const cleared = await execution.saveSet(bench(slot, "s1", 0, values(null, 8), fixed.fact.revision), DAY1);
    assert.equal(cleared.fact.confirmed, false);
    const again = await execution.saveSet(bench(slot, "s1", 0, values(105_000, 8), cleared.fact.revision), DAY1);
    assert.equal(again.confirmedNow, true, "повторное заполнение — новый переход");
    assert.equal(again.fact.id, first.fact.id);
    await assert.rejects(execution.saveSet(bench(slot, "s1", 0, values(110_000, 8), first.fact.revision), DAY1),
      message("STALE_SESSION"), "устаревшая ревизия не перезаписывает факт");
    await assert.rejects(execution.saveSet({ ...bench(slot, "s2", 1, values(100_000, 8), null), metrics: ["duration"] }, DAY1),
      message("INVALID_METRIC"), "лишнее для профиля поле");
  } finally { await close(); }
});

test("T03 ручной режим: значения не подтверждают, галочка обратима, неполный подход не подтверждается", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const slot: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    await execution.setConfirmationMode("MANUAL");
    assert.equal(await execution.getConfirmationMode(), "MANUAL");
    const filled = await execution.saveSet(bench(slot, "s1", 0, values(100_000, 8), null), DAY1);
    assert.equal(filled.fact.confirmed, false);
    const identity = { ...bench(slot, "s1", 0, values(null, null), filled.fact.revision) };
    const checked = await execution.toggleSetConfirmation(identity, DAY1);
    assert.equal(checked.confirmedNow, true);
    const unchecked = await execution.toggleSetConfirmation({ ...identity, expectedRevision: checked.fact.revision }, DAY1);
    assert.equal(unchecked.fact.confirmed, false);
    assert.equal(unchecked.fact.id, filled.fact.id, "снятие галочки не создаёт и не удаляет подход");
    const partial = await execution.saveSet(bench(slot, "s2", 1, values(100_000, null), null), DAY1);
    await assert.rejects(execution.toggleSetConfirmation({ ...identity, plannedSetId: "s2", position: 1,
      expectedRevision: partial.fact.revision }, DAY1), message("INVALID_METRIC"));
    await execution.setConfirmationMode("AUTO");
    assert.equal((await execution.getWorkout(slot)).facts.get("s1")?.confirmed, false,
      "смена режима не подтверждает подготовленные подходы");
  } finally { await close(); }
});

test("T03 исходы: переключатель без потери фактов, «Пропущена» без ввода, статус недели", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const w2: WorkoutSlot = { ...w1, plannedWorkoutId: "w2" };
    const saved = await execution.saveSet(bench(w1, "s1", 0, values(100_000, 8), null), DAY1);
    const completed = await execution.setOutcome(w1, "COMPLETED", saved.session.revision, DAY1);
    assert.equal(completed.outcome, "COMPLETED");
    const reopened = await execution.setOutcome(w1, null, completed.revision, DAY1);
    assert.equal(reopened.id, saved.session.id, "одно выполнение на слот");
    assert.equal((await execution.getWorkout(w1)).facts.get("s1")?.confirmed, true, "отмена завершения не удаляет факты");
    await execution.setOutcome(w1, "COMPLETED", reopened.revision, DAY1);
    const missed = await execution.setOutcome(w2, "MISSED", null, DAY1);
    assert.equal((await execution.getWorkout(w2)).facts.size, 0, "пропуск не создаёт фактов");
    await assert.rejects(execution.setOutcome(w2, null, null, DAY1), message("STALE_SESSION"));
    const statuses = await execution.getProgramStatuses(client.id, "program-a");
    assert.equal(weekStatus(statuses.map((item) => item.status)), "CLOSED_WITH_DEVIATIONS");
    await execution.setOutcome(w2, null, missed.revision, DAY1);
    const after = await execution.getProgramStatuses(client.id, "program-a");
    assert.equal(weekStatus(after.map((item) => item.status)), "IN_PROGRESS", "снятие исхода сразу открывает неделю");
    const dated = await execution.setActualDate(w1, "2026-10-16", (await execution.getWorkout(w1)).session!.revision, DAY1);
    assert.equal(dated.actualDate, "2026-10-16");
    await assert.rejects(execution.setActualDate(w1, "2026-02-30", dated.revision, DAY1), message("INVALID_METRIC"));
  } finally { await close(); }
});

test("T03 «Пред.»: только подтверждённые факты этого клиента в этой программе, сначала тот же слот", async () => {
  const { clients, execution, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const week = (clientId: string, programId: string, weekIndex: number, plannedWorkoutId = "w1"): WorkoutSlot =>
      ({ clientId, programId, weekIndex, plannedWorkoutId });
    await execution.saveSet(bench(week(a.id, "program-a", 1), "s1", 0, values(100_000, 8), null), DAY1);
    await execution.saveSet(bench(week(a.id, "program-a", 1), "s2", 1, values(100_000, 6), null), DAY1);
    await execution.saveSet(bench(week(a.id, "program-a", 1), "s3", 2, values(100_000, null), null), DAY1);
    await execution.saveSet(bench(week(b.id, "program-a", 1), "s1", 0, values(140_000, 5), null), DAY1);
    await execution.saveSet(bench(week(a.id, "program-b", 1), "s1", 0, values(120_000, 5), null), DAY2);
    const query = [{ plannedExerciseId: "pe-bench", exerciseId: BENCH, plannedSetIds: ["s1", "s2", "s3"] }];
    const previous = await execution.getPrevious(week(a.id, "program-a", 2), query, DAY2);
    assert.deepEqual([...previous].map(([id, set]) => [id, set.values.loadGrams, set.values.reps, set.date]),
      [["s1", 100_000, 8, "2026-10-17"], ["s2", 100_000, 6, "2026-10-17"]],
      "неподтверждённый третий подход, клиент B и программа B не источник");
    const ownWeek = await execution.getPrevious(week(a.id, "program-a", 1), query, DAY2);
    assert.equal(ownWeek.size, 0, "текущее выполнение — не своё «Пред.»");
    const otherDay = await execution.getPrevious(week(a.id, "program-a", 2, "w2"),
      [{ plannedExerciseId: "pe-bench-w2", exerciseId: BENCH, plannedSetIds: ["t1"] }], DAY2);
    assert.equal(otherDay.get("t1")?.values.reps, 8, "без того же слота — то же упражнение в другом дне программы");
  } finally { await close(); }
});

test("T03 схема и удаление клиента: подтверждение без значений запрещено, факты клиента удаляются с ним", async () => {
  const { db, clients, execution, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "SyntheticGone" });
    const kept = await clients.create({ displayName: "SyntheticKept" });
    const slot = (clientId: string): WorkoutSlot => ({ clientId, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" });
    const saved = await execution.saveSet(bench(slot(gone.id), "s1", 0, values(100_000, 8), null), DAY1);
    await execution.saveSet(bench(slot(kept.id), "s1", 0, values(90_000, 8), null), DAY1);
    assert.throws(() => db.prepare(`UPDATE dev_training_performed_sets SET reps = NULL, load_grams = NULL
      WHERE id = ?`).run(saved.fact.id), /CHECK/);
    assert.throws(() => db.prepare("UPDATE dev_training_performed_sets SET planned_set_id = 'other' WHERE id = ?")
      .run(saved.fact.id), /FACT_IDENTITY_FIXED/);
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.equal((await execution.getWorkout(slot(gone.id))).session, null);
    assert.equal((await execution.getWorkout(slot(kept.id))).facts.size, 1, "факты другого клиента на месте");
  } finally { await close(); }
});
