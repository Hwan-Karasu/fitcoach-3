import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant, NEW_SIMPLE_DRAFT_KEY } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, addSet, addWorkout, fillSets, newDraft, removeExercise, removeSet, reorderExercises, setTitle,
  setRest, updateSet } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import type { SimpleProgramDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { parseDuration, parseLoad, setsSummary, validateDraft, type TrackingMetric } from
  "../apps/mobile/src/features/training/plans/domain/SimplePlanRules.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { DEV_TRAINING_PLANS_LEDGER, devTrainingPlansCatalog } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansCatalog.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:synthetic-bench";
const PLANK = "sys:repdb:synthetic-plank";
const metrics: Readonly<Record<string, readonly TrackingMetric[]>> = { [BENCH]: ["load", "reps"], [PLANK]: ["duration"] };
const metricsOf = (id: string) => metrics[id] ?? null;
const seq = (prefix: string) => (index: number) => `${prefix}${index}`;

function sampleDraft(): SimpleProgramDraft {
  let draft = setTitle(newDraft("w1"), "База");
  draft = addExercise(draft, "w1", "e1", BENCH, seq("e1s"));
  draft = fillSets(draft, "e1", "reps", 10);
  draft = fillSets(draft, "e1", "loadGrams", 60_000);
  draft = addWorkout(draft, "w2");
  return addExercise(draft, "w2", "e2", PLANK, seq("e2s"));
}

test("T02 правки черновика: три пустых подхода, копия последнего, не меньше одного, порядок; исходник не меняется", () => {
  const base = newDraft("w1");
  const draft = addExercise(base, "w1", "e1", BENCH, seq("s"));
  assert.equal(base.plan.workouts[0]!.exercises.length, 0, "immer: исходный черновик прежний");
  assert.deepEqual(draft.plan.workouts[0]!.exercises[0]!.sets.map((set) => set.id), ["s0", "s1", "s2"]);
  const filled = updateSet(draft, "e1", "s2", "reps", 8);
  const copied = addSet(filled, "e1", "s3");
  assert.equal(copied.plan.workouts[0]!.exercises[0]!.sets[3]!.reps, 8, "новый подход — копия последнего");
  let single = removeSet(removeSet(removeSet(draft, "e1", "s0"), "e1", "s1"), "e1", "s2");
  assert.equal(single.plan.workouts[0]!.exercises[0]!.sets.length, 1, "последний подход не удаляется");
  single = addExercise(single, "w1", "e2", PLANK, seq("p"));
  assert.deepEqual(reorderExercises(single, "w1", ["e2", "e1"]).plan.workouts[0]!.exercises.map((item) => item.id), ["e2", "e1"]);
  assert.deepEqual(removeExercise(single, "e1").plan.workouts[0]!.exercises.map((item) => item.id), ["e2"]);
});

test("T02 правила: поля по профилю (§33), разбор веса и времени, сводка подходов", () => {
  const draft = sampleDraft();
  assert.deepEqual(validateDraft(draft, metricsOf), []);
  const wrong = updateSet(draft, "e2", "e2s0", "reps", 5);
  assert.ok(validateDraft(wrong, metricsOf).some((issue) => issue.exerciseId === "e2"), "у планки нет повторов");
  assert.ok(validateDraft(setTitle(draft, " "), metricsOf).length > 0);
  assert.equal(parseLoad("62,5"), 62_500);
  assert.equal(parseLoad("1.25"), 1_250);
  assert.equal(parseLoad(""), null);
  assert.equal(parseLoad("6x"), "invalid");
  assert.equal(parseDuration("1:30"), 90);
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration("1:x"), "invalid");
  assert.equal(setsSummary(draft.plan.workouts[0]!.exercises[0]!), "3 × 60 кг × 10");
  assert.equal(setsSummary(draft.plan.workouts[1]!.exercises[0]!), "3 подхода", "пустые значения — только число подходов");
});

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  return { clients, plans, close: async () => { await plans.close(); await clients.close(); } };
}

const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);

