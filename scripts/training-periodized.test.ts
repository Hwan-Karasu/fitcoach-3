import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { applyWeekOps, diffWeek, newMesocycleWeeks, targetWeeks, copyWeeks } from
  "../apps/mobile/src/features/training/plans/domain/PeriodizedRules.ts";
import { addExercise, addWorkout, fillSets, newDraft, removeExercise, renameWorkout, reorderExercises, replaceExercise,
  setSetCount } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedWorkout, SimpleProgramDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";

const BENCH = "sys:repdb:bench";
const SQUAT = "sys:repdb:squat";
const ROW = "sys:repdb:row";
const FLY = "sys:repdb:fly";

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

/** Неделя 1 из конструктора: «Тренировка 1» — жим 3×10 и присед. */
function firstWeek(): readonly PlannedWorkout[] {
  let draft = addExercise(newDraft("w1"), "w1", "e1", BENCH, ids("e1s"));
  draft = fillSets(draft, "e1", "reps", 10);
  draft = addExercise(draft, "w1", "e2", SQUAT, ids("e2s"));
  return draft.plan.workouts;
}

/** Правка недели через те же правки конструктора, что и в Простом режиме. */
function edit(week: readonly PlannedWorkout[], change: (draft: SimpleProgramDraft) => SimpleProgramDraft) {
  return change({ title: "М", plan: { weeks: 1, workouts: week } }).plan.workouts;
}

const weekTypes = ["heavy", "light", "heavy", "light", "heavy", "light"] as const;

test("T04 «первая неделя → во все»: у каждой недели свои ID, общее родство с первой", () => {
  const weeks = newMesocycleWeeks(firstWeek(), 4, ids("n"));
  assert.equal(weeks.length, 4);
  assert.deepEqual(weeks.map((week) => week.index), [1, 2, 3, 4]);
  const benches = weeks.map((week) => week.workouts[0]!.exercises[0]!);
  assert.equal(new Set(benches.map((item) => item.id)).size, 4, "ID разные — факты недель не смешиваются");
  assert.deepEqual(new Set(benches.map((item) => item.lineageId)), new Set(["e1"]), "родство — упражнение первой недели");
  assert.equal(new Set(weeks.flatMap((week) => week.workouts[0]!.exercises[0]!.sets.map((set) => set.id))).size, 12);
  assert.deepEqual(benches[3]!.sets.map((set) => set.reps), [10, 10, 10]);
  const copy = copyWeeks(weeks, ids("c"));
  assert.notEqual(copy[0]!.id, weeks[0]!.id, "копия другому участнику — новые ID");
  assert.equal(copy[0]!.workouts[0]!.exercises[0]!.lineageId, "e1");
});

