import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, newDraft, setTitle } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import { createActiveWorkouts } from "../apps/mobile/src/read-models/activeWorkouts.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:synthetic-bench";
const DAY = new Date(2026, 9, 18, 10, 0);

test("T03 быстрый переход (§48.83): карточки «в работе» с клиентом, программой и тренировкой; архивный клиент скрыт", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant,
    devTrainingExecutionClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const draft = (p: string, title: string) => addExercise(setTitle(newDraft(`${p}w`), title), `${p}w`, `${p}e`, BENCH,
      (index) => `${p}s${index}`);
    const programA = await plans.createSimpleProgram(a.id, draft("a", "База"));
    const programB = await plans.createSimpleProgram(b.id, draft("b", "Сила"));
    for (const [client, program, p] of [[a.id, programA.id, "a"], [b.id, programB.id, "b"]] as const) {
      await execution.saveSet({ slot: { clientId: client, programId: program, weekIndex: 2, plannedWorkoutId: `${p}w` },
        plannedExerciseId: `${p}e`, exerciseId: BENCH, plannedSetId: `${p}s0`, position: 0, metrics: ["load", "reps"],
        values: { reps: 8, loadGrams: 60_000, durationSec: null, distanceM: null }, drops: [], rpe: null, setType: "NORMAL",
        expectedRevision: null }, DAY);
    }
    const active = createActiveWorkouts(execution, plans, clients);
    const cards = await active.list();
    assert.deepEqual(cards.map((card) => [card.clientName, card.programTitle, card.workoutTitle, card.slot.weekIndex]).sort(),
      [["SyntheticA", "База", "Тренировка 1", 2], ["SyntheticB", "Сила", "Тренировка 1", 2]]);
    await clients.setArchived(b.id, b.revision, true);
    assert.deepEqual((await active.list()).map((card) => card.clientName), ["SyntheticA"], "архивный клиент не показывается");
  } finally {
    await execution.close();
    await plans.close();
    await clients.close();
  }
});
