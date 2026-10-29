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
import type { SqliteConnectionPort } from "../src/shared/db/SqlitePort.ts";
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

/** Запросы внутри транзакций записи, пока `recording` включён (PERF-PLAN-BATCH: каждый запрос на телефоне — обмен по мосту Expo). */
function recordingPort(db: DatabaseSync, journal: { recording: boolean; sql: string[] }): SqliteConnectionPort {
  const port = nodeSqlitePort(db);
  const log = (sql: string) => { if (journal.recording) journal.sql.push(sql.replace(/\s+/gu, " ").trim()); };
  return { ...port, exclusive: (task) => port.exclusive((tx) => task({
    run: (sql, bindings) => { log(sql); return tx.run(sql, bindings); },
    first: (sql, bindings) => { log(sql); return tx.first(sql, bindings); },
    all: (sql, bindings) => { log(sql); return tx.all(sql, bindings); },
  })) };
}

async function setup() {
  const db = new DatabaseSync(":memory:");
  const journal = { recording: false, sql: [] as string[] };
  const shared = new SharedSqliteDatabase(async () => recordingPort(db, journal));
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
  return { db, plans, execution, a, b, tx, fill, periodized, cycleOf, shared, journal,
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
    const save = createMesocycleSaveWorkflow(env.tx, env.plans.mesocycleSaveParticipant, env.execution.weekCopyParticipant, env.execution.cleanupParticipant);
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
    const save = createMesocycleSaveWorkflow(env.tx, env.plans.mesocycleSaveParticipant, env.execution.weekCopyParticipant, env.execution.cleanupParticipant);
    await assert.rejects(save.save({ clientId: env.a, programId, expectedRevision: plan.program.revision, mesocycleId, clientIds: [env.a],
      mesocycle: { title: cycle.title, cycleType: null, repRange: null, startDate: null, weeks } }), message("WEEK_HAS_RESULTS"));
    assert.equal((await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!.id, w2.id, "план не изменён");
    // С явным выбором: результаты остаются в истории, план заменён.
    const mesocycle = { title: cycle.title, cycleType: null, repRange: null, startDate: null, weeks };
    await save.save({ clientId: env.a, programId, expectedRevision: plan.program.revision, mesocycleId, clientIds: [env.a], mesocycle,
      resultsAction: "KEEP_HISTORY" });
    assert.notEqual((await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!.id, w2.id, "план заменён");
    const kept = (await env.execution.listClientExecutions(env.a)).filter((item) => item.plannedWorkoutId === w2.id);
    assert.equal(kept.length, 1, "результаты недели 2 остались в истории");
    assert.equal(kept[0]!.origin?.workoutTitle, w2.title);
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

test("TRN-014 сокращение недель Простой программы с результатами: сначала вопрос, после подтверждения результаты остаются в истории", async () => {
  const { createSimplePlanSaveWorkflow } = await import("../src/workflows/saveTrainingSimplePlan.ts");
  const env = await setup();
  try {
    const draft = { ...workoutWith(2), title: "Простая" };
    const program = await env.plans.createSimpleProgram(env.a, { ...draft, plan: { ...draft.plan, weeks: 4 } });
    const plan = (await env.plans.getSimplePlan(env.a, program.id))!;
    const workout = plan.draft.plan.workouts[0]!;
    const slot4 = { clientId: env.a, programId: program.id, weekIndex: 3, plannedWorkoutId: workout.id } as never;
    await env.fill(slot4, workout.exercises[0]!, 0, 6);
    const save = createSimplePlanSaveWorkflow(env.tx, env.plans.simplePlanSaveParticipant, env.execution.weekCopyParticipant);
    const request = (weeks: number, confirmRemovedResults: boolean) => ({ clientId: env.a, programId: program.id,
      expectedRevision: plan.program.revision, draft: { ...plan.draft, plan: { ...plan.draft.plan, weeks } }, confirmRemovedResults });
    await assert.rejects(save.saveSimplePlan(request(2, false)), message("WEEKS_HAVE_RESULTS"));
    assert.equal((await env.plans.getSimpleWeeks(env.a, program.id)).length, 4, "без подтверждения ничего не изменилось");
    await save.saveSimplePlan(request(3, false));
    assert.equal((await env.plans.getSimpleWeeks(env.a, program.id)).length, 3, "убираемая неделя без результатов — без вопроса");
    const fresh = (await env.plans.getSimplePlan(env.a, program.id))!;
    const shorter = { clientId: env.a, programId: program.id, expectedRevision: fresh.program.revision,
      draft: { ...fresh.draft, plan: { ...fresh.draft.plan, weeks: 2 } } };
    await assert.rejects(save.saveSimplePlan({ ...shorter, confirmRemovedResults: false }), message("WEEKS_HAVE_RESULTS"));
    await save.saveSimplePlan({ ...shorter, confirmRemovedResults: true });
    assert.equal((await env.plans.getSimpleWeeks(env.a, program.id)).length, 2);
    assert.equal((await env.execution.getWorkout(slot4)).facts.size, 1, "результат недели 4 сохранён в базе (история)");
  } finally { await env.close(); }
});

test("TRN-014 тренировка с результатами, убранная из базового плана Простой программы, тоже требует подтверждения", async () => {
  const { createSimplePlanSaveWorkflow } = await import("../src/workflows/saveTrainingSimplePlan.ts");
  const { addWorkout } = await import("../src/features/training/plans/domain/SimplePlanEdits.ts");
  const env = await setup();
  try {
    let draft = workoutWith(2);
    let t = 0;
    draft = addExercise(addWorkout(draft, "w2"), "w2", "e2", BENCH, () => `t${t++}`);
    const program = await env.plans.createSimpleProgram(env.a, { ...draft, title: "Простая", plan: { ...draft.plan, weeks: 2 } });
    const plan = (await env.plans.getSimplePlan(env.a, program.id))!;
    const second = plan.draft.plan.workouts[1]!;
    await env.fill({ clientId: env.a, programId: program.id, weekIndex: 1, plannedWorkoutId: second.id } as never, second.exercises[0]!, 0, 5);
    const save = createSimplePlanSaveWorkflow(env.tx, env.plans.simplePlanSaveParticipant, env.execution.weekCopyParticipant);
    const without = { ...plan.draft, plan: { ...plan.draft.plan, workouts: [plan.draft.plan.workouts[0]!] } };
    await assert.rejects(save.saveSimplePlan({ clientId: env.a, programId: program.id, expectedRevision: plan.program.revision,
      draft: without, confirmRemovedResults: false }), message("WEEKS_HAVE_RESULTS"));
    await save.saveSimplePlan({ clientId: env.a, programId: program.id, expectedRevision: plan.program.revision, draft: without,
      confirmRemovedResults: true });
    assert.equal((await env.plans.getSimplePlan(env.a, program.id))!.draft.plan.workouts.length, 1);
  } finally { await env.close(); }
});

test("TRN-002 черновик Простого конструктора переносится на изменившуюся программу: отдых из дневника не теряется", async () => {
  const { rebaseSimpleProgram } = await import("../src/features/training/plans/domain/DraftRebase.ts");
  const { setTitle } = await import("../src/features/training/plans/domain/SimplePlanEdits.ts");
  const env = await setup();
  try {
    const base = { ...workoutWith(3), title: "Исходная" };
    const program = await env.plans.createSimpleProgram(env.a, { ...base, plan: { ...base.plan, weeks: 4 } });
    const plan = (await env.plans.getSimplePlan(env.a, program.id))!;
    const draft = fillSets(setTitle(plan.draft, "Новое название"), plan.draft.plan.workouts[0]!.exercises[0]!.id, "reps", 6);
    await env.plans.saveBuilderDraft(env.a, program.id, plan.program.revision, draft, plan.draft);
    // Пока черновик лежит, отдых упражнения меняется из дневника — ревизия программы растёт.
    await env.plans.setExerciseRest(env.a, program.id, plan.draft.plan.workouts[0]!.exercises[0]!.id, 180);
    const current = (await env.plans.getSimplePlan(env.a, program.id))!;
    assert.notEqual(current.program.revision, plan.program.revision);
    const stored = (await env.plans.getBuilderDraft(env.a, program.id))!;
    assert.deepEqual(stored.base, plan.draft, "база черновика восстановлена");
    const rebased = rebaseSimpleProgram(stored.base!, stored.draft, current.draft, (() => { let n = 0; return () => `r${n++}`; })());
    assert.equal(rebased.title, "Новое название");
    assert.equal(rebased.plan.workouts[0]!.exercises[0]!.restSec, 180, "отдых из дневника сохранён");
    assert.deepEqual(rebased.plan.workouts[0]!.exercises[0]!.sets.map((set) => set.reps), [6, 6, 6], "правка тренера перенесена");
    await env.plans.saveSimplePlan(env.a, program.id, current.program.revision, rebased);
    assert.equal((await env.plans.getSimplePlan(env.a, program.id))!.draft.plan.workouts[0]!.exercises[0]!.restSec, 180);
  } finally { await env.close(); }
});

test("TRN-003 черновик конструктора мезоцикла: хранится по объекту правки, переносится на изменившийся мезоцикл, чистится при удалении", async () => {
  const { rebaseBuilderWeeks } = await import("../src/features/training/plans/domain/DraftRebase.ts");
  const { createMesocycleDeleteWorkflow } = await import("../src/workflows/deleteTrainingMesocycle.ts");
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(2, 2);
    const plan = await env.cycleOf(env.a, programId);
    const cycle = plan.mesocycles[0]!;
    const base = cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts }));
    const scope = { programId, mesocycleId };
    const draftOf = (weeks: typeof base) => ({ baseRevision: plan.program.revision, programTitle: "", title: "Правка", cycleType: "strength" as const,
      repsText: "3-5", startDate: "2026-10-19", weeks, editing: 1, members: [env.a], baseWeeks: base });
    // Тренер меняет повторы в неделе 2.
    const w2 = base[1]!.workouts[0]!;
    const edited = fillSets({ title: "x", plan: { weeks: 1, workouts: [w2] } }, w2.exercises[0]!.id, "reps", 5).plan.workouts;
    const draft = draftOf([base[0]!, { type: base[1]!.type, workouts: edited }]);
    await env.plans.saveMesocycleBuilderDraft(env.a, scope, draft);
    assert.deepEqual(await env.plans.getMesocycleBuilderDraft(env.a, scope), draft, "черновик восстановлен как был");
    assert.equal(await env.plans.getMesocycleBuilderDraft(env.a, { programId, mesocycleId: null }), null, "другой объект правки — другой черновик");
    // Пока он лежит, отдых упражнения недели 1 меняется (например, из дневника) — правки тренера переносятся на текущий план.
    const w1 = cycle.weeks[0]!.workouts[0]!;
    await env.plans.setExerciseRest(env.a, programId, w1.exercises[0]!.id, 180);
    const current = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks.map((week) => ({ type: week.type, workouts: week.workouts }));
    const rebased = rebaseBuilderWeeks(draft.baseWeeks, draft.weeks, current, (() => { let n = 0; return () => `r${n++}`; })());
    assert.equal(rebased[0]!.workouts[0]!.exercises[0]!.restSec, 180, "отдых из дневника сохранён");
    assert.deepEqual(rebased[1]!.workouts[0]!.exercises[0]!.sets.map((set) => set.reps), [5, 5, 5], "правка тренера перенесена");
    // Удаление мезоцикла чистит его черновик, удаление программы — все её черновики.
    const second = await env.plans.createMesocycle(env.a, programId, (await env.plans.getProgram(env.a, programId))!.revision,
      { title: "Второй", weeks: 1, firstWeek: workoutWith(1).plan.workouts.map((workout) => ({ ...workout, id: "q-w",
        exercises: workout.exercises.map((exercise) => ({ ...exercise, id: "q-e", sets: exercise.sets.map((set, at) => ({ ...set, id: `q-s${at}` })) })) })),
      clientIds: [env.a] });
    await env.plans.saveMesocycleBuilderDraft(env.a, { programId, mesocycleId: second.mesocycleId }, draft);
    await env.plans.saveMesocycleBuilderDraft(env.a, { programId, mesocycleId: null }, draft);
    await createMesocycleDeleteWorkflow(env.tx, env.plans.deleteParticipant, env.execution.cleanupParticipant).deleteMesocycle({
      clientId: env.a, programId, mesocycleId: second.mesocycleId, expectedRevision: (await env.plans.getProgram(env.a, programId))!.revision });
    assert.equal(await env.plans.getMesocycleBuilderDraft(env.a, { programId, mesocycleId: second.mesocycleId }), null);
    await createProgramDeleteWorkflow(env.tx, env.plans.deleteParticipant, env.execution.cleanupParticipant)
      .deleteProgram({ clientId: env.a, programId, expectedRevision: (await env.plans.getProgram(env.a, programId))!.revision });
    assert.equal(await env.plans.getMesocycleBuilderDraft(env.a, { programId, mesocycleId: null }), null, "черновик удалённой программы не воскрешает её");
    // Новая программа: черновик без программы, по клиенту.
    await env.plans.saveMesocycleBuilderDraft(env.a, { programId: null, mesocycleId: null }, { ...draft, baseRevision: null, baseWeeks: null });
    assert.equal((await env.plans.getMesocycleBuilderDraft(env.a, { programId: null, mesocycleId: null }))?.title, "Правка");
    assert.equal(await env.plans.getMesocycleBuilderDraft(env.b, { programId: null, mesocycleId: null }), null, "у другого клиента своего нет");
  } finally { await env.close(); }
});

