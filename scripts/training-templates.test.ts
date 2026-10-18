import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, fillSets, newDraft, replaceExercise } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedWorkout } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";
const ROW = "sys:repdb:row";

function week(prefix: string): readonly PlannedWorkout[] {
  let n = 0;
  return fillSets(addExercise(newDraft(`${prefix}w`), `${prefix}w`, `${prefix}e`, BENCH, () => `${prefix}s${n++}`), `${prefix}e`, "reps", 10)
    .plan.workouts;
}

async function setup() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  const a = await clients.create({ displayName: "SyntheticA" });
  const b = await clients.create({ displayName: "SyntheticB" });
  const c = await clients.create({ displayName: "SyntheticC" });
  return { plans, execution, a, b, c,
    close: async () => { await execution.close(); await plans.close(); await clients.close(); } };
}

test("T04 шаблон мезоцикла и программы (§48.14.3 п. 1–2, 6): только план открытого участника, без фактов и версий", async () => {
  const { plans, execution, a, b, close } = await setup();
  try {
    const program = await plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a.id, b.id] });
    let revision = program.revision;
    for (const [index, title] of ["Блок 1", "Блок 2", "Блок 3"].entries()) {
      revision = (await plans.createMesocycle(a.id, program.id, revision, { title, weeks: 2, firstWeek: week(`m${index}`),
        clientIds: [a.id, b.id] })).program.revision;
    }
    // У B во втором блоке жим индивидуально заменён на тягу (§48.15.2 п. 1).
    const cyclesB = (await plans.getPeriodizedPlan(b.id, program.id))!.mesocycles;
    const weekB = cyclesB[1]!.weeks[0]!;
    const replaced = replaceExercise({ title: "М", plan: { weeks: 1, workouts: weekB.workouts } }, weekB.workouts[0]!.exercises[0]!.id,
      "row-b", ROW, ["reps", "loadGrams"], () => `rb${Math.random()}`).plan.workouts;
    revision = (await plans.saveWeek(b.id, program.id, revision, { mesocycleId: cyclesB[1]!.id, weekIndex: 1, workouts: replaced,
      type: "base", scope: "CURRENT", clientIds: [b.id] })).program.revision;
    // У A есть выполнение во втором блоке.
    const cyclesA = (await plans.getPeriodizedPlan(a.id, program.id))!.mesocycles;
    const workoutA = cyclesA[1]!.weeks[0]!.workouts[0]!;
    await execution.saveSet({ slot: { clientId: a.id, programId: program.id, weekIndex: 1, plannedWorkoutId: workoutA.id },
      plannedExerciseId: workoutA.exercises[0]!.id, exerciseId: BENCH, plannedSetId: workoutA.exercises[0]!.sets[0]!.id, position: 0,
      metrics: ["load", "reps"], values: { loadGrams: 100_000, reps: 8, durationSec: null, distanceM: null }, setType: "NORMAL",
      drops: [], rpe: null, expectedRevision: null });

    const cycle = await plans.saveMesocycleAsTemplate(a.id, program.id, cyclesA[1]!.id, "Блок 2 — шаблон");
    assert.equal(cycle.kind, "MESOCYCLE");
    assert.equal(cycle.payload.kind === "MESOCYCLE" && cycle.payload.mesocycle.title, "Блок 2");
    assert.equal(cycle.payload.kind === "MESOCYCLE" && cycle.payload.mesocycle.weeks[0]!.workouts[0]!.exercises[0]!.exerciseId, BENCH,
      "план A, без индивидуальной замены B");
    const json = JSON.stringify(cycle.payload);
    assert.ok(!json.includes("100000") && !json.includes("confirmed"), "фактов выполнения нет");

    const whole = await plans.saveProgramAsTemplate(a.id, program.id, "Сила — шаблон");
    assert.deepEqual(whole.payload.kind === "PERIODIZED" && whole.payload.mesocycles.map((item) => item.title), ["Блок 1", "Блок 2", "Блок 3"]);
    const fromB = await plans.saveProgramAsTemplate(b.id, program.id, "Сила B");
    assert.equal(fromB.payload.kind === "PERIODIZED" && fromB.payload.mesocycles[1]!.weeks[0]!.workouts[0]!.exercises[0]!.exerciseId, ROW,
      "из контекста B — его замена (§48.15.2 п. 2)");
    assert.equal((await plans.listTemplates()).length, 3);
    assert.equal((await plans.getProgram(a.id, program.id))!.revision, revision, "сохранение шаблона не меняет программу");
  } finally {
    await close();
  }
});