test("T04 четыре области применения (§48.6.5 сценарии 1–4)", () => {
  const weeks = weekTypes.map((type, index) => ({ index: index + 1, type }));
  assert.deepEqual(targetWeeks(weeks, 3, "CURRENT"), [3]);
  assert.deepEqual(targetWeeks(weeks, 3, "FOLLOWING"), [3, 4, 5, 6]);
  assert.deepEqual(targetWeeks(weeks, 3, "SAME_TYPE"), [1, 3, 5], "силовые недели, объёмные не затронуты");
  assert.deepEqual(targetWeeks(weeks, 3, "ALL"), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(targetWeeks(weeks, 9, "ALL"), [], "нет такой недели — нет целей");
});

test("T04 замена упражнения доходит до того же места других недель с новой идентичностью; остальное не трогается", () => {
  const [week1, , week3] = newMesocycleWeeks(firstWeek(), 3, ids("n"));
  const after = edit(week3!.workouts, (draft) => replaceExercise(draft, week3!.workouts[0]!.exercises[0]!.id, "x1", ROW,
    ["reps", "loadGrams"], ids("xs")));
  const ops = diffWeek(week3!.workouts, after);
  assert.deepEqual(ops.map((op) => op.kind), ["replaceExercise"]);
  const applied = applyWeekOps(week1!.workouts, ops, ids("a"));
  const [first, second] = applied.workouts[0]!.exercises;
  assert.equal(applied.skipped, 0);
  assert.equal(first!.exerciseId, ROW);
  assert.equal(first!.lineageId, "e1", "место то же — родство то же");
  assert.notEqual(first!.id, week1!.workouts[0]!.exercises[0]!.id, "новое упражнение — новый ID, факты жима при старом");
  assert.deepEqual(first!.sets.map((set) => set.reps), [10, 10, 10]);
  assert.deepEqual(second, week1!.workouts[0]!.exercises[1], "присед не изменился");
});

test("T04 изменение подходов: ID имеющихся подходов в целевой неделе сохраняются, лишние — новые", () => {
  const [week1, week2] = newMesocycleWeeks(firstWeek(), 2, ids("n"));
  const benchId = week2!.workouts[0]!.exercises[0]!.id;
  const after = edit(week2!.workouts, (draft) => fillSets(setSetCount(draft, benchId, 4, ids("ns")), benchId, "reps", 8));
  const ops = diffWeek(week2!.workouts, after);
  assert.deepEqual(ops.map((op) => op.kind), ["updateExercise"]);
  const bench = applyWeekOps(week1!.workouts, ops, ids("a")).workouts[0]!.exercises[0]!;
  const oldSets = week1!.workouts[0]!.exercises[0]!.sets.map((set) => set.id);
  assert.deepEqual(bench.sets.map((set) => set.reps), [8, 8, 8, 8]);
  assert.deepEqual(bench.sets.slice(0, 3).map((set) => set.id), oldSets, "факты подходов недели 1 остаются при них");
  assert.equal(bench.sets[3]!.id, "a0");
  assert.equal(bench.id, week1!.workouts[0]!.exercises[0]!.id, "упражнение то же");
});

test("T04 нет соответствующего элемента — правка не подменяет другой (§48.6.5 п. 8)", () => {
  const [week1, week2] = newMesocycleWeeks(firstWeek(), 2, ids("n"));
  // В неделе 1 жим убран индивидуально.
  const individual = edit(week1!.workouts, (draft) => removeExercise(draft, week1!.workouts[0]!.exercises[0]!.id));
  const benchId = week2!.workouts[0]!.exercises[0]!.id;
  const ops = diffWeek(week2!.workouts, edit(week2!.workouts, (draft) => fillSets(draft, benchId, "reps", 5)));
  const applied = applyWeekOps(individual, ops, ids("a"));
  assert.equal(applied.skipped, 1);
  assert.deepEqual(applied.workouts[0]!.exercises.map((item) => item.exerciseId), [SQUAT]);
  assert.deepEqual(applied.workouts[0]!.exercises[0]!.sets, individual[0]!.exercises[0]!.sets, "присед не получил чужую правку");
});

test("T04 добавление, порядок, переименование и новая тренировка переносятся по родству", () => {
  const [week1, week2] = newMesocycleWeeks(firstWeek(), 2, ids("n"));
  const workoutId = week2!.workouts[0]!.id;
  const [bench, squat] = week2!.workouts[0]!.exercises;
  const after = edit(week2!.workouts, (draft) => {
    let next = addExercise(draft, workoutId, "f1", FLY, ids("fs"));
    next = reorderExercises(next, workoutId, [squat!.id, bench!.id, "f1"]);
    next = renameWorkout(next, workoutId, "Грудь и ноги");
    return addWorkout(next, "w9");
  });
  const ops = diffWeek(week2!.workouts, after);
  assert.deepEqual(ops.map((op) => op.kind).sort(), ["addExercise", "addWorkout", "orderExercises", "renameWorkout"]);
  const applied = applyWeekOps(week1!.workouts, ops, ids("a")).workouts;
  assert.equal(applied[0]!.title, "Грудь и ноги");
  assert.deepEqual(applied[0]!.exercises.map((item) => item.exerciseId), [SQUAT, BENCH, FLY]);
  assert.equal(applied[0]!.exercises[2]!.lineageId, "f1");
  assert.notEqual(applied[0]!.exercises[2]!.id, "f1", "в каждой неделе — свой ID");
  assert.equal(applied.length, 2);
  assert.equal(applied[1]!.lineageId, "w9");
  // Повторное применение не дублирует добавленное.
  assert.equal(applyWeekOps(applied, ops, ids("b")).skipped, 2);
});

const WS = "synthetic-workspace-a";

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  return { db, clients, plans, close: async () => { await plans.close(); await clients.close(); } };
}

const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);