test("TRN-019 скопированная разминка получает тот же вид ID, что добавленная в дневнике", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(2, 2);
    const plan = await env.cycleOf(env.a, programId);
    const w1 = plan.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const slot1 = { clientId: env.a, programId, weekIndex: 1, plannedWorkoutId: w1.id };
    const warmup = await env.execution.addWarmupSet(slot1, { plannedExerciseId: w1.exercises[0]!.id, exerciseId: BENCH });
    await env.execution.saveSet({ slot: slot1, plannedExerciseId: w1.exercises[0]!.id, exerciseId: BENCH, plannedSetId: warmup.fact.plannedSetId,
      position: warmup.fact.position, metrics: METRICS, values: { loadGrams: 20_000, reps: 10, durationSec: null, distanceM: null },
      setType: "WARMUP", drops: [], rpe: null, expectedRevision: warmup.fact.revision });
    const lookup = { lookup: async () => new Map([[BENCH, { name: "bench", metrics: METRICS, thumbnail: null, unilateral: false }]]), subscribe: () => () => undefined };
    const copy = createWeekCopyWorkflow(env.tx, env.plans.weekCopyParticipant, env.execution.weekCopyParticipant, lookup as never);
    const request = { clientId: env.a, programId, mesocycleId, sourceWeek: 1, targetWeek: 2, expectedRevision: plan.program.revision };
    await copy.copy(request, (await copy.preview(request)).revisionToken, "PREFILL", false);
    const target = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks[1]!.workouts[0]!;
    const facts = [...(await env.execution.getWorkout({ ...slot1, weekIndex: 2, plannedWorkoutId: target.id })).facts.values()];
    assert.ok(facts.filter((fact) => fact.extra).every((fact) => fact.plannedSetId.startsWith("extra-")) && facts.some((fact) => fact.extra));
  } finally { await env.close(); }
});

