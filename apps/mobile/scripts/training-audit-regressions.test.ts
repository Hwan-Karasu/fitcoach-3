import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { copyWeekPlan } from "../src/features/training/plans/domain/MesocycleBuilder.ts";
import { addExercise, fillSets, newDraft, removeSet } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedExercise } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createWeekCopyWorkflow } from "../src/workflows/copyTrainingWeek.ts";
import { createProgramDeleteWorkflow } from "../src/workflows/deleteTrainingProgram.ts";
import { createPlanOnlyDeleteWorkflow } from "../src/workflows/deleteTrainingPlanOnly.ts";
import { createMesocycleSaveWorkflow } from "../src/workflows/saveTrainingMesocycle.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Регрессии аудита «Тренировок» (docs/TRAINING_AUDIT.md). Workflows импортируют public.ts фич, поэтому тест живёт здесь.
const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";
const METRICS = ["load", "reps"] as const;
const message = (code: string) => (error: unknown) => error instanceof Error && error.message === code;

function workoutWith(setCount: number): SimpleDraft {
  let n = 0;
  let draft = fillSets(addExercise(newDraft("w1"), "w1", "e1", BENCH, () => `s${n++}`), "e1", "reps", 10);
  while (draft.plan.workouts[0]!.exercises[0]!.sets.length < setCount) {
    const exercise = draft.plan.workouts[0]!.exercises[0]!;
    const next = { ...exercise, sets: [...exercise.sets, { ...exercise.sets[0]!, id: `s${n++}` }] };
    draft = { ...draft, plan: { ...draft.plan, workouts: [{ ...draft.plan.workouts[0]!, exercises: [next] }] } };
  }
  return draft;
}
type SimpleDraft = ReturnType<typeof newDraft>;

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
  const lease = await shared.acquire();
  const tx = <T>(task: (tx: never) => Promise<T>) => lease.writer.write(task as never) as Promise<T>;
  const fill = (slot: never, exercise: PlannedExercise, setIndex: number, reps: number) => execution.saveSet({ slot, plannedExerciseId: exercise.id,
    exerciseId: exercise.exerciseId, plannedSetId: exercise.sets[setIndex]!.id, position: setIndex, metrics: METRICS,
    values: { loadGrams: 50_000, reps, durationSec: null, distanceM: null }, setType: "NORMAL", drops: [], rpe: null, expectedRevision: null });
  const periodized = async (sets: number, weeks: number, clientIds: string[] = [a]) => {
    const program = await plans.createProgram({ kind: "PERIODIZED", title: "Проверка", clientIds });
    const created = await plans.createMesocycle(a, program.id, program.revision,
      { title: "Блок", weeks, firstWeek: workoutWith(sets).plan.workouts, clientIds });
    return { programId: program.id, mesocycleId: created.mesocycleId };
  };
  const cycleOf = async (clientId: string, programId: string) => (await plans.getPeriodizedPlan(clientId, programId))!;
  return { plans, execution, a, b, tx, fill, periodized, cycleOf, shared,
    close: async () => { await shared.release(); await execution.close(); await plans.close(); await clients.close(); } };
}

test("TRN-001 удаление подхода с областью «следующие недели»: факты остаются у своих подходов", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(4, 2);
    const plan = await env.cycleOf(env.a, programId);
    const w2 = plan.mesocycles[0]!.weeks[1]!.workouts[0]!;
    const slot2 = { clientId: env.a, programId, weekIndex: 2, plannedWorkoutId: w2.id } as never;
    for (let i = 0; i < 4; i++) await env.fill(slot2, w2.exercises[0]!, i, i + 1);
    const w1 = plan.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const ex1 = w1.exercises[0]!;
    const edited = removeSet({ title: "x", plan: { weeks: 1, workouts: [w1] } }, ex1.id, ex1.sets[1]!.id).plan.workouts;
    await env.plans.saveWeek(env.a, programId, plan.program.revision, { mesocycleId, weekIndex: 1, workouts: edited, type: "base",
      scope: "FOLLOWING", clientIds: [env.a] });
    const after = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!.exercises[0]!;
    const facts = (await env.execution.getWorkout(slot2)).facts;
    assert.deepEqual(after.sets.map((set) => facts.get(set.id)?.values.reps ?? null), [1, 3, 4]);
  } finally { await env.close(); }
});