test("T02 хранилище: создание со структурой, сохранение по ID (§48.5.7 п. 5), CAS, чужой ID отклоняется", async () => {
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const draft = sampleDraft();
    await plans.saveBuilderDraft(a.id, NEW_SIMPLE_DRAFT_KEY, null, draft);
    const program = await plans.createSimpleProgram(a.id, draft);
    assert.equal(await plans.getBuilderDraft(a.id, NEW_SIMPLE_DRAFT_KEY), null, "черновик новой очищен");
    const loaded = (await plans.getSimplePlan(a.id, program.id))!;
    assert.deepEqual(loaded.draft, draft, "структура сохраняется без потерь");

    // Убрать вторую тренировку, переставить подходы — ID оставшихся строк те же.
    let edited = removeSet(loaded.draft, "e1", "e1s1");
    edited = { ...edited, plan: { ...edited.plan, weeks: 6, workouts: [edited.plan.workouts[0]!] } };
    await plans.saveBuilderDraft(a.id, program.id, program.revision, edited);
    const saved = await plans.saveSimplePlan(a.id, program.id, program.revision, edited);
    assert.equal(await plans.getBuilderDraft(a.id, program.id), null, "черновик программы очищен при сохранении");
    const reloaded = (await plans.getSimplePlan(a.id, program.id))!.draft;
    assert.equal(reloaded.plan.weeks, 6);
    assert.deepEqual(reloaded.plan.workouts.map((workout) => workout.id), ["w1"]);
    assert.deepEqual(reloaded.plan.workouts[0]!.exercises[0]!.sets.map((set) => set.id), ["e1s0", "e1s2"]);
    await assert.rejects(plans.saveSimplePlan(a.id, program.id, program.revision, edited), message("PROGRAM_REVISION_CONFLICT"));

    // Вторая программа не может «перехватить» строки первой по ID.
    const other = await plans.createSimpleProgram(a.id, { ...newDraft("w9"), title: "Другая" });
    const thief = addExercise({ ...newDraft("w9"), title: "Другая" }, "w9", "e1", BENCH, seq("x"));
    await assert.rejects(plans.saveSimplePlan(a.id, other.id, other.revision, thief), message("DRAFT_INVALID"));
    assert.equal((await plans.getSimplePlan(a.id, program.id))!.draft.plan.workouts[0]!.exercises[0]!.id, "e1");
    assert.equal(saved.revision, program.revision + 1);
  } finally {
    await close();
  }
});

test("T02 окончательное удаление клиента: структура и черновики уходят, черновик не воскрешает программу", async () => {
  const { clients, plans, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "SyntheticGone" });
    const program = await plans.createSimpleProgram(gone.id, sampleDraft());
    await plans.saveBuilderDraft(gone.id, program.id, program.revision, sampleDraft());
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.equal(await plans.getSimplePlan(gone.id, program.id), null);
    assert.equal(await plans.getBuilderDraft(gone.id, program.id), null);
  } finally {
    await close();
  }
});

test("T03 отдых упражнения (§48.56): 90 с по умолчанию, границы 1 с – 60 мин, выключение, хранение", async () => {
  const draft = sampleDraft();
  const bench = draft.plan.workouts[0]!.exercises[0]!;
  assert.equal(bench.restSec, 90);
  assert.equal(setRest(draft, "e1", 0).plan.workouts[0]!.exercises[0]!.restSec, 1, "не меньше 1 с");
  assert.equal(setRest(draft, "e1", 5000).plan.workouts[0]!.exercises[0]!.restSec, 3600, "не больше 60 мин");
  const tuned = setRest(setRest(draft, "e1", 180), "e2", null);
  assert.equal(tuned.plan.workouts[1]!.exercises[0]!.restSec, null, "таймер упражнения выключен");
  assert.equal(tuned.plan.workouts[0]!.exercises[0]!.restSec, 180, "отдых жима не трогает планку");
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const program = await plans.createSimpleProgram(a.id, tuned);
    const loaded = (await plans.getSimplePlan(a.id, program.id))!.draft;
    assert.deepEqual(loaded.plan.workouts.map((workout) => workout.exercises[0]!.restSec), [180, null]);
    const legacy = JSON.parse(JSON.stringify(draft)) as { plan: { workouts: { exercises: { restSec?: number }[] }[] } };
    delete legacy.plan.workouts[0]!.exercises[0]!.restSec;
    await plans.saveBuilderDraft(a.id, program.id, program.revision, legacy as unknown as SimpleProgramDraft);
    const restored = await plans.getBuilderDraft(a.id, program.id);
    assert.equal(restored?.draft.plan.workouts[0]!.exercises[0]!.restSec, 90, "старый черновик получает отдых по умолчанию");
  } finally {
    await close();
  }
});

