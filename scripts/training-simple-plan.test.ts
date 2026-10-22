import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant, NEW_SIMPLE_DRAFT_KEY } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, addSet, addWorkout, fillSets, newDraft, removeExercise, removeSet, reorderExercises, reorderWorkouts, setTitle,
  replaceExercise, setInstruction, setRepsRange, setRest, setRir, setSetCount, updateSet } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import type { SimpleProgramDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { formatRange, parseDuration, parseLoad, parseRange, sanitizeRange, setsSummary, validateDraft, type TrackingMetric } from
  "../apps/mobile/src/features/training/plans/domain/SimplePlanRules.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { DEV_TRAINING_PLANS_LEDGER, devTrainingPlansCatalog } from
  "./d01/history/DevTrainingPlansCatalog.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { DevTrainingExecutionRepository } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";

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

test("T02 дневник: три области меняют только свой слот, ALL сохраняет одну историческую матрицу", async () => {
  const { plans, clients, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticSimple" });
    const other = await clients.create({ displayName: "SyntheticOther" });
    const draft = sampleDraft();
    const program = await plans.createSimpleProgram(client.id, draft);
    const changed = (workout: typeof draft.plan.workouts[number], reps: number) => fillSets({ title: "База",
      plan: { weeks: 1, workouts: [workout] } }, workout.exercises[0]!.id, "reps", reps).plan.workouts[0]!;
    const input = { weekIndex: 2, workoutId: "w1", workout: changed(draft.plan.workouts[0]!, 8), scope: "CURRENT" as const };
    const local = await plans.saveSimpleWorkout(client.id, program.id, program.revision, input);
    let weeks = await plans.getSimpleWeeks(client.id, program.id);
    const reps = () => weeks.map((week) => week.workouts[0]!.exercises[0]!.sets[0]!.reps);
    assert.deepEqual(reps(), [10, 8, 10, 10]);
    assert.equal((await plans.getSimpleVersions(client.id, program.id)).length, 1, "локальная правка без глобальной версии");
    const future = await plans.saveSimpleWorkout(client.id, program.id, local.revision,
      { ...input, weekIndex: 3, scope: "FOLLOWING", workout: changed(weeks[2]!.workouts[0]!, 6) });
    weeks = await plans.getSimpleWeeks(client.id, program.id);
    assert.deepEqual(reps(), [10, 8, 6, 6]);
    const before = weeks;
    const all = { ...input, weekIndex: 3, scope: "ALL" as const, workout: changed(weeks[2]!.workouts[0]!, 5) };
    const preview = await plans.previewSimpleWorkout(client.id, program.id, future.revision, all);
    assert.deepEqual(preview.conflicts.map((conflict) => conflict.weekIndex), [1, 2]);
    const result = await plans.saveSimpleWorkout(client.id, program.id, future.revision,
      { ...all, replaceConflicts: preview.conflicts.map((conflict) => conflict.key) });
    weeks = await plans.getSimpleWeeks(client.id, program.id);
    assert.deepEqual(reps(), [5, 5, 5, 5]);
    assert.equal(weeks.length, 4, "структурная правка не добавляет недель");
    for (const week of weeks) assert.deepEqual(week.workouts[1], draft.plan.workouts[1], "другой слот не меняется");
    const versions = await plans.getSimpleVersions(client.id, program.id);
    assert.equal(versions.length, 2);
    assert.deepEqual(versions[1]!.weeks, before);
    assert.equal((await plans.findWorkout(client.id, program.id, "w1", 2))!.workout.exercises[0]!.sets[0]!.reps, 5);
    await assert.rejects(plans.saveSimpleWorkout(other.id, program.id, result.revision, all), message("TARGET_NOT_FOUND"));
    await assert.rejects(plans.saveSimpleWorkout(client.id, program.id, future.revision, all), message("PROGRAM_REVISION_CONFLICT"));
    await plans.saveSimpleWorkout(client.id, program.id, result.revision, all);
    assert.equal((await plans.getSimpleVersions(client.id, program.id)).length, 2, "повтор без изменений не добавляет версию");
  } finally { await close(); }
});

test("T02 локальные планы: recovery, чужие ID, базовая правка и окончательное удаление изолированы", async () => {
  const { plans, clients, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const base = sampleDraft();
    const program = await plans.createSimpleProgram(a.id, base);
    const foreignDraft = addExercise(setTitle(newDraft("foreign-w"), "Другая"), "foreign-w", "foreign-e", BENCH, seq("foreign-s"));
    const foreign = await plans.createSimpleProgram(b.id, foreignDraft);
    let nextSet = 0;
    const personal = replaceExercise(base, "e1", "personal-e", PLANK, ["durationSec"], () => `personal-${nextSet++}`).plan.workouts[0]!;
    const input = { weekIndex: 2, workoutId: "w1", workout: personal, scope: "CURRENT" as const };
    const recovery = { baseRevision: program.revision, input };
    await plans.saveSimpleWorkoutDraft(a.id, program.id, recovery);
    assert.deepEqual(await plans.getSimpleWorkoutDraft(a.id, program.id, 2, "w1"), recovery);
    assert.equal(await plans.getSimpleWorkoutDraft(b.id, program.id, 2, "w1"), null);
    await assert.rejects(plans.saveSimpleWorkout(a.id, program.id, program.revision, { ...input,
      workout: { ...personal, exercises: foreignDraft.plan.workouts[0]!.exercises } }), message("DRAFT_INVALID"));
    assert.deepEqual(await plans.getSimpleWorkoutDraft(a.id, program.id, 2, "w1"), recovery, "отказ не очищает черновик");
    const local = await plans.saveSimpleWorkout(a.id, program.id, program.revision, input);
    assert.equal(await plans.getSimpleWorkoutDraft(a.id, program.id, 2, "w1"), null);
    await plans.setExerciseRest(a.id, program.id, "personal-e", 120);
    assert.equal((await plans.findWorkout(a.id, program.id, "w1", 2))!.workout.exercises[0]!.restSec, 120);
    await assert.rejects(plans.saveSimpleWorkout(a.id, program.id, local.revision, input), message("PROGRAM_REVISION_CONFLICT"));
    const current = (await plans.getSimplePlan(a.id, program.id))!;
    const updatedBase = fillSets(current.draft, "e1", "reps", 7);
    await plans.saveSimplePlan(a.id, program.id, current.program.revision, updatedBase);
    const weeks = await plans.getSimpleWeeks(a.id, program.id);
    assert.equal(weeks[0]!.workouts[0]!.exercises[0]!.sets[0]!.reps, 7);
    assert.equal(weeks[1]!.workouts[0]!.exercises[0]!.exerciseId, PLANK, "базовая правка не затирает персональную замену");
    assert.equal((await plans.getSimpleVersions(a.id, program.id)).length, 2);
    await clients.setArchived(a.id, a.revision, true);
    await clients.deleteArchivedPermanently(a.id, (await clients.get(a.id))!.revision);
    assert.deepEqual(await plans.getSimpleVersions(a.id, program.id), []);
    assert.deepEqual((await plans.getSimplePlan(b.id, foreign.id))!.draft, foreignDraft);
  } finally { await close(); }
});

test("T02 замена во всех неделях не перепривязывает факты и исторический снимок не копирует выполнения", async () => {
  const { plans, clients, shared, close } = await stores();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  try {
    const client = await clients.create({ displayName: "SyntheticFacts" });
    const draft = sampleDraft();
    const program = await plans.createSimpleProgram(client.id, draft);
    const slot = { clientId: client.id, programId: program.id, weekIndex: 1, plannedWorkoutId: "w1" };
    await execution.saveSet({ slot, plannedExerciseId: "e1", plannedSetId: "e1s0", exerciseId: BENCH, position: 0,
      metrics: ["load", "reps"], values: { loadGrams: 60_000, reps: 10, durationSec: null, distanceM: null },
      setType: "NORMAL", drops: [], rpe: null, expectedRevision: null });
    const facts = await execution.getWorkout(slot);
    let id = 0;
    const replacement = replaceExercise(draft, "e1", "new-plank", PLANK, ["durationSec"], () => `plank-${id++}`).plan.workouts[0]!;
    await plans.saveSimpleWorkout(client.id, program.id, program.revision,
      { weekIndex: 1, workoutId: "w1", workout: replacement, scope: "ALL" });
    assert.deepEqual(await execution.getWorkout(slot), facts, "тот же факт, включая дату и исходный канонический ID");
    assert.equal((await execution.getWorkout({ ...slot, weekIndex: 2 })).facts.size, 0);
    const history = await plans.getSimpleVersions(client.id, program.id);
    assert.equal(history.length, 2);
    assert.equal(history[1]!.weeks[0]!.workouts[0]!.exercises[0]!.id, "e1");
    assert.equal((await plans.findWorkout(client.id, program.id, "w1", 1))!.workout.exercises[0]!.id, "new-plank");
  } finally { await execution.close(); await close(); }
});

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
  return { clients, plans, shared, close: async () => { await plans.close(); await clients.close(); } };
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
    const other = await plans.createSimpleProgram(a.id, { ...addExercise(newDraft("w9"), "w9", "o1", BENCH, seq("o1s")), title: "Другая" });
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
    const other = await plans.createSimpleProgram(b.id, { ...addExercise(newDraft("w9"), "w9", "o2", BENCH, seq("o2s")), title: "Чужая" });
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
    db.prepare(`INSERT INTO training_programs (id, workspace_id, kind, title, revision, created_at, updated_at, weeks)
      VALUES ('p', ?, 'SIMPLE', 'База', 1, 'x', 'x', 4)`).run(WS);
    db.prepare("INSERT INTO training_program_members (workspace_id, program_id, client_id, joined_at) VALUES (?, 'p', ?, 'x')").run(WS, a.id);
    db.prepare("INSERT INTO training_workouts (id, workspace_id, program_id, position, title) VALUES ('w', ?, 'p', 0, 'Т1')").run(WS);
    db.prepare(`INSERT INTO training_planned_exercises (id, workspace_id, workout_id, position, exercise_id, rest_sec)
      VALUES ('e', ?, 'w', 0, ?, 120)`).run(WS, BENCH);
    db.prepare(`INSERT INTO training_planned_sets (id, workspace_id, planned_exercise_id, position, reps)
      VALUES ('s', ?, 'e', 0, 8)`).run(WS);
    assert.throws(() => db.prepare("UPDATE training_planned_exercises SET rest_sec = 3600 WHERE id = 'e'").run(), /CHECK/);
    await runMigrations(writer, devTrainingPlansCatalog, DEV_TRAINING_PLANS_LEDGER);
    assert.deepEqual({ ...db.prepare("SELECT rest_sec AS rest FROM training_planned_exercises WHERE id = 'e'").get() }, { rest: 120 });
    assert.deepEqual({ ...db.prepare("SELECT reps FROM training_planned_sets WHERE id = 's'").get() }, { reps: 8 });
    db.prepare("UPDATE training_planned_exercises SET rest_sec = 3600 WHERE id = 'e'").run();
    assert.throws(() => db.prepare("UPDATE training_planned_exercises SET rest_sec = 3601 WHERE id = 'e'").run(), /CHECK/);
    assert.throws(() => db.prepare(`INSERT INTO training_planned_sets (id, workspace_id, planned_exercise_id, position)
      VALUES ('s2', ?, 'missing', 1)`).run(WS), /FOREIGN KEY/, "подход без упражнения — по-прежнему ошибка связи");
    assert.throws(() => db.prepare("DELETE FROM training_planned_exercises WHERE id = 'e'").run(), /FOREIGN KEY/,
      "упражнение с подходами не удаляется молча");
  } finally {
    await shared.release();
    await clients.close();
  }
});

