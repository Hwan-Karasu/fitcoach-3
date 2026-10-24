import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { LegacySourceAdmissionError } from "../apps/mobile/src/features/legacy-import/domain/LegacyBackupInventory.ts";
import { readAdmittedLegacyDomainSnapshots, type NativeLegacySourceDatabase } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { admitLegacyBackup, inspectLegacyBackup } from "./r02/LegacyBackupInspector.ts";

const accountScope = "PRIVATE-synthetic-account", workspace = "synthetic-workspace";
function fixture() {
  const db = new DatabaseSync(":memory:"); seedLegacyBackupMetadata(db, accountScope);
  db.exec("CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT); INSERT INTO client_day_facts VALUES('a','2026-10-19','80.1','','Нет')");
  updateLegacyManifestSize(db);
  const calls: string[] = []; let closed = false;
  const native: NativeLegacySourceDatabase = { getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
    calls.push(sql); return db.prepare(sql).all(...bindings as SQLInputValue[]) as Row[];
  }, execAsync: async (sql) => { calls.push(sql); db.exec(sql); }, closeAsync: async () => { calls.push("CLOSE"); db.close(); closed = true; } };
  const bytes = () => Number(db.prepare("PRAGMA page_count").get()!.page_count) * Number(db.prepare("PRAGMA page_size").get()!.page_size);
  return { db, native, calls, bytes, closed: () => closed };
}
function patchManifest(db: DatabaseSync, change: (record: Record<string, unknown>) => unknown) {
  const original = JSON.parse(db.prepare("SELECT json FROM athlete_backup_manifest").get()!.json as string) as Record<string, unknown>;
  db.prepare("UPDATE athlete_backup_manifest SET json=?").run(JSON.stringify(change(original)));
}
const noBusinessRows = (calls: readonly string[]) => assert.equal(calls.some((sql) => sql.startsWith('SELECT * FROM "')), false);

test("strict file candidate derives account and workspace from matching metadata before collecting facts", async () => {
  const f = fixture(), expected = inspectLegacyBackup(f.db), bytes = f.bytes(), strict = admitLegacyBackup(f.db, bytes);
  const result = await readAdmittedLegacyDomainSnapshots(async () => f.native, bytes);
  assert.equal(f.closed(), true); assert.deepEqual(result.admission.inventory, expected);
  assert.deepEqual(result.admission, strict);
  assert.equal(result.admission.accountScope, accountScope); assert.equal(result.admission.sourceWorkspaceId, workspace);
  assert.equal(result.admission.sourceDatabaseId, "synthetic-database"); assert.equal(result.admission.sourceDataRevision, 7);
  assert.equal(result.admission.sourceBackupId, "synthetic-backup"); assert.equal(result.admission.sourceCreatedAt, "2026-10-24T12:00:00.000Z");
  assert.equal(result.snapshots.nutrition.accountScope, accountScope); assert.equal(result.snapshots.measurements.clientDays![0]!.weight, "80.1");
  assert.equal(JSON.stringify(result.admission.inventory).includes(accountScope), false);
  assert.deepEqual(f.calls.slice(-2), ["ROLLBACK", "CLOSE"]);
});

