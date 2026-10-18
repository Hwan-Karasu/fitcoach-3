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
import { createWeekCopyWorkflow } from "../src/workflows/copyTrainingWeek.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Workflow копирования недели импортирует public.ts фич (там экраны .tsx), поэтому тест живёт здесь.
const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";
const SQUAT = "sys:repdb:squat";
const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function firstWeek(): readonly PlannedWorkout[] {
  let draft = addExercise(newDraft("w1"), "w1", "e1", BENCH, ids("e1s"));
  draft = fillSets(draft, "e1", "reps", 10);
  draft = addExercise(draft, "w1", "e2", SQUAT, ids("e2s"));
  return draft.plan.workouts;
}

async function sharedProgram() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const a = await clients.create({ displayName: "SyntheticA" });
  const b = await clients.create({ displayName: "SyntheticB" });
  const program = await plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a.id, b.id] });
  const created = await plans.createMesocycle(a.id, program.id, program.revision,
    { title: "Блок 1", weeks: 4, firstWeek: firstWeek(), clientIds: [a.id, b.id] });
  return { shared, plans, a, b, programId: program.id, mesocycleId: created.mesocycleId,
    close: async () => { await plans.close(); await clients.close(); } };
}

test("T04 копия недели: предварительно/подтвердить/план, стороны, дроп, разминка, новые даты и защита от повторов", async () => {
  const { plans, shared, a, b, programId, mesocycleId, close } = await sharedProgram();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  const lease = await shared.acquire();
  const copy = createWeekCopyWorkflow((task) => lease.writer.write(task), plans.weekCopyParticipant, execution.weekCopyParticipant,
    { lookup: async () => new Map([BENCH, SQUAT].map((id) => [id, { name: id, metrics: ["load", "reps"] as const, thumbnail: null, unilateral: false }])),
      subscribe: () => () => undefined }, () => new Date("2026-10-18T09:00:00Z"));
  try {
    const originalPlan = (await plans.getPeriodizedPlan(a.id, programId))!;
    const otherPlan = (await plans.getPeriodizedPlan(b.id, programId))!.mesocycles;
    const cycle = originalPlan.mesocycles[0]!;
    const first = cycle.weeks[0]!.workouts[0]!;
    const exercise = first.exercises[0]!;
    const slot = { clientId: a.id, programId, weekIndex: 1, plannedWorkoutId: first.id };
    const values = { loadGrams: 0, reps: 10, durationSec: null, distanceM: null };
    const empty = { loadGrams: null, reps: null, durationSec: null, distanceM: null };
    const base = { slot, plannedExerciseId: exercise.id, exerciseId: BENCH, metrics: ["load", "reps"] as const,
      values, setType: "NORMAL" as const, drops: [], rpe: 8, expectedRevision: null };
    await execution.saveSet({ ...base, plannedSetId: exercise.sets[0]!.id, position: 0 });
    await execution.saveSet({ ...base, plannedSetId: exercise.sets[1]!.id, position: 1, setType: "DROP", drops: [empty] });
    await execution.saveSet({ ...base, plannedSetId: exercise.sets[2]!.id, position: 2, values: empty, sides: { left: values, right: empty } });
    const warmup = await execution.addWarmupSet(slot, { plannedExerciseId: exercise.id, exerciseId: BENCH });
    await execution.saveSet({ ...base, plannedSetId: warmup.fact.plannedSetId, position: warmup.fact.position,
      setType: "WARMUP", expectedRevision: warmup.fact.revision });
    await execution.saveExerciseNote(slot, exercise.id, "Только у источника");
    const session = (await execution.getWorkout(slot)).session!;
    const dated = await execution.setActualDate(slot, "2024-09-01", session.revision);
    await execution.setOutcome(slot, "COMPLETED", dated.revision);
    await execution.setConfirmationMode("MANUAL");
    const sourceFacts = await execution.getWorkout(slot);
    const targetSlot = { ...slot, weekIndex: 2, plannedWorkoutId: cycle.weeks[1]!.workouts[0]!.id };
    await execution.saveExerciseNote(targetSlot, cycle.weeks[1]!.workouts[0]!.exercises[0]!.id, "Старая целевая заметка");
    const request = { clientId: a.id, programId, mesocycleId, sourceWeek: 1, targetWeek: 2, expectedRevision: originalPlan.program.revision };
    const preview = await copy.preview(request);
    assert.deepEqual([preview.sourceSets, preview.targetSessions, preview.targetNotes], [4, 1, 1]);
    await assert.rejects(copy.copy(request, preview.revisionToken, "PREFILL", false), message("REPLACE_CONFIRMATION_REQUIRED"));
    assert.deepEqual(await plans.getPeriodizedPlan(a.id, programId), originalPlan);
    await copy.copy(request, preview.revisionToken, "PREFILL", true);
    const filledPlan = (await plans.getPeriodizedPlan(a.id, programId))!;
    const filledWorkout = filledPlan.mesocycles[0]!.weeks[1]!.workouts[0]!;
    const filled = await execution.getWorkout({ ...targetSlot, plannedWorkoutId: filledWorkout.id });
    assert.equal(filled.facts.size, 4);
    assert.ok([...filled.facts.values()].every((fact) => !fact.confirmed));
    assert.equal(filled.session!.outcome, null);
    assert.equal(filled.session!.actualDate, "2026-10-18");
    assert.notEqual(filled.session!.id, sourceFacts.session!.id);
    assert.equal(filled.notes.size, 0);
    assert.equal((await execution.getWorkout(targetSlot)).session, null, "старое выполнение удалено только по явному выбору");
    await assert.rejects(copy.copy(request, preview.revisionToken, "PREFILL", true), message("PROGRAM_REVISION_CONFLICT"));
    const confirmedRequest = { ...request, targetWeek: 3, expectedRevision: filledPlan.program.revision };
    await copy.copy(confirmedRequest, (await copy.preview(confirmedRequest)).revisionToken, "CONFIRM", false);
    const confirmedPlan = (await plans.getPeriodizedPlan(a.id, programId))!;
    const confirmed = await execution.getWorkout({ ...slot, weekIndex: 3, plannedWorkoutId: confirmedPlan.mesocycles[0]!.weeks[2]!.workouts[0]!.id });
    const facts = [...confirmed.facts.values()];
    assert.equal(facts.filter((fact) => fact.confirmed).length, 3, "нормальный, одна заполненная сторона и разминка; неполный дроп не подтверждён");
    assert.equal(facts.find((fact) => fact.setType === "DROP")!.confirmed, false);
    assert.equal(facts.find((fact) => fact.sides)!.sides!.right.confirmed, false);
    assert.equal(facts.find((fact) => fact.sides)!.sides!.left.values.loadGrams, 0, "ноль является данными");
    assert.equal(confirmed.session!.outcome, null);
    const planRequest = { ...request, targetWeek: 4, expectedRevision: confirmedPlan.program.revision };
    await copy.copy(planRequest, (await copy.preview(planRequest)).revisionToken, "PLAN", false);
    const after = (await plans.getPeriodizedPlan(a.id, programId))!;
    assert.equal((await execution.getWorkout({ ...slot, weekIndex: 4, plannedWorkoutId: after.mesocycles[0]!.weeks[3]!.workouts[0]!.id })).session, null);
    assert.deepEqual(await execution.getWorkout(slot), sourceFacts);
    assert.deepEqual((await plans.getPeriodizedPlan(b.id, programId))!.mesocycles, otherPlan);
    assert.equal(after.mesocycles[0]!.weeks.length, 4);
    assert.equal((await plans.getMesocycleVersions(a.id, programId, mesocycleId)).length, 4);
  } finally { await shared.release(); await execution.close(); await close(); }
});