test("T04 черновик недели изолирован, сохраняет базовую ревизию и очищается только вместе с успешной публикацией", async () => {
  const { plans, clients, a, b, programId, mesocycleId, close } = await sharedProgram();
  try {
    const plan = (await plans.getPeriodizedPlan(a.id, programId))!;
    const key = `week:${mesocycleId}:1`;
    const draft = { kind: "WEEK" as const, baseRevision: plan.program.revision, draft: { title: "Блок 1",
      plan: { weeks: 1, workouts: plan.mesocycles[0]!.weeks[0]!.workouts } }, clientIds: [a.id],
      mesocycleId, weekIndex: 1, type: "heavy" as const, scope: "CURRENT" as const };
    await plans.savePeriodizedDraft(a.id, programId, draft);
    await plans.savePeriodizedDraft(a.id, programId, draft);
    assert.deepEqual(await plans.getPeriodizedDraft(a.id, programId, key), draft);
    assert.equal(await plans.getPeriodizedDraft(b.id, programId, key), null);
    await assert.rejects(plans.savePeriodizedDraft(b.id, programId, { ...draft, clientIds: [b.id] }), message("TARGET_NOT_FOUND"));
    const renamed = await plans.renameProgram(programId, plan.program.revision, "Новое название");
    const input = { mesocycleId, weekIndex: 1, workouts: draft.draft.plan.workouts, type: draft.type,
      scope: draft.scope, clientIds: draft.clientIds };
    await assert.rejects(plans.saveWeek(a.id, programId, draft.baseRevision, input), message("PROGRAM_REVISION_CONFLICT"));
    assert.deepEqual(await plans.getPeriodizedDraft(a.id, programId, key), draft, "отказ не теряет черновик");
    await plans.saveWeek(a.id, programId, renamed.revision, input);
    assert.equal(await plans.getPeriodizedDraft(a.id, programId, key), null);
    await plans.savePeriodizedDraft(a.id, programId, { kind: "MESOCYCLE", baseRevision: renamed.revision + 1,
      draft: { title: "Новый блок", plan: { weeks: 2, workouts: firstWeek() } }, clientIds: [a.id] });
    await clients.setArchived(a.id, a.revision, true);
    const archived = (await clients.get(a.id))!;
    await clients.deleteArchivedPermanently(a.id, archived.revision);
    assert.equal(await plans.getPeriodizedDraft(a.id, programId, "new:MESOCYCLE"), null);
    assert.ok(await plans.getProgram(b.id, programId), "участие другого клиента остаётся");
  } finally { await close(); }
});

test("T03 недели дневника: lineage только своего мезоцикла, отсутствие соответствия требует выбора", async () => {
  const { plans, a, b, programId, mesocycleId, close } = await sharedProgram();
  try {
    const plan = (await plans.getPeriodizedPlan(a.id, programId))!;
    const cycle = plan.mesocycles[0]!;
    const source = cycle.weeks[0]!.workouts[0]!;
    const navigation = (await plans.getWorkoutWeekNavigation(a.id, programId, source.id))!;
    assert.equal(navigation.mesocycleId, mesocycleId);
    assert.equal(navigation.weeks[2]!.workoutId, cycle.weeks[2]!.workouts[0]!.id);
    assert.equal(await plans.getWorkoutWeekNavigation(b.id, programId, source.id), null);
    await plans.saveWeek(a.id, programId, plan.program.revision, { mesocycleId, weekIndex: 2,
      workouts: newDraft("replacement-workout").plan.workouts, type: "base", scope: "CURRENT", clientIds: [a.id] });
    const changed = (await plans.getWorkoutWeekNavigation(a.id, programId, source.id))!;
    assert.equal(changed.weeks[1]!.workoutId, null, "нельзя молча открыть тренировку по позиции");
    assert.equal(changed.weeks[2]!.workoutId, cycle.weeks[2]!.workouts[0]!.id);
    const simple = await plans.createSimpleProgram(a.id, { title: "Повтор", plan: { weeks: 3, workouts: firstWeek() } });
    const simpleNavigation = (await plans.getWorkoutWeekNavigation(a.id, simple.id, "w1"))!;
    assert.equal(simpleNavigation.mesocycleId, null);
    assert.deepEqual(simpleNavigation.weeks.map((week) => week.workoutId), ["w1", "w1", "w1"]);
  } finally { await close(); }
});

