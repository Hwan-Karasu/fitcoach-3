import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stageLegacyInspectionCandidate } from "../apps/mobile/src/app/composition/stageLegacyInspectionCandidate.ts";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { prepareLegacyInspectionCopy } from "../apps/mobile/src/features/legacy-import/data/LegacyInspectionCopy.ts";
import { seedLegacyBackupMetadata } from "./support/legacy-backup-metadata.ts";
import { createInspectionFiles } from "./support/legacy-inspection-files.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { fixture as nutritionFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";

const operationId = "11111111-1111-4111-8111-111111111111";
const fixture = (run: (f: Parameters<Parameters<typeof nutritionFixture>[0]>[0] & { inspection: ReturnType<typeof createInspectionFiles> }) => Promise<void>) => nutritionFixture(async (f) => {
  await run({ ...f, inspection: createInspectionFiles(f.sourcePath, join(f.dir, "private-copies")) });
}, (db) => seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }));
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all().map((row) => row.name as string);
const records = (path: string) => inspect(path, (db) => tables(db).map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
function empty(path: string) { inspect(path, (db) => {
  for (const table of tables(db).filter((name) => !["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name))) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
}); }

test("sealed admitted source copy feeds the actual all-owner application composition with derived context and byte-identical source", () => fixture(async (f) => {
  const original = readFileSync(f.sourcePath), receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId);
  const result = await stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: async () => { assert.equal(f.inspection.handles.size, 0); return f.native.open(); }, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() });
  assert.equal(result.receipt.sha256, f.sha); assert.equal(result.admission.accountScope, f.context.accountScope); assert.equal(result.admission.sourceWorkspaceId, f.context.sourceWorkspaceId);
  assert.equal(result.admission.sourceDatabaseId, "synthetic-database"); assert.equal(result.admission.sourceDataRevision, 7);
  assert.equal(result.candidate.owners.executions.performedFacts, 6); assert.equal(result.candidate.owners.measurements.measurementRows, 12); assert.equal(result.candidate.owners.nutrition.nutritionEntryRows, 4); assert.equal(result.candidate.owners.calendar.calendarAppointmentRows, 4); assert.equal(result.finalizable, false);
  const expectedPath = join(f.dir, "expected.sqlite"), expected = nativeFactory(expectedPath);
  await stageLegacyImportCandidate({ openStaging: expected.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() });
  assert.deepEqual(records(f.stagePath), records(expectedPath)); assert.ok(f.inspection.opened.every((file) => file === f.inspection.path(operationId, "source.sqlite")));
  assert.equal(f.inspection.calls.filter((phase) => phase === "inspect-ready").length, 5); assert.deepEqual(readFileSync(f.sourcePath), original); assert.deepEqual(readFileSync(f.inspection.path(operationId, "source.sqlite")), original);
  assert.equal(f.native.handles.size, 0); assert.equal(expected.handles.size, 0); assert.equal(f.inspection.handles.size, 0);
}));

test("receipt mismatch and post-seal source-copy corruption reject before a staging file is opened", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId);
  const run = (copyReceipt = receipt) => stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt: copyReceipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() });
  await assert.rejects(run({ ...receipt, sha256: "f".repeat(64) }), /SOURCE_COPY_CHANGED/u);
  appendFileSync(f.inspection.path(operationId, "source.sqlite"), "!"); await assert.rejects(run(), /SOURCE_COPY_CHANGED/u);
  assert.equal(f.native.calls.length, 0); assert.equal(existsSync(f.stagePath), false); assert.equal(digest(f.sourcePath), f.sha);
}));

test("format admission failure rejects the sealed copy before target creation and preserves selected bytes", () => fixture(async (f) => {
  inspect(f.sourcePath, (db) => db.exec("DELETE FROM schema_migrations WHERE version=1")); const selected = readFileSync(f.sourcePath);
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId);
  await assert.rejects(stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() }), /LEGACY_SOURCE_REJECTED/u);
  assert.equal(f.native.calls.length, 0); assert.equal(existsSync(f.stagePath), false); assert.equal(f.inspection.handles.size, 0); assert.deepEqual(readFileSync(f.sourcePath), selected);
}));