test("T04 программа из шаблона (§48.14.3 п. 5, 7, 8): новые ID, свои копии участникам, шаблон дальше независим", async () => {
  const { plans, a, b, c, close } = await setup();
  try {
    const simple = await plans.createSimpleProgram(a.id, { title: "Фулбади", plan: { weeks: 6, workouts: week("s") } });
    const simpleTemplate = await plans.saveProgramAsTemplate(a.id, simple.id, "Фулбади — шаблон");
    const copy = await plans.createProgramFromTemplate(simpleTemplate.id, { title: "Фулбади для B", clientIds: [b.id] });
    const plan = (await plans.getSimplePlan(b.id, copy.id))!.draft.plan;
    assert.equal(plan.weeks, 6);
    assert.equal(plan.workouts[0]!.exercises[0]!.exerciseId, BENCH);
    assert.notEqual(plan.workouts[0]!.id, "sw", "новые ID — без связи с исходником");
    assert.deepEqual(copy.memberClientIds, [b.id]);

    const program = await plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a.id] });
    await plans.createMesocycle(a.id, program.id, program.revision, { title: "Блок 1", weeks: 3, firstWeek: week("p"), clientIds: [a.id] });
    const template = await plans.saveProgramAsTemplate(a.id, program.id, "Сила — шаблон");
    const group = await plans.createProgramFromTemplate(template.id, { title: "Сила группа", clientIds: [a.id, b.id] });
    const planA = (await plans.getPeriodizedPlan(a.id, group.id))!.mesocycles;
    const planB = (await plans.getPeriodizedPlan(b.id, group.id))!.mesocycles;
    assert.equal(planA[0]!.weeks.length, 3);
    assert.notEqual(planA[0]!.id, planB[0]!.id, "у каждого участника своя копия");
    assert.equal(await plans.getPeriodizedPlan(c.id, group.id), null, "C не назначен");

    await plans.renameTemplate(template.id, template.revision, "Сила v2");
    await plans.deleteTemplate(simpleTemplate.id);
    assert.equal((await plans.getProgram(a.id, group.id))!.title, "Сила группа", "переименование шаблона не трогает программы");
    assert.notEqual(await plans.getSimplePlan(b.id, copy.id), null, "удаление шаблона не трогает программы");
    const duplicate = await plans.duplicateTemplate(template.id, "Сила копия");
    assert.notEqual(duplicate.id, template.id);
    assert.deepEqual(duplicate.payload, (await plans.listTemplates()).find((item) => item.id === template.id)!.payload);
    await assert.rejects(plans.renameTemplate(template.id, template.revision, "Старая ревизия"),
      (error: unknown) => error instanceof Error && error.message === "TEMPLATE_REVISION_CONFLICT");

    const sourceCycle = (await plans.getPeriodizedPlan(a.id, program.id))!.mesocycles[0]!;
    const cycleTemplate = await plans.saveMesocycleAsTemplate(a.id, program.id, sourceCycle.id, "Блок");
    await assert.rejects(plans.createProgramFromTemplate(cycleTemplate.id, { title: "Нельзя", clientIds: [a.id] }),
      (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID", "мезоцикл — не программа (§48.14.2 п. 4)");
  } finally {
    await close();
  }
});

