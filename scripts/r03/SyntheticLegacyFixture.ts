import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/** Synthetic migration-source slice, not the production FitCoach 3 schema. */
export const fixtureRows = {
  clients: [
    { id: "synthetic-client-a", workspace_id: "synthetic-trainer-workspace" },
    { id: "synthetic-client-b", workspace_id: "synthetic-trainer-workspace" },
  ],
  training_programs: [
    ...[1, 2, 3].flatMap((cycle) => [
      { id: cycle === 1 ? "synthetic-program-a" : `synthetic-program-a-cycle-${cycle}`, client_id: "synthetic-client-a", book_id: "synthetic-shared-book", cycle_type: `synthetic-mesocycle-${cycle}` },
      { id: cycle === 1 ? "synthetic-program-b" : `synthetic-program-b-cycle-${cycle}`, client_id: "synthetic-client-b", book_id: "synthetic-shared-book", cycle_type: `synthetic-mesocycle-${cycle}` },
    ]),
    { id: "synthetic-archived-program", client_id: "synthetic-client-a", book_id: "synthetic-archive-book", cycle_type: "synthetic-mesocycle-1" },
  ],
  training_weeks: [
    ...[1, 2, 3].flatMap((cycle) => [
      { id: `synthetic-a-cycle-${cycle}-week`, program_id: cycle === 1 ? "synthetic-program-a" : `synthetic-program-a-cycle-${cycle}`, week_index: 0 },
      { id: `synthetic-b-cycle-${cycle}-week`, program_id: cycle === 1 ? "synthetic-program-b" : `synthetic-program-b-cycle-${cycle}`, week_index: 0 },
    ]),
  ],
  training_workouts: [
    { id: "synthetic-planned-workout-a", client_id: "synthetic-client-a", program_id: "synthetic-program-a", week_id: "synthetic-a-cycle-1-week", scheduled_at: "2026-01-02" },
    { id: "synthetic-planned-workout-b", client_id: "synthetic-client-b", program_id: "synthetic-program-b", week_id: "synthetic-b-cycle-1-week", scheduled_at: "2026-01-02" },
  ],
  training_exercises: [
    { id: "synthetic-planned-exercise-a", workout_id: "synthetic-planned-workout-a" },
    { id: "synthetic-planned-exercise-b", workout_id: "synthetic-planned-workout-b" },
  ],
  training_sessions: [
    { id: "synthetic-session-a", client_id: "synthetic-client-a", program_key: "synthetic-program-a" },
    { id: "synthetic-session-b", client_id: "synthetic-client-b", program_key: "synthetic-program-b" },
    { id: "synthetic-session-a-reused", client_id: "synthetic-client-a", program_key: "synthetic-program-a-cycle-2" },
    { id: "synthetic-archive-session", client_id: "synthetic-client-a", program_key: "synthetic-archived-program" },
  ],
  training_session_exercises: [
    { id: "synthetic-exercise-a", session_id: "synthetic-session-a" },
    { id: "synthetic-exercise-b", session_id: "synthetic-session-b" },
    { id: "synthetic-exercise-a-reused", session_id: "synthetic-session-a-reused" },
    { id: "synthetic-archive-exercise", session_id: "synthetic-archive-session" },
  ],
  training_session_sets: [
    { id: "synthetic-set-a", session_exercise_id: "synthetic-exercise-a", source_fact_id: "synthetic-fact-a", reps: "10", weight: "20" },
    { id: "synthetic-set-b", session_exercise_id: "synthetic-exercise-b", source_fact_id: "synthetic-fact-b", reps: "12", weight: "15" },
    { id: "synthetic-set-a-reused", session_exercise_id: "synthetic-exercise-a-reused", source_fact_id: "synthetic-fact-a", reps: "10", weight: "20" },
    { id: "synthetic-conflict-origin", session_exercise_id: "synthetic-exercise-a", source_fact_id: "synthetic-conflict-fact", reps: "8", weight: "20" },
    { id: "synthetic-conflict-copy", session_exercise_id: "synthetic-exercise-a-reused", source_fact_id: "synthetic-conflict-fact", reps: "9", weight: "20" },
    { id: "synthetic-archive-set", session_exercise_id: "synthetic-archive-exercise", source_fact_id: "synthetic-archive-fact", reps: "6", weight: "30" },
  ],
  training_exercise_history: [
    { id: "synthetic-history-row", client_id: "synthetic-client-a", source_fact_id: "synthetic-fact-a" },
  ],
  training_archive_entries: [
    { id: "synthetic-archive-entry", client_id: "synthetic-client-a", archived_at: "2026-01-02T10:00:00Z", data_json: "{}" },
  ],
  calendar_appointments: [
    { id: "synthetic-appointment", client_id: "synthetic-client-a", date_key: "2026-01-02" },
  ],
  food_products: [
    { id: "synthetic-food", name: "Synthetic food", calories: 100 },
  ],
  nutrition_recipes: [
    { id: "synthetic-recipe", name: "Synthetic recipe", items_json: '[{"productId":"synthetic-food"}]' },
  ],
  nutrition_days: [
    { client_id: "synthetic-client-a", date_key: "2026-01-02", water_ml: 250, meals_recorded: 1,
      meals_json: JSON.stringify({ breakfast: [{ id: "synthetic-food-entry", productId: "synthetic-food",
        grams: "125,5", createdAt: "2026-01-02T08:00:00Z",
        calories: 125.5, protein: 5, fat: 2, carbs: 20,
        productSnapshot: { id: "synthetic-food", calories: 100, protein: 4, fat: 1.6, carbs: 16 } }],
      lunch: [], dinner: [], snack: [] }), updated_at: "2026-01-02T10:00:00Z" },
    { client_id: "synthetic-client-a", date_key: "2026-01-03", water_ml: 500, meals_recorded: 0,
      meals_json: JSON.stringify({ breakfast: [], lunch: [], dinner: [], snack: [] }),
      updated_at: "2026-01-03T10:00:00Z" },
    { client_id: "synthetic-client-b", date_key: "2026-01-04", water_ml: 0, meals_recorded: 0,
      meals_json: JSON.stringify({ breakfast: [], lunch: [{ id: "synthetic-recipe-entry",
        recipeId: "synthetic-recipe", grams: "180", createdAt: "2026-01-04T12:00:00Z",
        calories: 180, protein: null, fat: 6, carbs: 25,
        recipeSnapshot: { id: "synthetic-recipe", calories: 100, protein: null, fat: 3, carbs: 14 } }],
      dinner: [], snack: [] }), updated_at: "2026-01-04T13:00:00Z" },
    { client_id: "synthetic-client-b", date_key: "2026-01-05", water_ml: 0, meals_recorded: 0,
      meals_json: JSON.stringify({ breakfast: [], lunch: [], dinner: [], snack: [{
        id: "synthetic-string-snapshot-entry", productId: "synthetic-food", grams: "100",
        createdAt: "2026-01-05T16:00:00Z", calories: 100, protein: 4, fat: 1.6, carbs: 16,
        productSnapshot: { id: "synthetic-food", calories: "100", protein: "4",
          fat: "1,6", carbs: "16" } }] }), updated_at: "2026-01-05T17:00:00Z" },
  ],
  client_measurements: [
    { id: "synthetic-measurement-1", client_id: "synthetic-client-a", date_key: "2026-01-02" },
    { id: "synthetic-measurement-2", client_id: "synthetic-client-a", date_key: "2026-01-02" },
  ],
} as const;