test("T03 указание к упражнению (§48.67): часть плана, хранится и меняется отдельно у каждого упражнения", async () => {
  const draft = setInstruction(sampleDraft(), "e1", "  Темп 3–1–1–0, пауза на груди  ");
  assert.equal(draft.plan.workouts[0]!.exercises[0]!.instruction, "Темп 3–1–1–0, пауза на груди", "пробелы по краям убраны");
  assert.equal(draft.plan.workouts[1]!.exercises[0]!.instruction, null, "у другого упражнения указания нет");
  assert.equal(setInstruction(draft, "e1", "   ").plan.workouts[0]!.exercises[0]!.instruction, null, "пустое — нет указания");
  assert.ok(validateDraft(setInstruction(draft, "e1", "x".repeat(501)), metricsOf).length > 0, "не длиннее 500 символов");
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const program = await plans.createSimpleProgram(a.id, draft);
    assert.equal((await plans.getSimplePlan(a.id, program.id))!.draft.plan.workouts[0]!.exercises[0]!.instruction,
      "Темп 3–1–1–0, пауза на груди");
  } finally {
    await close();
  }
});

test('T02 «Подходов» в карточке (как в 2.0): больше — копии последнего, меньше — с конца, от 1 до 20', () => {
  let n = 0;
  const id = () => "x" + String(n++);
  const filled = fillSets(sampleDraft(), 'e1', 'reps', 10);
  const five = setSetCount(updateSet(filled, 'e1', 'e1s2', 'reps', 6), 'e1', 5, id);
  assert.deepEqual(five.plan.workouts[0]!.exercises[0]!.sets.map((set) => [set.id, set.reps]),
    [['e1s0', 10], ['e1s1', 10], ['e1s2', 6], ['x0', 6], ['x1', 6]], 'новые — копии последнего, прежние ID на месте');
  assert.deepEqual(setSetCount(five, 'e1', 2, id).plan.workouts[0]!.exercises[0]!.sets.map((set) => set.id), ['e1s0', 'e1s1']);
  assert.equal(setSetCount(five, 'e1', 0, id).plan.workouts[0]!.exercises[0]!.sets.length, 1, 'не меньше одного');
  assert.equal(setSetCount(five, 'e1', 99, id).plan.workouts[0]!.exercises[0]!.sets.length, 20, 'не больше 20');
});

