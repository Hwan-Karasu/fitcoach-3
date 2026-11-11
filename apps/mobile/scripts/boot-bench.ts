/**
 * ARCH-HARDEN-1: замер холодного запуска и первой загрузки списка клиентов на ПК (V8, node:sqlite). Реальные prepareProductionDatabase,
 * репозитории и read-models; подменён только SQLite (node-sqlite-port со счётчиком запросов). Это НЕ время телефона (Hermes, мост Expo),
 * а сравнение «до/после» на одном наборе и одной машине; число запросов — то, что на телефоне идёт через мост.
 * Запуск: node --experimental-strip-types --expose-gc apps/mobile/scripts/boot-bench.ts <метка> [клиентов] [недель]
 * Результат: artifacts/arch-hardening/<метка>.json
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { createProductionBootDependencies } from "../src/app/bootstrap/ProductionBootDependencies.ts";
import { createLocalRepositories } from "../src/app/composition/createLocalRepositories.ts";
import { formatKopeks, pricePerSessionKopeks } from "../src/features/accounting/domain/AccountingRules.ts";
import { inspectProductionDatabase, prepareProductionDatabase, PRODUCTION_WORKSPACE_ID as WS } from "../src/app/composition/productionDatabase.ts";
import type { SystemCatalog } from "../src/features/exercises/domain/ExerciseModel.ts";
import { hasEnteredData, sessionDurationSec, workoutStatus } from "../src/features/training/execution/domain/ExecutionRules.ts";
import { workoutDayFromEvidence } from "../src/features/training/execution/domain/WorkoutDateEvidence.ts";
import { isWorkingSet } from "../src/features/training/analytics/presentation/workingSet.ts";
import { sortHistory } from "../src/features/training/archive/presentation/trainingHistory.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { createRosterOverviewSource } from "../src/read-models/rosterOverview.ts";
import { createTrainingHistory } from "../src/read-models/trainingHistory.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../src/shared/db/SqlitePort.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const label = process.argv[2] ?? "run";
const CLIENTS = Number(process.argv[3] ?? 30);
const WEEKS = Number(process.argv[4] ?? 26);
const catalog = JSON.parse(readFileSync(new URL("../src/features/exercises/data/system-catalog.generated.json", import.meta.url), "utf8")) as SystemCatalog;

const queries: string[] = [];
/** Счётчик на границе SQLite: и чтения соединения, и операторы внутри транзакций. */
function counting(port: SqliteConnectionPort): SqliteConnectionPort {
  const wrap = (inner: SqliteStatementPort): SqliteStatementPort => ({
    run: (sql, bindings) => { queries.push(sql); return inner.run(sql, bindings); },
    first: (sql, bindings) => { queries.push(sql); return inner.first(sql, bindings); },
    all: (sql, bindings) => { queries.push(sql); return inner.all(sql, bindings); },
  });
  return { ...wrap(port), exclusive: (task) => port.exclusive((tx) => task(wrap(tx))), close: () => port.close() };
}
const stats = () => ({ queries: queries.length, integrityChecks: queries.filter((sql) => sql.includes("integrity_check")).length,
  foreignKeyChecks: queries.filter((sql) => sql.includes("foreign_key_check")).length });
const heapMb = () => { globalThis.gc?.(); return Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 10) / 10; };

function workouts(prefix: string): readonly PlannedWorkout[] {
  return Array.from({ length: 3 }, (_, w) => ({ id: `${prefix}-w${w}`, title: `Тренировка ${w + 1}`,
    exercises: Array.from({ length: 6 }, (_, e) => ({ id: `${prefix}-w${w}-e${e}`, exerciseId: `sys:repdb:ex${e}`, restSec: null, instruction: null, rir: null,
      sets: Array.from({ length: 4 }, (_, s) => ({ id: `${prefix}-w${w}-e${e}-s${s}`, reps: 10, repsMax: null, loadGrams: null,
        durationSec: null, distanceM: null })) })) }));
}

