import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { CYCLE_REST_SQL, cycleRestMigration } from "../apps/mobile/src/features/training/plans/data/CycleRestMigration.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { devTrainingPlansCatalog } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansCatalog.ts";
import { addExercise, newDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import { CYCLE_REST_SEC, type CycleRestType } from "../apps/mobile/src/shared/training-transfer/CycleRest.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const week = (id: string) => {
  let n = 0;
  return addExercise(addExercise(newDraft(`w-${id}`), `w-${id}`, `e1-${id}`, "sys:repdb:bench", () => `s${id}${n++}`), `w-${id}`, `e2-${id}`, "sys:repdb:squat", () => `s${id}${n++}`).plan.workouts;
};

test("миграция v5: отдых упражнений мезоциклов выставляется по типу цикла; без типа и простые программы не меняются", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  try {
    const client = await clients.create({ displayName: "SyntheticRest" });
    const types: readonly (CycleRestType | null)[] = ["hypertrophy", "strength", "power", "endurance", "recomp", "custom", null];
    for (const type of types) {
      await plans.createPeriodizedProgram({ title: `П ${type}`, clientIds: [client.id], mesocycle: { title: `Ц ${type}`, cycleType: type, repRange: null,
        startDate: null, weeks: [{ type: "base", workouts: week(String(type)) }, { type: "heavy", workouts: week(`${type}2`) }] } });
    }
    await plans.createSimpleProgram(client.id, { title: "Простая", plan: { weeks: 2, workouts: week("simple") } });
    // Прежние данные: у одних упражнений отдыха нет, у других заданный вручную.
    db.exec("UPDATE training_planned_exercises SET rest_sec = NULL WHERE position = 0");
    db.exec("UPDATE training_planned_exercises SET rest_sec = 45 WHERE position = 1");
    db.exec(CYCLE_REST_SQL);
    const simple = (await plans.getLibrary(client.id)).active.find((item) => item.title === "Простая")!;
    const simpleRests = (await plans.getSimpleWeeks(client.id, simple.id)).flatMap((w) => w.workouts.flatMap((x) => x.exercises.map((item) => item.restSec)));
    const library = await plans.getLibrary(client.id);
    for (const type of types) {
      const program = library.active.find((item) => item.title === `П ${type}`)!;
      const cycle = (await plans.getPeriodizedPlan(client.id, program.id))!.mesocycles[0]!;
      const exercises = cycle.weeks.flatMap((w) => w.workouts.flatMap((x) => x.exercises));
      const expected = type === null ? [null, 45, null, 45] : Array(4).fill(CYCLE_REST_SEC[type]);
      assert.deepEqual(exercises.map((item) => item.restSec), expected, `тип ${type}`);
    }
    assert.deepEqual(simpleRests.slice(0, 2), [null, 45], "простая программа не менялась");
  } finally { await plans.close(); await clients.close(); }
});

test("миграция v5 стоит последней в каталоге планов и идёт одним шагом", () => {
  assert.equal(devTrainingPlansCatalog.at(-1), cycleRestMigration);
  assert.equal(cycleRestMigration.version, 5);
  assert.equal(cycleRestMigration.statements.length, 1);
});