test("TRN-018 нечитаемое недельное отличие Простой программы не ломает чтение: неделя показывает базовый план", async () => {
  const env = await setup();
  try {
    const draft = { ...workoutWith(2), title: "Простая" };
    const program = await env.plans.createSimpleProgram(env.a, { ...draft, plan: { ...draft.plan, weeks: 3 } });
    const plan = (await env.plans.getSimplePlan(env.a, program.id))!;
    const workout = plan.draft.plan.workouts[0]!;
    assert.throws(() => env.db.prepare("INSERT INTO training_simple_overrides (workspace_id, client_id, program_id, week_index, workout_id, workout_json) VALUES (?, ?, ?, 2, ?, ?)")
      .run(WS, env.a, program.id, workout.id, JSON.stringify({ id: workout.id })), /TRAINING_JSON_INVALID/);
    // Simulate damage outside the normal write path; application writes cannot create this row.
    env.db.exec("DROP TRIGGER training_simple_overrides_json_shape_insert");
    env.db.prepare("INSERT INTO training_simple_overrides (workspace_id, client_id, program_id, week_index, workout_id, workout_json) VALUES (?, ?, ?, 2, ?, ?)").run(WS, env.a, program.id, workout.id, JSON.stringify({ id: workout.id }));
    const weeks = await env.plans.getSimpleWeeks(env.a, program.id);
    assert.equal(weeks.length, 3);
    assert.deepEqual(weeks[1]!.workouts[0], workout, "повреждённая неделя 2 показывает базовый план");
  } finally { await env.close(); }
});