test("T02 повторы и RIR как в 2.0: число или диапазон, буквы не вводятся", () => {
  assert.equal(sanitizeRange("8a-1x2"), "8-12", "буквы выбрасываются");
  assert.equal(sanitizeRange("8–12—"), "8-12", "длинные тире — одно тире");
  assert.deepEqual(parseRange("8"), { min: 8, max: null });
  assert.deepEqual(parseRange("8-12"), { min: 8, max: 12 });
  assert.equal(parseRange("8-"), "invalid", "незаконченный диапазон");
  assert.equal(parseRange("12-8"), "invalid", "по убыванию нельзя");
  assert.equal(parseRange(""), null);
  assert.equal(formatRange({ min: 8, max: 12 }), "8–12");
  const ranged = setRir(setRepsRange(sampleDraft(), "e1", { min: 8, max: 12 }), "e1", { min: 1, max: 2 });
  const bench = ranged.plan.workouts[0]!.exercises[0]!;
  assert.deepEqual(bench.sets.map((set) => [set.reps, set.repsMax]), [[8, 12], [8, 12], [8, 12]]);
  assert.deepEqual(bench.rir, { min: 1, max: 2 });
  assert.equal(setsSummary(bench), "3 × 60 кг × 8–12");
  assert.deepEqual(validateDraft(ranged, metricsOf), []);
  assert.ok(validateDraft(setRir(ranged, "e1", { min: 3, max: 2 }), metricsOf).length > 0, "RIR по убыванию — ошибка");
});

