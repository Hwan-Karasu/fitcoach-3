import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { completedCount, filterHistory, sortHistory } from "../src/features/training/archive/presentation/trainingHistory.ts";
import { isWorkingSet } from "../src/features/training/analytics/presentation/workingSet.ts";
import { hasEnteredData, sessionDurationSec, workoutStatus } from "../src/features/training/execution/domain/ExecutionRules.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, fillSets, newDraft } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createTrainingHistory } from "../src/read-models/trainingHistory.ts";
import { createProgramDeleteWorkflow } from "../src/workflows/deleteTrainingProgram.ts";
import { createPlanOnlyDeleteWorkflow } from "../src/workflows/deleteTrainingPlanOnly.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Read-model импортирует public.ts фич (там экраны .tsx), поэтому тест живёт здесь.
const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";

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
  const a = (await clients.create({ displayName: "SyntheticA" })).id;
  const b = (await clients.create({ displayName: "SyntheticB" })).id;
  const simple = await plans.createSimpleProgram(a, { title: "Сила", plan: { weeks: 4, workouts: week("s") } });
  const periodized = await plans.createPeriodizedProgram({ title: "Сила", clientIds: [a], mesocycle: { title: "Блок 1", cycleType: null,
    repRange: null, startDate: null, weeks: [{ type: "base", workouts: week("p") }, { type: "base", workouts: [] }] } });
  const revision = async (programId: string) => (await plans.getProgram(a, programId))!.revision;
  await plans.createMesocycle(a, periodized.id, await revision(periodized.id), { title: "Блок 2", weeks: 2, firstWeek: week("q"), clientIds: [a] });
  const otherProgram = await plans.createSimpleProgram(b, { title: "Сила", plan: { weeks: 2, workouts: week("o") } });
  const history = createTrainingHistory({ hasEnteredData, isWorkingSet, sessionDurationSec, workoutStatus, sortHistory }, execution, plans);
  /** Подход в тренировке недели и исход «Завершена»; дата — фактическая дата занятия. */
  const complete = async (clientId: string, programId: string, weekIndex: number, workout: PlannedWorkout, date: string) => {
    const exercise = workout.exercises[0]!;
    const slot = { clientId, programId, weekIndex, plannedWorkoutId: workout.id };
    await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: BENCH, plannedSetId: exercise.sets[0]!.id, position: 0,
      metrics: ["load", "reps"], values: { loadGrams: 50_000, reps: 10, durationSec: null, distanceM: null }, setType: "NORMAL",
      drops: [], rpe: null, expectedRevision: null }, new Date(`${date}T10:00:00Z`));
    const current = (await execution.getWorkout(slot)).session!;
    return execution.setOutcome(slot, "COMPLETED", current.revision, new Date(`${date}T11:00:00Z`));
  };
  const simpleWorkout = (await plans.getSimplePlan(a, simple.id))!.draft.plan.workouts[0]!;
  const cycles = (await plans.getPeriodizedPlan(a, periodized.id))!.mesocycles;
  const lease = await shared.acquire();
  const deleteProgram = createProgramDeleteWorkflow((task) => lease.writer.write(task), plans.deleteParticipant, execution.cleanupParticipant);
  const deletePlanOnly = createPlanOnlyDeleteWorkflow((task) => lease.writer.write(task), plans.deleteParticipant, execution.cleanupParticipant);
  return { db, deletePlanOnly, plans, execution, history, complete, a, b, simple: simple.id, periodized: periodized.id, otherProgram: otherProgram.id,
    simpleWorkout, cycles, revision, deleteProgram,
    close: async () => { await shared.release(); await execution.close(); await plans.close(); await clients.close(); } };
}

