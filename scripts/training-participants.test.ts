import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { counterpartOf, isGroupOfMesocycle, participantOrder } from "../apps/mobile/src/features/training/plans/domain/ParticipantCounterpart.ts";
import { preferredPlacement } from "../apps/mobile/src/features/training/plans/domain/Placement.ts";
import { addExercise, fillSets, newDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { DevTrainingExecutionRepository } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { devTrainingPlansCatalog, DEV_TRAINING_PLANS_LEDGER } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansCatalog.ts";
import { runMigrationsInTransaction } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import type { PlacementTarget } from "../apps/mobile/src/features/training/plans/domain/Placement.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";
let n = 0;
const workouts = () => fillSets(addExercise(newDraft(`w${n}`), `w${n}`, `e${n}`, BENCH, () => `s${n++}`), `e${n - 1}`, "reps", 10).plan.workouts;
const builder = (title: string) => ({ title, cycleType: null, repRange: null, startDate: null,
  weeks: [{ type: "heavy" as const, workouts: workouts() }, { type: "base" as const, workouts: [] }] });

async function existingTarget(plans: DevTrainingPlansRepository, clientId: string, cycleId: string): Promise<PlacementTarget> {
  const cycle = (await plans.getPlacementOptions([clientId], null))[0]!.cycles!.find((item) => item.mesocycleId === cycleId)!;
  return { kind: "existing", programId: cycle.programId, mesocycleId: cycleId,
    expectedRevision: cycle.revision, expectedGroupId: cycle.groupId };
}

function snapshot(db: DatabaseSync, exclude: readonly string[] = []): Record<string, unknown> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.filter((row) => !exclude.includes(String(row.name)))
    .map((row) => [String(row.name), db.prepare(`SELECT * FROM "${String(row.name)}" ORDER BY rowid`).all()]));
}

/**
 * A открывает общую программу. У B своя текущая Расширенная «Своя», у C — только Простая, у D программ нет.
 * Как в 2.0: B получает мезоцикл в «Своя», C — участием в общей, D — по выбору тренера в новую программу.
 */
async function setup() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const [a, b, c, d] = (await Promise.all(["SyntheticA", "SyntheticB", "SyntheticC", "SyntheticD"]
    .map((displayName) => clients.create({ displayName })))).map((client) => client.id) as [string, string, string, string];
  const own = await plans.createPeriodizedProgram({ title: "Своя", clientIds: [b], mesocycle: builder("Свой блок") });
  await plans.selectProgram(b, own.id);
  const simple = await plans.createSimpleProgram(c, { title: "Простая C", plan: { weeks: 2, workouts: workouts() } });
  await plans.selectProgram(c, simple.id);
  return { db, shared, plans, a, b, c, d, ownB: own.id, close: async () => { await plans.close(); await clients.close(); } };
}

async function createGroup(env: Awaited<ReturnType<typeof setup>>) {
  const { plans, a, b, c, d, ownB } = env;
  const program = await plans.createPeriodizedProgram({ title: "Группа", clientIds: [a, b, c, d], mesocycle: builder("Общий"),
    placements: [{ clientId: b, target: { kind: "program", programId: ownB } }, { clientId: c, target: { kind: "join" } },
      { clientId: d, target: { kind: "new" } }] });
  const mesocycleId = (await plans.getPeriodizedPlan(a, program.id))!.mesocycles[0]!.id;
  const revision = async () => (await plans.getProgram(a, program.id))!.revision;
  const group = async (clientId: string, programId: string, cycleId: string) =>
    (await plans.getMesocycleGroup(clientId, programId, { mesocycleId: cycleId })).map((item) => item.clientId).sort();
  return { programId: program.id, mesocycleId, revision, group };
}

