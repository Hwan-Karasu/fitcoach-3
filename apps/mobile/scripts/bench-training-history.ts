import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { hasEnteredData, sessionDurationSec, workoutStatus } from "../src/features/training/execution/domain/ExecutionRules.ts";
import { isWorkingSet } from "../src/features/training/analytics/presentation/workingSet.ts";
import { exerciseActivity } from "../src/features/training/analytics/presentation/trainingStats.ts";
import { mesocyclesWithHistory, programsWithHistory, workoutGroups } from "../src/features/training/archive/presentation/historyGroups.ts";
import { sortHistory } from "../src/features/training/archive/presentation/trainingHistory.ts";
import { DevTrainingPlansRepository } from "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import type { SqliteConnectionPort } from "../src/shared/db/SqlitePort.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createTrainingHistory } from "../src/read-models/trainingHistory.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

/**
 * Замер стоимости чтения истории занятий (UX-контракт истории v1.2, P5). Запуск: `npm run bench:history`.
 * Данные синтетические: один клиент, 3 Простых программы × 52 недели × 3 тренировки = 468 занятий, по 6 упражнений × 4 подхода (≈ 11 тыс. подходов).
 * Время — на этой машине (Node, SQLite в памяти), а не на телефоне: цифры показывают рост по числам и сравнение «до/после», а не абсолют устройства.
 * Число обращений к SQLite — то, что на телефоне идёт через мост Expo.
 */
const WS = "synthetic-workspace-a";
const PROGRAMS = 3;
const WEEKS = 52;

function counting(port: SqliteConnectionPort) {
  const counter = { reads: 0 };
  const wrapped: SqliteConnectionPort = {
    ...port,
    all: ((sql: string, bindings?: never) => { counter.reads += 1; return port.all(sql, bindings); }) as SqliteConnectionPort["all"],
    first: ((sql: string, bindings?: never) => { counter.reads += 1; return port.first(sql, bindings); }) as SqliteConnectionPort["first"],
  };
  return { wrapped, counter };
}

function workouts(prefix: string): readonly PlannedWorkout[] {
  return Array.from({ length: 3 }, (_, w) => ({ id: `${prefix}-w${w}`, title: `Тренировка ${w + 1}`,
    exercises: Array.from({ length: 6 }, (_, e) => ({ id: `${prefix}-w${w}-e${e}`, exerciseId: `sys:repdb:ex${e}`, restSec: null, instruction: null, rir: null,
      sets: Array.from({ length: 4 }, (_, s) => ({ id: `${prefix}-w${w}-e${e}-s${s}`, reps: 10, repsMax: null, loadGrams: null,
        durationSec: null, distanceM: null })) })) }));
}

const db = new DatabaseSync(":memory:");
const { wrapped, counter } = counting(nodeSqlitePort(db));
const shared = new SharedSqliteDatabase(async () => wrapped);
const clients = new DevClientRepository(shared, WS, []);
await clients.initialize();
const plans = new DevTrainingPlansRepository(shared, WS);
await plans.initialize();
const execution = new DevTrainingExecutionRepository(shared, WS);
await execution.initialize();
const client = (await clients.create({ displayName: "SyntheticBench" })).id;

// Данные: программы — через репозиторий планов, занятия и подходы — прямой вставкой (генератор нагрузки, не путь продукта).
const insertSession = db.prepare(`INSERT INTO dev_training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id, outcome, actual_date,
  revision, created_at, updated_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, 1, 'x', 'x', ?, ?)`);
const insertSet = db.prepare(`INSERT INTO dev_training_performed_sets (id, workspace_id, session_id, planned_set_id, planned_exercise_id, exercise_id, position,
  set_type, reps, load_grams, confirmed_at, origin, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'NORMAL', 10, 50000, 'x', 'INPUT', 1, 'x')`);
let sessions = 0;
let sets = 0;
const created: { id: string; week: readonly PlannedWorkout[] }[] = [];
for (let program = 0; program < PROGRAMS; program += 1) {
  const week = workouts(`p${program}`);
  created.push({ id: (await plans.createSimpleProgram(client, { title: `Программа ${program + 1}`, plan: { weeks: WEEKS, workouts: week } })).id, week });
}
db.exec("BEGIN");
for (const [program, { id: programId, week }] of created.entries()) {
  for (let weekIndex = 1; weekIndex <= WEEKS; weekIndex += 1) {
    for (const workout of week) {
      const day = new Date(Date.UTC(2024, 0, 1 + program * 400 + (weekIndex - 1) * 7 + Number(workout.id.slice(-1)) * 2));
      const date = day.toISOString().slice(0, 10);
      const id = `s-${program}-${weekIndex}-${workout.id}`;
      insertSession.run(id, WS, client, programId, weekIndex, workout.id, date, `${date}T10:00:00.000Z`, `${date}T11:00:00.000Z`);
      sessions += 1;
      for (const exercise of workout.exercises) {
        for (const [position, set] of exercise.sets.entries()) {
          insertSet.run(`f-${id}-${set.id}`, WS, id, set.id, exercise.id, exercise.exerciseId, position);
          sets += 1;
        }
      }
    }
  }
}
db.exec("COMMIT");

const history = createTrainingHistory({ hasEnteredData, isWorkingSet, sessionDurationSec, workoutStatus, sortHistory }, execution, plans);
const timed = async <T>(task: () => Promise<T>) => { counter.reads = 0; const start = performance.now(); const value = await task(); return { value, ms: performance.now() - start, reads: counter.reads }; };
const sync = <T>(task: () => T) => { const start = performance.now(); const value = task(); return { value, ms: performance.now() - start }; };
const row = (label: string, ms: number, extra = "") => console.log(`${label.padEnd(58)} ${ms.toFixed(1).padStart(8)} мс  ${extra}`);

console.log(`\nДанные: ${sessions} занятий, ${sets} подходов, ${PROGRAMS} программы × ${WEEKS} недель\n`);
const cold = await timed(() => history.list(client));
row("history.list — 1-й вызов", cold.ms, `записей ${cold.value.length}, обращений к SQLite ${cold.reads}`);
const repeat = [await timed(() => history.list(client)), await timed(() => history.list(client)), await timed(() => history.list(client))];
row("history.list — повторные вызовы (среднее из 3)", repeat.reduce((sum, item) => sum + item.ms, 0) / repeat.length, `обращений к SQLite на вызов ${repeat[0]!.reads}`);
const entries = cold.value;
row("programsWithHistory", sync(() => programsWithHistory(entries)).ms);
const first = programsWithHistory(entries)[0]!;
row("mesocyclesWithHistory (одна программа)", sync(() => mesocyclesWithHistory(entries, first.programId)).ms);
row("workoutGroups (одна программа, 468/3 записей)", sync(() => workoutGroups(entries, { programId: first.programId, mesocycleId: null })).ms);
row("exerciseActivity (все упражнения)", sync(() => exerciseActivity(entries)).ms);
// Три экрана, открытых вместе (список программ, программа, статистика): каждый читает историю сам.
const screens = await timed(async () => { await Promise.all([history.list(client), history.list(client), history.list(client)]); });
row("три экрана читают историю одновременно", screens.ms, `обращений к SQLite ${screens.reads}`);
await shared.release();
await execution.close();
await plans.close();
await clients.close();
