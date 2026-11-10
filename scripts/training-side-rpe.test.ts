import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DEV_TRAINING_EXECUTION_LEDGER, devTrainingExecutionCatalog } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionCatalog.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { SetValues, TrackingMetric, WorkoutSlot } from "../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import type { SaveSetInput } from "../apps/mobile/src/features/training/execution/domain/TrainingExecutionPort.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const SQUAT = "sys:repdb:synthetic-single-leg";
const LOAD_REPS: readonly TrackingMetric[] = ["load", "reps"];
const NOW = new Date(2026, 10, 10, 9, 0);
const values = (loadGrams: number | null, reps: number | null): SetValues => ({ reps, loadGrams, durationSec: null, distanceM: null });
const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);

test("UIX: миграция v5 — RPE подхода копируется в обе стороны, факты и значения целы, новые значения 1–10", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const client = await clients.create({ displayName: "SyntheticLegacy" });
  // Установка прежней версии: журнал исполнения только до v4.
  await runMigrations(new WriterCoordinator(nodeSqlitePort(db)), devTrainingExecutionCatalog.slice(0, 4), DEV_TRAINING_EXECUTION_LEDGER);
  db.prepare(`INSERT INTO training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id, actual_date, revision, created_at, updated_at)
    VALUES ('s1', ?, ?, 'p1', 1, 'w1', '2026-11-01', 1, 'n', 'n')`).run(WS, client.id);
  const set = db.prepare(`INSERT INTO training_performed_sets (id, workspace_id, session_id, planned_set_id, planned_exercise_id, exercise_id, position, set_type, reps, load_grams, rpe,
    confirmed_at, origin, revision, updated_at, sided) VALUES (?, ?, 's1', ?, 'pe1', ?, 0, 'NORMAL', ?, ?, ?, 'x', 'INPUT', 1, 'n', ?)`);
  set.run("f-sided", WS, "ps1", SQUAT, null, null, 8, 1);
  set.run("f-plain", WS, "ps2", "sys:repdb:synthetic-bench", 8, 100_000, 6, 0);
  set.run("f-sided-no-rpe", WS, "ps3", SQUAT, null, null, null, 1);
  const side = db.prepare("INSERT INTO training_performed_sides (workspace_id, set_id, side, reps, load_grams, confirmed_at) VALUES (?, ?, ?, ?, ?, 'x')");
  for (const id of ["f-sided", "f-sided-no-rpe"]) { side.run(WS, id, "L", 10, 40_000); side.run(WS, id, "R", 9, 38_000); }

  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  try {
    assert.deepEqual(db.prepare("SELECT version FROM training_execution_schema_migrations ORDER BY version").all().map((row) => row["version"]), [1, 2, 3, 4, 5]);
    const rpes = db.prepare("SELECT set_id, side, rpe, reps, load_grams FROM training_performed_sides ORDER BY set_id, side").all().map((row) => ({ ...row }));
    assert.deepEqual(rpes, [
      { set_id: "f-sided", side: "L", rpe: 8, reps: 10, load_grams: 40_000 }, { set_id: "f-sided", side: "R", rpe: 8, reps: 9, load_grams: 38_000 },
      { set_id: "f-sided-no-rpe", side: "L", rpe: null, reps: 10, load_grams: 40_000 }, { set_id: "f-sided-no-rpe", side: "R", rpe: null, reps: 9, load_grams: 38_000 }]);
    assert.equal((db.prepare("SELECT rpe FROM training_performed_sets WHERE id = 'f-plain'").get() as { rpe: number }).rpe, 6, "RPE обычного подхода не тронут");
    assert.throws(() => db.prepare("UPDATE training_performed_sides SET rpe = 11 WHERE set_id = 'f-sided' AND side = 'L'").run(), /CHECK|constraint/iu);
    assert.throws(() => db.prepare("UPDATE training_performed_sides SET rpe = 0 WHERE set_id = 'f-sided' AND side = 'L'").run(), /CHECK|constraint/iu);
  } finally { await execution.close(); await clients.close(); }
});

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  return { clients, execution, close: async () => { await execution.close(); await clients.close(); } };
}

const sidedInput = (slot: WorkoutSlot, setId: string, revision: number | null, extra: Partial<SaveSetInput> = {}): SaveSetInput => ({
  slot, plannedExerciseId: "pe-leg", exerciseId: SQUAT, plannedSetId: setId, position: 0, metrics: LOAD_REPS, values: values(null, null), drops: [], rpe: null, setType: "NORMAL",
  expectedRevision: revision, sides: { left: values(40_000, 10), right: values(38_000, 9) }, ...extra });