test("TRN-001 добавление подхода в середину не сдвигает факты целевых недель", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(3, 2);
    const plan = await env.cycleOf(env.a, programId);
    const w2 = plan.mesocycles[0]!.weeks[1]!.workouts[0]!;
    const slot2 = { clientId: env.a, programId, weekIndex: 2, plannedWorkoutId: w2.id } as never;
    for (let i = 0; i < 3; i++) await env.fill(slot2, w2.exercises[0]!, i, i + 1);
    const w1 = plan.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const ex = w1.exercises[0]!;
    const added = { ...ex, sets: [ex.sets[0]!, { ...ex.sets[0]!, id: "new-middle" }, ex.sets[1]!, ex.sets[2]!] };
    await env.plans.saveWeek(env.a, programId, plan.program.revision, { mesocycleId, weekIndex: 1, workouts: [{ ...w1, exercises: [added] }],
      type: "base", scope: "FOLLOWING", clientIds: [env.a] });
    const after = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!.exercises[0]!;
    const facts = (await env.execution.getWorkout(slot2)).facts;
    assert.deepEqual(after.sets.map((set) => facts.get(set.id)?.values.reps ?? null), [1, null, 2, 3]);
  } finally { await env.close(); }
});

test("TRN-005 сохранение мезоцикла без структурных изменений не создаёт версию и не меняет ревизию", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(3, 3);
    const save = createMesocycleSaveWorkflow(env.tx, env.plans.mesocycleSaveParticipant, env.execution.weekCopyParticipant);
    const plan = await env.cycleOf(env.a, programId);
    const cycle = plan.mesocycles[0]!;
    const request = (title: string) => ({ clientId: env.a, programId, expectedRevision: plan.program.revision, mesocycleId, clientIds: [env.a],
      mesocycle: { title, cycleType: cycle.cycleType ?? null, repRange: cycle.repRange ?? null, startDate: cycle.startDate ?? null,
        weeks: cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts })) } });
    const versions = (await env.plans.getMesocycleVersions(env.a, programId, mesocycleId)).length;
    await save.save(request(cycle.title));
    assert.equal((await env.plans.getMesocycleVersions(env.a, programId, mesocycleId)).length, versions, "без изменений — без версии");
    assert.equal((await env.cycleOf(env.a, programId)).program.revision, plan.program.revision, "без изменений — ревизия прежняя");
    await save.save(request("Новое название"));
    assert.equal((await env.cycleOf(env.a, programId)).mesocycles[0]!.title, "Новое название", "название применено к существующему");
    assert.equal((await env.plans.getMesocycleVersions(env.a, programId, mesocycleId)).length, versions, "смена названия — не структурная версия");
  } finally { await env.close(); }
});

test("TRN-006 копия недели «с данными / Нет» не делает целевую тренировку «В работе»", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(2, 3);
    const plan = await env.cycleOf(env.a, programId);
    const w1 = plan.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const slot1 = { clientId: env.a, programId, weekIndex: 1, plannedWorkoutId: w1.id } as never;
    await env.fill(slot1, w1.exercises[0]!, 0, 8);
    await env.fill(slot1, w1.exercises[0]!, 1, 8);
    const lookup = { lookup: async () => new Map([[BENCH, { name: "bench", metrics: METRICS, thumbnail: null, unilateral: false }]]), subscribe: () => () => undefined };
    const copy = createWeekCopyWorkflow(env.tx, env.plans.weekCopyParticipant, env.execution.weekCopyParticipant, lookup as never,
      () => new Date("2026-10-21T08:00:00Z"));
    const request = { clientId: env.a, programId, mesocycleId, sourceWeek: 1, targetWeek: 2, expectedRevision: plan.program.revision };
    await copy.copy(request, (await copy.preview(request)).revisionToken, "PREFILL", false);
    const statuses = await env.execution.getProgramStatuses(env.a, programId);
    assert.equal(statuses.find((item) => item.weekIndex === 2)?.status ?? "NOT_STARTED", "NOT_STARTED");
    assert.ok(!(await env.execution.listActiveWorkouts()).some((item) => item.weekIndex === 2));
    // Правка скопированного значения тренером — уже ввод.
    const target = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!;
    const targetSlot = { clientId: env.a, programId, weekIndex: 2, plannedWorkoutId: target.id } as never;
    const fact = (await env.execution.getWorkout(targetSlot)).facts.get(target.exercises[0]!.sets[0]!.id)!;
    await env.execution.saveSet({ slot: targetSlot, plannedExerciseId: target.exercises[0]!.id, exerciseId: BENCH, plannedSetId: fact.plannedSetId,
      position: 0, metrics: METRICS, values: { ...fact.values, reps: 9 }, setType: "NORMAL", drops: [], rpe: null, expectedRevision: fact.revision });
    assert.equal((await env.execution.getProgramStatuses(env.a, programId)).find((item) => item.weekIndex === 2)?.status, "IN_PROGRESS");
  } finally { await env.close(); }
});