/** Расширенная программа на двоих с мезоциклом из четырёх недель у каждого. */
async function sharedProgram() {
  const env = await stores();
  const a = await env.clients.create({ displayName: "SyntheticA" });
  const b = await env.clients.create({ displayName: "SyntheticB" });
  const program = await env.plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a.id, b.id] });
  const created = await env.plans.createMesocycle(a.id, program.id, program.revision,
    { title: "Блок 1", weeks: 4, firstWeek: firstWeek(), clientIds: [a.id, b.id] });
  return { ...env, a, b, programId: program.id, revision: created.program.revision, mesocycleId: created.mesocycleId };
}

test("T04 версии: одна на реальное сохранение участника, без дубликатов и при отказе CAS", async () => {
  const { plans, clients, db, a, b, programId, mesocycleId, close } = await sharedProgram();
  try {
    const original = (await plans.getPeriodizedPlan(a.id, programId))!;
    const cycle = original.mesocycles[0]!;
    const initial = await plans.getMesocycleVersions(a.id, programId, mesocycleId);
    assert.equal(initial.length, 1);
    assert.equal(initial[0]!.validTo, null);
    const changed = edit(cycle.weeks[0]!.workouts, (draft) =>
      fillSets(draft, cycle.weeks[0]!.workouts[0]!.exercises[0]!.id, "reps", 7));
    const input = { mesocycleId, weekIndex: 1, workouts: changed, type: "heavy" as const,
      scope: "ALL" as const, clientIds: [a.id] };
    const at = new Date(Date.now() + 1000);
    const result = await plans.saveWeek(a.id, programId, original.program.revision, input, at);
    const versions = await plans.getMesocycleVersions(a.id, programId, mesocycleId);
    assert.equal(versions.length, 2, "все четыре недели — одна версия мезоцикла");
    assert.equal(versions[0]!.validFrom, at.toISOString());
    assert.equal(versions[1]!.validTo, at.toISOString());
    assert.deepEqual(versions[1]!.structure, cycle, "снимок прежнего плана со стабильными ID");
    assert.equal(versions[0]!.structure.weeks[3]!.workouts[0]!.exercises[0]!.sets[0]!.reps, 7);
    const other = (await plans.getPeriodizedPlan(b.id, programId))!.mesocycles[0]!;
    assert.equal((await plans.getMesocycleVersions(b.id, programId, other.id)).length, 1);
    assert.deepEqual(await plans.getMesocycleVersions(b.id, programId, mesocycleId), []);
    await assert.rejects(plans.saveWeek(a.id, programId, original.program.revision, input), message("PROGRAM_REVISION_CONFLICT"));
    await plans.saveWeek(a.id, programId, result.program.revision, input, new Date(at.getTime() + 1000));
    assert.deepEqual(await plans.getMesocycleVersions(a.id, programId, mesocycleId), versions,
      "повтор без изменений не создаёт историю и не сдвигает период");
    const current = (await plans.getPeriodizedPlan(a.id, programId))!;
    const second = { ...input, type: "light" as const, scope: "CURRENT" as const };
    await plans.saveWeek(a.id, programId, current.program.revision, second, new Date(at.getTime() + 2000));
    const all = await plans.getMesocycleVersions(a.id, programId, mesocycleId);
    assert.equal(all.length, 3);
    assert.equal(all[1]!.validFrom, at.toISOString());
    assert.equal(all[1]!.validTo, all[0]!.validFrom);
    assert.deepEqual(all[2], versions[1], "самая ранняя версия неизменна");
    assert.throws(() => db.prepare("UPDATE dev_training_structure_versions SET valid_from = valid_to WHERE id = ?")
      .run(all[1]!.id), /STRUCTURE_VERSION_IMMUTABLE/u);
    const latest = (await plans.getPeriodizedPlan(a.id, programId))!;
    const illegal = edit(latest.mesocycles[0]!.weeks[0]!.workouts, (draft) =>
      fillSets(draft, draft.plan.workouts[0]!.exercises[0]!.id, "reps", 9));
    const foreignSet = other.weeks[0]!.workouts[0]!.exercises[0]!.sets[0]!.id;
    const bad = illegal.map((workout) => ({ ...workout, exercises: workout.exercises.map((exercise, index) => index === 0
      ? { ...exercise, sets: exercise.sets.map((set, setIndex) => setIndex === 0 ? { ...set, id: foreignSet } : set) } : exercise) }));
    await assert.rejects(plans.saveWeek(a.id, programId, latest.program.revision, { ...second, workouts: bad }));
    assert.deepEqual(await plans.getMesocycleVersions(a.id, programId, mesocycleId), all,
      "ошибка после вставки снимка откатывает снимок вместе с правкой");
    assert.deepEqual(await plans.getPeriodizedPlan(a.id, programId), latest, "ревизия и структура тоже откатились");
    await clients.setArchived(a.id, a.revision, true);
    await clients.deleteArchivedPermanently(a.id, (await clients.get(a.id))!.revision);
    assert.deepEqual(await plans.getMesocycleVersions(a.id, programId, mesocycleId), []);
    assert.equal((await plans.getMesocycleVersions(b.id, programId, other.id)).length, 1);
  } finally { await close(); }
});

