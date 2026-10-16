import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectLegacyBackup } from "./r02/LegacyBackupInspector.ts";
import { auditSourceFactCollisions } from "./r03/SourceFactCollisionAudit.ts";
import { auditLegacyRelations } from "./r03/LegacyRelationAudit.ts";
import { decideLegacyAudit } from "./r03/LegacyAuditDecision.ts";
import { screenLegacySemantics } from "./r03/LegacySemanticScreen.ts";
import { createSyntheticLegacyFixture, fixtureRows, scenarioExpectations, syntheticFixtureManifest } from "./r03/SyntheticLegacyFixture.ts";

const golden = JSON.parse(await readFile(new URL("./r03/synthetic-manifest.json", import.meta.url), "utf8")) as Record<string, { count: number; sha256: string }>;

test("R03: synthetic source counts and SHA-256 manifest are fixed", () => {
  assert.deepEqual(syntheticFixtureManifest(), golden);
  for (const rows of Object.values(fixtureRows)) {
    assert.ok(rows.every((row) => Object.values(row).every((value) => typeof value !== "string" ||
      !/(?:@|\+7\d{10}|\b\d{3}[- ]\d{2}[- ]\d{2}\b)/u.test(value))), "fixture has no obvious contact data");
  }
});

test("R03: synthetic source has valid FK, manifest and inspected shape", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const inventory = inspectLegacyBackup(db);
    assert.equal(inventory.status, "candidate");
    assert.equal(inventory.foreignKeyErrors, 0);
    assert.equal(inventory.clientRows, 2);
    assert.equal(inventory.bindingMatchesManifest, true);
  } finally { db.close(); }
});

test("R03: shared book has three mesocycles per client and isolated performed facts", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const shared = db.prepare(`SELECT count(DISTINCT client_id) AS clients, count(*) AS programs
      FROM training_programs WHERE book_id='synthetic-shared-book'`).get() as { clients: number; programs: number };
    assert.equal(shared.clients, 2);
    assert.equal(shared.programs, 6);
    const cycles = db.prepare(`SELECT client_id AS clientId, count(DISTINCT cycle_type) AS cycles
      FROM training_programs WHERE book_id='synthetic-shared-book' GROUP BY client_id ORDER BY client_id`).all() as { clientId: string; cycles: number }[];
    assert.deepEqual(cycles.map((row) => row.cycles), [3, 3]);
    const weeks = db.prepare(`SELECT p.client_id AS clientId, count(*) AS weeks FROM training_weeks w
      JOIN training_programs p ON p.id=w.program_id WHERE p.book_id='synthetic-shared-book'
      GROUP BY p.client_id ORDER BY p.client_id`).all() as { clientId: string; weeks: number }[];
    assert.deepEqual(weeks.map((row) => row.weeks), [3, 3]);
    const facts = db.prepare(`SELECT s.client_id AS clientId, count(*) AS facts FROM training_session_sets f
      JOIN training_session_exercises e ON e.id=f.session_exercise_id
      JOIN training_sessions s ON s.id=e.session_id
      JOIN training_programs p ON p.id=s.program_key WHERE p.book_id='synthetic-shared-book'
      GROUP BY s.client_id ORDER BY s.client_id`).all() as { clientId: string; facts: number }[];
    assert.deepEqual(facts.map((row) => row.facts), [4, 1]);
    assert.notEqual(facts[0]?.clientId, facts[1]?.clientId);
  } finally { db.close(); }
});

test("R03: archive retains its fact; only duplicate ID within the same exercise is rejected", () => {
  const db = createSyntheticLegacyFixture();
  try {
    assert.equal((db.prepare("SELECT count(*) AS count FROM training_archive_entries").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT count(*) AS count FROM training_session_sets WHERE source_fact_id='synthetic-archive-fact'").get() as { count: number }).count, 1);
    assert.throws(() => db.prepare("INSERT INTO training_session_sets VALUES ('synthetic-duplicate', 'synthetic-archive-exercise', 'synthetic-archive-fact', '6', '30')").run(), /UNIQUE/u);
  } finally { db.close(); }
});

test("R03: repeated source fact across sessions is retained and metric conflict is visible", () => {
  const db = createSyntheticLegacyFixture();
  try {
    assert.deepEqual(auditSourceFactCollisions(db), {
      sourceRows: 6, emptySourceFactIds: 0, duplicateGroups: 2, duplicateRows: 4,
      crossClientGroups: 0, crossSessionGroups: 2, crossProgramGroups: 2, metricConflictGroups: 1,
    });
  } finally { db.close(); }
});

test("R03: selected source relations are checked, not mistaken for verified facts", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const audit = auditLegacyRelations(db);
    assert.equal(audit.status, "no-detected-breaks");
    assert.equal(audit.findings.length, 14);
    assert.ok(audit.findings.every((finding) => finding.available && finding.sourceRows === 0));
    assert.equal(fixtureRows.training_exercise_history.length, 1, "history is a separate source row, not another performed set");
  } finally { db.close(); }
});