test("§48.85.2 п. 1, 2, 5: общая хронология всех программ клиента, фильтры программа → мезоцикл, чужих занятий нет", async () => {
  const env = await setup();
  try {
    const { a, b, simple, periodized, cycles, complete, simpleWorkout, history } = env;
    for (const [index, date] of ["2026-10-01", "2026-10-03", "2026-10-05"].entries()) await complete(a, simple, index + 1, simpleWorkout, date);
    await complete(a, periodized, 1, cycles[0]!.weeks[0]!.workouts[0]!, "2026-10-02");
    await complete(a, periodized, 1, cycles[1]!.weeks[0]!.workouts[0]!, "2026-10-04");
    const otherWorkout = (await env.plans.getSimplePlan(b, env.otherProgram))!.draft.plan.workouts[0]!;
    await complete(b, env.otherProgram, 1, otherWorkout, "2026-10-04");

    const entries = await history.list(a);
    assert.equal(entries.length, 5, "пять разных записей, занятий другого клиента нет");
    assert.deepEqual(entries.map((entry) => entry.actualDate), ["2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    assert.equal(completedCount(filterHistory(entries, { programId: simple, mesocycleId: null, workoutKey: null })), 3);
    assert.equal(completedCount(filterHistory(entries, { programId: periodized, mesocycleId: null, workoutKey: null })), 2);
    const second = filterHistory(entries, { programId: periodized, mesocycleId: cycles[1]!.id, workoutKey: null });
    assert.deepEqual(second.map((entry) => [entry.mesocycleTitle, entry.workoutTitle, entry.weekIndex]), [["Блок 2", "Тренировка 1", 1]]);
    assert.equal(entries[0]!.workingSets, 1, "рабочие подходы — по фактам");
    assert.deepEqual([entries[0]!.startedAt, entries[0]!.finishedAt, entries[0]!.durationSec], ["2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z", 3600],
      "время занятия: первый подход 10:00, «Завершить» 11:00 — 60 минут");
  } finally {
    await env.close();
  }
});

test("§48.85.2 п. 3, 4: смена даты двигает запись, повторное завершение — одна запись", async () => {
  const env = await setup();
  try {
    const { a, simple, complete, simpleWorkout, execution, history } = env;
    const slot = { clientId: a, programId: simple, weekIndex: 1, plannedWorkoutId: simpleWorkout.id };
    await complete(a, simple, 1, simpleWorkout, "2026-10-01");
    await complete(a, simple, 2, simpleWorkout, "2026-10-05");
    let session = (await execution.getWorkout(slot)).session!;
    session = await execution.setOutcome(slot, null, session.revision);
    await execution.setOutcome(slot, "COMPLETED", session.revision);
    session = (await execution.getWorkout(slot)).session!;
    await execution.setActualDate(slot, "2026-10-09", session.revision);
    const entries = await history.list(a);
    assert.equal(entries.length, 2, "завершить → отменить → завершить: одна запись");
    assert.equal(completedCount(entries), 2);
    assert.deepEqual(entries.map((entry) => [entry.weekIndex, entry.actualDate]), [[1, "2026-10-09"], [2, "2026-10-05"]], "дата сдвинула запись");
  } finally {
    await env.close();
  }
});

test("§48.85.2 п. 6: архивная программа остаётся в истории; полное удаление убирает её занятия", async () => {
  const env = await setup();
  try {
    const { a, simple, complete, simpleWorkout, plans, history, deleteProgram, revision } = env;
    await complete(a, simple, 1, simpleWorkout, "2026-10-01");
    await plans.archiveForClient(a, simple);
    const archived = await history.list(a);
    assert.deepEqual(archived.map((entry) => [entry.programTitle, entry.archived]), [["Сила", true]]);
    await deleteProgram.deleteProgram({ clientId: a, programId: simple, expectedRevision: await revision(simple) });
    assert.deepEqual(await history.list(a), [], "удалено с результатами — записи нет");
  } finally {
    await env.close();
  }
});

test("§50.3 действие 1: удалить план архивной программы — занятия остаются в истории с происхождением «план удалён»", async () => {
  const env = await setup();
  try {
    const { a, periodized, cycles, complete, plans, history, deletePlanOnly, revision, db } = env;
    await complete(a, periodized, 1, cycles[1]!.weeks[0]!.workouts[0]!, "2026-10-04");
    await assert.rejects(deletePlanOnly.deletePlanKeepHistory({ clientId: a, programId: periodized, expectedRevision: await revision(periodized) }),
      (error: unknown) => error instanceof Error && error.message === "PROGRAM_NOT_ARCHIVED", "только для архивной программы");
    await plans.archiveForClient(a, periodized);
    await deletePlanOnly.deletePlanKeepHistory({ clientId: a, programId: periodized, expectedRevision: await revision(periodized) });

    assert.equal(await plans.getProgram(a, periodized), null, "плана больше нет");
    const entries = await history.list(a);
    assert.deepEqual(entries.map((entry) => [entry.programTitle, entry.mesocycleTitle, entry.workoutTitle, entry.planDeleted, entry.workingSets]),
      [["Сила", "Блок 2", "Тренировка 1", true, 1]], "факт с неизменяемым происхождением");
    assert.equal(completedCount(entries), 1, "проведённое занятие не потеряно");
    assert.throws(() => db.prepare("UPDATE dev_training_sessions SET origin_json = '{}'").run(), /ORIGIN_IMMUTABLE/, "снимок неизменяем");
    assert.equal((await history.list(a)).length, 1, "повторное чтение — без дублей");
  } finally {
    await env.close();
  }
});

test("§50.2: восстановление архивной программы не делает её текущей и не меняет занятия", async () => {
  const env = await setup();
  try {
    const { a, simple, periodized, complete, simpleWorkout, plans, history } = env;
    await complete(a, simple, 1, simpleWorkout, "2026-10-01");
    await plans.selectProgram(a, periodized);
    await plans.archiveForClient(a, simple);
    const before = await history.list(a);
    await plans.restoreForClient(a, simple);
    const library = await plans.getLibrary(a);
    assert.equal(library.selectedProgramId, periodized, "текущей осталась прежняя программа");
    assert.ok(library.active.some((card) => card.id === simple), "восстановленная — в списке");
    assert.deepEqual((await history.list(a)).map((entry) => [entry.key, entry.archived]), before.map((entry) => [entry.key, false]),
      "те же занятия, без дублей");
  } finally {
    await env.close();
  }
});

test("§48.86.9: плановых тренировок выбранной программы и мезоцикла; без явного выбора, у чужой и у удалённой — нет", async () => {
  const env = await setup();
  try {
    const { a, simple, periodized, cycles, history, otherProgram, deleteProgram, plans, revision } = env;
    assert.equal(await history.planned(a, { programId: simple, mesocycleId: null }), 4, "Простая: 4 недели по одной тренировке");
    assert.equal(await history.planned(a, { programId: periodized, mesocycleId: null }), 4, "два мезоцикла по две недели, в каждой по одной тренировке");
    assert.equal(await history.planned(a, { programId: periodized, mesocycleId: cycles[1]!.id }), 2);
    assert.equal(await history.planned(a, { programId: periodized, mesocycleId: "нет-такого" }), null);
    assert.equal(await history.planned(a, { programId: null, mesocycleId: null }), null, "программа явно не выбрана");
    assert.equal(await history.planned(a, { programId: otherProgram, mesocycleId: null }), null, "программа другого клиента не считается");
    await plans.archiveForClient(a, simple);
    await deleteProgram.deleteProgram({ clientId: a, programId: simple, expectedRevision: await revision(simple) });
    assert.equal(await history.planned(a, { programId: simple, mesocycleId: null }), null, "удалённой программы нет");
  } finally {
    await env.close();
  }
});

test("UX-контракт истории: «рабочих подходов» — засчитанные без разминки, одна функция для истории и статистики", async () => {
  const env = await setup();
  try {
    const { a, simple, simpleWorkout, complete, execution, history } = env;
    await complete(a, simple, 1, simpleWorkout, "2026-10-01");
    const slot = { clientId: a, programId: simple, weekIndex: 1, plannedWorkoutId: simpleWorkout.id };
    const exercise = simpleWorkout.exercises[0]!;
    const warm = await execution.addWarmupSet(slot, { plannedExerciseId: exercise.id, exerciseId: BENCH }, new Date("2026-10-01T09:00:00Z"));
    await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: BENCH, plannedSetId: warm.fact.plannedSetId,
      position: warm.fact.position, metrics: ["load", "reps"], values: { loadGrams: 20_000, reps: 10, durationSec: null, distanceM: null },
      setType: "WARMUP", drops: [], rpe: null, expectedRevision: warm.fact.revision }, new Date("2026-10-01T09:05:00Z"));
    const [entry] = await history.list(a);
    const confirmed = entry!.exercises.flatMap((group) => group.facts).filter((fact) => fact.confirmed);
    assert.equal(confirmed.length, 2, "засчитаны рабочий подход и разминка");
    assert.equal(entry!.workingSets, 1, "разминка в рабочие не входит");
  } finally {
    await env.close();
  }
});