test("T04 хранилище: мезоцикл у каждого участника свой, общее только родство; выбор — у открывшего", async () => {
  const { plans, a, b, programId, mesocycleId, close } = await sharedProgram();
  try {
    const planA = (await plans.getPeriodizedPlan(a.id, programId))!;
    const planB = (await plans.getPeriodizedPlan(b.id, programId))!;
    assert.equal(planA.selectedMesocycleId, mesocycleId);
    assert.equal(planA.mesocycles.length, 1);
    assert.equal(planA.mesocycles[0]!.weeks.length, 4);
    assert.notEqual(planA.mesocycles[0]!.id, planB.mesocycles[0]!.id);
    assert.equal(planA.mesocycles[0]!.lineageId, planB.mesocycles[0]!.lineageId);
    const benchA = planA.mesocycles[0]!.weeks[2]!.workouts[0]!.exercises[0]!;
    const benchB = planB.mesocycles[0]!.weeks[2]!.workouts[0]!.exercises[0]!;
    assert.notEqual(benchA.id, benchB.id, "факты участников не могут смешаться");
    assert.equal(benchA.lineageId, benchB.lineageId);
    assert.deepEqual(benchA.sets.map((set) => set.reps), [10, 10, 10]);
    // Дневник находит только свою тренировку.
    const workoutA = planA.mesocycles[0]!.weeks[0]!.workouts[0]!;
    assert.equal((await plans.findWorkout(a.id, programId, workoutA.id))?.workout.exercises.length, 2);
    assert.equal(await plans.findWorkout(b.id, programId, workoutA.id), null);
  } finally {
    await close();
  }
});

test("T04 правка недели: «все недели этого типа» только у выбранного участника (§48.6.5 сценарии 3 и 6)", async () => {
  const { plans, a, b, programId, mesocycleId, close } = await sharedProgram();
  try {
    let revision = (await plans.getProgram(a.id, programId))!.revision;
    const weeksOf = async (clientId: string) => (await plans.getPeriodizedPlan(clientId, programId))!.mesocycles[0]!.weeks;
    // Недели 1 и 3 — тяжёлые.
    for (const index of [1, 3]) {
      const week = (await weeksOf(a.id))[index - 1]!;
      revision = (await plans.saveWeek(a.id, programId, revision, { mesocycleId, weekIndex: index, workouts: week.workouts,
        type: "heavy", scope: "CURRENT", clientIds: [a.id] })).program.revision;
    }
    const week3 = (await weeksOf(a.id))[2]!;
    const benchId = week3.workouts[0]!.exercises[0]!.id;
    const after = edit(week3.workouts, (draft) => fillSets(draft, benchId, "reps", 5));
    const result = await plans.saveWeek(a.id, programId, revision, { mesocycleId, weekIndex: 3, workouts: after, type: "heavy",
      scope: "SAME_TYPE", clientIds: [a.id] });
    assert.equal(result.skipped, 0);
    const repsA = (await weeksOf(a.id)).map((week) => week.workouts[0]!.exercises[0]!.sets[0]!.reps);
    assert.deepEqual(repsA, [5, 10, 5, 10], "тяжёлые недели 1 и 3, лёгкие не тронуты");
    assert.deepEqual((await weeksOf(a.id)).map((week) => week.type), ["heavy", "base", "heavy", "base"]);
    assert.deepEqual((await weeksOf(b.id)).map((week) => week.workouts[0]!.exercises[0]!.sets[0]!.reps), [10, 10, 10, 10],
      "участник B не выбран — его план прежний");
    await assert.rejects(plans.saveWeek(a.id, programId, revision, { mesocycleId, weekIndex: 3, workouts: after, type: "heavy",
      scope: "CURRENT", clientIds: [a.id] }), message("PROGRAM_REVISION_CONFLICT"), "старая ревизия не затирает новую");
  } finally {
    await close();
  }
});