test("T04 мезоцикл из шаблона (§48.14.3 п. 3–4, §48.13.3 п. 6–8): один мезоцикл, выбранным участникам, без фактов", async () => {
  const { plans, a, b, c, close } = await setup();
  try {
    const source = await plans.createProgram({ kind: "PERIODIZED", title: "Источник", clientIds: [a.id] });
    let revision = source.revision;
    for (const [index, title] of ["База", "Пик"].entries()) {
      revision = (await plans.createMesocycle(a.id, source.id, revision, { title, weeks: index + 2, firstWeek: week(`x${index}`),
        clientIds: [a.id] })).program.revision;
    }
    const whole = await plans.saveProgramAsTemplate(a.id, source.id, "Книга");
    const single = await plans.saveMesocycleAsTemplate(a.id, source.id,
      (await plans.getPeriodizedPlan(a.id, source.id))!.mesocycles[0]!.id, "База — шаблон");
    const simple = await plans.createSimpleProgram(c.id, { title: "Простая", plan: { weeks: 2, workouts: week("y") } });
    const simpleTemplate = await plans.saveProgramAsTemplate(c.id, simple.id, "Простая — шаблон");

    const target = await plans.createProgram({ kind: "PERIODIZED", title: "Цель", clientIds: [a.id, b.id, c.id] });
    const fromSingle = await plans.createMesocycleFromTemplate(a.id, target.id, target.revision,
      { templateId: single.id, mesocycleIndex: 0, title: "Новая база", clientIds: [a.id, b.id] });
    const fromWhole = await plans.createMesocycleFromTemplate(a.id, target.id, fromSingle.program.revision,
      { templateId: whole.id, mesocycleIndex: 1, title: "Новый пик", clientIds: [a.id] });
    const cyclesA = (await plans.getPeriodizedPlan(a.id, target.id))!.mesocycles;
    assert.deepEqual(cyclesA.map((item) => [item.title, item.weeks.length]), [["Новая база", 2], ["Новый пик", 3]],
      "из книги — только выбранный мезоцикл, без остальных");
    assert.deepEqual((await plans.getPeriodizedPlan(b.id, target.id))!.mesocycles.map((item) => item.title), ["Новая база"]);
    assert.deepEqual((await plans.getPeriodizedPlan(c.id, target.id))!.mesocycles, [], "C не выбран");
    assert.equal((await plans.getPeriodizedPlan(a.id, target.id))!.selectedMesocycleId, fromWhole.mesocycleId);
    await assert.rejects(plans.createMesocycleFromTemplate(a.id, target.id, fromWhole.program.revision,
      { templateId: simpleTemplate.id, mesocycleIndex: 0, title: "Нельзя", clientIds: [a.id] }),
    (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID", "Простая программа — не мезоцикл");
    await assert.rejects(plans.createMesocycleFromTemplate(a.id, target.id, target.revision,
      { templateId: single.id, mesocycleIndex: 0, title: "Старая ревизия", clientIds: [a.id] }),
    (error: unknown) => error instanceof Error && error.message === "PROGRAM_REVISION_CONFLICT");
  } finally {
    await close();
  }
});

test("T04 Расширенная на основе Простой (§48.17.2): план по неделям в первый мезоцикл, без фактов, Простая не меняется", async () => {
  const { plans, execution, a, b, close } = await setup();
  try {
    const simple = await plans.createSimpleProgram(a.id, { title: "Фулбади", plan: { weeks: 6, workouts: week("f") } });
    const base = (await plans.getSimplePlan(a.id, simple.id))!.draft.plan.workouts[0]!;
    // Разовое отличие недели 3: 5 повторов вместо 10.
    const changed = { ...base, exercises: base.exercises.map((exercise) => ({ ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, reps: 5 })) })) };
    await plans.saveSimpleWorkout(a.id, simple.id, simple.revision, { weekIndex: 3, workoutId: base.id, workout: changed, scope: "CURRENT" });
    await execution.saveSet({ slot: { clientId: a.id, programId: simple.id, weekIndex: 1, plannedWorkoutId: base.id },
      plannedExerciseId: base.exercises[0]!.id, exerciseId: BENCH, plannedSetId: base.exercises[0]!.sets[0]!.id, position: 0,
      metrics: ["load", "reps"], values: { loadGrams: 100_000, reps: 8, durationSec: null, distanceM: null }, setType: "NORMAL",
      drops: [], rpe: null, expectedRevision: null });
    const sourceBefore = await plans.getSimplePlan(a.id, simple.id);

    const created = await plans.createPeriodizedFromSimple(a.id, simple.id,
      { title: "Фулбади — расширенная", mesocycleTitle: "Мезоцикл 1", clientIds: [a.id, b.id] });
    assert.equal(created.kind, "PERIODIZED");
    const cycles = (await plans.getPeriodizedPlan(a.id, created.id))!.mesocycles;
    assert.equal(cycles.length, 1);
    assert.equal(cycles[0]!.weeks.length, 6, "шесть недель");
    assert.deepEqual(cycles[0]!.weeks.map((item) => item.workouts[0]!.exercises[0]!.sets[0]!.reps), [10, 10, 5, 10, 10, 10]);
    assert.notEqual(cycles[0]!.weeks[0]!.workouts[0]!.id, base.id, "новые ID — факты Простой к ним не привязаны");
    assert.deepEqual(await execution.getProgramStatuses(a.id, created.id), [], "результатов в новой программе нет");
    assert.equal((await plans.getPeriodizedPlan(b.id, created.id))!.mesocycles[0]!.weeks.length, 6, "у B своя копия");
    assert.deepEqual(await plans.getSimplePlan(a.id, simple.id), sourceBefore, "Простая не изменилась");
    assert.equal((await execution.getProgramStatuses(a.id, simple.id)).length, 1, "её результаты на месте");
  } finally {
    await close();
  }
});