test("UIX: у каждой стороны одностороннего подхода свой RPE; правка одной не трогает другую; отметка и повторная запись сохраняют RPE", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const slot: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const first = await execution.saveSet(sidedInput(slot, "s1", null, { sidesRpe: { left: 8, right: 7 } }), NOW);
    assert.deepEqual([first.fact.sides?.left.rpe, first.fact.sides?.right.rpe, first.fact.rpe], [8, 7, null], "RPE по сторонам; общего RPE у одностороннего нет");
    // Правка значений без указания RPE — прежние RPE сторон остаются.
    const edited = await execution.saveSet(sidedInput(slot, "s1", first.fact.revision, { sides: { left: values(42_500, 10), right: values(38_000, 9) } }), NOW);
    assert.deepEqual([edited.fact.sides?.left.values.loadGrams, edited.fact.sides?.left.rpe, edited.fact.sides?.right.rpe], [42_500, 8, 7]);
    // Меняется только правая сторона.
    const right = await execution.saveSet(sidedInput(slot, "s1", edited.fact.revision, { sides: { left: values(42_500, 10), right: values(38_000, 9) }, sidesRpe: { left: 8, right: 9 } }), NOW);
    assert.deepEqual([right.fact.sides?.left.rpe, right.fact.sides?.right.rpe], [8, 9]);
    // Очистка RPE левой стороны не меняет правую.
    const cleared = await execution.saveSet(sidedInput(slot, "s1", right.fact.revision, { sidesRpe: { left: null, right: 9 } }), NOW);
    assert.deepEqual([cleared.fact.sides?.left.rpe, cleared.fact.sides?.right.rpe], [null, 9]);
    // Снятие и повторная отметка стороны RPE не стирают.
    const identity = { slot, plannedExerciseId: "pe-leg", exerciseId: SQUAT, plannedSetId: "s1", position: 0, metrics: LOAD_REPS, expectedRevision: cleared.fact.revision };
    const unchecked = await execution.setSetConfirmation(identity, false, NOW, "R");
    assert.deepEqual([unchecked.fact.sides?.right.confirmed, unchecked.fact.sides?.right.rpe, unchecked.fact.sides?.left.rpe], [false, 9, null]);
    const checked = await execution.setSetConfirmation({ ...identity, expectedRevision: unchecked.fact.revision }, true, NOW, "R");
    assert.deepEqual([checked.fact.sides?.right.confirmed, checked.fact.sides?.right.rpe, checked.fact.sides?.left.rpe], [true, 9, null]);
    const read = (await execution.getWorkout(slot)).facts.get("s1");
    assert.deepEqual([read?.sides?.left.rpe, read?.sides?.right.rpe, read?.rpe], [null, 9, null], "чтение возвращает те же RPE");
    // Проверка границ: 1–10 у каждой стороны.
    await assert.rejects(execution.saveSet(sidedInput(slot, "s1", checked.fact.revision, { sidesRpe: { left: 11, right: 5 } }), NOW), message("INVALID_METRIC"));
    await assert.rejects(execution.saveSet(sidedInput(slot, "s1", checked.fact.revision, { sidesRpe: { left: 5, right: 0 } }), NOW), message("INVALID_METRIC"));
  } finally { await close(); }
});

test("SIDE-RPE: одна оценка без результатов не засчитывает сторону", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticRpeOnly" });
    const slot: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const result = await execution.saveSet(sidedInput(slot, "s1", null, {
      sides: { left: values(null, null), right: values(null, null) }, sidesRpe: { left: 8, right: 7 },
    }), NOW);
    assert.deepEqual([result.fact.confirmed, result.fact.sides?.left.confirmed, result.fact.sides?.right.confirmed, result.confirmedNow],
      [false, false, false, false]);
    const cleared = await execution.saveSet(sidedInput(slot, "s1", result.fact.revision, {
      sides: { left: values(null, null), right: values(null, null) }, sidesRpe: { left: null, right: 7 },
    }), NOW);
    assert.deepEqual([cleared.fact.sides?.left.rpe, cleared.fact.sides?.right.rpe], [null, 7]);
    const empty = await execution.saveSet(sidedInput(slot, "s1", cleared.fact.revision, {
      sides: { left: values(null, null), right: values(null, null) }, sidesRpe: { left: null, right: null },
    }), NOW);
    assert.deepEqual([empty.fact.sides?.left.rpe, empty.fact.sides?.right.rpe, empty.fact.confirmed], [null, null, false]);
  } finally { await close(); }
});

test("UIX: обычный подход по-прежнему хранит общий RPE; у одностороннего без sidesRpe RPE пуст", async () => {
  const { clients, execution, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const slot: WorkoutSlot = { clientId: client.id, programId: "program-a", weekIndex: 1, plannedWorkoutId: "w1" };
    const plain = await execution.saveSet({ slot, plannedExerciseId: "pe-bench", exerciseId: "sys:repdb:synthetic-bench", plannedSetId: "p1", position: 0, metrics: LOAD_REPS,
      values: values(100_000, 8), drops: [], rpe: 9, setType: "NORMAL", expectedRevision: null }, NOW);
    assert.equal(plain.fact.rpe, 9);
    const sided = await execution.saveSet(sidedInput(slot, "s2", null), NOW);
    assert.deepEqual([sided.fact.sides?.left.rpe, sided.fact.sides?.right.rpe], [null, null]);
  } finally { await close(); }
});