test("T04 правка «эта и следующие» двум участникам: у B — по родству в его неделях 3–4", async () => {
  const { plans, a, b, programId, mesocycleId, revision, close } = await sharedProgram();
  try {
    const weeksOf = async (clientId: string) => (await plans.getPeriodizedPlan(clientId, programId))!.mesocycles[0]!.weeks;
    const week3 = (await weeksOf(a.id))[2]!;
    const after = edit(week3.workouts, (draft) => replaceExercise(draft, week3.workouts[0]!.exercises[0]!.id, "row-a3", ROW,
      ["reps", "loadGrams"], ids("rs")));
    await plans.saveWeek(a.id, programId, revision, { mesocycleId, weekIndex: 3, workouts: after, type: "base",
      scope: "FOLLOWING", clientIds: [a.id, b.id] });
    const exercisesOf = (weeks: Awaited<ReturnType<typeof weeksOf>>) => weeks.map((week) => week.workouts[0]!.exercises[0]!.exerciseId);
    assert.deepEqual(exercisesOf(await weeksOf(a.id)), [BENCH, BENCH, ROW, ROW]);
    assert.deepEqual(exercisesOf(await weeksOf(b.id)), [BENCH, BENCH, ROW, ROW]);
    assert.equal((await weeksOf(a.id))[2]!.workouts[0]!.exercises[0]!.id, "row-a3", "открытая неделя — ровно как отредактирована");
  } finally {
    await close();
  }
});

test("T04 схема: мезоцикл только у Расширенной программы, выбор — только своего мезоцикла", async () => {
  const { db, clients, plans, a, b, programId, close } = await sharedProgram();
  try {
    const simple = await plans.createSimpleProgram(a.id, { title: "Просто", plan: { weeks: 2, workouts: firstWeek() } });
    assert.throws(() => db.prepare(`INSERT INTO dev_training_mesocycles (id, workspace_id, program_id, client_id, lineage_id,
      position, title, created_at) VALUES ('m-x', ?, ?, ?, 'l', 0, 'М', 'now')`).run(WS, simple.id, a.id), /DRAFT_INVALID/);
    const own = (await plans.getPeriodizedPlan(b.id, programId))!.mesocycles[0]!.id;
    await assert.rejects(plans.selectMesocycle(a.id, programId, own), message("TARGET_NOT_FOUND"), "чужой мезоцикл не выбрать");
    void clients;
  } finally {
    await close();
  }
});

test("T04 окончательное удаление участника: его мезоциклы уходят, у второго участника всё на месте", async () => {
  const { clients, plans, a, b, programId, close } = await sharedProgram();
  try {
    const before = (await plans.getPeriodizedPlan(a.id, programId))!;
    await plans.archiveForClient(b.id, programId);
    const archived = await clients.setArchived(b.id, b.revision, true);
    await clients.deleteArchivedPermanently(b.id, archived.revision);
    const after = (await plans.getPeriodizedPlan(a.id, programId))!;
    assert.deepEqual(after.mesocycles, before.mesocycles);
    assert.deepEqual(after.program.memberClientIds, [a.id]);
  } finally {
    await close();
  }
});