test("T02 «⇄ Заменить» (§48.5.7 п. 1): новая идентичность на том же месте, план — по профилю нового", () => {
  let n = 0;
  const id = () => "n" + String(n++);
  const ranged = setRir(setRepsRange(sampleDraft(), "e1", { min: 8, max: 12 }), "e1", { min: 2, max: null });
  const replaced = replaceExercise(ranged, "e1", "e9", PLANK, ["durationSec"], id);
  const swapped = replaced.plan.workouts[0]!.exercises[0]!;
  assert.equal(swapped.id, "e9", "новое плановое упражнение — новый ID");
  assert.equal(swapped.exerciseId, PLANK);
  assert.deepEqual(swapped.sets.map((set) => set.id), ["n0", "n1", "n2"], "подходы — новые ID, число то же");
  assert.deepEqual(swapped.sets.map((set) => [set.reps, set.loadGrams]), [[null, null], [null, null], [null, null]],
    "повторы и вес не подходят планке");
  assert.equal(swapped.rir, null);
  const sameProfile = replaceExercise(ranged, "e1", "e8", "sys:repdb:synthetic-row", ["loadGrams", "reps"], id).plan.workouts[0]!.exercises[0]!;
  assert.deepEqual([sameProfile.sets[0]!.reps, sameProfile.sets[0]!.repsMax, sameProfile.rir], [8, 12, { min: 2, max: null }]);
});