const root = mkdtempSync(join(tmpdir(), "boot-bench-"));
const file = join(root, "fitcoach_v3.db");
const result: Record<string, unknown> = { label, node: process.version, clients: CLIENTS, weeks: WEEKS };
try {
  // 1. Наполнение: программы — через репозиторий планов, занятия и подходы — прямой вставкой (генератор нагрузки, не путь продукта).
  {
    const database = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file)));
    const owners = createLocalRepositories(database, WS, catalog);
    await prepareProductionDatabase(database);
    await owners.initialize();
    const created: { client: string; program: string; week: readonly PlannedWorkout[] }[] = [];
    for (let index = 0; index < CLIENTS; index += 1) {
      const client = (await owners.clients.create({ displayName: `SyntheticBench ${index}` })).id;
      const week = workouts(`c${index}`);
      const program = (await owners.trainingPlans.createSimpleProgram(client, { title: "Программа", plan: { weeks: WEEKS, workouts: week } })).id;
      created.push({ client, program, week });
    }
    await owners.close();
    const db = new DatabaseSync(file);
    const insertSession = db.prepare(`INSERT INTO training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id, outcome, actual_date,
      revision, created_at, updated_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, 1, 'x', 'x', ?, ?)`);
    const insertSet = db.prepare(`INSERT INTO training_performed_sets (id, workspace_id, session_id, planned_set_id, planned_exercise_id, exercise_id, position,
      set_type, reps, load_grams, confirmed_at, origin, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'NORMAL', 10, 50000, 'x', 'INPUT', 1, 'x')`);
    let sessions = 0; let sets = 0;
    db.exec("BEGIN");
    for (const [index, { client, program, week }] of created.entries()) {
      for (let weekIndex = 1; weekIndex <= WEEKS; weekIndex += 1) {
        for (const workout of week) {
          const date = new Date(Date.UTC(2026, 0, 1 + (weekIndex - 1) * 7 + Number(workout.id.slice(-1)) * 2)).toISOString().slice(0, 10);
          const id = `s-${index}-${weekIndex}-${workout.id}`;
          insertSession.run(id, WS, client, program, weekIndex, workout.id, date, `${date}T10:00:00.000Z`, `${date}T11:00:00.000Z`);
          sessions += 1;
          for (const exercise of workout.exercises) {
            for (const [position, set] of exercise.sets.entries()) { insertSet.run(`f-${id}-${set.id}`, WS, id, set.id, exercise.id, exercise.exerciseId, position); sets += 1; }
          }
        }
      }
    }
    db.exec("COMMIT"); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close();
    Object.assign(result, { sessions, sets, liveBytes: statSync(file).size });
  }

  // 2. Холодный запуск, как в createRuntime("production"): проверка идентичности при открытии → подготовка базы → инициализация репозиториев.
  const database = new SharedSqliteDatabase(async () => {
    const port = counting(nodeSqlitePort(new DatabaseSync(file)));
    await inspectProductionDatabase(port);
    return port;
  });
  const owners = createLocalRepositories(database, WS, catalog);
  queries.length = 0;
  let started = performance.now();
  // Тот же вызов, что делает BootCoordinator в приложении (createServices.ts): соединение открывается с проверкой идентичности.
  await createProductionBootDependencies(database, () => owners.initialize(), async () => null, { integrityVerifiedAtOpen: true }).openDatabase(WS);
  result.boot = { totalMs: Math.round(performance.now() - started), ...stats() };

  // 3. Первая загрузка сводки списка клиентов с плитками по умолчанию (следующее занятие, последняя тренировка, абонемент).
  const history = createTrainingHistory({ hasEnteredData, isWorkingSet, sessionDurationSec, workoutStatus, sortHistory, workoutDayFromEvidence,
    dateContextKey: () => "UTC" }, owners.trainingExecution, owners.trainingPlans);
  const roster = createRosterOverviewSource({ rules: { formatKopeks, pricePerSessionKopeks }, calendar: owners.calendar, accounting: owners.accounting,
    questionnaire: owners.questionnaire, measurements: owners.measurements, diary: owners.nutrition.diary, calc: owners.nutrition.calc, history });
  const ids = (await owners.clients.listRoster("ACTIVE")).map((row) => row.id);
  const now = new Date(2026, 10, 11, 12, 0, 0);
  const heapBefore = heapMb();
  queries.length = 0; started = performance.now();
  const overview = await roster.load(ids, now);
  const coldMs = performance.now() - started; const coldQueries = queries.length;
  const heapAfter = heapMb();
  queries.length = 0; started = performance.now();
  await roster.load(ids, now);
  const warmMs = performance.now() - started;
  const lastTraining = [...overview.values()].map((row) => row.metrics.find((metric) => metric.id === "lastTraining")?.value ?? null);
  result.roster = { clients: ids.length, coldMs: Math.round(coldMs), coldQueries, warmMs: Math.round(warmMs), warmQueries: queries.length,
    heapBeforeMb: heapBefore, heapAfterMb: heapAfter, heapGrowthMb: Math.round((heapAfter - heapBefore) * 10) / 10,
    lastTrainingSample: lastTraining.slice(0, 3), lastTrainingKnown: lastTraining.filter((value) => value !== null).length };
  await owners.close();
} finally { rmSync(root, { recursive: true, force: true }); }
mkdirSync("artifacts/arch-hardening", { recursive: true });
writeFileSync(`artifacts/arch-hardening/${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