test("copy change during owner staging is detected before COMMIT, rolls back every owner, and permits verified retry", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId), ready = f.inspection.path(operationId, "source.sqlite"), original = readFileSync(ready);
  const run = (checkpoint?: Parameters<typeof stageLegacyInspectionCandidate>[1]) => stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() }, checkpoint);
  await assert.rejects(run((at) => { if (at === "after-plan-receipt") appendFileSync(ready, "!"); }), /SOURCE_COPY_CHANGED/u); empty(f.stagePath);
  assert.equal(f.native.handles.size, 0); assert.equal(f.inspection.handles.size, 0); writeFileSync(ready, original);
  const result = await run(); assert.equal(result.candidate.owners.calendar.calendarAppointmentRows, 4); assert.equal(result.finalizable, false); assert.equal(digest(f.sourcePath), f.sha);
}));

test("copy verification I/O failure inside before-commit retains its safe cause and rolls back all staged rows", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId); let reads = 0;
  f.inspection.state.hook = (phase) => { if (phase === "inspect-ready" && ++reads === 3) throw new Error("PRIVATE copy path and device I/O details"); };
  await assert.rejects(stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() }), { message: "SOURCE_COPY_IO_FAILED" });
  empty(f.stagePath); assert.equal(f.native.handles.size, 0); assert.equal(f.inspection.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("late copy change after COMMIT returns no verified result, keeps only a private candidate and permits unchanged-ID replay", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId), ready = f.inspection.path(operationId, "source.sqlite"), original = readFileSync(ready);
  let commitReady = false, changed = false;
  f.native.state.after = (call) => { if (commitReady && !changed && call.kind === "exec" && call.sql === "COMMIT") { changed = true; appendFileSync(ready, "!"); } };
  await assert.rejects(stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() }, (at) => { if (at === "before-commit") commitReady = true; }), /SOURCE_COPY_CHANGED/u);
  assert.equal(changed, true); const before = records(f.stagePath); inspect(f.stagePath, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM calendar_appointments").get()!.n, 4));
  assert.equal(f.native.handles.size, 0); f.native.state.after = undefined; writeFileSync(ready, original);
  const result = await stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: () => assert.fail("committed ID allocated") });
  assert.equal(result.finalizable, false); assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha);
}));

test("sealed-copy replay needs no selected-source access and owner interruption retains content-free errors", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId), hashes = f.inspection.calls.filter((phase) => phase === "hash-source").length;
  f.inspection.files.hashSource = async () => assert.fail("external source accessed on resume"); f.inspection.files.copyToPartial = async () => assert.fail("source recopied on resume");
  const run = (allocate = allocator(), checkpoint?: Parameters<typeof stageLegacyInspectionCandidate>[1]) => stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate }, checkpoint);
  await assert.rejects(run(allocator(), (at) => { if (at === "after-calendar-receipt") throw new Error("PRIVATE source contents"); }), { message: "R04_ID_LEDGER_WRITE_FAILED" }); empty(f.stagePath);
  await run(); const before = records(f.stagePath); await run(() => assert.fail("resume allocated")); assert.deepEqual(records(f.stagePath), before);
  assert.equal(f.inspection.calls.filter((phase) => phase === "hash-source").length, hashes); assert.equal(f.inspection.handles.size, 0); assert.equal(f.native.handles.size, 0);
}));

