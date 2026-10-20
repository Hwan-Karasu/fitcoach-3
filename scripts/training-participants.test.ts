import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { counterpartOf, isGroupOfMesocycle, participantOrder } from "../apps/mobile/src/features/training/plans/domain/ParticipantCounterpart.ts";
import { preferredPlacement } from "../apps/mobile/src/features/training/plans/domain/Placement.ts";
import { addExercise, fillSets, newDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";
let n = 0;
const workouts = () => fillSets(addExercise(newDraft(`w${n}`), `w${n}`, `e${n}`, BENCH, () => `s${n++}`), `e${n - 1}`, "reps", 10).plan.workouts;
const builder = (title: string) => ({ title, cycleType: null, repRange: null, startDate: null,
  weeks: [{ type: "heavy" as const, workouts: workouts() }, { type: "base" as const, workouts: [] }] });

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
  return { db, plans, a, b, c, d, ownB: own.id, close: async () => { await plans.close(); await clients.close(); } };
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

test("UI-OWN-044 размещение по умолчанию, как в 2.0: текущая Расширенная → последняя Расширенная → участие", async () => {
  const program = (id: string, kind: "SIMPLE" | "PERIODIZED", createdAt: string) => ({ id, kind, title: id, createdAt });
  const list = [program("old", "PERIODIZED", "2026-01-01"), program("new", "PERIODIZED", "2026-05-01"), program("s", "SIMPLE", "2026-06-01")];
  assert.deepEqual(preferredPlacement(list, "old", "host"), { kind: "program", programId: "old" }, "текущая Расширенная");
  assert.deepEqual(preferredPlacement(list, "s", "host"), { kind: "program", programId: "new" }, "текущая Простая — последняя Расширенная");
  assert.deepEqual(preferredPlacement([program("s", "SIMPLE", "2026-06-01")], "s", "host"), { kind: "join" });
  assert.deepEqual(preferredPlacement([program("host", "PERIODIZED", "2026-06-01")], "host", "host"), { kind: "join" }, "эта же программа — не вариант");

  const env = await setup();
  try {
    const options = await env.plans.getPlacementOptions([env.b, env.c, env.d], null);
    assert.deepEqual(options.map((item) => item.preferred), [{ kind: "program", programId: env.ownB }, { kind: "join" }, { kind: "join" }]);
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

    await plans.addParticipants(a, programId, await revision(), mesocycleId, c, [{ clientId: b, target: { kind: "join" } }]);
    assert.deepEqual(await group(a, programId, mesocycleId), [a, b, c, d].sort());
    assert.deepEqual((await plans.getPeriodizedPlan(b, ownB))!.mesocycles[1], copyB, "вернувшийся — со своим планом в своей программе");
    assert.deepEqual((await plans.getProgram(a, programId))!.memberClientIds, [a, c], "в общую программу не добавлен");
  } finally {
    await env.close();
  }
});

test("UI-OWN-044 групповая правка недели доходит до копии участника в его программе", async () => {
  const env = await setup();
  try {
    const { plans, a, b, ownB } = env;
    const { programId, mesocycleId, revision } = await createGroup(env);
    const week = (await plans.getPeriodizedPlan(a, programId))!.mesocycles[0]!.weeks[0]!;
    const exerciseId = week.workouts[0]!.exercises[0]!.id;
    const edited = fillSets({ title: "м", plan: { weeks: 1, workouts: week.workouts } }, exerciseId, "reps", 5).plan.workouts;
    const ownRevision = (await plans.getProgram(b, ownB))!.revision;
    await plans.saveWeek(a, programId, await revision(), { mesocycleId, weekIndex: 1, workouts: edited, type: week.type,
      scope: "CURRENT", clientIds: [a, b] });
    const copy = (await plans.getPeriodizedPlan(b, ownB))!.mesocycles[1]!;
    assert.equal(copy.weeks[0]!.workouts[0]!.exercises[0]!.sets[0]!.reps, 5);
    assert.equal((await plans.getProgram(b, ownB))!.revision, ownRevision + 1, "ревизия его программы изменилась");
  } finally {
    await env.close();
  }
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
      { mesocycleId: cycleB.id, weekIndex: 2, workoutId: null }, "недели нет — последняя неделя, без тренировки");
    assert.deepEqual((await plans.getMesocycleGroup(a, programId, { workoutId: workoutA.id })).map((item) => item.clientId).length, 4,
      "группа находится и по тренировке");
  } finally {
    await env.close();
  }
});

test("UI-OWN-044 схема: дата выхода копии из группы не бывает пустой строкой", async () => {
  const env = await setup();
  try {
    assert.throws(() => env.db.prepare("UPDATE dev_training_mesocycles SET group_left_at = ''").run(), /CHECK/);
    const memberColumns = env.db.prepare("PRAGMA table_info(dev_training_program_members)").all().map((row) => String(row.name));
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