export type FixtureTable = keyof typeof fixtureRows;

/** Target-behaviour expectations, not claims about rows present in the user's backup. */
export const scenarioExpectations = {
  completedAppointmentClientCorrection: {
    appointmentId: "synthetic-appointment",
    fromClientId: "synthetic-client-a",
    toClientId: "synthetic-client-b",
    ledgerEvents: [
      { clientId: "synthetic-client-a", kind: "USED", delta: -1 },
      { clientId: "synthetic-client-a", kind: "RETURNED", delta: 1 },
      { clientId: "synthetic-client-b", kind: "USED", delta: -1 },
    ],
  },
  structuralRevisions: Array.from({ length: 10 }, (_, index) => ({
    programId: "synthetic-archived-program",
    revision: index + 1,
    preservedSourceFactId: "synthetic-archive-fact",
  })),
} as const;

export interface FixtureManifestEntry {
  readonly count: number;
  readonly sha256: string;
}

/** Hashes lock the synthetic inputs; no private source row is used. */
export function syntheticFixtureManifest(): Record<FixtureTable, FixtureManifestEntry> {
  return Object.fromEntries(Object.entries(fixtureRows).map(([table, rows]) => [
    table,
    { count: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") },
  ])) as Record<FixtureTable, FixtureManifestEntry>;
}

/** Isolated in-memory schema mirrors only the selected legacy columns. */
export function createSyntheticLegacyFixture(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE athlete_backup_manifest (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE account_database_binding (id INTEGER PRIMARY KEY, scope_key TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE clients (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
    CREATE TABLE training_programs (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), book_id TEXT, cycle_type TEXT NOT NULL);
    CREATE TABLE training_weeks (id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES training_programs(id), week_index INTEGER NOT NULL);
    CREATE TABLE training_workouts (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), program_id TEXT NOT NULL REFERENCES training_programs(id), week_id TEXT NOT NULL REFERENCES training_weeks(id), scheduled_at TEXT NOT NULL);
    CREATE TABLE training_exercises (id TEXT PRIMARY KEY, workout_id TEXT NOT NULL REFERENCES training_workouts(id));
    CREATE TABLE training_sessions (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), program_key TEXT NOT NULL);
    CREATE TABLE training_session_exercises (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES training_sessions(id));
    CREATE TABLE training_session_sets (id TEXT PRIMARY KEY, session_exercise_id TEXT NOT NULL REFERENCES training_session_exercises(id), source_fact_id TEXT NOT NULL, reps TEXT NOT NULL, weight TEXT NOT NULL, UNIQUE(session_exercise_id, source_fact_id));
    CREATE TABLE training_exercise_history (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), source_fact_id TEXT NOT NULL);
    CREATE TABLE training_archive_entries (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), archived_at TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE calendar_appointments (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), date_key TEXT NOT NULL);
    CREATE TABLE food_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, calories REAL NOT NULL);
    CREATE TABLE nutrition_recipes (id TEXT PRIMARY KEY, name TEXT NOT NULL, items_json TEXT NOT NULL);
    CREATE TABLE nutrition_days (client_id TEXT NOT NULL REFERENCES clients(id), date_key TEXT NOT NULL,
      water_ml INTEGER NOT NULL, meals_recorded INTEGER NOT NULL, meals_json TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(client_id,date_key));
    CREATE TABLE client_measurements (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), date_key TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO athlete_backup_manifest VALUES (1, ?)").run(JSON.stringify({
    type: "manual", formatVersion: 1, schemaVersion: 25, sourceSchemaVersion: 28,
    accountScopeKey: "synthetic-account-scope", appVersion: "2.0.0",
  }));
  db.prepare("INSERT INTO account_database_binding VALUES (1, ?)").run("synthetic-account-scope");
  const migration = db.prepare("INSERT INTO schema_migrations VALUES (?)");
  for (let version = 1; version <= 25; version += 1) migration.run(version);

  for (const row of fixtureRows.clients) db.prepare("INSERT INTO clients VALUES (?, ?)").run(row.id, row.workspace_id);
  for (const row of fixtureRows.training_programs) db.prepare("INSERT INTO training_programs VALUES (?, ?, ?, ?)").run(row.id, row.client_id, row.book_id, row.cycle_type);
  for (const row of fixtureRows.training_weeks) db.prepare("INSERT INTO training_weeks VALUES (?, ?, ?)").run(row.id, row.program_id, row.week_index);
  for (const row of fixtureRows.training_workouts) db.prepare("INSERT INTO training_workouts VALUES (?, ?, ?, ?, ?)").run(row.id, row.client_id, row.program_id, row.week_id, row.scheduled_at);
  for (const row of fixtureRows.training_exercises) db.prepare("INSERT INTO training_exercises VALUES (?, ?)").run(row.id, row.workout_id);
  for (const row of fixtureRows.training_sessions) db.prepare("INSERT INTO training_sessions VALUES (?, ?, ?)").run(row.id, row.client_id, row.program_key);
  for (const row of fixtureRows.training_session_exercises) db.prepare("INSERT INTO training_session_exercises VALUES (?, ?)").run(row.id, row.session_id);
  for (const row of fixtureRows.training_session_sets) db.prepare("INSERT INTO training_session_sets VALUES (?, ?, ?, ?, ?)").run(row.id, row.session_exercise_id, row.source_fact_id, row.reps, row.weight);
  for (const row of fixtureRows.training_exercise_history) db.prepare("INSERT INTO training_exercise_history VALUES (?, ?, ?)").run(row.id, row.client_id, row.source_fact_id);
  for (const row of fixtureRows.training_archive_entries) db.prepare("INSERT INTO training_archive_entries VALUES (?, ?, ?, ?)").run(row.id, row.client_id, row.archived_at, row.data_json);
  for (const row of fixtureRows.calendar_appointments) db.prepare("INSERT INTO calendar_appointments VALUES (?, ?, ?)").run(row.id, row.client_id, row.date_key);
  for (const row of fixtureRows.food_products) db.prepare("INSERT INTO food_products VALUES (?, ?, ?)").run(row.id, row.name, row.calories);
  for (const row of fixtureRows.nutrition_recipes) db.prepare("INSERT INTO nutrition_recipes VALUES (?, ?, ?)").run(row.id, row.name, row.items_json);
  for (const row of fixtureRows.nutrition_days) db.prepare("INSERT INTO nutrition_days VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.client_id, row.date_key, row.water_ml, row.meals_recorded, row.meals_json, row.updated_at);
  for (const row of fixtureRows.client_measurements) db.prepare("INSERT INTO client_measurements VALUES (?, ?, ?)").run(row.id, row.client_id, row.date_key);
  return db;
}
