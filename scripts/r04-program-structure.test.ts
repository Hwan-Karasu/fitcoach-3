import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readLegacyProgramBooksInSnapshot } from "./r04/LegacyProgramBookSourceReader.ts";
import { readLegacyProgramStructureInSnapshot, summarizeLegacyProgramStructure } from "./r04/LegacyProgramStructureSourceReader.ts";

function fixture(run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY);
      CREATE TABLE training_programs (id TEXT PRIMARY KEY,client_id TEXT,book_id TEXT,
        name TEXT,settings_json TEXT,deleted_at TEXT);
      CREATE TABLE training_weeks (id TEXT PRIMARY KEY,program_id TEXT,week_index INTEGER,data_json TEXT,deleted_at TEXT);
      CREATE TABLE training_workouts (id TEXT PRIMARY KEY,client_id TEXT,program_id TEXT,week_id TEXT,
        sort_index INTEGER,data_json TEXT,deleted_at TEXT);
      CREATE TABLE training_exercises (id TEXT PRIMARY KEY,workout_id TEXT,sort_index INTEGER,
        name TEXT,note TEXT,data_json TEXT,deleted_at TEXT);
      CREATE TABLE training_library_programs (id TEXT,client_id TEXT,PRIMARY KEY(client_id,id));
      INSERT INTO clients VALUES ('synthetic-a'),('synthetic-b');
      INSERT INTO training_programs VALUES
        ('synthetic-program-a','synthetic-a','synthetic-book','Имя А','{"pageIndex":0}',NULL),
        ('synthetic-program-b','synthetic-b','synthetic-book','Имя Б','{"pageIndex":1}',NULL);
      INSERT INTO training_library_programs VALUES ('synthetic-book','synthetic-a'),('synthetic-book','synthetic-b');
      INSERT INTO training_weeks VALUES ('synthetic-week-a','synthetic-program-a',0,'{}',NULL),
        ('synthetic-week-b','synthetic-program-b',0,'{}',NULL);
      INSERT INTO training_workouts VALUES
        ('synthetic-workout-a','synthetic-a','synthetic-program-a','synthetic-week-a',0,'{}',NULL),
        ('synthetic-workout-b','synthetic-b','synthetic-program-b','synthetic-week-b',0,'{}',NULL);
      INSERT INTO training_exercises VALUES
        ('synthetic-exercise-a','synthetic-workout-a',0,'Имя упражнения','Заметка','{"plannedReps":"10"}',NULL),
        ('synthetic-exercise-b','synthetic-workout-b',0,'Другое имя','Другая заметка','{}',NULL);`);
    run(db);
  } finally { db.close(); }
}

test("client-scoped library primary key permits the same book ID for two owners", () => fixture((db) => {
  const programs = readLegacyProgramBooksInSnapshot(db, "synthetic-scope");
  assert.equal(programs.length, 2);
  assert.ok(programs.every((row) => row.libraryIdHint === "same-client"));
  assert.notEqual(programs[0]?.sourceProgramId, programs[1]?.sourceProgramId);
  assert.ok(programs.every((row) => row.targetProgramId === null));
}));

test("same-client library identity takes precedence over another client's ID hint", () => fixture((db) => {
  db.exec("DELETE FROM training_library_programs WHERE client_id='synthetic-a'");
  const programs = readLegacyProgramBooksInSnapshot(db, "synthetic-scope");
  assert.equal(programs.find((row) => row.clientId === "synthetic-a")?.libraryIdHint, "other-client");
  assert.equal(programs.find((row) => row.clientId === "synthetic-b")?.libraryIdHint, "same-client");
}));

test("duplicate library identity for the same client is still rejected", () => fixture((db) => {
  db.exec(`CREATE TABLE duplicate_library AS SELECT * FROM training_library_programs;
    INSERT INTO duplicate_library SELECT * FROM training_library_programs WHERE client_id='synthetic-a';
    DROP TABLE training_library_programs; ALTER TABLE duplicate_library RENAME TO training_library_programs;`);
  assert.throws(() => readLegacyProgramBooksInSnapshot(db, "scope"), /R04_DUPLICATE_PROGRAM_LIBRARY_ID/u);
}));

test("source hierarchy preserves each client's program and all raw plan payloads", () => fixture((db) => {
  const rows = readLegacyProgramStructureInSnapshot(db, "synthetic-scope");
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => row.issues.length === 0));
  const exercise = rows.find((row) => row.sourceRowId === "synthetic-exercise-a")!;
  assert.equal(exercise.clientId, "synthetic-a");
  assert.equal(exercise.sourceProgramId, "synthetic-program-a");
  assert.equal(exercise.raw.note, "Заметка");
  assert.equal(exercise.raw.data_json, '{"plannedReps":"10"}');
  assert.equal(exercise.parentSourceKey, JSON.stringify(["synthetic-scope", "training_workouts", "synthetic-workout-a"]));
  assert.ok(rows.every((row) => row.targetId === null));
}));

test("soft-deleted program, week and exercise remain in the graph with original markers", () => fixture((db) => {
  db.exec("UPDATE training_programs SET deleted_at='legacy-marker'; UPDATE training_weeks SET deleted_at='legacy-marker'; UPDATE training_exercises SET deleted_at='legacy-marker'");
  const rows = readLegacyProgramStructureInSnapshot(db, "scope");
  assert.equal(rows.length, 8);
  assert.equal(summarizeLegacyProgramStructure(rows).deletionMarkerRows, 6);
  assert.equal(rows[0]?.raw.deleted_at, "legacy-marker");
}));

test("workout cannot borrow another client's program through a valid week ID", () => fixture((db) => {
  db.exec("UPDATE training_workouts SET program_id='synthetic-program-b',week_id='synthetic-week-b' WHERE id='synthetic-workout-a'");
  const rows = readLegacyProgramStructureInSnapshot(db, "scope");
  assert.ok(rows.find((row) => row.sourceRowId === "synthetic-workout-a")?.issues.includes("CROSS_CLIENT_PROGRAM"));
  assert.ok(rows.find((row) => row.sourceRowId === "synthetic-exercise-a")?.issues.includes("PARENT_REQUIRES_REVIEW"));
}));

test("week from another program is a conflict even when the workout's program exists", () => fixture((db) => {
  db.exec("UPDATE training_workouts SET week_id='synthetic-week-b' WHERE id='synthetic-workout-a'");
  const rows = readLegacyProgramStructureInSnapshot(db, "scope");
  assert.ok(rows.find((row) => row.sourceRowId === "synthetic-workout-a")?.issues.includes("WEEK_PROGRAM_MISMATCH"));
  assert.equal(rows.find((row) => row.sourceRowId === "synthetic-workout-a")?.sourceProgramId, "synthetic-program-a");
}));

test("missing parents and owners stay visible instead of disappearing behind joins", () => fixture((db) => {
  db.exec("UPDATE training_weeks SET program_id='synthetic-missing' WHERE id='synthetic-week-a'; UPDATE training_programs SET client_id='synthetic-missing-owner' WHERE id='synthetic-program-b'");
  const rows = readLegacyProgramStructureInSnapshot(db, "scope");
  assert.equal(rows.length, 8);
  assert.ok(rows.find((row) => row.sourceRowId === "synthetic-week-a")?.issues.includes("MISSING_PARENT"));
  assert.ok(rows.find((row) => row.sourceRowId === "synthetic-program-b")?.issues.includes("MISSING_OWNER"));
}));

test("unassigned workout keeps null links without manufacturing a program or week", () => fixture((db) => {
  db.exec("UPDATE training_workouts SET program_id=NULL,week_id=NULL WHERE id='synthetic-workout-a'");
  const workout = readLegacyProgramStructureInSnapshot(db, "scope").find((row) => row.sourceRowId === "synthetic-workout-a")!;
  assert.equal(workout.sourceProgramId, null);
  assert.equal(workout.parentSourceKey, null);
  assert.ok(workout.issues.includes("UNASSIGNED_PROGRAM"));
  assert.ok(workout.issues.includes("UNASSIGNED_WEEK"));
}));

test("invalid plan JSON is preserved and prevents confident descendant classification", () => fixture((db) => {
  db.exec("UPDATE training_programs SET settings_json='{broken' WHERE id='synthetic-program-a'");
  const rows = readLegacyProgramStructureInSnapshot(db, "scope");
  assert.equal(rows.find((row) => row.sourceRowId === "synthetic-program-a")?.raw.settings_json, "{broken");
  assert.ok(rows.find((row) => row.sourceRowId === "synthetic-program-a")?.issues.includes("INVALID_JSON"));
  assert.ok(rows.find((row) => row.sourceRowId === "synthetic-week-a")?.issues.includes("PARENT_REQUIRES_REVIEW"));
}));

test("ambiguous ordering retains every row and marks all conflicting positions", () => fixture((db) => {
  db.exec("INSERT INTO training_exercises SELECT 'synthetic-duplicate-position',workout_id,sort_index,name,note,data_json,deleted_at FROM training_exercises WHERE id='synthetic-exercise-a'");
  const rows = readLegacyProgramStructureInSnapshot(db, "scope");
  assert.equal(rows.length, 9);
  assert.equal(rows.filter((row) => row.issues.includes("DUPLICATE_POSITION")).length, 2);
}));

test("negative ordering is preserved without renumbering", () => fixture((db) => {
  db.exec("UPDATE training_weeks SET week_index=-1 WHERE id='synthetic-week-a'");
  const week = readLegacyProgramStructureInSnapshot(db, "scope").find((row) => row.sourceRowId === "synthetic-week-a")!;
  assert.equal(week.raw.week_index, -1);
  assert.ok(week.issues.includes("INVALID_POSITION"));
}));

test("duplicate physical row ID blocks reading instead of replacing a parent mapping", () => fixture((db) => {
  db.exec(`CREATE TABLE duplicate_exercises AS SELECT * FROM training_exercises;
    INSERT INTO duplicate_exercises SELECT * FROM training_exercises WHERE id='synthetic-exercise-a';
    DROP TABLE training_exercises; ALTER TABLE duplicate_exercises RENAME TO training_exercises;`);
  assert.throws(() => readLegacyProgramStructureInSnapshot(db, "scope"), /R04_STRUCTURE_ROW_IDENTITY_INVALID/u);
}));

test("missing JSON/lifecycle columns remain explicitly unobserved instead of becoming empty values", () => fixture((db) => {
  db.exec("ALTER TABLE training_programs DROP COLUMN settings_json; ALTER TABLE training_programs DROP COLUMN deleted_at");
  const rows = readLegacyProgramStructureInSnapshot(db, "scope");
  const program = rows.find((row) => row.sourceRowId === "synthetic-program-a")!;
  assert.equal(program.jsonShape, "column-not-observed");
  assert.equal(program.lifecycle, "column-not-observed");
  assert.equal(summarizeLegacyProgramStructure(rows).missingJsonShapeRows, 2);
  assert.equal(summarizeLegacyProgramStructure(rows).missingLifecycleShapeRows, 2);
}));

test("missing structural source column blocks rather than treating the table as empty", () => fixture((db) => {
  db.exec("ALTER TABLE training_weeks RENAME COLUMN program_id TO unknown_program_column");
  assert.throws(() => readLegacyProgramStructureInSnapshot(db, "scope"), /R04_STRUCTURE_SHAPE_UNSUPPORTED/u);
}));

test("duplicate client identity cannot multiply the inferred owners of descendants", () => fixture((db) => {
  db.exec(`CREATE TABLE duplicate_clients AS SELECT * FROM clients;
    INSERT INTO duplicate_clients SELECT * FROM clients WHERE id='synthetic-a';
    DROP TABLE clients; ALTER TABLE duplicate_clients RENAME TO clients;`);
  assert.throws(() => readLegacyProgramStructureInSnapshot(db, "scope"), /R04_STRUCTURE_CLIENT_IDENTITY_INVALID/u);
}));

test("aggregate report keeps source names, IDs and JSON out of audit output", () => fixture((db) => {
  const report = summarizeLegacyProgramStructure(readLegacyProgramStructureInSnapshot(db, "scope"));
  assert.equal(report.physicalRows, 8);
  assert.equal(report.programRows + report.weekRows + report.workoutRows + report.exerciseRows, 8);
  assert.equal(report.rowsRequiringReview, 0);
  assert.equal(report.targetWrites, 0);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|Имя|Заметка|pageIndex|plannedReps/u);
  assert.throws(() => readLegacyProgramStructureInSnapshot(db, " "), /R04_ACCOUNT_SCOPE_REQUIRED/u);
}));