test("bad binding, metadata versions, migration gaps and ambiguous workspace stop before domain rows", async () => {
  const cases: [string, (db: DatabaseSync) => void][] = [
    ["BINDING_UNVERIFIED", (db) => db.exec("UPDATE account_database_binding SET scope_key='PRIVATE-other-owner'")],
    ["WORKSPACE_AMBIGUOUS", (db) => db.exec("UPDATE clients SET workspace_id=NULL")],
    ["WORKSPACE_AMBIGUOUS", (db) => db.prepare("UPDATE clients SET workspace_id=?").run("\n\u00a0\u2001\ufeff")],
    ["WORKSPACE_AMBIGUOUS", (db) => db.exec("INSERT INTO clients VALUES('b','PRIVATE-other-workspace')")],
    ["MIGRATION_LEDGER_UNEXPECTED", (db) => db.exec("DELETE FROM schema_migrations WHERE version=4")],
    ["UNSUPPORTED_VERSION", (db) => patchManifest(db, (m) => ({ ...m, schemaVersion: 24 }))],
    ["BACKUP_REVISION_MISMATCH", (db) => db.exec("UPDATE backup_state SET database_id='PRIVATE-other-database'")],
    ["BACKUP_REVISION_MISMATCH", (db) => db.exec("UPDATE backup_state SET data_revision=8")],
    ["METADATA_SINGLETON_INVALID", (db) => db.exec("UPDATE account_database_binding SET id=2")],
    ["METADATA_SINGLETON_INVALID", (db) => db.exec("UPDATE athlete_backup_manifest SET id=2")],
    ["UNSUPPORTED_SHAPE", (db) => db.exec("DROP TABLE training_programs")],
    ["UNSUPPORTED_SHAPE", (db) => db.exec("DROP TABLE backup_state; CREATE VIEW backup_state AS SELECT 1 AS id")],
  ];
  for (const [reason, mutate] of cases) {
    const f = fixture(); mutate(f.db);
    if (f.db.prepare("SELECT 1 FROM athlete_backup_manifest WHERE id=1").get()) updateLegacyManifestSize(f.db);
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes()), (error) => {
      assert.ok(error instanceof LegacySourceAdmissionError); assert.ok(error.inventory.reasons.includes(reason), reason);
      assert.equal(JSON.stringify(error).includes("PRIVATE"), false); return true;
    });
    assert.equal(f.closed(), true); noBusinessRows(f.calls);
  }
});

test("case-insensitive SQLite collations cannot merge distinct source owners", async () => {
  for (const kind of ["binding", "workspace"]) {
    const f = fixture();
    if (kind === "binding") {
      f.db.exec("DROP TABLE account_database_binding; CREATE TABLE account_database_binding(id INTEGER,scope_key TEXT COLLATE NOCASE)");
      f.db.prepare("INSERT INTO account_database_binding VALUES(1,?)").run(accountScope.toLowerCase());
    } else {
      f.db.exec("DROP TABLE clients; CREATE TABLE clients(id TEXT,workspace_id TEXT COLLATE NOCASE); INSERT INTO clients VALUES('a','Owner'),('b','owner')");
    }
    updateLegacyManifestSize(f.db);
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes()), (error) => error instanceof LegacySourceAdmissionError
      && error.inventory.reasons.includes(kind === "binding" ? "BINDING_UNVERIFIED" : "WORKSPACE_AMBIGUOUS"));
    assert.equal(f.closed(), true); noBusinessRows(f.calls);
  }
});

test("malformed and incomplete manifests reject without leaking their contents", async () => {
  for (const field of ["databaseId", "backupId", "createdAt", "dataRevision", "databaseSize", "type", "appVersion"]) {
    const f = fixture(); patchManifest(f.db, (m) => { delete m[field]; return m; });
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes()), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("MANIFEST_INVALID"));
    assert.equal(f.closed(), true); noBusinessRows(f.calls);
  }
  for (const json of ['{"private":"PRIVATE source",bad}', '"PRIVATE source"', "1.00000000000000001", JSON.stringify({ data: "PRIVATE".repeat(3000) })]) {
    const f = fixture(); f.db.prepare("UPDATE athlete_backup_manifest SET json=?").run(json);
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes()), (error) => error instanceof LegacySourceAdmissionError
      && error.inventory.reasons.includes("MANIFEST_INVALID") && !JSON.stringify(error).includes("PRIVATE"));
    assert.equal(f.closed(), true); noBusinessRows(f.calls);
  }
});

test("file bytes, SQLite page size and manifest size must all agree", async () => {
  for (const kind of ["receipt", "manifest"]) {
    const f = fixture();
    if (kind === "manifest") patchManifest(f.db, (m) => ({ ...m, databaseSize: (m.databaseSize as number) + 1 }));
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes() + (kind === "receipt" ? 1 : 0)), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("MANIFEST_SIZE_MISMATCH"));
    assert.equal(f.closed(), true); noBusinessRows(f.calls);
  }
});

