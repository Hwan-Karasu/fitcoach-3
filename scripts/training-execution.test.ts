import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { SetValues, TrackingMetric, WorkoutSlot } from "../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import { assertDropStructure, confirmationAfterSave, displayOrder, dropsForType, isSetComplete, matchPrevious, nextOutcome,
  endInstantAfter, instantFromLocal, localMinuteOfDay, sessionDurationSec, sidesAfterSave, toggleConfirmation, toggleSide, weekStatus, type SetContent } from
  "../apps/mobile/src/features/training/execution/domain/ExecutionRules.ts";
import type { SaveSetInput } from "../apps/mobile/src/features/training/execution/domain/TrainingExecutionPort.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER } from
  "./d01/history/DevTrainingExecutionCatalog.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:synthetic-bench";
const LOAD_REPS: readonly TrackingMetric[] = ["load", "reps"];
const DAY1 = new Date(2026, 9, 17, 9, 0);
const DAY2 = new Date(2026, 9, 20, 9, 0);
const values = (loadGrams: number | null, reps: number | null): SetValues => ({ reps, loadGrams, durationSec: null, distanceM: null });
const plain = (set: SetValues): SetContent => ({ setType: "NORMAL", values: set, drops: [] });
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
    values: set, drops: [], rpe: null, setType: "NORMAL", expectedRevision };
}