test("T03 отдых упражнения из дневника: меняется только это упражнение, ревизия растёт, чужое не трогается", async () => {
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const program = await plans.createSimpleProgram(a.id, sampleDraft());
    const other = await plans.createSimpleProgram(b.id, { ...newDraft("w9"), title: "Чужая" });
    const changed = await plans.setExerciseRest(a.id, program.id, "e1", 135);
    assert.equal(changed.revision, program.revision + 1, "правка плана повышает ревизию (конструктор получит конфликт)");
    const loaded = (await plans.getSimplePlan(a.id, program.id))!.draft.plan;
    assert.deepEqual(loaded.workouts.map((workout) => workout.exercises[0]!.restSec), [135, 90]);
    await plans.setExerciseRest(a.id, program.id, "e2", null);
    assert.equal((await plans.getSimplePlan(a.id, program.id))!.draft.plan.workouts[1]!.exercises[0]!.restSec, null);
    await assert.rejects(plans.setExerciseRest(a.id, program.id, "e1", 0), message("DRAFT_INVALID"), "0 с нельзя");
    await assert.rejects(plans.setExerciseRest(a.id, program.id, "e1", 3601), message("DRAFT_INVALID"), "больше 60 мин нельзя");
    assert.equal((await plans.setExerciseRest(a.id, program.id, "e1", 3600)).revision > 0, true, "ровно 60:00 можно");
    await assert.rejects(plans.setExerciseRest(a.id, other.id, "e1", 60), message("TARGET_NOT_FOUND"),
      "чужая программа — не своя");
    await assert.rejects(plans.setExerciseRest(b.id, program.id, "e1", 60), message("TARGET_NOT_FOUND"),
      "клиент не участник программы");
  } finally {
    await close();
  }
});

test("T03 миграция v4 планов: отдых до 60 мин в схеме, данные и связи упражнений с подходами сохранены", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const { writer } = await shared.acquire();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    await runMigrations(writer, devTrainingPlansCatalog.slice(0, 3), DEV_TRAINING_PLANS_LEDGER);
    db.prepare(`INSERT INTO dev_training_programs (id, workspace_id, kind, title, revision, created_at, updated_at, weeks)
      VALUES ('p', ?, 'SIMPLE', 'База', 1, 'x', 'x', 4)`).run(WS);
    db.prepare("INSERT INTO dev_training_program_members (workspace_id, program_id, client_id, joined_at) VALUES (?, 'p', ?, 'x')").run(WS, a.id);
    db.prepare("INSERT INTO dev_training_workouts (id, workspace_id, program_id, position, title) VALUES ('w', ?, 'p', 0, 'Т1')").run(WS);
    db.prepare(`INSERT INTO dev_training_planned_exercises (id, workspace_id, workout_id, position, exercise_id, rest_sec)
      VALUES ('e', ?, 'w', 0, ?, 120)`).run(WS, BENCH);
    db.prepare(`INSERT INTO dev_training_planned_sets (id, workspace_id, planned_exercise_id, position, reps)
      VALUES ('s', ?, 'e', 0, 8)`).run(WS);
    assert.throws(() => db.prepare("UPDATE dev_training_planned_exercises SET rest_sec = 3600 WHERE id = 'e'").run(), /CHECK/);
    await runMigrations(writer, devTrainingPlansCatalog, DEV_TRAINING_PLANS_LEDGER);
    assert.deepEqual({ ...db.prepare("SELECT rest_sec AS rest FROM dev_training_planned_exercises WHERE id = 'e'").get() }, { rest: 120 });
    assert.deepEqual({ ...db.prepare("SELECT reps FROM dev_training_planned_sets WHERE id = 's'").get() }, { reps: 8 });
    db.prepare("UPDATE dev_training_planned_exercises SET rest_sec = 3600 WHERE id = 'e'").run();
    assert.throws(() => db.prepare("UPDATE dev_training_planned_exercises SET rest_sec = 3601 WHERE id = 'e'").run(), /CHECK/);
    assert.throws(() => db.prepare(`INSERT INTO dev_training_planned_sets (id, workspace_id, planned_exercise_id, position)
      VALUES ('s2', ?, 'missing', 1)`).run(WS), /FOREIGN KEY/, "подход без упражнения — по-прежнему ошибка связи");
    assert.throws(() => db.prepare("DELETE FROM dev_training_planned_exercises WHERE id = 'e'").run(), /FOREIGN KEY/,
      "упражнение с подходами не удаляется молча");
  } finally {
    await shared.release();
    await clients.close();
  }
});
