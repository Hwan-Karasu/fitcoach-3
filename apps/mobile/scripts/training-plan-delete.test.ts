import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, fillSets, newDraft } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createMesocycleDeleteWorkflow } from "../src/workflows/deleteTrainingMesocycle.ts";
import { createProgramDeleteWorkflow } from "../src/workflows/deleteTrainingProgram.ts";
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
  const a = (await clients.create({ displayName: "SyntheticA" })).id;
  const b = (await clients.create({ displayName: "SyntheticB" })).id;
  const program = await plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a, b] });
  const revision = async () => (await plans.getProgram(a, program.id))!.revision;
  for (const title of ["Блок 1", "Блок 2"]) {
    await plans.createMesocycle(a, program.id, await revision(), { title, weeks: 2, firstWeek: firstWeek(), clientIds: [a, b] });
  }
  const lease = await shared.acquire();
  const transaction = <T>(task: (tx: Parameters<Parameters<typeof lease.writer.write>[0]>[0]) => Promise<T>) => lease.writer.write(task);
  const now = () => new Date("2026-10-19T12:00:00Z");
  const mesocycles = createMesocycleDeleteWorkflow(transaction, plans.deleteParticipant, execution.cleanupParticipant, now);
  const programs = createProgramDeleteWorkflow(transaction, plans.deleteParticipant, execution.cleanupParticipant, now);
  /** Результат в первой тренировке первой недели мезоцикла `index` у клиента. */
  const record = async (clientId: string, index: number) => {
    const cycle = (await plans.getPeriodizedPlan(clientId, program.id))!.mesocycles[index]!;
    const workout = cycle.weeks[0]!.workouts[0]!;
    const exercise = workout.exercises[0]!;
    const slot = { clientId, programId: program.id, weekIndex: 1, plannedWorkoutId: workout.id };
    await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: BENCH, plannedSetId: exercise.sets[0]!.id, position: 0,
      metrics: ["load", "reps"], values: { loadGrams: 80_000, reps: 8, durationSec: null, distanceM: null }, setType: "NORMAL",
      drops: [], rpe: null, expectedRevision: null });
    return slot;
  };
  return { plans, execution, a, b, programId: program.id, revision, mesocycles, programs, record,
    close: async () => { await shared.release(); await execution.close(); await plans.close(); await clients.close(); } };
}

test("§48.11 удаление мезоцикла у этого клиента: недели и результаты уходят, у второго участника — остаются", async () => {
  const { plans, execution, a, b, programId, revision, mesocycles, record, close } = await setup();
  try {
    const slotA = await record(a, 0);
    const slotB = await record(b, 0);
    const [first, second] = (await plans.getPeriodizedPlan(a, programId))!.mesocycles;
    await plans.selectMesocycle(a, programId, first!.id);

    const selected = await mesocycles.deleteMesocycle({ clientId: a, programId, mesocycleId: first!.id, expectedRevision: await revision() });

    const after = (await plans.getPeriodizedPlan(a, programId))!;
    assert.deepEqual(after.mesocycles.map((cycle) => cycle.title), ["Блок 2"]);
    assert.equal(selected, second!.id, "выбор — к ближайшему");
    assert.equal(after.selectedMesocycleId, second!.id);
    assert.equal((await execution.getWorkout(slotA)).session, null, "результаты удалённого мезоцикла удалены");
    assert.deepEqual((await plans.getPeriodizedPlan(b, programId))!.mesocycles.map((cycle) => cycle.title), ["Блок 1", "Блок 2"]);
    assert.notEqual((await execution.getWorkout(slotB)).session, null, "у второго участника результаты на месте");
    await assert.rejects(mesocycles.deleteMesocycle({ clientId: a, programId, mesocycleId: second!.id, expectedRevision: await revision() }),
      (error: unknown) => error instanceof Error && error.message === "LAST_MESOCYCLE", "последний мезоцикл не удаляется");
  } finally {
    await close();
  }
});

test("§50.3 удаление программы полностью: у одного участника — только его данные, у последнего — программа целиком", async () => {
  const { plans, execution, a, b, programId, revision, programs, record, close } = await setup();
  try {
    const slotA = await record(a, 1);
    const slotB = await record(b, 1);
    await programs.deleteProgram({ clientId: a, programId, expectedRevision: await revision() });
    assert.equal(await plans.getProgram(a, programId), null);
    assert.deepEqual((await plans.getLibrary(a)).active, [], "у клиента программы нет");
    assert.equal((await execution.getWorkout(slotA)).session, null, "его результаты удалены");
    assert.deepEqual((await plans.getProgram(b, programId))!.memberClientIds, [b], "у второго программа осталась");
    assert.notEqual((await execution.getWorkout(slotB)).session, null, "и его результаты");

    await programs.deleteProgram({ clientId: b, programId, expectedRevision: (await plans.getProgram(b, programId))!.revision });
    assert.equal(await plans.getProgram(b, programId), null, "последний участник — программы больше нет");
    assert.equal((await execution.getWorkout(slotB)).session, null);
  } finally {
    await close();
  }
});
