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
