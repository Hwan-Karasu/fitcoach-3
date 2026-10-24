import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readLegacyTrainingSnapshots, type NativeLegacySourceDatabase } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { readLegacyPlansInSnapshot } from "./r04/LegacyPlansSourceReader.ts";
import { readLegacyExecutionInSnapshot } from "./r04/LegacyExecutionSourceReader.ts";
import { createLegacyTrainingTables } from "./support/legacy-training-tables.ts";

const scope = "portable-training-source";
function seed(db: DatabaseSync) {
  createLegacyTrainingTables(db);
  db.exec(`INSERT INTO training_programs(id,client_id,mode,name,settings_json,is_template,deleted_at) VALUES('p-a','a','free','Same name','{"totalWeeks":1}',0,NULL),('p-b','b','free','Same name','broken JSON',0,'2026-10-01');
    INSERT INTO training_weeks(id,program_id,week_index,data_json) VALUES('week','p-a',0,'{}');
    INSERT INTO training_workouts(id,client_id,program_id,week_id,sort_index,name,data_json) VALUES('workout','a','p-a','week',0,'Workout','{}');
    INSERT INTO training_exercises(id,workout_id,sort_index,name,data_json) VALUES('exercise','workout',0,'Exercise','{}');
    INSERT INTO training_set_logs(id,exercise_id,set_index,reps,weight,data_json) VALUES('set','exercise',0,'20','10','{}'),('draft','exercise',1,'20',NULL,'{}');
    INSERT INTO training_set_segments(id,set_log_id,segment_index,reps,weight) VALUES('segment','set',0,'20','10');
    INSERT INTO training_archive_entries(id,client_id,data_json) VALUES('archive','a','broken JSON');
    INSERT INTO training_workspaces(client_id,active_program_id,week_state_json) VALUES('a','p-a','unparsed state');
    INSERT INTO training_library_programs(id,client_id,name,mode) VALUES('library','a','Library','free');
    INSERT INTO training_program_view_state(actor_id,client_id,library_id,selected_program_id,state_json) VALUES('actor','a','library','p-a','{}');
    INSERT INTO training_library_preferences(actor_id,client_id,preferred_id) VALUES('actor','a','library');
    INSERT INTO training_sessions(id,client_id,source_workout_id,data_json) VALUES('session','a','workout','{}');
    INSERT INTO training_session_exercises(id,session_id,source_exercise_id,sort_index,data_json) VALUES('session-exercise','session','exercise',0,'{}');
    INSERT INTO training_session_sets(id,session_exercise_id,source_fact_id,set_index,reps,weight,segments_json,data_json) VALUES('session-set','session-exercise','set',0,'20','10','[]','{}');
    INSERT INTO training_exercise_history(id,client_id,source_fact_id,data_json) VALUES('history','a','set','{"reps":20.00000000000000001}');
    INSERT INTO training_workout_logs(id,client_id,workout_id,data_json) VALUES('log','a','workout','broken JSON');`);
}
function native(db: DatabaseSync, after?: (sql: string) => void) {
  let closed = false; const calls: string[] = [];
  const port: NativeLegacySourceDatabase = {
    getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
      calls.push(sql); const rows = db.prepare(sql).all(...bindings as SQLInputValue[]) as Row[]; after?.(sql); return rows;
    }, execAsync: async (sql) => { calls.push(sql); db.exec(sql); }, closeAsync: async () => { db.close(); closed = true; },
  };
  return { port, calls, closed: () => closed };
}
function source() { const db = new DatabaseSync(":memory:"); seed(db); return db; }

test("mobile training sources match host full rows without merging owners, soft-deletes, drafts or archives", async () => {
  const db = source(); db.exec('ALTER TABLE training_programs ADD COLUMN "extra""field" BLOB');
  db.prepare('UPDATE training_programs SET "extra""field"=? WHERE id=?').run(new Uint8Array([0, 255, 1]), "p-a");
  const expected = { plans: readLegacyPlansInSnapshot(db, scope), executions: readLegacyExecutionInSnapshot(db, scope) }, f = native(db);
  const actual = await readLegacyTrainingSnapshots(async () => f.port, scope);
  assert.deepEqual(actual, expected); assert.equal(f.closed(), true);
  assert.equal(actual.plans.tables.training_programs!.length, 2); assert.equal(actual.plans.tables.training_programs![1]!.deleted_at, "2026-10-01");
  assert.equal(actual.plans.tables.training_set_logs![1]!.weight, null); assert.equal(actual.plans.tables.training_archive_entries![0]!.data_json, "broken JSON");
  assert.equal(actual.executions.tables.training_exercise_history![0]!.data_json, '{"reps":20.00000000000000001}');
  assert.equal(actual.executions.tables.training_workout_logs![0]!.data_json, "broken JSON");
});