test("T03 правила подтверждения: авто по полным обязательным полям, ручная галочка обратима", () => {
  assert.deepEqual(confirmationAfterSave("AUTO", false, plain(values(100_000, 8)), LOAD_REPS), { confirmed: true, confirmedNow: true });
  assert.deepEqual(confirmationAfterSave("AUTO", true, plain(values(105_000, 8)), LOAD_REPS), { confirmed: true, confirmedNow: false },
    "правка без опустошения поля — без нового запуска таймера");
  assert.deepEqual(confirmationAfterSave("AUTO", true, plain(values(null, 8)), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.deepEqual(confirmationAfterSave("AUTO", false, plain(values(0, 15)), LOAD_REPS), { confirmed: true, confirmedNow: true },
    "0 кг — заполненное значение");
  assert.deepEqual(confirmationAfterSave("MANUAL", false, plain(values(100_000, 8)), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.deepEqual(confirmationAfterSave("MANUAL", true, plain(values(100_000, null)), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.deepEqual(toggleConfirmation(false, plain(values(100_000, 8)), LOAD_REPS), { confirmed: true, confirmedNow: true });
  assert.deepEqual(toggleConfirmation(true, plain(values(100_000, 8)), LOAD_REPS), { confirmed: false, confirmedNow: false });
  assert.throws(() => toggleConfirmation(false, plain(values(100_000, null)), LOAD_REPS), message("INVALID_METRIC"));
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

test("T03 «Пред.»: только подтверждённые факты того же слота прошлой недели этого клиента и программы", async () => {
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
    assert.equal(otherDay.size, 0, "нет соответствующей тренировки прошлой недели — другие дни не подставляются");
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
    assert.throws(() => db.prepare(`UPDATE training_performed_sets SET reps = NULL, load_grams = NULL
      WHERE id = ?`).run(saved.fact.id), /CHECK/);
    assert.throws(() => db.prepare("UPDATE training_performed_sets SET planned_set_id = 'other' WHERE id = ?")
      .run(saved.fact.id), /FACT_IDENTITY_FIXED/);
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.equal((await execution.getWorkout(slot(gone.id))).session, null);
    assert.equal((await execution.getWorkout(slot(kept.id))).facts.size, 1, "факты другого клиента на месте");
  } finally { await close(); }
});

test("T03 дроп-сет: полон с мини-сетами, состав выполненного заморожен, разминка — первой (§48.57–48.61)", () => {
  const drop: SetContent = { setType: "DROP", values: values(100_000, 8), drops: [values(80_000, 6), values(60_000, null)] };
  assert.equal(isSetComplete(drop, LOAD_REPS), false, "незаполненный мини-сет — подход не выполнен");
  assert.equal(isSetComplete({ ...drop, drops: [values(80_000, 6)] }, LOAD_REPS), true);
  assert.equal(isSetComplete({ ...drop, drops: [] }, LOAD_REPS), false, "дроп без мини-сетов — не дроп");
  const was = { confirmed: true, setType: "DROP" as const, dropCount: 1 };
  assert.throws(() => assertDropStructure(was, { ...drop, drops: [values(80_000, 6), values(60_000, 4)] }),
    message("DROP_STRUCTURE_LOCKED"), "добавить мини-сет в выполненный дроп нельзя");
  assert.throws(() => assertDropStructure(was, plain(values(100_000, 8))), message("DROP_STRUCTURE_LOCKED"));
  assert.doesNotThrow(() => assertDropStructure(was, { ...drop, drops: [values(75_000, 6)] }), "числа исправлять можно");
  assert.doesNotThrow(() => assertDropStructure({ ...was, confirmed: false }, plain(values(100_000, 8))));
  assert.deepEqual(dropsForType("DROP", []).length, 1, "новый дроп получает пустой мини-сет");
  assert.deepEqual(dropsForType("FAILURE", [values(1, 1)]), []);
  const order = displayOrder([{ id: "a", setType: "NORMAL" }, { id: "b", setType: "FAILURE" }, { id: "c", setType: "WARMUP" },
    { id: "d", setType: "DROP" }] as const);
  assert.deepEqual(order.map(({ item, number }) => [item.id, number]), [["c", null], ["a", 1], ["b", 2], ["d", 3]],
    "разминка наверху без номера, отказной и дроп сохраняют номер");
});

test("T03 дроп-сет в хранилище: подтверждение после всех мини-сетов, запрет смены состава, «Пред.» с мини-сетами", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const dropInput = (slot: WorkoutSlot, drops: readonly SetValues[], expectedRevision: number | null): SaveSetInput =>
      ({ ...bench(slot, "s1", 0, values(100_000, 8), expectedRevision), setType: "DROP", drops });
    const partial = await execution.saveSet(dropInput(w1, [values(80_000, null)], null), DAY1);
    assert.equal(partial.fact.confirmed, false, "мини-сет не заполнен — подход не выполнен");
    const full = await execution.saveSet(dropInput(w1, [values(80_000, 6)], partial.fact.revision), DAY1);
    assert.equal(full.confirmedNow, true, "один переход на весь дроп-сет");
    assert.deepEqual(full.fact.drops, [values(80_000, 6)]);
    await assert.rejects(execution.saveSet(dropInput(w1, [values(80_000, 6), values(60_000, 4)], full.fact.revision), DAY1),
      message("DROP_STRUCTURE_LOCKED"));
    await assert.rejects(execution.saveSet({ ...bench(w1, "s1", 0, values(100_000, 8), full.fact.revision) }, DAY1),
      message("DROP_STRUCTURE_LOCKED"), "сменить тип выполненного дропа нельзя");
    const fixed = await execution.saveSet(dropInput(w1, [values(75_000, 6)], full.fact.revision), DAY1);
    assert.equal(fixed.fact.id, full.fact.id);
    assert.equal(fixed.confirmedNow, false, "исправление числа — без нового перехода");
    assert.deepEqual((await execution.getWorkout(w1)).facts.get("s1")?.drops, [values(75_000, 6)]);
    await assert.rejects(execution.saveSet({ ...bench(w1, "s2", 1, values(100_000, 8), null), drops: [values(1, 1)] }, DAY1),
      message("INVALID_METRIC"), "мини-сеты только у дроп-сета");
    const w2: WorkoutSlot = { ...w1, weekIndex: 2 };
    const drafted = await execution.saveSet(dropInput(w2, [values(null, null)], null), DAY2);
    assert.equal(drafted.fact.confirmed, false);
    const previous = await execution.getPrevious(w2, [{ plannedExerciseId: "pe-bench", exerciseId: BENCH,
      plannedSetIds: ["s1"] }], DAY2);
    assert.deepEqual(previous.get("s1")?.drops, [values(75_000, 6)], "дроп сопоставляется с дропом вместе с мини-сетами");
  } finally { await close(); }
});

test("T03 миграция v2 сохраняет факты v1 и разрешает тип DROP", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const { writer } = await shared.acquire();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await runMigrations(writer, devTrainingExecutionCatalog.slice(0, 1), DEV_TRAINING_EXECUTION_LEDGER);
    db.prepare(`INSERT INTO training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id,
      actual_date, revision, created_at, updated_at) VALUES ('ses', ?, ?, 'p', 1, 'w', '2026-10-17', 1, 'x', 'x')`).run(WS, client.id);
    db.prepare(`INSERT INTO training_performed_sets (id, workspace_id, session_id, planned_set_id, planned_exercise_id,
      exercise_id, position, set_type, reps, load_grams, confirmed_at, origin, revision, updated_at)
      VALUES ('f1', ?, 'ses', 's1', 'pe', ?, 0, 'NORMAL', 8, 100000, 'x', 'INPUT', 1, 'x')`).run(WS, BENCH);
    await runMigrations(writer, devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER);
    const row = db.prepare("SELECT reps, load_grams AS load, confirmed_at AS at FROM training_performed_sets WHERE id = 'f1'").get();
    assert.deepEqual({ ...row }, { reps: 8, load: 100000, at: "x" });
    db.prepare("UPDATE training_performed_sets SET set_type = 'DROP' WHERE id = 'f1'").run();
    assert.throws(() => db.prepare("UPDATE training_performed_sets SET planned_set_id = 'z' WHERE id = 'f1'").run(),
      /FACT_IDENTITY_FIXED/, "триггер неизменности восстановлен");
  } finally {
    await shared.release();
    await clients.close();
  }
});

test("T03 «Пред.»: логическая предыдущая неделя, даже если обе тренировки проведены в один день", async () => {
  const { clients, execution, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const week = (weekIndex: number): WorkoutSlot => ({ clientId: a.id, programId: "program-a", weekIndex, plannedWorkoutId: "w1" });
    const query = [{ plannedExerciseId: "pe-bench", exerciseId: BENCH, plannedSetIds: ["s1"] }];
    const morning = new Date(2026, 9, 17, 9, 0);
    const evening = new Date(2026, 9, 17, 19, 0);
    await execution.saveSet(bench(week(1), "s1", 0, values(100_000, 8), null), morning);
    await execution.saveSet(bench(week(2), "s1", 0, values(110_000, 6), null), evening);
    assert.equal((await execution.getPrevious(week(2), query, evening)).get("s1")?.values.loadGrams, 100_000,
      "вечером «Пред.» — утреннее выполнение");
    assert.equal((await execution.getPrevious(week(1), query, evening)).size, 0,
      "у утреннего выполнения вечернее не становится «прошлым»");
  } finally { await close(); }
});

test("T03 разминка — новый подход сверху, плановые не меняются; удаление прячет только его (как в 2.0)", async () => {
  const { clients, execution, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: a.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const w2: WorkoutSlot = { ...w1, weekIndex: 2 };
    const where = { plannedExerciseId: "pe-bench", exerciseId: BENCH };
    await execution.saveSet(bench(w1, "s1", 0, values(100_000, 8), null), DAY1);
    const warm = await execution.addWarmupSet(w1, where, DAY1);
    assert.equal(warm.fact.setType, "WARMUP");
    assert.equal(warm.fact.extra, true, "дополнительный подход, не плановый");
    const after = await execution.getWorkout(w1);
    assert.equal(after.facts.get("s1")?.setType, "NORMAL", "плановый подход остался обычным");
    assert.equal([...after.facts.values()].filter((fact) => fact.extra).length, 1);
    const filled = await execution.saveSet({ ...bench(w1, warm.fact.plannedSetId, warm.fact.position, values(40_000, 12),
      warm.fact.revision), setType: "WARMUP" }, DAY1);
    assert.equal(filled.fact.id, warm.fact.id);
    await assert.rejects(execution.saveSet({ ...bench(w1, warm.fact.plannedSetId, warm.fact.position, values(40_000, 12),
      filled.fact.revision), setType: "NORMAL" }, DAY1), message("INVALID_METRIC"), "дополнительный — всегда разминочный");

    const previous = await execution.getPrevious(w2, [{ ...where, plannedSetIds: ["s1"] }], DAY2);
    assert.equal(previous.get("s1")?.values.reps, 8, "разминка прошлого раза не сдвигает рабочий подход");
    const nextWarm = await execution.addWarmupSet(w2, where, DAY2);
    const warmPrevious = await execution.getPrevious(w2, [{ ...where, plannedSetIds: [nextWarm.fact.plannedSetId, "s1"] }], DAY2);
    assert.equal(warmPrevious.get(nextWarm.fact.plannedSetId)?.values.loadGrams, 40_000, "разминка — с разминкой");

    await execution.removeWarmupSet(w1, filled.fact.plannedSetId, filled.fact.revision, DAY1);
    const removed = await execution.getWorkout(w1);
    assert.equal(removed.facts.has(filled.fact.plannedSetId), false, "удалённая разминка не видна");
    assert.equal(removed.facts.get("s1")?.values.reps, 8, "плановые подходы на месте");
    const noWarm = await execution.getPrevious(w2, [{ ...where, plannedSetIds: [nextWarm.fact.plannedSetId] }], DAY2);
    assert.equal(noWarm.size, 0, "удалённая разминка не источник «Пред.»");
    await assert.rejects(execution.removeWarmupSet(w1, "s1", removed.facts.get("s1")!.revision, DAY1),
      message("INVALID_METRIC"), "плановый подход так не удаляется");
  } finally { await close(); }
});

const EMPTY = values(null, null);
const sided = (slot: WorkoutSlot, left: SetValues, right: SetValues, expectedRevision: number | null): SaveSetInput =>
  ({ ...bench(slot, "s1", 0, EMPTY, expectedRevision), sides: { left, right } });

test("T03 стороны — правила: каждая засчитывается отдельно (§48.76), галочка своей стороны", () => {
  const change = sidesAfterSave("AUTO", { left: false, right: false }, { left: values(10_000, 8), right: EMPTY }, LOAD_REPS);
  assert.deepEqual(change, { left: { confirmed: true, confirmedNow: true }, right: { confirmed: false, confirmedNow: false } });
  const manual = sidesAfterSave("MANUAL", { left: false, right: false }, { left: values(10_000, 8), right: values(12_000, 10) },
    LOAD_REPS);
  assert.equal(manual.left.confirmed || manual.right.confirmed, false, "в ручном режиме цифры не засчитывают");
  const toggled = toggleSide({ left: false, right: false }, { left: values(10_000, 8), right: values(12_000, 10) }, "R", LOAD_REPS);
  assert.deepEqual(toggled, { left: { confirmed: false, confirmedNow: false }, right: { confirmed: true, confirmedNow: true } });
  assert.throws(() => toggleSide({ left: false, right: false }, { left: values(10_000, null), right: EMPTY }, "L", LOAD_REPS),
    message("INVALID_METRIC"));
});

test("T03 стороны в хранилище: один подход с двумя сторонами, частичное выполнение, «Пред.» по сторонам (§48.70–48.81)", async () => {
  const { clients, execution, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: a.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const left = await execution.saveSet(sided(w1, values(10_000, 8), EMPTY, null), DAY1);
    assert.equal(left.fact.confirmed, true, "одна засчитанная сторона — подход частично выполнен, но засчитан");
    assert.equal(left.fact.sides?.left.confirmed, true);
    assert.equal(left.fact.sides?.right.confirmed, false);
    assert.equal(left.confirmedNow, true);
    assert.deepEqual(await execution.getProgramStatuses(a.id, "program-a"), [{ weekIndex: 1, plannedWorkoutId: "w1", status: "IN_PROGRESS" }]);
    const both = await execution.saveSet(sided(w1, values(10_000, 8), values(12_000, 10), left.fact.revision), DAY1);
    assert.equal(both.fact.id, left.fact.id, "вторая сторона — тот же подход, не второй");
    assert.equal(both.confirmedNow, true, "новая засчитанная сторона — повод перезапустить таймер");
    const fixed = await execution.saveSet(sided(w1, values(10_000, 8), values(13_000, 10), both.fact.revision), DAY1);
    assert.equal(fixed.confirmedNow, false, "исправление числа стороны — без нового перехода");
    const cleared = await execution.saveSet(sided(w1, values(10_000, null), values(13_000, 10), fixed.fact.revision), DAY1);
    assert.equal(cleared.fact.sides?.left.confirmed, false, "очистка поля снимает отметку только этой стороны");
    assert.equal(cleared.fact.confirmed, true, "правая засчитана — подход по-прежнему засчитан");
    await assert.rejects(execution.saveSet({ ...sided(w1, EMPTY, EMPTY, cleared.fact.revision), setType: "DROP",
      drops: [EMPTY] }, DAY1), message("INVALID_METRIC"), "дроп-сет со сторонами — пока нет");
    await assert.rejects(execution.saveSet({ ...sided(w1, EMPTY, EMPTY, cleared.fact.revision), values: values(1, 1) }, DAY1),
      message("INVALID_METRIC"), "у одностороннего значения только в сторонах");

    const w2: WorkoutSlot = { ...w1, weekIndex: 2 };
    const previous = await execution.getPrevious(w2, [{ plannedExerciseId: "pe-bench", exerciseId: BENCH, plannedSetIds: ["s1"] }], DAY2);
    assert.deepEqual(previous.get("s1")?.sides, { left: null, right: values(13_000, 10) },
      "в «Пред.» — только засчитанная сторона, другая не выдумывается");

    await execution.setConfirmationMode("MANUAL");
    const w3: WorkoutSlot = { ...w1, weekIndex: 3 };
    const typed = await execution.saveSet(sided(w3, values(10_000, 8), values(12_000, 10), null), DAY2);
    assert.equal(typed.fact.confirmed, false);
    const identity = { ...bench(w3, "s1", 0, EMPTY, typed.fact.revision) };
    const right = await execution.toggleSetConfirmation(identity, DAY2, "R");
    assert.deepEqual([right.fact.sides?.left.confirmed, right.fact.sides?.right.confirmed, right.fact.confirmed], [false, true, true]);
  } finally { await close(); }
});

test("T03 миграция v5 дневника: стороны, прежние подходы и мини-сеты сохранены", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const { writer } = await shared.acquire();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await runMigrations(writer, devTrainingExecutionCatalog.slice(0, 4), DEV_TRAINING_EXECUTION_LEDGER);
    db.prepare(`INSERT INTO training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id,
      actual_date, revision, created_at, updated_at) VALUES ('ses', ?, ?, 'p', 1, 'w', '2026-10-17', 1, 'x', 'x')`).run(WS, client.id);
    db.prepare(`INSERT INTO training_performed_sets (id, workspace_id, session_id, planned_set_id, planned_exercise_id,
      exercise_id, position, set_type, reps, load_grams, confirmed_at, origin, revision, updated_at)
      VALUES ('f1', ?, 'ses', 's1', 'pe', ?, 0, 'DROP', 8, 100000, 'x', 'INPUT', 1, 'x')`).run(WS, BENCH);
    db.prepare("INSERT INTO training_performed_drops (workspace_id, set_id, position, reps, load_grams) VALUES (?, 'f1', 2, 6, 80000)").run(WS);
    await runMigrations(writer, devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER);
    assert.deepEqual({ ...db.prepare("SELECT reps, set_type AS type FROM training_performed_sets WHERE id = 'f1'").get() },
      { reps: 8, type: "DROP" });
    assert.deepEqual({ ...db.prepare("SELECT reps FROM training_performed_drops WHERE set_id = 'f1'").get() }, { reps: 6 });
    assert.throws(() => db.prepare("INSERT INTO training_performed_drops (workspace_id, set_id, position) VALUES (?, 'nope', 3)")
      .run(WS), /FOREIGN KEY|INVALID_METRIC/, "мини-сет без подхода — ошибка");
    assert.throws(() => db.prepare("UPDATE training_performed_sets SET planned_set_id = 'z' WHERE id = 'f1'").run(),
      /FACT_IDENTITY_FIXED/, "триггеры восстановлены");
    assert.throws(() => db.prepare(`INSERT INTO training_performed_sides (workspace_id, set_id, side, confirmed_at)
      VALUES (?, 'f1', 'L', 'x')`).run(WS), /CHECK/, "засчитанная сторона без значения невозможна");
  } finally {
    await shared.release();
    await clients.close();
  }
});

test("T03 заметка о выполнении (§48.67): своя у упражнения в каждой тренировке, не начинает тренировку сама", async () => {
  const { clients, execution, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: a.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const w2: WorkoutSlot = { ...w1, weekIndex: 2 };
    await execution.saveExerciseNote(w1, "pe-bench", "  Болело плечо, снизили вес  ", DAY1);
    assert.equal((await execution.getWorkout(w1)).notes.get("pe-bench"), "Болело плечо, снизили вес");
    assert.equal((await execution.getWorkout(w2)).notes.size, 0, "заметка не переходит в другую неделю");
    await execution.saveExerciseNote(w1, "pe-bench", "Хорошо", DAY1);
    assert.equal((await execution.getWorkout(w1)).notes.get("pe-bench"), "Хорошо", "правка — та же заметка");
    await execution.saveExerciseNote(w1, "pe-bench", "  ", DAY1);
    assert.equal((await execution.getWorkout(w1)).notes.has("pe-bench"), false, "пустая — убирается");
    await assert.rejects(execution.saveExerciseNote(w1, "pe-bench", "x".repeat(1001), DAY1), message("INVALID_METRIC"));
  } finally { await close(); }
});

test("T03 удаление выполнения тренировки (§48.30): факты, мини-сеты, стороны и заметки уходят, другие недели на месте", async () => {
  const { clients, execution, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: a.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const w2: WorkoutSlot = { ...w1, weekIndex: 2 };
    await execution.saveSet(bench(w1, "s1", 0, values(100_000, 8), null), DAY1);
    await execution.saveSet({ ...bench(w1, "s2", 1, values(100_000, 8), null), setType: "DROP", drops: [values(80_000, 6)] }, DAY1);
    await execution.saveSet({ ...bench(w1, "s3", 2, values(null, null), null), sides: { left: values(10_000, 8), right: values(null, null) } }, DAY1);
    await execution.saveExerciseNote(w1, "pe-bench", "Заметка", DAY1);
    const done = await execution.setOutcome(w1, "COMPLETED", (await execution.getWorkout(w1)).session!.revision, DAY1);
    await execution.saveSet(bench(w2, "s1", 0, values(105_000, 8), null), DAY2);
    await assert.rejects(execution.deleteWorkoutExecution(w1, done.revision - 1), message("STALE_SESSION"));
    await execution.deleteWorkoutExecution(w1, done.revision);
    const gone = await execution.getWorkout(w1);
    assert.equal(gone.session, null, "выполнение удалено целиком");
    assert.equal(gone.facts.size, 0);
    assert.deepEqual(await execution.getProgramStatuses(a.id, "program-a"), [{ weekIndex: 2, plannedWorkoutId: "w1", status: "IN_PROGRESS" }]);
    const previous = await execution.getPrevious(w2, [{ plannedExerciseId: "pe-bench", exerciseId: BENCH, plannedSetIds: ["s1"] }], DAY2);
    assert.equal(previous.size, 0, "удалённые факты не возвращаются через «Пред.»");
    assert.equal((await execution.getWorkout(w2)).facts.get("s1")?.values.loadGrams, 105_000, "другая неделя не тронута");
  } finally { await close(); }
});

test("T03 тренировки «в работе» у всех клиентов (§48.83): начатые без исхода, последние сверху", async () => {
  const { clients, execution, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const slotOf = (clientId: string, plannedWorkoutId: string): WorkoutSlot =>
      ({ clientId, programId: `program-${clientId}`, weekIndex: 1, plannedWorkoutId });
    await execution.saveSet(bench(slotOf(a.id, "w1"), "s1", 0, values(100_000, 8), null), new Date(2026, 9, 17, 9, 0));
    await execution.saveSet(bench(slotOf(b.id, "w1"), "s1", 0, values(60_000, 10), null), new Date(2026, 9, 17, 9, 30));
    const doneRun = await execution.saveSet(bench(slotOf(a.id, "w2"), "s1", 0, values(80_000, 8), null), DAY1);
    await execution.setOutcome(slotOf(a.id, "w2"), "COMPLETED", doneRun.session.revision, DAY1);
    await execution.saveExerciseNote(slotOf(b.id, "w2"), "pe-bench", "Только заметка", DAY1);
    const active = await execution.listActiveWorkouts();
    assert.deepEqual(active.map((item) => [item.clientId, item.plannedWorkoutId]), [[b.id, "w1"], [a.id, "w1"]],
      "завершённая и не начатая (только заметка) — не «в работе»; свежий ввод — первым");
  } finally { await close(); }
});

test("PC §48.86.10/13/17 длительность: только валидная пара отметок, окончание позже начала", () => {
  const at = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`;
  assert.equal(sessionDurationSec(at("10:00"), at("11:15")), 75 * 60, "10:00–11:15 — 75 минут");
  assert.equal(sessionDurationSec(at("10:00"), null), null, "только начало — нет данных");
  assert.equal(sessionDurationSec(null, at("11:00")), null, "только окончание — нет данных");
  assert.equal(sessionDurationSec(at("11:00"), at("10:00")), null, "окончание раньше начала — нет данных до правки");
  assert.equal(sessionDurationSec(at("10:00"), at("10:00")), null, "нулевой интервал — не длительность");
  assert.equal(sessionDurationSec("вчера", at("10:00")), null, "не момент времени — нет данных");
  assert.equal(sessionDurationSec("2026-10-20T23:30:00.000Z", "2026-10-21T00:15:00.000Z"), 45 * 60, "через полночь");
});

test("PC §48.86.13 время занятия: авто-начало по первому подтверждённому подходу, авто-окончание при «Завершить», ручная правка, отмена не стирает", async () => {
  const { clients, execution, close } = await stores();
  try {
    const at = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`;
    const client = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const first = await execution.saveSet(bench(w1, "s1", 0, values(100_000, 8), null), new Date(at("10:10")));
    assert.equal(first.session.startedAt, at("10:10"), "начало — момент первого подтверждённого подхода");
    assert.equal(first.session.finishedAt, null);
    const second = await execution.saveSet(bench(w1, "s2", 1, values(100_000, 8), null), new Date(at("10:30")));
    assert.equal(second.session.startedAt, at("10:10"), "следующие подходы начало не двигают");
    const session = (await execution.getWorkout(w1)).session!;
    const done = await execution.setOutcome(w1, "COMPLETED", session.revision, new Date(at("11:00")));
    assert.equal(done.finishedAt, at("11:00"), "окончание — момент «Завершить»");
    assert.equal(sessionDurationSec(done.startedAt, done.finishedAt), 50 * 60, "10:10–11:00 — 50 минут");
    const reopened = await execution.setOutcome(w1, null, done.revision, new Date(at("11:05")));
    assert.deepEqual([reopened.startedAt, reopened.finishedAt], [at("10:10"), at("11:00")], "отмена завершения отметки не стирает");
    const again = await execution.setOutcome(w1, "COMPLETED", reopened.revision, new Date(at("11:30")));
    assert.equal(again.finishedAt, at("11:00"), "повторное завершение не переписывает окончание");
    const fixed = await execution.setTimes(w1, { startedAt: at("10:00"), finishedAt: at("11:00") }, again.revision, new Date(at("12:00")));
    assert.equal(sessionDurationSec(fixed.startedAt, fixed.finishedAt), 60 * 60, "тренер исправил начало на 10:00 — 60 минут");
    assert.equal(fixed.revision, again.revision + 1, "правка времени — CAS по ревизии выполнения");
    await assert.rejects(execution.setTimes(w1, { startedAt: null, finishedAt: null }, again.revision, new Date(at("12:01"))), message("STALE_SESSION"));
    const cleared = await execution.setTimes(w1, { startedAt: at("10:00"), finishedAt: null }, fixed.revision, new Date(at("12:02")));
    assert.equal(sessionDurationSec(cleared.startedAt, cleared.finishedAt), null, "очищенное окончание — длительности нет");
    await assert.rejects(execution.setTimes(w1, { startedAt: "10:00", finishedAt: null }, cleared.revision, new Date(at("12:03"))), message("INVALID_METRIC"));
  } finally { await close(); }
});