test("TRN-009 правка недели: тренировка с результатами убирается только по явному выбору — удалить или сохранить в истории (ADR-031)", async () => {
  const { addWorkout } = await import("../src/features/training/plans/domain/SimplePlanEdits.ts");
  const { createWeekEditWorkflow } = await import("../src/workflows/saveTrainingWeek.ts");
  for (const action of ["DELETE", "KEEP_HISTORY"] as const) {
    const env = await setup();
    try {
      let t = 0;
      const two = addExercise(addWorkout(workoutWith(2), "w2"), "w2", "e2", BENCH, () => `u${t++}`).plan.workouts;
      const program = await env.plans.createProgram({ kind: "PERIODIZED", title: "Две", clientIds: [env.a] });
      const created = await env.plans.createMesocycle(env.a, program.id, program.revision, { title: "Блок", weeks: 2, firstWeek: two, clientIds: [env.a] });
      const plan = await env.cycleOf(env.a, program.id);
      const week2 = plan.mesocycles[0]!.weeks[1]!;
      const second = week2.workouts[1]!;
      const slot = { clientId: env.a, programId: program.id, weekIndex: 2, plannedWorkoutId: second.id };
      await env.fill(slot as never, second.exercises[0]!, 0, 7);
      const save = createWeekEditWorkflow(env.tx, env.plans.weekEditSaveParticipant, env.execution.weekCopyParticipant, env.execution.cleanupParticipant);
      const input = { mesocycleId: created.mesocycleId, weekIndex: 2, type: "base" as const, scope: "CURRENT" as const, clientIds: [env.a] };
      const request = (resultsAction?: "DELETE" | "KEEP_HISTORY") => ({ clientId: env.a, programId: program.id, expectedRevision: plan.program.revision,
        input: { ...input, workouts: [week2.workouts[0]!] }, ...(resultsAction === undefined ? {} : { resultsAction }) });
      await assert.rejects(save.saveWeek(request()), message("WEEK_HAS_RESULTS"));
      assert.equal((await env.cycleOf(env.a, program.id)).mesocycles[0]!.weeks[1]!.workouts.length, 2, "без выбора план не изменён");
      await save.saveWeek(request(action));
      assert.deepEqual((await env.cycleOf(env.a, program.id)).mesocycles[0]!.weeks[1]!.workouts.map((workout) => workout.id), [week2.workouts[0]!.id]);
      const history = (await env.execution.listClientExecutions(env.a)).filter((item) => item.plannedWorkoutId === second.id);
      if (action === "DELETE") assert.equal(history.length, 0, "результаты удалены окончательно");
      else {
        assert.equal(history.length, 1, "результаты остались в истории");
        assert.deepEqual(history[0]!.origin, { programTitle: "Две", programKind: "PERIODIZED", mesocycleTitle: "Блок", workoutTitle: second.title });
        assert.equal(history[0]!.execution.facts.size, 1);
        assert.equal((await env.execution.listProgramExecutions(env.a, program.id)).some((item) => item.plannedWorkoutId === second.id), false,
          "из экранов программы выпала");
      }
    } finally { await env.close(); }
  }
});