test("T04 правка шаблона (§48.16.2 п. 2): следующее применение — новое содержимое, ранее созданное не меняется", async () => {
  const { plans, a, b, close } = await setup();
  try {
    const simple = await plans.createSimpleProgram(a.id, { title: "Фулбади", plan: { weeks: 4, workouts: week("u") } });
    const template = await plans.saveProgramAsTemplate(a.id, simple.id, "Фулбади — шаблон");
    const before = await plans.createProgramFromTemplate(template.id, { title: "До правки", clientIds: [b.id] });
    assert.equal(template.payload.kind, "SIMPLE");
    if (template.payload.kind !== "SIMPLE") return;
    const workouts = template.payload.workouts.map((workout) => ({ ...workout, exercises: workout.exercises.map((exercise) => ({
      ...exercise, sets: exercise.sets.map((set) => ({ ...set, reps: 6 })) })) }));
    const updated = await plans.updateTemplate(template.id, template.revision, "Фулбади v2", { kind: "SIMPLE", weeks: 5, workouts });
    assert.equal(updated.title, "Фулбади v2");
    const after = await plans.createProgramFromTemplate(template.id, { title: "После правки", clientIds: [b.id] });
    const repsOf = async (programId: string) => (await plans.getSimplePlan(b.id, programId))!.draft.plan;
    assert.deepEqual([(await repsOf(after.id)).weeks, (await repsOf(after.id)).workouts[0]!.exercises[0]!.sets[0]!.reps], [5, 6]);
    assert.deepEqual([(await repsOf(before.id)).weeks, (await repsOf(before.id)).workouts[0]!.exercises[0]!.sets[0]!.reps], [4, 10],
      "программа, созданная до правки, не изменилась");
    await assert.rejects(plans.updateTemplate(template.id, template.revision, "Старая", { kind: "SIMPLE", weeks: 4, workouts }),
      (error: unknown) => error instanceof Error && error.message === "TEMPLATE_REVISION_CONFLICT");
    await assert.rejects(plans.updateTemplate(template.id, updated.revision, "Другой тип", { kind: "MESOCYCLE",
      mesocycle: { title: "М", weeks: [{ type: "base", workouts }] } }), (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID");
    assert.equal((await plans.getTemplate(template.id))!.revision, updated.revision, "отказы ничего не записали");
  } finally {
    await close();
  }
});
