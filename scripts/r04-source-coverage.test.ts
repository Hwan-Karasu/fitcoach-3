import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { statSync } from "node:fs";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { legacySourceCoverageReadPlan } from "../apps/mobile/src/features/legacy-import/data/LegacySourceCoverageReadPlan.ts";
import { coverageRows, coverageDigest } from "../apps/mobile/src/features/legacy-import/domain/LegacySourceCoverage.ts";
import { runNodeLegacyReadPlan } from "./r04/NodeLegacySourceReadPlan.ts";
import { fixture as nutritionFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";
import { runLegacyJobWorker } from "./support/legacy-job-worker.ts";
import { updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";

const opaque = 'Unmapped " PRIVATE store';
function extras(db: DatabaseSync) {
  db.exec(`CREATE TABLE "Unmapped "" PRIVATE store"(label TEXT,n REAL,payload BLOB);
    CREATE TABLE sync_operations(id TEXT,payload_json TEXT);
    CREATE TABLE import_jobs(id TEXT,status TEXT);
    CREATE TABLE empty_extension(id TEXT);
    CREATE TABLE serial_test(id INTEGER PRIMARY KEY AUTOINCREMENT);
    INSERT INTO serial_test DEFAULT VALUES;
    CREATE TABLE "\ue000"(id TEXT);
    CREATE TABLE "\u{10000}"(id TEXT);
    CREATE VIEW unexecuted_view AS SELECT missing_private_function(label) AS value FROM "Unmapped "" PRIVATE store";
    INSERT INTO sync_operations VALUES('PRIVATE-operation','{"pending":true}');
    INSERT INTO import_jobs VALUES('PRIVATE-job','pending');`);
  const insert = db.prepare('INSERT INTO "Unmapped "" PRIVATE store" VALUES(?,?,?)');
  for (let i = 0; i < 2; i++) insert.run('{"sqlBlobHex":"00ff"}', 1.25, new Uint8Array([0, 255]));
}
const fixture = (run: Parameters<typeof nutritionFixture>[0], amend: (db: DatabaseSync) => void = extras) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }); amend(db);
});
type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const stage = (f: Fixture, checkpoint?: Parameters<typeof stageLegacyImportCandidate>[1]) => stageLegacyImportCandidate({ openStaging: f.native.open,
  context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() }, checkpoint);
