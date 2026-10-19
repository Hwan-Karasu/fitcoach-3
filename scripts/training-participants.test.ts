import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, fillSets, newDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";

async function setup() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const [a, b, c, d] = await Promise.all(["SyntheticA", "SyntheticB", "SyntheticC", "SyntheticD"]
    .map((displayName) => clients.create({ displayName })));
  let n = 0;
  const workouts = fillSets(addExercise(newDraft("w1"), "w1", "e1", BENCH, () => `s${n++}`), "e1", "reps", 10).plan.workouts;
  const program = await plans.createPeriodizedProgram({ title: "Группа", clientIds: [a!.id, b!.id, c!.id], mesocycle: {
    title: "Блок", cycleType: null, repRange: null, startDate: null, weeks: [{ type: "heavy", workouts }, { type: "base", workouts: [] }] } });
  const group = async (clientId: string) => (await plans.getProgram(clientId, program.id))?.memberClientIds;
  const revision = async () => (await plans.getProgram(a!.id, program.id))!.revision;
  return { db, plans, a: a!.id, b: b!.id, c: c!.id, d: d!.id, programId: program.id, group, revision,
    close: async () => { await plans.close(); await clients.close(); } };
}

test("UI-OWN-042 убранный участник сохраняет программу и план, но выходит из группы", async () => {
  const { plans, a, b, c, programId, group, revision, close } = await setup();
  try {
    const planB = await plans.getPeriodizedPlan(b, programId);
    await plans.leaveGroup(a, programId, await revision(), b);

    assert.deepEqual(await group(a), [a, c], "у остальных его нет");
    assert.deepEqual(await group(c), [a, c]);
    assert.deepEqual(await group(b), [b], "у него группа — только он");
    assert.deepEqual((await plans.getPeriodizedPlan(b, programId))!.mesocycles, planB!.mesocycles, "план на месте");
    assert.deepEqual([(await plans.getLibrary(a)).active[0]!.memberCount, (await plans.getLibrary(b)).active[0]!.memberCount], [2, 1]);
    await assert.rejects(plans.createMesocycle(a, programId, await revision(), { title: "Новый", weeks: 1,
      firstWeek: planB!.mesocycles[0]!.weeks[0]!.workouts, clientIds: [a, b] }),
    (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID", "групповая правка его не задевает");
    await assert.rejects(plans.leaveGroup(a, programId, await revision(), a),
      (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID", "открывший клиент себя не убирает");
  } finally {
    await close();
  }
});

test("UI-OWN-042 добавленный участник получает копию плана выбранного источника; вернувшийся — свой план", async () => {
  const { plans, a, b, c, d, programId, group, revision, close } = await setup();
  try {
    const planA = (await plans.getPeriodizedPlan(a, programId))!;
    const planC = (await plans.getPeriodizedPlan(c, programId))!;
    await plans.leaveGroup(a, programId, await revision(), b);
    const planB = (await plans.getPeriodizedPlan(b, programId))!;

    await plans.addParticipants(a, programId, await revision(), c, [d, b]);

    assert.deepEqual(await group(a), [a, b, c, d]);
    const planD = (await plans.getPeriodizedPlan(d, programId))!;
    const shape = (cycle: typeof planC.mesocycles[number]) => cycle.weeks.map((week) => [week.type,
      week.workouts.map((workout) => workout.exercises.map((exercise) => [exercise.exerciseId, exercise.sets.length]))]);
    assert.deepEqual(planD.mesocycles.map(shape), planC.mesocycles.map(shape), "план источника");
    assert.notEqual(planD.mesocycles[0]!.id, planC.mesocycles[0]!.id, "своя копия");
    assert.equal(planD.mesocycles[0]!.lineageId, planC.mesocycles[0]!.lineageId, "то же родство — групповые правки и переключение");
    assert.equal(planD.selectedMesocycleId, planD.mesocycles[0]!.id);
    assert.deepEqual((await plans.getPeriodizedPlan(b, programId))!.mesocycles, planB.mesocycles, "вернувшийся — со своим планом");
    assert.deepEqual((await plans.getPeriodizedPlan(a, programId))!.mesocycles, planA.mesocycles, "остальные не изменились");
    await assert.rejects(plans.addParticipants(a, programId, await revision(), c, [d]),
      (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID", "уже в группе");
  } finally {
    await close();
  }
});

test("UI-OWN-042 схема: дата выхода из группы не бывает пустой строкой", async () => {
  const { db, b, programId, close } = await setup();
  try {
    assert.throws(() => db.prepare("UPDATE dev_training_program_members SET group_left_at = '' WHERE program_id = ? AND client_id = ?")
      .run(programId, b), /CHECK/);
  } finally {
    await close();
  }
});