test("inspection workflow captures receipt, file methods, clocks, target and callbacks before its first await", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId), input = { inspection: { inspectReady: f.inspection.files.inspectReady.bind(f.inspection.files), openReady: f.inspection.files.openReady.bind(f.inspection.files) }, receipt: { ...receipt }, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() };
  const pending = stageLegacyInspectionCandidate(input);
  input.receipt.sha256 = "f".repeat(64); input.targetWorkspaceId = "changed"; input.importedAt = "2027-01-01T12:00:00Z"; input.referenceDay = "2027-01-01";
  input.inspection.inspectReady = async () => assert.fail("mutated inspection used"); input.inspection.openReady = async () => assert.fail("mutated reader used");
  input.openStaging = async () => assert.fail("mutated target factory used"); input.allocate = () => assert.fail("mutated allocator used");
  const result = await pending; assert.equal(result.receipt.sha256, f.sha); assert.equal(result.candidate.owners.calendar.calendarAppointmentRows, 4);
  inspect(f.stagePath, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM clients WHERE workspace_id='changed'").get()!.n, 0); assert.equal(db.prepare("SELECT count(*) AS n FROM body_measurements WHERE created_at=?").get(importedAt)!.n, 12); });
}));

test("accidentally routing staging to the sealed inspection database rejects it before WAL without changing either source", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.inspection.files, operationId), ready = f.inspection.path(operationId, "source.sqlite"), wrong = nativeFactory(ready);
  await assert.rejects(stageLegacyInspectionCandidate({ inspection: f.inspection.files, receipt, openStaging: wrong.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate: allocator() }), /FOREIGN_DATABASE/u);
  assert.equal(digest(ready), receipt.sha256); assert.equal(digest(f.sourcePath), f.sha); assert.equal(wrong.calls.some((call) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(call.sql)), false); assert.equal(wrong.handles.size, 0);
}));

test("genuinely empty source stages and replays without inventing a source workspace or client identity", () => fixture(async (f) => {
  const source = join(f.dir, "empty.atbackup"), db = new DatabaseSync(source); seedLegacyBackupMetadata(db, "empty-scope"); db.exec("DELETE FROM clients"); db.close();
  const files = createInspectionFiles(source, join(f.dir, "empty-private")), receipt = await prepareLegacyInspectionCopy(files.files, operationId);
  const run = (allocate = allocator()) => stageLegacyInspectionCandidate({ inspection: files.files, receipt, openStaging: f.native.open, targetWorkspaceId: f.context.targetWorkspaceId, importedAt, referenceDay, allocate });
  const result = await run(); assert.equal(result.admission.sourceWorkspaceId, null); assert.equal(result.candidate.sourceRows, 0); assert.equal(result.candidate.owners.executions.performedFacts, 0); assert.equal(result.finalizable, false);
  inspect(f.stagePath, (target) => { assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()!.n, 0); assert.equal(target.prepare("SELECT source_key FROM r04_candidate_ids WHERE kind='WORKSPACE'").get()!.source_key, JSON.stringify(["empty-scope", null])); });
  const before = records(f.stagePath); await run(() => assert.fail("empty replay allocated")); assert.deepEqual(records(f.stagePath), before);
  assert.equal(files.handles.size, 0); assert.equal(f.native.handles.size, 0); assert.equal(digest(source), receipt.sha256);
}));

test("an unobserved source workspace cannot authorize client IDs, rows or a corrupt persisted client mapping", () => fixture(async (f) => {
  const staging = await prepareLegacyClientStaging(f.native.open, { ...f.context, sourceWorkspaceId: null }, importedAt);
  await assert.rejects(staging.reserveClientIds([JSON.stringify([f.context.accountScope, "a"])], allocator()), /CLIENT_SCOPE_MISMATCH/u);
  await assert.rejects(staging.stageClients(f.snapshots.clients, allocator()), /CLIENT_SCOPE_MISMATCH/u);
  assert.equal((await staging.loadClientIds()).clients.size, 0);
  inspect(f.stagePath, (db) => db.prepare("INSERT INTO r04_candidate_ids(kind,source_key,target_id) VALUES('CLIENT',?,?)").run(JSON.stringify([f.context.accountScope, "a"]), "11111111-1111-4111-8111-999999999999"));
  await assert.rejects(staging.loadClientIds(), /CORRUPT/u); assert.equal(f.native.handles.size, 0);
}));
