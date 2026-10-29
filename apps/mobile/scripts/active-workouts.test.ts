import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository, devTrainingExecutionClientDeletionParticipant } from
  "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, newDraft, setTitle } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import { createActiveWorkouts } from "../src/read-models/activeWorkouts.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

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
    let invalidations = 0;
    const off = active.subscribe(() => { invalidations += 1; });
    await clients.setArchived(b.id, b.revision, true);
    assert.equal(invalidations, 1, "client lifecycle invalidates active cards without execution writes");
    assert.deepEqual((await active.list()).map((card) => card.clientName), ["SyntheticA"], "архивный клиент не показывается");
    const current = (await plans.getProgram(a.id, programA.id))!;
    await plans.renameProgram(programA.id, current.revision, "Synthetic renamed");
    assert.equal(invalidations, 2, "plan titles invalidate cards");
    assert.equal((await active.list())[0]!.programTitle, "Synthetic renamed");
    // Запись подхода подписи не меняет: повторный список берёт карточки из кэша, клиенты и планы не перечитываются.
    let lookups = 0;
    const counting = createActiveWorkouts(execution, { findWorkout: (...args: Parameters<typeof plans.findWorkout>) => { lookups += 1; return plans.findWorkout(...args); },
      subscribeCommittedChanges: (listener) => plans.subscribeCommittedChanges(listener) }, clients);
    await counting.list(); const first = lookups;
    await execution.saveSet({ slot: { clientId: a.id, programId: programA.id, weekIndex: 2, plannedWorkoutId: "aw" }, plannedExerciseId: "ae",
      exerciseId: BENCH, plannedSetId: "as0", position: 0, metrics: ["load", "reps"],
      values: { reps: 9, loadGrams: 60_000, durationSec: null, distanceM: null }, drops: [], rpe: null, setType: "NORMAL",
      expectedRevision: (await execution.getWorkout({ clientId: a.id, programId: programA.id, weekIndex: 2, plannedWorkoutId: "aw" }))
        .facts.get("as0")!.revision }, DAY);
    await counting.list();
    assert.equal(lookups, first, "после записи подхода планы заново не читаются");
    await plans.renameProgram(programA.id, (await plans.getProgram(a.id, programA.id))!.revision, "Third");
    assert.equal((await counting.list())[0]!.programTitle, "Third", "смена плана сбрасывает кэш и без подписчиков");
    const before = invalidations;
    off();
    await clients.setArchived(b.id, b.revision + 1, false);
    assert.equal(invalidations, before, "unsubscribing removes all three observers");
  } finally {
    await execution.close();
    await plans.close();
    await clients.close();
  }
});