test("PC §48.86.13 время занятия не создаётся из пропуска, незавершённого ввода и ручного режима", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const w2: WorkoutSlot = { ...w1, plannedWorkoutId: "w2" };
    const missed = await execution.setOutcome(w1, "MISSED", null, DAY1);
    assert.deepEqual([missed.startedAt, missed.finishedAt], [null, null], "пропуск без ввода — без времени");
    await execution.setConfirmationMode("MANUAL");
    const typed = await execution.saveSet(bench(w2, "s1", 0, values(100_000, 8), null), DAY1);
    assert.equal(typed.session.startedAt, null, "в ручном режиме значения без галочки тренировку не начинают");
    const toggled = await execution.toggleSetConfirmation({ slot: w2, plannedExerciseId: "pe-bench", exerciseId: BENCH, plannedSetId: "s1",
      position: 0, metrics: LOAD_REPS, expectedRevision: typed.fact.revision }, new Date("2026-10-20T10:40:00.000Z"));
    assert.equal(toggled.session.startedAt, "2026-10-20T10:40:00.000Z", "галочка — первое подтверждение");
  } finally { await close(); }
});

test("PC §48.86.13 миграция v9: существующие выполнения получают пустые отметки, ограничение не пускает не-время", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const { writer } = await shared.acquire();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await runMigrations(writer, devTrainingExecutionCatalog.slice(0, 8), DEV_TRAINING_EXECUTION_LEDGER);
    db.prepare(`INSERT INTO training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id,
      actual_date, revision, created_at, updated_at) VALUES ('ses', ?, ?, 'p', 1, 'w', '2026-10-17', 1, 'x', 'x')`).run(WS, client.id);
    await runMigrations(writer, devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER);
    assert.deepEqual({ ...db.prepare("SELECT started_at AS s, finished_at AS f, actual_date AS d FROM training_sessions WHERE id = 'ses'").get() },
      { s: null, f: null, d: "2026-10-17" }, "старая запись цела, времени нет");
    assert.throws(() => db.prepare("UPDATE training_sessions SET started_at = 'вчера' WHERE id = 'ses'").run(), /CHECK/, "не момент времени");
    db.prepare("UPDATE training_sessions SET started_at = '2026-10-17T07:00:00.000Z' WHERE id = 'ses'").run();
  } finally {
    await shared.release();
    await clients.close();
  }
});