test("TRN-008 копия недели «Да» не ставит началом занятия момент копирования", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(2, 2);
    const plan = await env.cycleOf(env.a, programId);
    const w1 = plan.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const slot1 = { clientId: env.a, programId, weekIndex: 1, plannedWorkoutId: w1.id } as never;
    await env.fill(slot1, w1.exercises[0]!, 0, 8);
    const lookup = { lookup: async () => new Map([[BENCH, { name: "bench", metrics: METRICS, thumbnail: null, unilateral: false }]]), subscribe: () => () => undefined };
    const copy = createWeekCopyWorkflow(env.tx, env.plans.weekCopyParticipant, env.execution.weekCopyParticipant, lookup as never,
      () => new Date("2026-10-21T08:00:00Z"));
    const request = { clientId: env.a, programId, mesocycleId, sourceWeek: 1, targetWeek: 2, expectedRevision: plan.program.revision };
    await copy.copy(request, (await copy.preview(request)).revisionToken, "CONFIRM", false);
    const target = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!;
    const session = (await env.execution.getWorkout({ clientId: env.a, programId, weekIndex: 2, plannedWorkoutId: target.id })).session!;
    assert.equal(session.startedAt, null);
  } finally { await env.close(); }
});

test("TRN-004 сохранение мезоцикла не заменяет тренировки недели с результатами без отказа WEEK_HAS_RESULTS", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(2, 2);
    const plan = await env.cycleOf(env.a, programId);
    const cycle = plan.mesocycles[0]!;
    const w2 = cycle.weeks[1]!.workouts[0]!;
    await env.fill({ clientId: env.a, programId, weekIndex: 2, plannedWorkoutId: w2.id } as never, w2.exercises[0]!, 0, 7);
    let n = 0;
    const weeks = cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts }));
    weeks[1] = copyWeekPlan(weeks[0]!, () => `copy-${n++}`);
    const save = createMesocycleSaveWorkflow(env.tx, env.plans.mesocycleSaveParticipant, env.execution.weekCopyParticipant);
    await assert.rejects(save.save({ clientId: env.a, programId, expectedRevision: plan.program.revision, mesocycleId, clientIds: [env.a],
      mesocycle: { title: cycle.title, cycleType: null, repRange: null, startDate: null, weeks } }), message("WEEK_HAS_RESULTS"));
    assert.equal((await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!.id, w2.id, "план не изменён");
  } finally { await env.close(); }
});

test("TRN-007 «Удалить программу полностью» не стирает ранее сохранённую историю «план удалён»", async () => {
  const env = await setup();
  try {
    const { programId } = await env.periodized(2, 2, [env.a, env.b]);
    const own = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[0]!.workouts[0]!;
    await env.fill({ clientId: env.a, programId, weekIndex: 1, plannedWorkoutId: own.id } as never, own.exercises[0]!, 0, 5);
    const revision = async () => (await env.plans.getProgram(env.b, programId))!.revision;
    await env.plans.archiveForClient(env.a, programId);
    await createPlanOnlyDeleteWorkflow(env.tx, env.plans.deleteParticipant, env.execution.cleanupParticipant)
      .deletePlanKeepHistory({ clientId: env.a, programId, expectedRevision: await revision() });
    const bCycle = (await env.cycleOf(env.b, programId)).mesocycles[0]!;
    await env.plans.addParticipants(env.b, programId, await revision(), bCycle.id, env.b, [{ clientId: env.a, target: { kind: "join" } }]);
    await createProgramDeleteWorkflow(env.tx, env.plans.deleteParticipant, env.execution.cleanupParticipant)
      .deleteProgram({ clientId: env.a, programId, expectedRevision: await revision() });
    assert.equal((await env.execution.listClientExecutions(env.a)).filter((item) => item.origin !== null).length, 1);
  } finally { await env.close(); }
});