const writesTo = (sql: readonly string[], verb: "INSERT INTO" | "DELETE FROM", table: string) =>
  sql.filter((item) => item.startsWith(`${verb} ${table} `)).length;

test("PERF-PLAN-BATCH замена упражнения во всех 8 неделях: один запрос на таблицу в неделе, неизменённое не переписывается", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(4, 8);
    const plan = await env.cycleOf(env.a, programId);
    const w1 = plan.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const openSets = w1.exercises[0]!.sets.map((set) => set.id);
    const replaced = { ...w1, exercises: [{ ...w1.exercises[0]!, exerciseId: "sys:repdb:row" }] };
    env.journal.recording = true;
    await env.plans.saveWeek(env.a, programId, plan.program.revision, { mesocycleId, weekIndex: 1, workouts: [replaced], type: "base",
      scope: "ALL", clientIds: [env.a] });
    env.journal.recording = false;
    const sql = env.journal.sql;
    // В открытой неделе меняется только строка упражнения (ID подходов те же); в неделях 2–8 замена — новое упражнение с
    // новыми подходами (как и раньше). Каждая неделя: один запрос упражнений, в неделях 2–8 — одна вставка и одно удаление
    // подходов (было: по запросу на строку); тренировки не переписываются.
    assert.equal(writesTo(sql, "INSERT INTO", "training_planned_exercises"), 8);
    assert.equal(writesTo(sql, "INSERT INTO", "training_planned_sets"), 7);
    assert.equal(writesTo(sql, "DELETE FROM", "training_planned_sets"), 7);
    assert.equal(writesTo(sql, "INSERT INTO", "training_workouts"), 0);
    const after = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks;
    assert.deepEqual(after.map((week) => week.workouts[0]!.exercises[0]!.exerciseId), Array(8).fill("sys:repdb:row"));
    assert.deepEqual(after.map((week) => week.workouts[0]!.exercises[0]!.sets.length), Array(8).fill(4));
    assert.deepEqual(after[0]!.workouts[0]!.exercises[0]!.sets.map((set) => set.id), openSets, "в открытой неделе ID подходов сохранены");
  } finally { await env.close(); }
});