test("T04 перетаскивание: порядок программ и мезоциклов — свой у каждого клиента, новая программа сверху", async () => {
  const { plans, a, b, programId, revision, mesocycleId, close } = await sharedProgram();
  try {
    const simple = await plans.createSimpleProgram(a.id, { title: "Просто", plan: { weeks: 2, workouts: firstWeek() } });
    const titlesOf = async (clientId: string) => (await plans.getLibrary(clientId)).active.map((card) => card.title);
    assert.deepEqual(await titlesOf(a.id), ["Просто", "Сила"], "без порядка — новые сверху");
    await plans.reorderPrograms(a.id, [programId, simple.id]);
    assert.deepEqual(await titlesOf(a.id), ["Сила", "Просто"]);
    await plans.createSimpleProgram(a.id, { title: "Новая", plan: { weeks: 1, workouts: newDraft("w-new").plan.workouts } });
    assert.deepEqual(await titlesOf(a.id), ["Новая", "Сила", "Просто"], "новая программа — сверху");
    await assert.rejects(plans.reorderPrograms(b.id, [simple.id]), message("TARGET_NOT_FOUND"), "чужую программу не упорядочить");

    const second = await plans.createMesocycle(a.id, programId, revision, { title: "Блок 2", weeks: 2, firstWeek: firstWeek(),
      clientIds: [a.id, b.id] });
    const mesocyclesOf = async (clientId: string) => (await plans.getPeriodizedPlan(clientId, programId))!.mesocycles.map((item) => item.title);
    assert.deepEqual(await mesocyclesOf(a.id), ["Блок 1", "Блок 2"]);
    await plans.reorderMesocycles(a.id, programId, [second.mesocycleId, mesocycleId]);
    assert.deepEqual(await mesocyclesOf(a.id), ["Блок 2", "Блок 1"]);
    assert.deepEqual(await mesocyclesOf(b.id), ["Блок 1", "Блок 2"], "у второго участника порядок прежний");
    await assert.rejects(plans.reorderMesocycles(b.id, programId, [mesocycleId]), message("TARGET_NOT_FOUND"));
  } finally {
    await close();
  }
});

test("T04 порядок программ: неполный список, дубликаты и архив отклоняются без записи и уведомления", async () => {
  const { plans, a, programId, close } = await sharedProgram();
  try {
    const simple = await plans.createSimpleProgram(a.id, { title: "Просто", plan: { weeks: 2, workouts: firstWeek() } });
    const before = await plans.getLibrary(a.id);
    let notifications = 0;
    const unsubscribe = plans.subscribeCommittedChanges(() => { notifications += 1; });
    for (const order of [[programId], [programId, programId], []]) {
      await assert.rejects(plans.reorderPrograms(a.id, order), message("DRAFT_INVALID"));
      assert.deepEqual(await plans.getLibrary(a.id), before);
    }
    await assert.rejects(plans.reorderPrograms(a.id, [programId, "missing"]), message("TARGET_NOT_FOUND"));
    assert.deepEqual(await plans.getLibrary(a.id), before);
    assert.equal(notifications, 0);
    unsubscribe();
    await plans.archiveForClient(a.id, simple.id);
    await assert.rejects(plans.reorderPrograms(a.id, [programId, simple.id]), message("TARGET_NOT_FOUND"));
  } finally {
    await close();
  }
});

test("T04 порядок мезоциклов: только полный список активного участия, выбор и недели не меняются", async () => {
  const { plans, a, b, programId, revision, mesocycleId, close } = await sharedProgram();
  try {
    const second = await plans.createMesocycle(a.id, programId, revision, { title: "Блок 2", weeks: 2,
      firstWeek: firstWeek(), clientIds: [a.id, b.id] });
    await plans.selectMesocycle(a.id, programId, mesocycleId);
    const before = (await plans.getPeriodizedPlan(a.id, programId))!;
    const other = await plans.getPeriodizedPlan(b.id, programId);
    let notifications = 0;
    const unsubscribe = plans.subscribeCommittedChanges(() => { notifications += 1; });
    for (const order of [[mesocycleId], [mesocycleId, mesocycleId], []]) {
      await assert.rejects(plans.reorderMesocycles(a.id, programId, order), message("DRAFT_INVALID"));
      assert.deepEqual(await plans.getPeriodizedPlan(a.id, programId), before);
    }
    await assert.rejects(plans.reorderMesocycles(a.id, programId, [second.mesocycleId, "missing"]), message("TARGET_NOT_FOUND"));
    assert.deepEqual(await plans.getPeriodizedPlan(a.id, programId), before);
    assert.equal(notifications, 0);
    await plans.reorderMesocycles(a.id, programId, [second.mesocycleId, mesocycleId]);
    assert.deepEqual(await plans.getPeriodizedPlan(a.id, programId), { ...before, mesocycles: [...before.mesocycles].reverse() });
    assert.deepEqual(await plans.getPeriodizedPlan(b.id, programId), other);
    assert.equal(notifications, 1);
    unsubscribe();
    await plans.archiveForClient(a.id, programId);
    await assert.rejects(plans.reorderMesocycles(a.id, programId, [mesocycleId, second.mesocycleId]), message("PROGRAM_ARCHIVED"));
  } finally {
    await close();
  }
});