const records = (file: string) => inspect(file, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${(name as string).replaceAll('"', '""')}"`).all()]));
const empty = (file: string) => inspect(file, (db) => {
  for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_'").all()) if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("coverage enumerates every table/view, checks full collectors independently and retains unknown SQL cells without executing views", () => fixture(async (f) => {
  const coverage = f.snapshots.coverage;
  const expected = inspect(f.sourcePath, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name COLLATE BINARY").all().map((r) => r.name));
  assert.deepEqual(coverage.objects.map((r) => r.name), expected);
  const unknown = coverage.objects.find((r) => r.name === opaque)!;
  assert.equal(unknown.disposition, "REVIEW_REQUIRED"); assert.equal(unknown.rowCount, 2);
  assert.equal(unknown.rowsSha256, coverageDigest(unknown.retainedRows!));
  const rows = JSON.parse(unknown.retainedRows!) as string[]; assert.equal(rows.length, 2); assert.equal(rows[0], rows[1]);
  const cells = Object.fromEntries(JSON.parse(rows[0]!) as [string, unknown][]);
  assert.deepEqual(cells, { label: ["TEXT", '{"sqlBlobHex":"00ff"}'], n: ["NUMBER", "1.25"], payload: ["BLOB", "00ff"] });
  const view = coverage.objects.find((r) => r.name === "unexecuted_view")!;
  assert.equal(view.rowCount, null); assert.equal(view.retainedRows, null); assert.match(view.sql!, /missing_private_function/u);
  assert.equal(coverage.objects.find((r) => r.name === "sqlite_sequence")!.disposition, "SQLITE_INTERNAL");
  assert.equal(coverage.objects.find((r) => r.name === "empty_extension")!.retainedRows, "[]");
  inspect(f.sourcePath, (db) => assert.deepEqual(runNodeLegacyReadPlan(db, legacySourceCoverageReadPlan(f.context.accountScope, f.snapshots)), coverage));
  const result = await stage(f); assert.ok(result.owners.coverage.capturedTables > 20);
  assert.equal(result.owners.coverage.reviewViews, 1); assert.equal(result.owners.coverage.reviewRows, 5); assert.equal(result.finalizable, false);
  inspect(f.stagePath, (db) => {
    const stored = db.prepare("SELECT * FROM r04_source_coverage WHERE name=?").get(opaque)!;
    assert.equal(stored.retained_rows_json, unknown.retainedRows); assert.equal(stored.row_count, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_source_coverage").get()!.n, expected.length);
    const receipt = db.prepare("SELECT * FROM r04_source_coverage_receipt").get()!;
    assert.equal(receipt.source_sha256, f.sha); assert.equal(receipt.target_sha256, coverageDigest(receipt.target_json as string));
    inspect(f.sourcePath, (original) => {
      for (const r of coverage.objects.filter((r) => r.type === "table" && r.disposition !== "SQLITE_INTERNAL")) {
        const actual = original.prepare(`SELECT * FROM "${r.name.replaceAll('"', '""')}"`).all();
        const saved = db.prepare("SELECT retained_rows_json FROM r04_source_coverage WHERE name=?").get(r.name)!;
        assert.equal(saved.retained_rows_json, coverageRows(actual), r.name);
      }
    });
  });
  const before = records(f.stagePath); assert.equal(before.length, 84);
  const source = structuredClone(f.snapshots); (source.coverage.objects as unknown[]).reverse(); (source.clients.rows as unknown[]).reverse();
  await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: () => assert.fail("coverage replay allocated") });
  assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("tagged rows distinguish BLOB/text/null/zero and retain multiplicity and negative zero", () => {
  const encoded = coverageRows([{ x: null }, { x: 0 }, { x: -0 }, { x: "0" }, { x: new Uint8Array([0]) }, { x: "0" }]);
  const rows = JSON.parse(encoded) as string[]; assert.equal(new Set(rows).size, 5); assert.equal(rows.length, 6);
  assert.throws(() => coverageRows([{ x: 9007199254740992 }]), /SOURCE_COVERAGE_MISMATCH/u);
});

test("a missing full-table collector or altered physical cardinality cannot masquerade as complete capture", () => fixture(async (f) => {
  for (const kind of ["missing", "count", "column"] as const) inspect(f.sourcePath, (db) => {
    const source = structuredClone(f.snapshots);
    if (kind === "missing") Object.assign(source, { settings: { ...source.settings, rows: null } });
    if (kind === "count") (source.clients.rows as unknown[]).pop();
    if (kind === "column") delete (source.clients.rows[0] as Record<string, unknown>).profile_json;
    assert.throws(() => runNodeLegacyReadPlan(db, legacySourceCoverageReadPlan(f.context.accountScope, source)), /SOURCE_COVERAGE_MISMATCH/u);
  });
  assert.equal(digest(f.sourcePath), f.sha);
}));

test("coverage checkpoints and native writes roll back every owner; retry/reopen keep IDs and source bytes", async () => {
  for (const at of ["after-source-coverage-rows", "after-source-coverage-receipt", "before-commit", "insert", "receipt"] as const) await fixture(async (f) => {
    let failed = false;
    if (at === "insert" || at === "receipt") f.native.state.fail = (c) => !failed && c.kind === "run" && c.sql.startsWith(at === "insert" ? "INSERT INTO r04_source_coverage VALUES" : "INSERT INTO r04_source_coverage_receipt") && (failed = true);
    await assert.rejects(stage(f, (phase) => { if (phase === at) { failed = true; throw Error("PRIVATE callback"); } }), /WRITE_FAILED/u);
    assert.equal(failed, true); empty(f.stagePath); f.native.state.fail = undefined;
    await stage(f); const before = records(f.stagePath); await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context,
      source: f.snapshots, importedAt, referenceDay, allocate: () => assert.fail("retry allocated") });
    assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
  });
});

test("coverage source, retained data and receipts are captured before awaits and tamper cannot overwrite a staged candidate", () => fixture(async (f) => {
  const source = structuredClone(f.snapshots), pending = stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() });
  const index = source.coverage.objects.findIndex((r) => r.name === opaque);
  (source.coverage.objects as unknown[])[index] = { ...source.coverage.objects[index], retainedRows: "[]", rowCount: 0, rowsSha256: coverageDigest("[]") };
  await pending; const before = records(f.stagePath);
  await assert.rejects(stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() }), /SOURCE_COVERAGE_MISMATCH/u);
  assert.deepEqual(records(f.stagePath), before);
  for (const table of ["r04_source_coverage", "r04_source_coverage_receipt"]) {
    const field = table.endsWith("receipt") ? "target_json" : "retained_rows_json", where = table.endsWith("receipt") ? "id=1" : "name='import_jobs'";
    const original = inspect(f.stagePath, (db) => db.prepare(`SELECT ${field} AS v FROM ${table} WHERE ${where}`).get()!.v);
    inspect(f.stagePath, (db) => db.prepare(`UPDATE ${table} SET ${field}='[]' WHERE ${where}`).run()); const damaged = records(f.stagePath);
    await assert.rejects(stage(f), /SOURCE_COVERAGE_MISMATCH/u); assert.deepEqual(records(f.stagePath), damaged);
    inspect(f.stagePath, (db) => db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${where}`).run(original!));
  }
  await stage(f); assert.equal(f.native.handles.size, 0);
}));

test("unknown-table unsafe integers and virtual stores reject safely and close the pinned source", () => fixture(async (f) => {
  for (const kind of ["integer", "virtual"] as const) {
    const file = join(f.dir, `${kind}.sqlite`); inspect(f.sourcePath, (db) => db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`));
    inspect(file, (db) => {
      if (kind === "integer") db.exec("CREATE TABLE unknown_counter(value INTEGER); INSERT INTO unknown_counter VALUES(9007199254740993)");
      else db.exec("CREATE VIRTUAL TABLE unknown_search USING fts5(body)");
      updateLegacyManifestSize(db);
    });
    const native = nativeFactory(file), before = digest(file);
    await assert.rejects(readAdmittedLegacyDomainSnapshots(native.open, statSync(file).size), { message: kind === "integer" ? "R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE" : "R04_SOURCE_COVERAGE_VIRTUAL_STORE_UNSUPPORTED" });
    assert.equal(native.handles.size, 0); assert.equal(digest(file), before);
  }
}));