test("UX-контракт истории: ключ тренировки — родство у Расширенной, id у Простой; заметка упражнения попадает в запись", async () => {
  const env = await setup();
  try {
    const { a, simple, periodized, simpleWorkout, cycles, complete, execution, history } = env;
    // Простая: одна тренировка в разных неделях — один ключ; Расширенная: родство тренировки внутри мезоцикла.
    await complete(a, simple, 1, simpleWorkout, "2026-10-01");
    await complete(a, simple, 2, simpleWorkout, "2026-10-08");
    const first = cycles[1]!.weeks[0]!.workouts[0]!;
    const second = cycles[1]!.weeks[1]!.workouts[0]!;
    assert.equal(first.lineageId, second.lineageId, "предусловие: у недель одного мезоцикла общее родство тренировки");
    assert.notEqual(first.id, second.id, "предусловие: плановые тренировки разных недель — разные id");
    await complete(a, periodized, 1, first, "2026-10-02");
    await complete(a, periodized, 2, second, "2026-10-09");
    await complete(a, periodized, 1, cycles[0]!.weeks[0]!.workouts[0]!, "2026-10-03");
    await execution.saveExerciseNote({ clientId: a, programId: simple, weekIndex: 1, plannedWorkoutId: simpleWorkout.id },
      simpleWorkout.exercises[0]!.id, "Левое плечо не тянуло", new Date("2026-10-01T11:00:00Z"));

    const entries = await history.list(a);
    const simpleKeys = entries.filter((entry) => entry.programId === simple).map((entry) => entry.workoutKey);
    assert.deepEqual(simpleKeys, [simpleWorkout.id, simpleWorkout.id], "Простая: ключ — id тренировки, повторяется по неделям");
    const blockTwo = entries.filter((entry) => entry.mesocycleId === cycles[1]!.id).map((entry) => entry.workoutKey);
    assert.deepEqual(blockTwo, [first.lineageId, first.lineageId], "Расширенная: ключ — родство тренировки");
    const blockOne = entries.find((entry) => entry.mesocycleId === cycles[0]!.id)!;
    assert.notEqual(blockOne.workoutKey, first.lineageId, "у другого мезоцикла другое родство");
    assert.deepEqual([blockOne.mesocycleIndex, entries.find((entry) => entry.mesocycleId === cycles[1]!.id)!.mesocycleIndex], [0, 1],
      "порядок мезоцикла в программе");
    assert.equal(entries.find((entry) => entry.programId === simple)!.mesocycleIndex, null, "у Простой мезоцикла нет");
    const noted = entries.find((entry) => entry.programId === simple && entry.weekIndex === 1)!;
    assert.equal(noted.exercises[0]!.note, "Левое плечо не тянуло");
    assert.equal(entries.find((entry) => entry.programId === simple && entry.weekIndex === 2)!.exercises[0]!.note, null, "без заметки — null");
  } finally {
    await env.close();
  }
});

test("пустые строки подходов не делают занятие «начатым»: в истории только введённое или с исходом (как в дневнике, §48.34)", async () => {
  const env = await setup();
  try {
    const { a, simple, simpleWorkout, execution, history } = env;
    const slot = { clientId: a, programId: simple, weekIndex: 1, plannedWorkoutId: simpleWorkout.id };
    const exercise = simpleWorkout.exercises[0]!;
    await execution.addWarmupSet(slot, { plannedExerciseId: exercise.id, exerciseId: BENCH }, new Date("2026-10-01T09:00:00Z"));
    assert.deepEqual(await history.list(a), [], "одна пустая разминка — занятия в истории нет");
    const session = (await execution.getWorkout(slot)).session!;
    await execution.setOutcome(slot, "MISSED", session.revision, new Date("2026-10-01T09:30:00Z"));
    const [entry] = await history.list(a);
    assert.equal(entry!.status, "MISSED", "исход делает запись");
    assert.deepEqual(entry!.exercises, [], "пустая строка подхода в запись не входит");
  } finally {
    await env.close();
  }
});
