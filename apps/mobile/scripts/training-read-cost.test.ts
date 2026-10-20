import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository } from "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import type { SqliteConnectionPort } from "../src/shared/db/SqlitePort.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Стоимость чтения: число обращений к SQLite не должно расти с размером программы и числом занятий — на телефоне каждое
// обращение идёт через мост Expo, и сотни последовательных запросов давали секунды задержки при открытии и переключении.
const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";

/** Порт, считающий чтения (`all`/`first`) вне транзакций записи. */
function counting(port: SqliteConnectionPort) {
  const counter = { reads: 0 };
  const wrapped: SqliteConnectionPort = {
    ...port,
    all: ((sql: string, bindings?: never) => { counter.reads += 1; return port.all(sql, bindings); }) as SqliteConnectionPort["all"],
    first: ((sql: string, bindings?: never) => { counter.reads += 1; return port.first(sql, bindings); }) as SqliteConnectionPort["first"],
  };
  return { wrapped, counter };
}

/** Неделя из 3 тренировок × 6 упражнений × 4 подхода с ID, уникальными по префиксу. */
function week(prefix: string): readonly PlannedWorkout[] {
  return Array.from({ length: 3 }, (_, w) => ({ id: `${prefix}-w${w}`, title: `Тренировка ${w + 1}`,
    exercises: Array.from({ length: 6 }, (_, e) => ({ id: `${prefix}-w${w}-e${e}`, exerciseId: BENCH, restSec: null, instruction: null, rir: null,
      sets: Array.from({ length: 4 }, (_, s) => ({ id: `${prefix}-w${w}-e${e}-s${s}`, reps: 10, repsMax: null, loadGrams: null,
        durationSec: null, distanceM: null })) })) }));
}

async function setup() {
  const db = new DatabaseSync(":memory:");
  const { wrapped, counter } = counting(nodeSqlitePort(db));
  const shared = new SharedSqliteDatabase(async () => wrapped);
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  const big = (await clients.create({ displayName: "SyntheticBig" })).id;
  const small = (await clients.create({ displayName: "SyntheticSmall" })).id;
  const bigProgram = await plans.createPeriodizedProgram({ title: "Большая", clientIds: [big], mesocycle: { title: "Блок 0", cycleType: null,
    repRange: null, startDate: null, weeks: [{ type: "base", workouts: week("b0") }] } });
  for (let cycle = 1; cycle <= 4; cycle += 1) {
    const revision = (await plans.getProgram(big, bigProgram.id))!.revision;
    await plans.createMesocycle(big, bigProgram.id, revision, { title: `Блок ${cycle}`, weeks: 8, firstWeek: week(`b${cycle}`), clientIds: [big] });
  }
  const smallProgram = await plans.createPeriodizedProgram({ title: "Малая", clientIds: [small], mesocycle: { title: "Блок 0", cycleType: null,
    repRange: null, startDate: null, weeks: [{ type: "base", workouts: week("s0") }] } });
  /** Подход и исход «Завершена» в тренировке; ключ занятия — слот. */
  const complete = async (clientId: string, programId: string, weekIndex: number, workout: PlannedWorkout, date: string) => {
    const exercise = workout.exercises[0]!;
    const slot = { clientId, programId, weekIndex, plannedWorkoutId: workout.id };
    await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: BENCH, plannedSetId: exercise.sets[0]!.id, position: 0,
      metrics: ["load", "reps"], values: { loadGrams: 50_000, reps: 10, durationSec: null, distanceM: null }, setType: "NORMAL",
      drops: [], rpe: null, expectedRevision: null }, new Date(`${date}T10:00:00Z`));
    const current = (await execution.getWorkout(slot)).session!;
    await execution.setOutcome(slot, "COMPLETED", current.revision);
  };
  const slotsOf = async (clientId: string, programId: string) => (await plans.getPeriodizedPlan(clientId, programId))!.mesocycles
    .flatMap((cycle) => cycle.weeks.flatMap((item) => item.workouts.map((workout) => ({ weekIndex: item.index, workout }))));
  const bigSlots = await slotsOf(big, bigProgram.id);
  for (const [index, slot] of bigSlots.slice(0, 40).entries()) {
    await complete(big, bigProgram.id, slot.weekIndex, slot.workout, `2026-09-${String((index % 28) + 1).padStart(2, "0")}`);
  }
  const smallSlot = (await slotsOf(small, smallProgram.id))[0]!;
  await complete(small, smallProgram.id, smallSlot.weekIndex, smallSlot.workout, "2026-09-01");
  const measure = async <T>(task: () => Promise<T>) => { counter.reads = 0; const value = await task(); return { value, reads: counter.reads }; };
  /** Репозиторий с пустым кэшем: «холодное» чтение плана (подготовка теста уже прогрела кэш основного). */
  const coldPlans = async () => { const repo = new DevTrainingPlansRepository(shared, WS); await repo.initialize(); return repo; };
  return { db, plans, coldPlans, execution, big, small, bigProgram: bigProgram.id, smallProgram: smallProgram.id, bigSlots, measure,
    close: async () => { await shared.release(); await execution.close(); await plans.close(); await clients.close(); } };
}