test("PERF-PLAN-BATCH добавление подходов во всех неделях: одна вставка подходов на неделю, убранные удаляются одним запросом", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(4, 8);
    const plan = await env.cycleOf(env.a, programId);
    const w1 = plan.mesocycles[0]!.weeks[0]!.workouts[0]!;
    const ex = w1.exercises[0]!;
    const grown = { ...w1, exercises: [{ ...ex, sets: [...ex.sets, ...["n1", "n2", "n3"].map((id) => ({ ...ex.sets[0]!, id }))] }] };
    env.journal.recording = true;
    const revision = (await env.plans.saveWeek(env.a, programId, plan.program.revision, { mesocycleId, weekIndex: 1, workouts: [grown],
      type: "base", scope: "ALL", clientIds: [env.a] })).program.revision;
    assert.equal(writesTo(env.journal.sql, "INSERT INTO", "training_planned_sets"), 8);
    let weeks = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks;
    assert.deepEqual(weeks.map((week) => week.workouts[0]!.exercises[0]!.sets.length), Array(8).fill(7));
    env.journal.sql.length = 0;
    const current = weeks[0]!.workouts[0]!;
    const shrunk = { ...current, exercises: [{ ...current.exercises[0]!, sets: current.exercises[0]!.sets.slice(0, 2) }] };
    await env.plans.saveWeek(env.a, programId, revision, { mesocycleId, weekIndex: 1, workouts: [shrunk], type: "base",
      scope: "ALL", clientIds: [env.a] });
    env.journal.recording = false;
    assert.equal(writesTo(env.journal.sql, "DELETE FROM", "training_planned_sets"), 8);
    assert.equal(writesTo(env.journal.sql, "INSERT INTO", "training_planned_sets"), 0, "оставшиеся подходы не переписываются");
    weeks = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks;
    assert.deepEqual(weeks.map((week) => week.workouts[0]!.exercises[0]!.sets.length), Array(8).fill(2));
  } finally { await env.close(); }
});