test("PC §48.86.13 ручные отметки: местное время дня занятия ↔ момент UTC; окончание после полуночи, но не «через сутки» по опечатке", () => {
  const date = "2026-10-20";
  assert.equal(localMinuteOfDay(instantFromLocal(date, 10 * 60 + 10)), 610, "10:10 туда и обратно, в любом часовом поясе");
  const start = instantFromLocal(date, 10 * 60);
  assert.equal(sessionDurationSec(start, endInstantAfter(start, date, 11 * 60 + 15)), 75 * 60, "10:00–11:15");
  const late = instantFromLocal(date, 23 * 60 + 30);
  assert.equal(sessionDurationSec(late, endInstantAfter(late, date, 15)), 45 * 60, "23:30–00:15 — окончание на следующий день");
  assert.equal(sessionDurationSec(start, endInstantAfter(start, date, 9 * 60)), null, "09:00 при начале 10:00 — не 23 часа, а нет данных до правки");
  assert.equal(endInstantAfter(null, date, 11 * 60), instantFromLocal(date, 11 * 60), "без начала — тот же день");
});

test("PC §48.84 + §48.86.13: смена даты занятия переносит отметки времени на ту же разницу в днях, время суток сохраняется", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const w1: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const first = await execution.saveSet(bench(w1, "s1", 0, values(100_000, 8), null), new Date("2026-10-20T10:10:00.000Z"));
    const done = await execution.setOutcome(w1, "COMPLETED", first.session.revision, new Date("2026-10-20T11:00:00.000Z"));
    const moved = await execution.setActualDate(w1, "2026-10-18", done.revision, new Date("2026-10-20T12:00:00.000Z"));
    assert.deepEqual([moved.actualDate, moved.startedAt, moved.finishedAt], ["2026-10-18", "2026-10-18T10:10:00.000Z", "2026-10-18T11:00:00.000Z"],
      "результаты внесли сегодня за позавчера — отметки уехали вместе с датой, длительность прежняя");
    assert.equal(sessionDurationSec(moved.startedAt, moved.finishedAt), 50 * 60);
    const empty = await execution.setOutcome({ ...w1, plannedWorkoutId: "w2" }, "MISSED", null, new Date("2026-10-20T12:00:00.000Z"));
    const noTimes = await execution.setActualDate({ ...w1, plannedWorkoutId: "w2" }, "2026-10-19", empty.revision);
    assert.deepEqual([noTimes.startedAt, noTimes.finishedAt], [null, null], "без отметок — переносить нечего");
  } finally { await close(); }
});

test("TRN-015 пределы ячейки: «0 повторов» не допускается, ноль килограммов — значение", async () => {
  const { inLimits, limitHint } = await import("../apps/mobile/src/features/training/execution/domain/ExecutionRules.ts");
  assert.equal(inLimits("reps", 0), false);
  assert.equal(inLimits("reps", 1), true);
  assert.equal(inLimits("reps", 999), true);
  assert.equal(inLimits("reps", 1000), false);
  assert.equal(inLimits("loadGrams", 0), true);
  assert.equal(inLimits("loadGrams", 1_000_001), false);
  assert.equal(inLimits("durationSec", 0), false);
  assert.equal(inLimits("distanceM", 0), false);
  assert.equal(inLimits("reps", 2.5), false);
  assert.equal(limitHint("reps"), "От 1 до 999");
  assert.equal(limitHint("loadGrams"), "Вес от 0 до 1000 кг");
});