test("T02 диапазоны и RIR сохраняются в хранилище", async () => {
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const draft = setRir(setRepsRange(sampleDraft(), "e1", { min: 8, max: 12 }), "e1", { min: 1, max: 2 });
    const program = await plans.createSimpleProgram(a.id, draft);
    const loaded = (await plans.getSimplePlan(a.id, program.id))!.draft.plan.workouts[0]!.exercises[0]!;
    assert.deepEqual([loaded.sets[0]!.reps, loaded.sets[0]!.repsMax, loaded.rir], [8, 12, { min: 1, max: 2 }]);
  } finally {
    await close();
  }
});

test("T02 порядок тренировок перетаскиванием: новый порядок целиком, неполный список не применяется", () => {
  const draft = sampleDraft();
  const swapped = reorderWorkouts(draft, ["w2", "w1"]);
  assert.deepEqual(swapped.plan.workouts.map((workout) => workout.id), ["w2", "w1"]);
  assert.deepEqual(swapped.plan.workouts[1]!.exercises.map((item) => item.id), ["e1"], "упражнения едут вместе с тренировкой");
  assert.deepEqual(reorderWorkouts(draft, ["w2"]).plan.workouts.map((workout) => workout.id), ["w1", "w2"]);
  assert.deepEqual(draft.plan.workouts.map((workout) => workout.id), ["w1", "w2"], "исходник не меняется");
});

test("тренировка без упражнений недопустима: валидация и хранилище отклоняют пустую тренировку", async () => {
  const empty = newDraft("w-empty");
  assert.ok(validateDraft(empty, () => ["reps"]).some((issue) => issue.workoutId === "w-empty" && issue.message.includes("хотя бы одно упражнение")));
  const filled = addExercise(empty, "w-empty", "e-ok", BENCH, seq("ok"));
  assert.equal(validateDraft(filled, () => ["reps"]).some((issue) => issue.message.includes("хотя бы одно упражнение")), false);
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticEmpty" });
    await assert.rejects(plans.createSimpleProgram(a.id, { ...empty, title: "Пустая" }), message("DRAFT_INVALID"));
    assert.deepEqual((await plans.getLibrary(a.id)).active, [], "программа с пустой тренировкой не создана");
  } finally { await close(); }
});