test("PERF-REST-ALL отдых «все недели»: другие повторы не мешают, без UUID, без перечитывания недель, читается один мезоцикл", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(4, 8);
    // Второй мезоцикл: правка первого не должна его читать.
    const other = await env.cycleOf(env.a, programId);
    await env.plans.createMesocycle(env.a, programId, other.program.revision,
      { title: "Второй", weeks: 8, firstWeek: workoutWith(4).plan.workouts, clientIds: [env.a] });
    let plan = await env.cycleOf(env.a, programId);
    // Неделя 3 — «тяжёлая»: 6 повторов вместо 10 (другая форма упражнения), отдых прежний.
    const w3 = plan.mesocycles[0]!.weeks[2]!;
    const heavy = w3.workouts.map((workout) => ({ ...workout, exercises: workout.exercises.map((exercise) => ({ ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, reps: 6 })) })) }));
    await env.plans.saveWeek(env.a, programId, plan.program.revision, { mesocycleId, weekIndex: 3, workouts: heavy, type: w3.type,
      scope: "CURRENT", clientIds: [env.a] });
    plan = await env.cycleOf(env.a, programId);
    const w1 = plan.mesocycles[0]!.weeks[0]!;
    const edited = w1.workouts.map((workout) => ({ ...workout, exercises: workout.exercises.map((exercise) => ({ ...exercise, restSec: 150 })) }));
    const input = { mesocycleId, weekIndex: 1, workouts: edited, type: w1.type, scope: "ALL" as const, clientIds: [env.a] };
    env.journal.sql.length = 0;
    env.journal.recording = true;
    const preview = await env.plans.previewWeekEdit(env.a, programId, plan.program.revision, input);
    await env.plans.saveWeek(env.a, programId, plan.program.revision, input);
    env.journal.recording = false;
    assert.equal(preview.conflicts.length, 0, "другие повторы недели 3 не считаются своей структурой");
    const after = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks;
    assert.deepEqual(after.map((week) => week.workouts[0]!.exercises[0]!.restSec), Array(8).fill(150));
    assert.deepEqual(after[2]!.workouts[0]!.exercises[0]!.sets.map((set) => set.reps), [6, 6, 6, 6], "повторы недели 3 не тронуты");
    const sql = env.journal.sql;
    assert.equal(sql.filter((item) => item.includes("WITH RECURSIVE n(i)")).length, 0, "ID не готовятся");
    assert.equal(sql.filter((item) => item.startsWith("SELECT") && item.includes("FROM training_mesocycles") && !item.includes("id = ?")).length, 0,
      "читается один мезоцикл, а не все");
    assert.equal(writesTo(sql, "INSERT INTO", "training_planned_sets"), 0, "подходы не переписываются");
    assert.equal(writesTo(sql, "INSERT INTO", "training_workouts"), 0);
  } finally { await env.close(); }
});

test("PERF-REST-ALL отдых, заданный вручную в другой неделе, не затирается", async () => {
  const env = await setup();
  try {
    const { programId, mesocycleId } = await env.periodized(2, 3);
    let plan = await env.cycleOf(env.a, programId);
    const w2 = plan.mesocycles[0]!.weeks[1]!;
    const own = w2.workouts.map((workout) => ({ ...workout, exercises: workout.exercises.map((exercise) => ({ ...exercise, restSec: 45 })) }));
    await env.plans.saveWeek(env.a, programId, plan.program.revision, { mesocycleId, weekIndex: 2, workouts: own, type: w2.type,
      scope: "CURRENT", clientIds: [env.a] });
    plan = await env.cycleOf(env.a, programId);
    const w1 = plan.mesocycles[0]!.weeks[0]!;
    const edited = w1.workouts.map((workout) => ({ ...workout, exercises: workout.exercises.map((exercise) => ({ ...exercise, restSec: 150 })) }));
    const saved = await env.plans.saveWeek(env.a, programId, plan.program.revision,
      { mesocycleId, weekIndex: 1, workouts: edited, type: w1.type, scope: "ALL", clientIds: [env.a] });
    assert.equal(saved.skipped, 1);
    const rests = (await env.cycleOf(env.a, programId)).mesocycles[0]!.weeks.map((week) => week.workouts[0]!.exercises[0]!.restSec);
    assert.deepEqual(rests, [150, 45, 150]);
  } finally { await env.close(); }
});