test("P01 размещение копии: текущая Расширенная → последняя Расширенная → новая личная программа", async () => {
  const program = (id: string, kind: "SIMPLE" | "PERIODIZED", createdAt: string) => ({ id, kind, title: id, createdAt });
  const list = [program("old", "PERIODIZED", "2026-01-01"), program("new", "PERIODIZED", "2026-05-01"), program("s", "SIMPLE", "2026-06-01")];
  assert.deepEqual(preferredPlacement(list, "old", "host"), { kind: "program", programId: "old" }, "текущая Расширенная");
  assert.deepEqual(preferredPlacement(list, "s", "host"), { kind: "program", programId: "new" }, "текущая Простая — последняя Расширенная");
  assert.deepEqual(preferredPlacement([program("s", "SIMPLE", "2026-06-01")], "s", "host"), { kind: "new" });
  assert.deepEqual(preferredPlacement([program("host", "PERIODIZED", "2026-06-01")], "host", "host"), { kind: "new" }, "эта же программа — не вариант");

  const env = await setup();
  try {
    const options = await env.plans.getPlacementOptions([env.b, env.c, env.d], null);
    assert.deepEqual(options.map((item) => item.preferred), [{ kind: "program", programId: env.ownB }, { kind: "new" }, { kind: "new" }]);
    assert.deepEqual(options[0]!.programs, [{ id: env.ownB, title: "Своя", current: true }]);
  } finally {
    await env.close();
  }
});

test("UI-OWN-044 общий мезоцикл ложится в программы участников; группа — копии одного родства", async () => {
  const env = await setup();
  try {
    const { plans, a, b, c, d, ownB } = env;
    const { programId, mesocycleId, group } = await createGroup(env);
    assert.deepEqual((await plans.getProgram(a, programId))!.memberClientIds, [a, c], "в общей программе — A и C");
    const inOwn = (await plans.getPeriodizedPlan(b, ownB))!;
    assert.deepEqual(inOwn.mesocycles.map((cycle) => cycle.title), ["Свой блок", "Общий"], "у B — новым мезоциклом в «Своя»");
    assert.equal(inOwn.selectedMesocycleId, inOwn.mesocycles[1]!.id);
    const dLibrary = await plans.getLibrary(d);
    assert.deepEqual(dLibrary.active.map((card) => card.title), ["Группа"], "у D — своя новая программа");
    assert.notEqual(dLibrary.active[0]!.id, programId);
    assert.deepEqual(await group(a, programId, mesocycleId), [a, b, c, d].sort());
    assert.deepEqual(await group(b, ownB, inOwn.mesocycles[1]!.id), [a, b, c, d].sort(), "группа видна из чужой программы");
    assert.deepEqual(await group(b, ownB, inOwn.mesocycles[0]!.id), [b], "свой мезоцикл B — без группы");
  } finally {
    await env.close();
  }
});

