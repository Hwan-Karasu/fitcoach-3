import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLocalRepositories } from "../src/app/composition/createLocalRepositories.ts";
import { prepareProductionDatabase, PRODUCTION_WORKSPACE_ID as WS } from "../src/app/composition/productionDatabase.ts";
import type { SystemCatalog } from "../src/features/exercises/domain/ExerciseModel.ts";
import { hasEnteredData, sessionDurationSec, workoutStatus } from "../src/features/training/execution/domain/ExecutionRules.ts";
import { workoutDayFromEvidence } from "../src/features/training/execution/domain/WorkoutDateEvidence.ts";
import { isWorkingSet } from "../src/features/training/analytics/presentation/workingSet.ts";
import { sortHistory } from "../src/features/training/archive/presentation/trainingHistory.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import { createTrainingHistory } from "../src/read-models/trainingHistory.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../src/shared/db/SqlitePort.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const catalog = JSON.parse(readFileSync(new URL("../src/features/exercises/data/system-catalog.generated.json", import.meta.url), "utf8")) as SystemCatalog;
const rules = { hasEnteredData, isWorkingSet, sessionDurationSec, workoutStatus, sortHistory, workoutDayFromEvidence, dateContextKey: () => "UTC" };
const week = (prefix: string): readonly PlannedWorkout[] => [{ id: `${prefix}-w0`, title: "Тренировка", exercises: [{ id: `${prefix}-w0-e0`, exerciseId: "sys:repdb:ex0",
  restSec: null, instruction: null, rir: null, sets: [{ id: `${prefix}-w0-e0-s0`, reps: 10, repsMax: null, loadGrams: null, durationSec: null, distanceM: null }] }] }];
const TODAY = "2026-11-11";

test("ARCH-HARDEN-1d: дата последней проведённой тренировки по клиентам — один запрос дневника, результат как у полной истории", async () => {
  const root = mkdtempSync(join(tmpdir(), "roster-last-"));
  const file = join(root, "live.db");
  const counter = { reads: 0 };
  const counting = (port: SqliteConnectionPort): SqliteConnectionPort => {
    const wrap = (inner: SqliteStatementPort): SqliteStatementPort => ({ run: (sql, bindings) => inner.run(sql, bindings),
      first: (sql, bindings) => { counter.reads += 1; return inner.first(sql, bindings); },
      all: (sql, bindings) => { counter.reads += 1; return inner.all(sql, bindings); } });
    return { ...wrap(port), exclusive: (task) => port.exclusive(task), close: () => port.close() };
  };
  const database = new SharedSqliteDatabase(async () => counting(nodeSqlitePort(new DatabaseSync(file))));
  const owners = createLocalRepositories(database, WS, catalog);
  const raw = (sql: string, ...args: (string | number | null)[]) => { const handle = new DatabaseSync(file); try { handle.prepare(sql).run(...args); } finally { handle.close(); } };
  try {
    await prepareProductionDatabase(database);
    await owners.initialize();
    const make = async (name: string) => (await owners.clients.create({ displayName: name })).id;
    const program = async (client: string, prefix: string) => (await owners.trainingPlans.createSimpleProgram(client, { title: "Программа", plan: { weeks: 8, workouts: week(prefix) } })).id;
    const session = (id: string, client: string, programId: string, weekIndex: number, outcome: string | null, date: string, origin: string | null = null) =>
      raw(`INSERT INTO training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id, outcome, actual_date, revision,
        created_at, updated_at, origin_json, plan_deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'x', 'x', ?, ?)`,
      id, WS, client, programId, weekIndex, `${id.slice(0, 1)}-w0`, outcome, date, origin, origin === null ? null : "2026-10-25T00:00:00.000Z");

    // A: проведённые 1 и 5 ноября, пропущенная 8 ноября, проведённая «в будущем» 1 декабря.
    const a = await make("SyntheticLast A"); const pa = await program(a, "a");
    session("a1", a, pa, 1, "COMPLETED", "2026-11-01"); session("a2", a, pa, 2, "COMPLETED", "2026-11-05");
    session("a3", a, pa, 3, "MISSED", "2026-11-08"); session("a4", a, pa, 4, "COMPLETED", "2026-12-01");
    // B: только тренировка «в работе» (без исхода).
    const b = await make("SyntheticLast B"); const pb = await program(b, "b");
    session("b1", b, pb, 1, null, "2026-11-10");
    // C: проведённая тренировка программы, которой у клиента нет, и без снимка происхождения — в историю не входит.
    const c = await make("SyntheticLast C");
    session("c1", c, "missing-program", 1, "COMPLETED", "2026-11-03");
    // D: план удалён с сохранением истории (снимок происхождения). Негодный снимок схема не принимает (триггер TRAINING_INTEGRITY_INVALID).
    const d = await make("SyntheticLast D");
    session("d1", d, "deleted-program", 1, "COMPLETED", "2026-10-20", JSON.stringify({ programTitle: "Удалённая", programKind: "SIMPLE", mesocycleTitle: null, workoutTitle: "Тренировка" }));
    assert.throws(() => session("d2", d, "deleted-program", 2, "COMPLETED", "2026-11-09", "{}"), /TRAINING_INTEGRITY_INVALID/u);
    // E: без тренировок.
    const e = await make("SyntheticLast E");

    const history = createTrainingHistory(rules, owners.trainingExecution, owners.trainingPlans);
    const ids = [a, b, c, d, e];
    counter.reads = 0;
    const last = await history.lastCompleted(ids, TODAY);
    const fastReads = counter.reads;
    assert.deepEqual(Object.fromEntries(last), { [a]: "2026-11-05", [d]: "2026-10-20" });

    // Прежний расчёт (полная история каждого клиента) даёт то же самое.
    const legacy = createTrainingHistory(rules, { listClientExecutions: (id) => owners.trainingExecution.listClientExecutions(id),
      subscribeCommittedChanges: (listener) => owners.trainingExecution.subscribeCommittedChanges(listener) }, owners.trainingPlans);
    counter.reads = 0;
    assert.deepEqual(Object.fromEntries(await legacy.lastCompleted(ids, TODAY)), Object.fromEntries(last));
    assert.ok(fastReads < counter.reads, `чтений SQLite: ${fastReads} вместо ${counter.reads}`);
    assert.ok(fastReads <= 2 + ids.length, `не больше одного чтения плана на клиента с тренировками: ${fastReads}`);
  } finally { await owners.close(); rmSync(root, { recursive: true, force: true }); }
});