test("actual Expo adapters retain uncovered tables across start/restart without the selected file or new allocation", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), first = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start" });
  assert.equal(first.ok, true, first.code); const jobId = first.jobs[0]!.jobId, file = join(root, "legacy-import-jobs", jobId, "candidate.sqlite"), before = records(file);
  const next = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(next.ok, true, next.code); assert.equal(next.issued, 0); assert.equal(next.handles, 0); assert.deepEqual(records(file), before);
  assert.equal(inspect(file, (db) => db.prepare("SELECT row_count FROM r04_source_coverage WHERE name=?").get(opaque)!.row_count), 2);
  assert.equal(digest(f.sourcePath), f.sha);
}));

test("actual host Worker termination at each coverage checkpoint rolls back; disk resume preserves the entire raw store", async () => {
  for (const killAt of ["after-source-coverage-rows", "after-source-coverage-receipt"]) await fixture(async (f) => {
    const root = join(f.dir, "documents"), killed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", killAt });
    assert.equal(killed.terminated, true); const jobId = killed.jobs[0]!.jobId, file = join(root, "legacy-import-jobs", jobId, "candidate.sqlite"); empty(file);
    const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true });
    assert.equal(resumed.ok, true, resumed.code); assert.deepEqual(resumed.counts, [6, 12, 4, 4]); assert.equal(resumed.handles, 0);
    assert.equal(inspect(file, (db) => db.prepare("SELECT row_count FROM r04_source_coverage WHERE name=?").get(opaque)!.row_count), 2);
    assert.equal(digest(f.sourcePath), f.sha);
  });
});