test("UI-OWN-044 выход из группы мезоцикла: план и программа остаются; возврат — со своим планом", async () => {
  const env = await setup();
  try {
    const { plans, a, b, c, d, ownB } = env;
    const { programId, mesocycleId, revision, group } = await createGroup(env);
    const copyB = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles[1]!;
    await plans.leaveGroup(a, programId, await revision(), mesocycleId, b);
    assert.deepEqual(await group(a, programId, mesocycleId), [a, c, d].sort());
    assert.deepEqual(await group(b, ownB, copyB.id), [b], "у него группа — только он");
    assert.deepEqual((await plans.getPeriodizedPlan(b, ownB))!.mesocycles[1], copyB, "план на месте");
    await assert.rejects(plans.leaveGroup(a, programId, await revision(), mesocycleId, a),
      (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID", "открывший себя не убирает");

    const option = (await plans.getPlacementOptions([b], programId))[0]!.cycles!.find((item) => item.mesocycleId === copyB.id)!;
    await plans.addParticipants(a, programId, await revision(), mesocycleId, c, [{ clientId: b, target: {
      kind: "existing", programId: ownB, mesocycleId: copyB.id, expectedRevision: option.revision, expectedGroupId: option.groupId } }]);
    assert.deepEqual(await group(a, programId, mesocycleId), [a, b, c, d].sort());
    assert.deepEqual((await plans.getPeriodizedPlan(b, ownB))!.mesocycles[1], copyB, "вернувшийся — со своим планом в своей программе");
    assert.deepEqual((await plans.getProgram(a, programId))!.memberClientIds, [a, c], "в общую программу не добавлен");
  } finally {
    await env.close();
  }
});

test("P01 owner rejects editing another participant; own week scopes still work", async () => {
  const env = await setup();
  try {
    const { plans, a, b, ownB } = env;
    const { programId, mesocycleId, revision } = await createGroup(env);
    const own = (await plans.getPeriodizedPlan(a, programId))!;
    const before = (await plans.getPeriodizedPlan(b, ownB))!;
    const week = own.mesocycles[0]!.weeks[0]!;
    const edited = fillSets({ title: "m", plan: { weeks: 1, workouts: week.workouts } }, week.workouts[0]!.exercises[0]!.id, "reps", 5).plan.workouts;
    const input = { mesocycleId, weekIndex: 1, workouts: edited, type: week.type, scope: "ALL" as const, clientIds: [a, b] };
    await assert.rejects(plans.previewWeekEdit(a, programId, await revision(), input), /DRAFT_INVALID/);
    await assert.rejects(plans.saveWeek(a, programId, await revision(), input), /DRAFT_INVALID/);
    assert.deepEqual(await plans.getPeriodizedPlan(a, programId), own);
    await plans.saveWeek(a, programId, await revision(), { ...input, clientIds: [a] });
    assert.deepEqual(await plans.getPeriodizedPlan(b, ownB), before);
    assert.ok((await plans.getPeriodizedPlan(a, programId))!.mesocycles[0]!.weeks.every((w) => w.workouts[0]!.exercises[0]!.sets[0]!.reps === 5));
  } finally { await env.close(); }
});

test("UI-OWN-043/044 переключатель: открывший первым; то же место плана в программе другого участника", async () => {
  const env = await setup();
  try {
    const { plans, a, b, c, ownB } = env;
    assert.deepEqual(participantOrder([a, b, c], c), [c, a, b]);
    assert.deepEqual(participantOrder([a, b], c), [a, b], "открывшего нет в группе — порядок группы");
    const { programId } = await createGroup(env);
    const planA = (await plans.getPeriodizedPlan(a, programId))!;
    const planB = (await plans.getPeriodizedPlan(b, ownB))!;
    const cycleA = planA.mesocycles[0]!;
    const cycleB = planB.mesocycles[1]!;
    const workoutA = cycleA.weeks[1]!.workouts[0]!;
    assert.deepEqual(counterpartOf(planA.mesocycles, planB.mesocycles, planB.selectedMesocycleId,
      { mesocycleId: cycleA.id, weekIndex: 2, workoutId: workoutA.id }),
    { mesocycleId: cycleB.id, weekIndex: 2, workoutId: cycleB.weeks[1]!.workouts[0]!.id });
    assert.deepEqual(counterpartOf(planA.mesocycles, planB.mesocycles, null, { mesocycleId: cycleA.id, weekIndex: 9, workoutId: workoutA.id }),
      null, "недели нет — последняя неделя, без тренировки");
    assert.deepEqual((await plans.getMesocycleGroup(a, programId, { workoutId: workoutA.id })).map((item) => item.clientId).length, 4,
      "группа находится и по тренировке");
  } finally {
    await env.close();
  }
});

test("P01 attaching an existing cycle preserves every plan ID, ancestry and recorded fact", async () => {
  const env = await setup();
  const execution = new DevTrainingExecutionRepository(env.shared, WS);
  await execution.initialize();
  try {
    const { plans, a, b, ownB } = env;
    const before = (await plans.getPeriodizedPlan(b, ownB))!;
    const cycle = before.mesocycles[0]!;
    const workout = cycle.weeks[0]!.workouts[0]!;
    const exercise = workout.exercises[0]!;
    const slot = { clientId: b, programId: ownB, weekIndex: 1, plannedWorkoutId: workout.id };
    await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId,
      plannedSetId: exercise.sets[0]!.id, position: 0, metrics: ["reps", "load"],
      values: { reps: 11, loadGrams: 42500, durationSec: null, distanceM: null }, drops: [], rpe: null,
      setType: "NORMAL", expectedRevision: null });
    const facts = await execution.getWorkout(slot);
    const program = await plans.createPeriodizedProgram({ title: "Navigation", clientIds: [a, b], mesocycle: builder("Own"),
      placements: [{ clientId: b, target: await existingTarget(plans, b, cycle.id) }] });
    assert.deepEqual(await plans.getPeriodizedPlan(b, ownB), before);
    assert.deepEqual(await execution.getWorkout(slot), facts);
    const own = (await plans.getPeriodizedPlan(a, program.id))!.mesocycles[0]!;
    const group = await plans.getMesocycleGroup(a, program.id, { mesocycleId: own.id });
    assert.deepEqual(group.map((member) => member.mesocycleId), [own.id, cycle.id]);
    assert.notEqual(own.lineageId, cycle.lineageId);
    assert.deepEqual((await plans.getProgram(a, program.id))!.memberClientIds, [a]);
    assert.deepEqual(await execution.getWorkout({ clientId: a, programId: program.id, weekIndex: 1,
      plannedWorkoutId: own.weeks[0]!.workouts[0]!.id }), { session: null, facts: new Map(), notes: new Map() });
    assert.deepEqual(env.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await execution.close(); await env.close(); }
});

test("P01 invalid attachment rolls back the entire programme, copied plans and group", async () => {
  const env = await setup();
  try {
    const { plans, a, b, c, ownB, db } = env;
    const cycle = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles[0]!;
    const target = await existingTarget(plans, b, cycle.id);
    assert.equal(target.kind, "existing");
    if (target.kind !== "existing") throw new Error("test target");
    const before = snapshot(db);
    await assert.rejects(plans.createPeriodizedProgram({ title: "Rollback", clientIds: [a, c, b], mesocycle: builder("Block"),
      placements: [{ clientId: c, target: { kind: "new" } }, { clientId: b, target: { ...target, expectedRevision: target.expectedRevision + 1 } }] }), /PROGRAM_REVISION_CONFLICT/);
    assert.deepEqual(snapshot(db), before);
    // A write failure after several inserts must roll back just as completely.
    db.exec(`CREATE TRIGGER qa_fail_attachment BEFORE INSERT ON training_navigation_members
      WHEN NEW.client_id = '${b}' BEGIN SELECT RAISE(ABORT, 'QA_INJECTED'); END`);
    await assert.rejects(plans.createPeriodizedProgram({ title: "Rollback", clientIds: [a, c, b], mesocycle: builder("Block"),
      placements: [{ clientId: c, target: { kind: "new" } }, { clientId: b, target }] }), /QA_INJECTED/);
    assert.deepEqual(snapshot(db), before);
  } finally { await env.close(); }
});

test("P01 a new cycle can attach a participant's existing cycle in the same programme without a false revision conflict", async () => {
  const env = await setup();
  try {
    const { plans, a, b, db } = env;
    const program = await plans.createPeriodizedProgram({ title: "Shared container", clientIds: [a, b], mesocycle: builder("Old") });
    const cycleB = (await plans.getPeriodizedPlan(b, program.id))!.mesocycles[0]!;
    const target = await existingTarget(plans, b, cycleB.id);
    if (target.kind !== "existing") throw new Error("test target");
    const result = await nodeSqlitePort(db).exclusive((tx) => plans.mesocycleSaveParticipant.save(tx, {
      clientId: a, programId: program.id, expectedRevision: program.revision, mesocycleId: null,
      clientIds: [a, b], mesocycle: builder("New independent cycle"),
      placements: [{ clientId: b, target: { ...target, confirmReassignment: true } }],
    }, new Date()));
    plans.mesocycleSaveParticipant.notify([a, b]);
    assert.equal(result.program.revision, program.revision + 1);
    assert.deepEqual((await plans.getPeriodizedPlan(b, program.id))!.mesocycles, [cycleB]);
    assert.equal((await plans.getPeriodizedPlan(a, program.id))!.mesocycles.length, 2);
    assert.deepEqual((await plans.getMesocycleGroup(a, program.id, { mesocycleId: result.mesocycleId })).map((item) => item.clientId), [a, b]);
  } finally { await env.close(); }
});

test("P01 constructor recovery preserves copy destinations and existing-cycle references", async () => {
  const env = await setup();
  try {
    const { plans, a, b, ownB } = env;
    const cycleB = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles[0]!;
    const scope = { programId: null, mesocycleId: null };
    const draft = { baseRevision: null, programTitle: "Recovered", title: "Block", cycleType: "hypertrophy" as const,
      repsText: "8–10", startDate: "", weeks: builder("Recovery").weeks, editing: 0, members: [a, b], baseWeeks: null,
      placements: [{ clientId: b, target: await existingTarget(plans, b, cycleB.id) }] };
    await plans.saveMesocycleBuilderDraft(a, scope, draft);
    assert.deepEqual(await plans.getMesocycleBuilderDraft(a, scope), draft);
  } finally { await env.close(); }
});

test("P01 reassignment requires confirmation and only moves navigation membership", async () => {
  const env = await setup();
  try {
    const { plans, a, b, c, ownB, db } = env;
    const cycleB = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles[0]!;
    const first = await plans.createPeriodizedProgram({ title: "First", clientIds: [a, b], mesocycle: builder("First"),
      placements: [{ clientId: b, target: await existingTarget(plans, b, cycleB.id) }] });
    const own = (await plans.getPeriodizedPlan(a, first.id))!.mesocycles[0]!;
    const target = await existingTarget(plans, b, cycleB.id);
    const before = snapshot(db);
    await assert.rejects(plans.createPeriodizedProgram({ title: "Second", clientIds: [c, b], mesocycle: builder("Second"),
      placements: [{ clientId: b, target }] }), /NAVIGATION_REASSIGNMENT_REQUIRED/);
    assert.deepEqual(snapshot(db), before);
    if (target.kind !== "existing") throw new Error("test target");
    const second = await plans.createPeriodizedProgram({ title: "Second", clientIds: [c, b], mesocycle: builder("Second"),
      placements: [{ clientId: b, target: { ...target, confirmReassignment: true } }] });
    assert.deepEqual((await plans.getMesocycleGroup(a, first.id, { mesocycleId: own.id })).map((item) => item.clientId), [a]);
    assert.deepEqual((await plans.getMesocycleGroup(b, ownB, { mesocycleId: cycleB.id })).map((item) => item.clientId).sort(), [b, c].sort());
    assert.deepEqual((await plans.getPeriodizedPlan(b, ownB))!.mesocycles[0], cycleB);
    assert.ok(second.id);
    await assert.rejects(plans.addParticipants(a, first.id, first.revision, own.id, a,
      [{ clientId: b, target: { ...target, confirmReassignment: true } }]), /NAVIGATION_GROUP_CONFLICT/);
  } finally { await env.close(); }
});

test("P01 archive hides a participant until restore, without deleting the link", async () => {
  const env = await setup();
  try {
    const { plans, a, b, ownB, db } = env;
    const { programId, mesocycleId } = await createGroup(env);
    const workoutId = (await plans.getPeriodizedPlan(a, programId))!.mesocycles[0]!.weeks[0]!.workouts[0]!.id;
    const links = db.prepare("SELECT * FROM training_navigation_members ORDER BY rowid").all();
    assert.ok((await plans.getMesocycleGroup(a, programId, { workoutId })).some((member) => member.clientId === b));
    await plans.archiveForClient(b, ownB);
    assert.ok(!(await plans.getMesocycleGroup(a, programId, { mesocycleId })).some((member) => member.clientId === b));
    assert.ok(!(await plans.getMesocycleGroup(a, programId, { workoutId })).some((member) => member.clientId === b));
    assert.deepEqual(db.prepare("SELECT * FROM training_navigation_members ORDER BY rowid").all(), links);
    await plans.restoreForClient(b, ownB);
    assert.ok((await plans.getMesocycleGroup(a, programId, { workoutId })).some((member) => member.clientId === b));
  } finally { await env.close(); }
});

test("P01 ordinal availability follows displayed workout order and exact week, without lineage fallbacks", async () => {
  const env = await setup();
  try {
    const { plans, a, b, ownB } = env;
    const cycleB = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles[0]!;
    const source = builder("Three workouts");
    source.weeks[0]!.workouts = [...workouts(), ...workouts(), ...workouts()];
    const programme = await plans.createPeriodizedProgram({ title: "Ordinal", clientIds: [a, b], mesocycle: source,
      placements: [{ clientId: b, target: await existingTarget(plans, b, cycleB.id) }] });
    const cycleA = (await plans.getPeriodizedPlan(a, programme.id))!.mesocycles[0]!;
    const ref = { mesocycleId: cycleA.id, weekIndex: 1, workoutId: cycleA.weeks[0]!.workouts[2]!.id };
    assert.deepEqual((await plans.getMesocycleGroup(a, programme.id, { workoutId: ref.workoutId })).map((copy) => copy.clientId), [a]);
    assert.equal(counterpartOf([cycleA], [cycleB], cycleB.id, ref), null);
    const programB = (await plans.getPeriodizedPlan(b, ownB))!;
    const weekB = cycleB.weeks[0]!;
    await plans.saveWeek(b, ownB, programB.program.revision, { mesocycleId: cycleB.id, weekIndex: 1,
      workouts: [...weekB.workouts, ...workouts(), ...workouts()], type: weekB.type, scope: "CURRENT", clientIds: [b] });
    assert.deepEqual((await plans.getMesocycleGroup(a, programme.id, { workoutId: ref.workoutId })).map((copy) => copy.clientId), [a, b]);
    const updated = (await plans.getPeriodizedPlan(b, ownB))!;
    const target = updated.mesocycles[0]!;
    const reverse = [...target.weeks[0]!.workouts].reverse();
    await plans.saveWeek(b, ownB, updated.program.revision, { mesocycleId: target.id, weekIndex: 1,
      workouts: reverse, type: weekB.type, scope: "CURRENT", clientIds: [b] });
    const reordered = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles;
    assert.equal(counterpartOf([cycleA], reordered, cycleB.id, ref)!.workoutId, weekB.workouts[0]!.id);
    assert.equal(counterpartOf([cycleA], reordered, cycleB.id, { ...ref, weekIndex: 3 }), null);
    assert.equal(counterpartOf([cycleA], reordered, "missing", ref), null);
  } finally { await env.close(); }
});

test("P01 migration reconstructs old active copy groups without rewriting any existing rows; SQLite backup retains links", async () => {
  const env = await setup();
  try {
    const { plans, a, b, ownB, db } = env;
    const { programId, mesocycleId } = await createGroup(env);
    await plans.archiveForClient(b, ownB);
    db.exec("DROP TABLE training_navigation_members; DROP TABLE training_navigation_groups; DELETE FROM training_plans_schema_migrations WHERE version = 3");
    const exclude = [DEV_TRAINING_PLANS_LEDGER, "training_navigation_members", "training_navigation_groups"];
    const before = snapshot(db, exclude);
    await nodeSqlitePort(db).exclusive((tx) => runMigrationsInTransaction(tx, devTrainingPlansCatalog, DEV_TRAINING_PLANS_LEDGER));
    assert.deepEqual(snapshot(db, exclude), before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM training_navigation_members WHERE mesocycle_id = ?").get(mesocycleId)!.n, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const directory = mkdtempSync(join(tmpdir(), "fitcoach-p01-"));
    const destination = join(directory, "snapshot.db");
    try {
      await backup(db, destination);
      const restored = new DatabaseSync(destination);
      try {
        assert.deepEqual(snapshot(restored), snapshot(db));
        assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
      } finally { restored.close(); }
    } finally { unlinkSync(destination); rmdirSync(directory); }
    assert.ok(a && programId);
  } finally { await env.close(); }
});

test("UI-OWN-044 схема: дата выхода копии из группы не бывает пустой строкой", async () => {
  const env = await setup();
  try {
    assert.throws(() => env.db.prepare("UPDATE training_mesocycles SET group_left_at = ''").run(), /CHECK/);
    const memberColumns = env.db.prepare("PRAGMA table_info(training_program_members)").all().map((row) => String(row.name));
    assert.ok(!memberColumns.includes("group_left_at"), "колонка v15 у участия удалена миграцией v17");
  } finally {
    await env.close();
  }
});

test("UI-OWN-044 переключатель определяется группой выбранного мезоцикла, а не программой", async () => {
  const env = await setup();
  try {
    const { plans, a, b, ownB } = env;
    const { programId, mesocycleId, revision } = await createGroup(env);
    const cycles = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles;
    const own = cycles[0]!;
    const shared = cycles[1]!;
    const groupOf = (clientId: string, program: string, cycle: string) => plans.getMesocycleGroup(clientId, program, { mesocycleId: cycle });

    const sharedGroup = await groupOf(a, programId, mesocycleId);
    assert.equal(isGroupOfMesocycle(sharedGroup, mesocycleId), true, "общий мезоцикл — переключатель есть");
    const ownGroup = await groupOf(b, ownB, own.id);
    assert.equal(isGroupOfMesocycle(ownGroup, own.id), false, "мезоцикл одного участника — переключателя нет");
    assert.equal(isGroupOfMesocycle(sharedGroup, own.id), false, "состав общего мезоцикла не относится к чужому: старый список не показывается");
    assert.equal(isGroupOfMesocycle([], own.id), false, "состав не загружен или пуст");
    assert.equal(isGroupOfMesocycle(await groupOf(b, ownB, shared.id), shared.id), true, "возврат к общему — снова есть, из программы другого участника");

    await plans.leaveGroup(a, programId, await revision(), mesocycleId, b);
    const afterLeave = await groupOf(b, ownB, shared.id);
    assert.equal(isGroupOfMesocycle(afterLeave, shared.id), false, "вышедший видит только себя — переключателя нет");
    assert.equal(isGroupOfMesocycle(await groupOf(a, programId, mesocycleId), mesocycleId), true, "у остальных он остаётся");
  } finally {
    await env.close();
  }
});