test("R03: cross-client workout and orphan session are reported without choosing a winner", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("UPDATE training_workouts SET client_id='synthetic-client-b' WHERE id='synthetic-planned-workout-a'");
    db.exec("INSERT INTO training_sessions VALUES ('synthetic-orphan-session', 'synthetic-missing-client', 'synthetic-program-a')");
    const audit = auditLegacyRelations(db);
    assert.equal(audit.status, "requires-review");
    assert.equal(audit.findings.find((finding) => finding.id === "workout_client_mismatch")?.sourceRows, 1);
    assert.equal(audit.findings.find((finding) => finding.id === "session_client")?.sourceRows, 1);
  } finally { db.close(); }
});

test("R03: absent relation table is incomplete coverage, never a clean zero", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("DROP TABLE training_exercise_history");
    const audit = auditLegacyRelations(db);
    assert.equal(audit.status, "incomplete-shape");
    assert.deepEqual(audit.findings.find((finding) => finding.id === "history_client"),
      { id: "history_client", available: false, sourceRows: null });
  } finally { db.close(); }
});

test("R03: semantic screen reports source rows and gaps, not verified performed sets", () => {
  const db = createSyntheticLegacyFixture();
  try {
    assert.deepEqual(screenLegacySemantics(db), {
      coverage: "complete", sourceSessionRows: 4, sourceSetRows: 6,
      sessionsWithoutExercises: 0, sessionsWithoutSets: 0, exercisesWithoutSets: 0,
      sourceHistoryRows: 1, historyWithoutMatchingSet: 0, historyMatchingMultipleSets: 1,
    });
  } finally { db.close(); }
});

test("R03: missing session sets and unmatched history are warnings, not synthesized facts", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.prepare("INSERT INTO training_sessions VALUES (?, ?, ?)").run("synthetic-empty-session", "synthetic-client-a", "synthetic-program-a");
    db.prepare("INSERT INTO training_session_exercises VALUES (?, ?)").run("synthetic-empty-exercise", "synthetic-empty-session");
    db.prepare("INSERT INTO training_exercise_history VALUES (?, ?, ?)").run("synthetic-orphan-history", "synthetic-client-b", "synthetic-no-set");
    const screen = screenLegacySemantics(db);
    assert.equal(screen.sessionsWithoutSets, 1);
    assert.equal(screen.exercisesWithoutSets, 1);
    assert.equal(screen.historyWithoutMatchingSet, 1);
    assert.equal(screen.sourceSetRows, 6);
  } finally { db.close(); }
});

test("R03: absent history table leaves unknown semantic counts as null", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("DROP TABLE training_exercise_history");
    const screen = screenLegacySemantics(db);
    assert.equal(screen.coverage, "incomplete-shape");
    assert.equal(screen.sourceHistoryRows, null);
    assert.equal(screen.historyWithoutMatchingSet, null);
    assert.equal(screen.historyMatchingMultipleSets, null);
  } finally { db.close(); }
});

test("R03: even a source without selected anomalies is not certified as performed truth", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("DELETE FROM training_session_sets WHERE id IN ('synthetic-set-a-reused','synthetic-conflict-copy')");
    db.exec("DELETE FROM training_session_exercises WHERE id='synthetic-exercise-a-reused'");
    db.exec("DELETE FROM training_sessions WHERE id='synthetic-session-a-reused'");
    const decision = decideLegacyAudit(auditSourceFactCollisions(db), auditLegacyRelations(db), screenLegacySemantics(db));
    assert.deepEqual(decision, { status: "requires-semantic-review", reasons: ["SOURCE_FACTS_UNVERIFIED"] });
  } finally { db.close(); }
});

test("R03: audit decision gives aggregate reason codes without source identities", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const collisions = auditSourceFactCollisions(db);
    const relations = auditLegacyRelations(db);
    const semantics = screenLegacySemantics(db);
    const decision = decideLegacyAudit(collisions, relations, semantics);
    assert.deepEqual(decision.reasons, [
      "SOURCE_FACTS_UNVERIFIED", "SOURCE_FACT_ID_REUSED", "SOURCE_FACT_METRICS_CONFLICT",
      "SOURCE_HISTORY_NOT_ONE_TO_ONE",
    ]);
    const report = JSON.stringify({ ...decision, collisions, relations, semantics });
    assert.ok(!report.includes("synthetic-client-") && !report.includes("synthetic-fact-"));
  } finally { db.close(); }
});