test("optional absence and observed empty stores remain distinct; required plan/history stores cannot disappear", async () => {
  const db = source(); db.exec("DROP TABLE training_workout_logs; DELETE FROM training_set_segments; DROP TABLE training_library_preferences");
  const f = native(db), actual = await readLegacyTrainingSnapshots(async () => f.port, scope);
  assert.equal(actual.executions.tables.training_workout_logs, null); assert.deepEqual(actual.executions.tables.training_set_segments, []);
  assert.equal(actual.plans.tables.training_library_preferences, null);
  for (const table of ["training_programs", "training_exercise_history"]) {
    const bad = source(); bad.exec(`DROP TABLE ${table}`); const port = native(bad);
    await assert.rejects(readLegacyTrainingSnapshots(async () => port.port, scope), /SHAPE_UNSUPPORTED/u); assert.equal(port.closed(), true);
  }
});

test("partial session stores and views stop collection rather than silently omitting execution history", async () => {
  for (const change of ["DROP TABLE training_session_sets", "DROP TABLE training_workout_logs; CREATE VIEW training_workout_logs AS SELECT 'not-table' AS id"]) {
    const db = source(); db.exec(change); const f = native(db);
    await assert.rejects(readLegacyTrainingSnapshots(async () => f.port, scope), change.includes("VIEW") ? /SOURCE_SHAPE_UNSUPPORTED/u : /PARTIAL_SESSION_STORE/u);
    assert.equal(f.closed(), true);
  }
  const db = source(); db.exec("DROP TABLE training_sessions; DROP TABLE training_session_exercises; DROP TABLE training_session_sets");
  const f = native(db), result = await readLegacyTrainingSnapshots(async () => f.port, scope);
  assert.equal(result.executions.tables.training_sessions, null); assert.equal(result.executions.tables.training_exercise_history!.length, 1);
});

test("unsafe SQL training indices fail before rows can be rounded by the bridge", async () => {
  for (const table of ["training_set_logs", "training_session_sets"]) {
    const db = source(); db.exec(`UPDATE ${table} SET set_index=9007199254740993`); const f = native(db);
    await assert.rejects(readLegacyTrainingSnapshots(async () => f.port, scope), { message: "R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE" });
    assert.equal(f.calls.includes(`SELECT * FROM "${table}"`), false); assert.equal(f.closed(), true);
  }
});

test("plans and execution rows share one snapshot while another connection updates both", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-training-source-")), path = join(dir, "inspection.db"), writer = new DatabaseSync(path);
  try {
    writer.exec("PRAGMA journal_mode=WAL"); seed(writer); let changed = false;
    const f = native(new DatabaseSync(path), (sql) => {
      if (!changed && sql === 'SELECT count(*) AS n FROM "training_set_logs"') {
        changed = true; writer.exec("BEGIN; UPDATE training_programs SET name='New name'; UPDATE training_session_sets SET reps='99'; COMMIT");
      }
    });
    const actual = await readLegacyTrainingSnapshots(async () => f.port, scope);
    assert.equal(changed, true); assert.equal(actual.plans.tables.training_programs![0]!.name, "Same name");
    assert.equal(actual.executions.tables.training_session_sets![0]!.reps, "20"); assert.equal(f.closed(), true);
    assert.equal(writer.prepare("SELECT reps FROM training_session_sets").get()!.reps, "99");
  } finally {
    writer.close(); const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(basename(absolute).startsWith("athlete-r04-training-source-")); rmSync(absolute, { recursive: true, force: true });
  }
});

test("row loss in either training owner is detected before a partial snapshot can be returned", async () => {
  for (const table of ["training_programs", "training_session_sets"]) {
    const f = native(source()), port: NativeLegacySourceDatabase = { ...f.port,
      getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
        const rows = await f.port.getAllAsync<Row>(sql, ...bindings as (string | number | null)[]);
        return sql === `SELECT * FROM "${table}"` ? rows.slice(1) : rows;
      },
    };
    await assert.rejects(readLegacyTrainingSnapshots(async () => port, scope), /(?:CARDINALITY|COVERAGE)_MISMATCH/u); assert.equal(f.closed(), true);
  }
});
