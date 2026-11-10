import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DevExerciseCatalogRepository } from "../src/features/exercises/data/DevExerciseCatalogRepository.ts";
import type { SystemCatalog } from "../src/features/exercises/domain/ExerciseModel.ts";
import { createLocalRepositories } from "../src/app/composition/createLocalRepositories.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const CATALOG: SystemCatalog = { exercises: [], meta: { provider: "REPDB", datasetName: "synthetic", datasetSchemaVersion: 3,
  sourceSha256: "0", importedAt: "2026-11-10", license: "synthetic", attribution: "synthetic", count: 0, missingRuNames: 0 } };
const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);
async function store() {
  const db = new DatabaseSync(":memory:");
  const repository = new DevExerciseCatalogRepository(new SharedSqliteDatabase(async () => nodeSqlitePort(db)), WS, CATALOG);
  await repository.initialize();
  return { repository };
}

test("AUDIT-ALL-1: профиль свободного упражнения меняется, после фактов и удаления плана — заблокирован; переименование разрешено", async () => {
  const db = new DatabaseSync(":memory:");
  const database = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const owners = createLocalRepositories(database, WS, CATALOG);
  await owners.initialize();
  try {
    const client = await owners.clients.create({ displayName: "Synthetic Exercise History" });
    const input = { name: "Synthetic Exercise", bodyPart: "chest" as const, equipment: "barbell", trackingProfile: "REPS" as const };
    const made = await owners.exercises.createCustom(input);
    await owners.exercises.updateCustom(made.id, 1, { ...input, trackingProfile: "LOAD_REPS" });
    const slot = { clientId: client.id, programId: "synthetic-program", plannedWorkoutId: "synthetic-workout", weekIndex: 1 };
    // Оба вызова поставлены в общую очередь до завершения факта: проверка истории должна идти внутри транзакции правки.
    const saving = owners.trainingExecution.saveSet({ slot, plannedExerciseId: "synthetic-pe", exerciseId: made.id,
      plannedSetId: "synthetic-ps", position: 0, metrics: ["load", "reps"],
      values: { reps: 8, loadGrams: 50_000, durationSec: null, distanceM: null }, drops: [], rpe: null,
      setType: "NORMAL", expectedRevision: null });
    const changing = owners.exercises.updateCustom(made.id, 2, { ...input, trackingProfile: "DURATION" });
    await assert.rejects(changing, message("EXERCISE_PROFILE_IN_USE"));
    await saving;
    await owners.exercises.updateCustom(made.id, 2, { ...input, name: "Synthetic Renamed", trackingProfile: "LOAD_REPS" });
    assert.equal((await owners.exercises.get(made.id))!.definition.name, "Synthetic Renamed");
    const lease = await database.acquire();
    try {
      await lease.writer.write((tx) => owners.trainingExecution.cleanupParticipant.keepAsHistory(tx, client.id, slot.programId,
        () => ({ programTitle: "Synthetic program", programKind: "SIMPLE", mesocycleTitle: null, workoutTitle: "Synthetic workout" }), new Date()));
    } finally { await database.release(); }
    await assert.rejects(owners.exercises.updateCustom(made.id, 3, { ...input, trackingProfile: "DURATION" }), message("EXERCISE_PROFILE_IN_USE"));
    await owners.clients.setArchived(client.id, client.revision, true);
    await assert.rejects(owners.exercises.updateCustom(made.id, 3, { ...input, trackingProfile: "DURATION" }), message("EXERCISE_PROFILE_IN_USE"));
    assert.equal((await owners.trainingExecution.getWorkout(slot)).facts.values().next().value!.values.loadGrams, 50_000);
  } finally { await owners.close(); }
});

test("AUDIT-ALL-1: отсутствие проверки владельца истории не разрешает потенциально разрушительную смену профиля", async () => {
  const { repository } = await store();
  try {
    const input = { name: "Synthetic closed guard", bodyPart: "chest" as const, equipment: null, trackingProfile: "REPS" as const };
    const created = await repository.createCustom(input);
    await assert.rejects(repository.updateCustom(created.id, 1, { ...input, trackingProfile: "DURATION" }), message("EXERCISE_HISTORY_UNAVAILABLE"));
    await repository.updateCustom(created.id, 1, { ...input, name: "Synthetic renamed" });
    assert.equal((await repository.get(created.id))!.definition.trackingProfile, "REPS");
  } finally { await repository.close(); }
});