test("R03: broken links and missing schema remain separate review reasons", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("UPDATE training_workouts SET client_id='synthetic-client-b' WHERE id='synthetic-planned-workout-a'");
    db.exec("DROP TABLE training_exercise_history");
    const decision = decideLegacyAudit(auditSourceFactCollisions(db), auditLegacyRelations(db), screenLegacySemantics(db));
    assert.ok(decision.reasons.includes("SOURCE_RELATIONS_BROKEN"));
    assert.ok(decision.reasons.includes("SOURCE_RELATIONS_INCOMPLETE"));
    assert.ok(decision.reasons.includes("SOURCE_SEMANTIC_COVERAGE_INCOMPLETE"));
  } finally { db.close(); }
});

test("R03: water-only day, recipe and same-day measurements are represented", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const waterOnly = db.prepare("SELECT count(*) AS count FROM nutrition_days WHERE water_ml>0 AND meals_recorded=0").get() as { count: number };
    const recorded = db.prepare("SELECT count(*) AS count FROM nutrition_days WHERE meals_recorded=1").get() as { count: number };
    assert.equal(waterOnly.count, 1);
    assert.equal(recorded.count, 1);
    assert.equal((db.prepare("SELECT count(*) AS count FROM nutrition_recipes").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT count(*) AS count FROM client_measurements WHERE date_key='2026-01-02'").get() as { count: number }).count, 2);
  } finally { db.close(); }
});

test("R03: food presence overrides legacy flag and missing recipe protein stays missing", () => {
  const db = createSyntheticLegacyFixture();
  try {
    const days = db.prepare("SELECT meals_json, meals_recorded, water_ml FROM nutrition_days").all();
    const parsed = days.map((row) => ({
      entries: Object.values(JSON.parse(row.meals_json as string) as Record<string, unknown[]>).flat(),
      flag: row.meals_recorded, water: row.water_ml,
    }));
    assert.equal(parsed.filter((row) => row.entries.length > 0).length, 3);
    assert.equal(parsed.filter((row) => row.entries.length === 0 && Number(row.water) > 0).length, 1);
    assert.equal(parsed.filter((row) => row.entries.length > 0 && row.flag === 0).length, 2);
    const recipe = parsed.flatMap((row) => row.entries)
      .find((entry) => typeof entry === "object" && entry !== null
        && "recipeId" in entry) as Record<string, unknown> | undefined;
    assert.equal(recipe?.protein, null);
    assert.equal((recipe?.recipeSnapshot as Record<string, unknown>)?.protein, null);

    const before = db.prepare("SELECT meals_json FROM nutrition_days WHERE date_key='2026-01-02'").get()?.meals_json;
    db.prepare("UPDATE food_products SET calories=500 WHERE id='synthetic-food'").run();
    const after = db.prepare("SELECT meals_json FROM nutrition_days WHERE date_key='2026-01-02'").get()?.meals_json;
    assert.equal(after, before, "catalog edit cannot rewrite a frozen consumed snapshot");
  } finally { db.close(); }
});

test("R03: completed appointment correction compensates A and charges B once", () => {
  const correction = scenarioExpectations.completedAppointmentClientCorrection;
  assert.ok(fixtureRows.calendar_appointments.some((row) => row.id === correction.appointmentId && row.client_id === correction.fromClientId));
  const balance = (clientId: string) => correction.ledgerEvents
    .filter((event) => event.clientId === clientId)
    .reduce((sum, event) => sum + event.delta, 0);
  assert.equal(balance(correction.fromClientId), 0);
  assert.equal(balance(correction.toClientId), -1);
  assert.equal(correction.ledgerEvents.filter((event) => event.kind === "RETURNED").length, 1);
});

test("R03: ten structural revisions retain one original source fact", () => {
  const revisions = scenarioExpectations.structuralRevisions;
  assert.equal(revisions.length, 10);
  assert.deepEqual(revisions.map((item) => item.revision), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(revisions.map((item) => item.preservedSourceFactId)).size, 1);
  assert.ok(fixtureRows.training_programs.some((row) => row.id === revisions[0]?.programId));
  assert.equal(revisions[0]?.preservedSourceFactId,
    fixtureRows.training_session_sets.find((row) => row.id === "synthetic-archive-set")?.source_fact_id);
});

test("R03: semantic expectation catalog has a fixed SHA-256", () => {
  const hash = createHash("sha256").update(JSON.stringify(scenarioExpectations)).digest("hex");
  assert.equal(hash, "5bf5579e85bcdf2b95f3c9b9745ae91dff5815f2408ed60ddea32ba1c0e72d24");
});

test("R03: corrupted manifest is blocked without changing source facts", () => {
  const db = createSyntheticLegacyFixture();
  try {
    db.prepare("UPDATE athlete_backup_manifest SET json=?").run("{corrupted");
    const result = inspectLegacyBackup(db);
    assert.equal(result.status, "blocked");
    assert.ok(result.reasons.includes("MANIFEST_INVALID"));
    assert.equal((db.prepare("SELECT count(*) AS count FROM training_session_sets").get() as { count: number }).count, 6);
  } finally { db.close(); }
});
