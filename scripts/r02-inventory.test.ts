import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { inspectLegacyBackup } from "./r02/LegacyBackupInspector.ts";
import { selectLegacySource, type LegacySourceCandidate } from "./r02/LegacySourceSelection.ts";

function fixture(options: { workspace?: string; manifestScope?: string; bindingScope?: string; schemaVersion?: number } = {}): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE athlete_backup_manifest (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE account_database_binding (id INTEGER PRIMARY KEY, scope_key TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE clients (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
    CREATE TABLE training_sessions (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id));
  `);
  const manifest = { type: "manual", formatVersion: 1, schemaVersion: options.schemaVersion ?? 25,
    sourceSchemaVersion: 28, accountScopeKey: options.manifestScope ?? "synthetic-scope" };
  db.prepare("INSERT INTO athlete_backup_manifest VALUES (1, ?)").run(JSON.stringify(manifest));
  db.prepare("INSERT INTO account_database_binding VALUES (1, ?)").run(options.bindingScope ?? "synthetic-scope");
  db.prepare("INSERT INTO clients VALUES ('synthetic-client', ?)").run(options.workspace ?? "synthetic-workspace");
  db.exec("INSERT INTO training_sessions VALUES ('synthetic-session', 'synthetic-client')");
  const migration = db.prepare("INSERT INTO schema_migrations VALUES (?)");
  for (let version = 1; version <= 25; version += 1) migration.run(version);
  return db;
}

const source = (sourceId: string, overrides: Partial<LegacySourceCandidate> = {}): LegacySourceCandidate => ({
  sourceId, kind: "account-scoped", marker: "recognized", binding: "verified", schema: "supported", ...overrides,
});

test("R02: one verified source is a candidate, never an automatic migration", () => {
  assert.deepEqual(selectLegacySource([source("one")]), { status: "single-candidate", sourceId: "one" });
  assert.deepEqual(selectLegacySource([]), { status: "none" });
});

test("R02: multiple DBs, unknown marker and binding ambiguity fail closed", () => {
  assert.deepEqual(selectLegacySource([source("one"), source("two")]), { status: "blocked", reason: "AMBIGUOUS_SOURCE" });
  assert.deepEqual(selectLegacySource([source("one"), source("two", { marker: "unknown" })]), { status: "blocked", reason: "UNKNOWN_MARKER" });
  assert.deepEqual(selectLegacySource([source("one", { binding: "unverified" })]), { status: "blocked", reason: "UNVERIFIED_BINDING" });
  assert.deepEqual(selectLegacySource([source("one", { schema: "unknown" })]), { status: "blocked", reason: "UNSUPPORTED_SCHEMA" });
  assert.deepEqual(selectLegacySource([source("one"), source("one")]), { status: "blocked", reason: "DUPLICATE_SOURCE_ID" });
});

test("R02: compatible backup exposes only safe aggregate inventory", () => {
  const db = fixture();
  try {
    const result = inspectLegacyBackup(db);
    assert.equal(result.status, "candidate");
    assert.equal(result.clientRows, 1);
    assert.equal(result.sourceSchemaVersion, 28);
    assert.equal(result.migrationRows, 25);
    assert.equal(JSON.stringify(result).includes("synthetic-client"), false);
    assert.equal(JSON.stringify(result).includes("synthetic-scope"), false);
    assert.throws(() => db.exec("INSERT INTO clients VALUES ('forbidden', 'workspace')"), /readonly/u);
  } finally { db.close(); }
});

test("R02: invalid binding, unsupported version and ambiguous workspace block", () => {
  const wrongBinding = fixture({ bindingScope: "other-scope" });
  const wrongVersion = fixture({ schemaVersion: 24 });
  const twoWorkspaces = fixture();
  const missingWorkspace = fixture();
  const ledgerGap = fixture();
  twoWorkspaces.exec("INSERT INTO clients VALUES ('second', 'other-workspace')");
  missingWorkspace.exec("INSERT INTO clients VALUES ('second', '')");
  ledgerGap.exec("DELETE FROM schema_migrations WHERE version=1; INSERT INTO schema_migrations VALUES (0)");
  try {
    assert.ok(inspectLegacyBackup(wrongBinding).reasons.includes("BINDING_UNVERIFIED"));
    assert.ok(inspectLegacyBackup(wrongVersion).reasons.includes("UNSUPPORTED_VERSION"));
    assert.ok(inspectLegacyBackup(twoWorkspaces).reasons.includes("WORKSPACE_AMBIGUOUS"));
    assert.ok(inspectLegacyBackup(missingWorkspace).reasons.includes("WORKSPACE_AMBIGUOUS"));
    assert.ok(inspectLegacyBackup(ledgerGap).reasons.includes("MIGRATION_LEDGER_UNEXPECTED"));
  } finally { wrongBinding.close(); wrongVersion.close(); twoWorkspaces.close(); missingWorkspace.close(); ledgerGap.close(); }
});

test("R02: broken FK and missing schema shape block even with valid manifest", () => {
  const brokenFk = fixture();
  const missingShape = fixture();
  brokenFk.exec("PRAGMA foreign_keys=OFF; INSERT INTO training_sessions VALUES ('orphan', 'missing-client')");
  missingShape.exec("ALTER TABLE clients RENAME TO clients_old");
  try {
    assert.ok(inspectLegacyBackup(brokenFk).reasons.includes("FOREIGN_KEYS_FAILED"));
    assert.ok(inspectLegacyBackup(missingShape).reasons.includes("UNSUPPORTED_SHAPE"));
  } finally { brokenFk.close(); missingShape.close(); }
});

test("R02: inventory owns only its own read transaction and preserves an existing snapshot", () => {
  const db = fixture();
  try {
    db.exec("BEGIN"); assert.equal(inspectLegacyBackup(db).status, "candidate");
    assert.equal(db.isTransaction, true); db.exec("ROLLBACK");
    assert.equal(inspectLegacyBackup(db).status, "candidate"); assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});