test("metadata decimal tokens are exact, including exponent forms and underflow", async () => {
  for (const raw of ["1.00000000000000001", "1e-400", "9007199254740993"]) {
    const f = fixture(), m = f.db.prepare("SELECT json FROM athlete_backup_manifest").get()!.json as string;
    f.db.prepare("UPDATE athlete_backup_manifest SET json=?").run(m.replace('"formatVersion":1', `"formatVersion":${raw}`));
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes()), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("UNSUPPORTED_VERSION"));
    assert.equal(f.closed(), true); noBusinessRows(f.calls);
  }
  const f = fixture(), m = f.db.prepare("SELECT json FROM athlete_backup_manifest").get()!.json as string;
  f.db.prepare("UPDATE athlete_backup_manifest SET json=?").run(m.replace('"formatVersion":1', '"formatVersion":1.00e0').replace('"schemaVersion":25', '"schemaVersion":250e-1'));
  assert.equal((await readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes())).admission.inventory.status, "candidate");
});

test("unsafe revision integers and non-integer migration storage cannot cross the native bridge", async () => {
  for (const kind of ["revision", "ledger"]) {
    const f = fixture();
    if (kind === "revision") f.db.exec("UPDATE backup_state SET data_revision=9007199254740993");
    else f.db.exec("DROP TABLE schema_migrations; CREATE TABLE schema_migrations(version TEXT); WITH RECURSIVE v(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM v WHERE n<25) INSERT INTO schema_migrations SELECT n FROM v");
    updateLegacyManifestSize(f.db);
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes()), (error) => error instanceof LegacySourceAdmissionError
      && error.inventory.reasons.includes(kind === "revision" ? "BACKUP_REVISION_MISMATCH" : "MIGRATION_LEDGER_UNEXPECTED"));
    assert.equal(f.closed(), true); noBusinessRows(f.calls);
  }
});

test("foreign key violations and a non-ok integrity result stop the candidate", async () => {
  const orphan = fixture(); orphan.db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE orphan(id TEXT REFERENCES clients(id)); INSERT INTO orphan VALUES('PRIVATE-missing-client')"); updateLegacyManifestSize(orphan.db);
  await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => orphan.native, orphan.bytes()), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("FOREIGN_KEYS_FAILED"));
  noBusinessRows(orphan.calls);
  const f = fixture(), native: NativeLegacySourceDatabase = { ...f.native, getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
    if (sql === "PRAGMA integrity_check") return [{ integrity_check: "PRIVATE corrupted page" }] as Row[];
    return f.native.getAllAsync<Row>(sql, ...bindings as (string | number | null)[]);
  } };
  await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => native, f.bytes()), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("INTEGRITY_FAILED") && !JSON.stringify(error).includes("PRIVATE"));
  assert.equal(f.closed(), true); noBusinessRows(f.calls);
});

test("an empty source does not acquire an invented source workspace", async () => {
  const f = fixture(); f.db.exec("DELETE FROM clients; DELETE FROM client_day_facts"); updateLegacyManifestSize(f.db);
  const result = await readAdmittedLegacyDomainSnapshots(async () => f.native, f.bytes());
  assert.equal(result.admission.sourceWorkspaceId, null); assert.equal(result.admission.accountScope, accountScope);
  assert.deepEqual(result.snapshots.nutrition.tables.client_day_facts, []);
});

test("each admission/read IO failure closes the private snapshot and exposes no native details", async () => {
  const reference = fixture(), result = await readAdmittedLegacyDomainSnapshots(async () => reference.native, reference.bytes());
  const queries = reference.calls.filter((sql) => sql.startsWith("SELECT") || sql.startsWith("PRAGMA") && !sql.includes(";"));
  assert.ok(queries.length > 30);
  for (let failAt = 0; failAt < queries.length; failAt++) {
    const f = fixture(), bytes = f.bytes(); let seen = 0;
    const native: NativeLegacySourceDatabase = { ...f.native, getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
      if (seen++ === failAt) throw new Error("PRIVATE database detail");
      return f.native.getAllAsync<Row>(sql, ...bindings as (string | number | null)[]);
    } };
    await assert.rejects(readAdmittedLegacyDomainSnapshots(async () => native, bytes), { message: "R04_SOURCE_READ_FAILED" });
    assert.equal(f.closed(), true);
  }
  const retry = fixture(); assert.deepEqual(await readAdmittedLegacyDomainSnapshots(async () => retry.native, retry.bytes()), result);
});
