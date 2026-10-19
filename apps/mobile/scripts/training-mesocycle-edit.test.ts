import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import type { BuilderWeek, Mesocycle } from "../src/features/training/plans/domain/PeriodizedModel.ts";
import { addExercise, fillSets, newDraft } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createMesocycleSaveWorkflow } from "../src/workflows/saveTrainingMesocycle.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Workflow импортирует public.ts фич (там экраны .tsx), поэтому тест живёт здесь.
const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";

function firstWeek(): readonly PlannedWorkout[] {
  let n = 0;
  return fillSets(addExercise(newDraft("w1"), "w1", "e1", BENCH, () => `s${n++}`), "e1", "reps", 10).plan.workouts;
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
  const program = await plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a.id, b.id] });
  await plans.createMesocycle(a.id, program.id, program.revision, { title: "Блок", weeks: 4, firstWeek: firstWeek(), clientIds: [a.id, b.id] });
  const lease = await shared.acquire();
  const save = createMesocycleSaveWorkflow((task) => lease.writer.write(task), plans.mesocycleSaveParticipant,
    execution.weekCopyParticipant, () => new Date("2026-10-19T10:00:00Z"));
  const cycleOf = async (clientId: string) => (await plans.getPeriodizedPlan(clientId, program.id))!.mesocycles[0]!;
  const revision = async () => (await plans.getProgram(a.id, program.id))!.revision;
  return { plans, execution, a, b, programId: program.id, save, cycleOf, revision,
    close: async () => { await shared.release(); await execution.close(); await plans.close(); await clients.close(); } };
}

const builderOf = (cycle: Mesocycle): BuilderWeek[] => cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts }));
const reps5 = (workouts: readonly PlannedWorkout[]) =>
  fillSets({ title: "м", plan: { weeks: 1, workouts } }, workouts[0]!.exercises[0]!.id, "reps", 5).plan.workouts;

test("UI-OWN-041 правка мезоцикла в конструкторе: настройки и все недели, новая неделя, версия до правки, другой участник цел", async () => {
  const { plans, a, b, programId, save, cycleOf, revision, close } = await setup();
  try {
    const before = await cycleOf(a.id);
    const otherBefore = await cycleOf(b.id);
    const versions = (await plans.getMesocycleVersions(a.id, programId, before.id)).length;
    const weeks = builderOf(before);
    weeks[1] = { type: "base", workouts: reps5(weeks[1]!.workouts) };
    weeks[2] = { ...weeks[2]!, type: "heavy" };
    weeks.push({ type: "deload", workouts: [] });

    const saved = await save.save({ clientId: a.id, programId, expectedRevision: await revision(), mesocycleId: before.id, clientIds: [a.id],
      mesocycle: { title: "Блок 2", cycleType: "strength", repRange: { min: 3, max: 5 }, startDate: "2026-10-12", weeks } });

    const after = await cycleOf(a.id);
    assert.equal(saved.mesocycleId, before.id);
    assert.deepEqual([after.title, after.cycleType, after.repRange, after.startDate], ["Блок 2", "strength", { min: 3, max: 5 }, "2026-10-12"]);
    assert.deepEqual(after.weeks.map((week) => week.type), ["base", "base", "heavy", "base", "deload"]);
    assert.deepEqual(after.weeks.map((week) => week.workouts[0]!.exercises[0]!.sets[0]!.reps), [10, 5, 10, 10, 10],
      "пустая 5-я неделя получила план 4-й");
    assert.equal(after.weeks[0]!.workouts[0]!.id, before.weeks[0]!.workouts[0]!.id, "ID тренировок прежние — результаты при них");
    assert.equal((await plans.getMesocycleVersions(a.id, programId, before.id)).length, versions + 1, "версия до правки сохранена");
    assert.deepEqual(await cycleOf(b.id), otherBefore, "у второго участника без изменений");
  } finally {
    await close();
  }
});

test("UI-OWN-041 неделя с результатами не удаляется; без результатов — удаляется; старая ревизия отклоняется", async () => {
  const { execution, a, b, programId, save, cycleOf, revision, close } = await setup();
  try {
    const cycle = await cycleOf(a.id);
    const workout = cycle.weeks[3]!.workouts[0]!;
    const exercise = workout.exercises[0]!;
    await execution.saveSet({ slot: { clientId: a.id, programId, weekIndex: 4, plannedWorkoutId: workout.id }, plannedExerciseId: exercise.id,
      exerciseId: BENCH, plannedSetId: exercise.sets[0]!.id, position: 0, metrics: ["load", "reps"],
      values: { loadGrams: 100_000, reps: 8, durationSec: null, distanceM: null }, setType: "NORMAL", drops: [], rpe: null, expectedRevision: null });
    const shorter = { title: "Блок", cycleType: null, repRange: null, startDate: null, weeks: builderOf(cycle).slice(0, 3) };
    await assert.rejects(save.save({ clientId: a.id, programId, expectedRevision: await revision(), mesocycleId: cycle.id, clientIds: [a.id],
      mesocycle: shorter }), (error: unknown) => error instanceof Error && error.message === "WEEK_HAS_RESULTS");
    assert.equal((await cycleOf(a.id)).weeks.length, 4, "отказ ничего не изменил");

    const other = await cycleOf(b.id);
    const stale = await revision();
    await save.save({ clientId: b.id, programId, expectedRevision: stale, mesocycleId: other.id, clientIds: [b.id],
      mesocycle: { ...shorter, weeks: builderOf(other).slice(0, 3) } });
    assert.equal((await cycleOf(b.id)).weeks.length, 3);
    await assert.rejects(save.save({ clientId: a.id, programId, expectedRevision: stale, mesocycleId: cycle.id, clientIds: [a.id],
      mesocycle: { ...shorter, weeks: builderOf(cycle) } }), (error: unknown) => error instanceof Error && error.message === "PROGRAM_REVISION_CONFLICT");
  } finally {
    await close();
  }
});

test("UI-OWN-041 «+ Мезоцикл» из конструктора: у выбранных участников свои копии, выбор открывшего — новый", async () => {
  const { plans, a, b, programId, save, revision, close } = await setup();
  try {
    const created = await save.save({ clientId: a.id, programId, expectedRevision: await revision(), mesocycleId: null, clientIds: [a.id, b.id],
      mesocycle: { title: "Пик", cycleType: "power", repRange: null, startDate: null,
        weeks: [{ type: "heavy", workouts: firstWeek() }, { type: "deload", workouts: [] }] } });
    const own = await plans.getPeriodizedPlan(a.id, programId);
    const other = await plans.getPeriodizedPlan(b.id, programId);
    assert.equal(own!.selectedMesocycleId, created.mesocycleId);
    assert.deepEqual(own!.mesocycles.map((item) => item.title), ["Блок", "Пик"]);
    assert.deepEqual(other!.mesocycles[1]!.weeks.map((week) => [week.type, week.workouts.length]), [["heavy", 1], ["deload", 1]]);
    assert.notEqual(other!.mesocycles[1]!.id, own!.mesocycles[1]!.id, "у каждого своя копия");
    assert.equal(other!.mesocycles[1]!.lineageId, own!.mesocycles[1]!.lineageId);
  } finally {
    await close();
  }
});