test("чтение плана: число обращений к SQLite не растёт с размером программы", async (t) => {
  const env = await setup();
  try {
    assert.ok(env.bigSlots.length >= 90, `большая программа действительно большая: ${env.bigSlots.length} тренировок`);
    const [coldBig, coldSmall] = [await env.coldPlans(), await env.coldPlans()];
    const large = await env.measure(() => coldBig.getPeriodizedPlan(env.big, env.bigProgram));
    const little = await env.measure(() => coldSmall.getPeriodizedPlan(env.small, env.smallProgram));
    t.diagnostic(`обращений: большая программа ${large.reads}, малая ${little.reads} (до исправления было 108 и 8)`);
    assert.equal(large.value!.mesocycles.length, 5);
    assert.equal(large.reads, little.reads, `большая программа (${large.reads}) стоит как малая (${little.reads})`);
    assert.ok(large.reads <= 12, `чтение плана — не более 12 обращений, сейчас ${large.reads}`);
  } finally {
    await env.close();
  }
});

test("чтение занятий клиента: число обращений не растёт с числом занятий", async (t) => {
  const env = await setup();
  try {
    const many = await env.measure(() => env.execution.listClientExecutions(env.big));
    const one = await env.measure(() => env.execution.listClientExecutions(env.small));
    t.diagnostic(`обращений: 40 занятий ${many.reads}, одно ${one.reads} (до исправления было 121 и 4)`);
    assert.equal(many.value.length, 40);
    assert.equal(many.reads, one.reads, `40 занятий (${many.reads}) стоят как одно (${one.reads})`);
    assert.ok(many.reads <= 8, `чтение занятий — не более 8 обращений, сейчас ${many.reads}`);
    const program = await env.measure(() => env.execution.listProgramExecutions(env.big, env.bigProgram));
    assert.equal(program.value.length, 40);
    assert.ok(program.reads <= 8, `чтение занятий программы — не более 8 обращений, сейчас ${program.reads}`);
  } finally {
    await env.close();
  }
});

test("повторное чтение плана без записи — из кэша (одна сверка членства); после записи — заново и с новым значением", async () => {
  const env = await setup();
  try {
    const cold = await env.coldPlans();
    const first = await env.measure(() => cold.getPeriodizedPlan(env.big, env.bigProgram));
    assert.ok(first.reads > 0, "холодное чтение идёт в базу");
    const again = await env.measure(() => cold.getPeriodizedPlan(env.big, env.bigProgram));
    assert.ok(again.reads <= 1, `второе чтение — не более одной сверки членства, сейчас ${again.reads}`);
    const program = (await cold.getProgram(env.big, env.bigProgram))!;
    await cold.renameProgram(program.id, program.revision, "Переименованная");
    const fresh = await env.measure(() => cold.getPeriodizedPlan(env.big, env.bigProgram));
    assert.ok(fresh.reads > 0, "после записи кэш сброшен");
    assert.equal(fresh.value!.program.title, "Переименованная", "новое значение, а не прежнее из кэша");
  } finally {
    await env.close();
  }
});

test("запись выбора мезоцикла оповещает как «только выбор» (экран не перезагружается), переименование — как обычное изменение", async () => {
  const env = await setup();
  try {
    const plan = (await env.plans.getPeriodizedPlan(env.big, env.bigProgram))!;
    const other = plan.mesocycles.find((cycle) => cycle.id !== plan.selectedMesocycleId)!;
    const changes: boolean[] = [];
    const stop = env.plans.subscribeCommittedChanges((change) => changes.push(change.selectionOnly === true));
    await env.plans.selectMesocycle(env.big, env.bigProgram, other.id);
    const program = (await env.plans.getProgram(env.big, env.bigProgram))!;
    await env.plans.renameProgram(program.id, program.revision, "Другая");
    stop();
    assert.deepEqual(changes, [true, false], "выбор — только выбор; переименование — обычное изменение");
    assert.equal((await env.plans.getPeriodizedPlan(env.big, env.bigProgram))!.selectedMesocycleId, other.id,
      "выбор виден при следующем чтении — кэш сброшен");
  } finally {
    await env.close();
  }
});
