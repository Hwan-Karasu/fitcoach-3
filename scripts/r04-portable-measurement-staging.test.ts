import { seedMeasurementSource } from "./support/legacy-measurement-source.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyMeasurementStagingExtension } from "../apps/mobile/src/features/measurements/data/legacy-import/LegacyMeasurementStaging.ts";
import { legacyLoadMeasurementsPlan } from "../apps/mobile/src/features/measurements/data/legacy-import/LegacyMeasurementStagePlan.ts";
import { combineLegacyStageExtensions } from "../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import { runLegacyWritePlan, type LegacyMeasurementCheckpoint } from "../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { openIsolatedSqliteConnection } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import type { LegacyImportSourceSnapshots } from "../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { scope, importedAt, allocator, digest, extension as training, inspect, records as trainingRecords, empty as trainingEmpty, fixture as trainingFixture } from "./support/legacy-training-staging.ts";

const referenceDay = "2026-10-24";
const measurementTables = ["body_measurements", "measurement_daily_primary", "r04_measurement_ids", "r04_measurement_receipt"];
const phases: readonly LegacyMeasurementCheckpoint[] = ["after-measurement-ids", "after-measurement-rows", "after-measurement-receipt"];
const extension = (s: LegacyImportSourceSnapshots, cutoff = referenceDay) => combineLegacyStageExtensions(training(s), legacyMeasurementStagingExtension(s.measurements, cutoff));
const records = (path: string) => [...trainingRecords(path), ...inspect(path, (db) => measurementTables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]))];
function empty(path: string) { trainingEmpty(path); inspect(path, (db) => { for (const table of measurementTables) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table); }); }
const fixture = (run: Parameters<typeof trainingFixture>[0]) => trainingFixture(run, seedMeasurementSource);

test("admitted measurements and daily weights reach async staging with host-identical rows, IDs, receipts and retained review", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator());
  assert.deepEqual([result.extensionResult![1].measurementRows, result.extensionResult![1].measurementReviewValues, result.extensionResult![1].weightMeasurementRows, result.extensionResult![1].undatedProfileWeightSnapshots], [12, 6, 2, 1]);
  const hostPath = join(f.dir, "host.sqlite"); inspect(f.sourcePath, (source) => inspect(hostPath, (target) => {
    const catalog = readLegacyExerciseCatalogInSnapshot(source, scope), refs = readLegacyExerciseReferencesInSnapshot(source, scope, catalog);
    const ledger = prepareCandidateIdentityLedger(target, f.context, { clientIdentityRehearsal: { createdAt: importedAt, profiles: true, questionnaires: true, workData: true, exercises: true, plans: true, templates: true, archives: true, executions: true, measurements: { referenceDay } } });
    ledger.stageClientMeasurements(projectLegacyClientCards(f.snapshots.clients, projectLegacyClientIdentities(f.snapshots.clients)), projectLegacyQuestionnaire(f.snapshots.questionnaire!), catalog, refs, f.snapshots.plans, f.snapshots.executions, f.snapshots.measurements, allocator());
  }));
  assert.deepEqual(records(f.stagePath), records(hostPath));
  const db = await openIsolatedSqliteConnection(f.native.open);
  try {
    const rows = await runLegacyWritePlan(db, legacyLoadMeasurementsPlan()); assert.equal(rows.length, 12);
    assert.ok(rows.every((row) => row.local_minute === null && row.created_at === importedAt && row.method === "MANUAL"));
    assert.deepEqual(rows.filter((row) => row.type === "WEIGHT").map((row) => row.value_x10), [801, 801]);
    assert.equal(rows.filter((row) => row.type === "ARM").length, 1); assert.equal(rows.some((row) => row.type === "ARM_L" || row.type === "ARM_R"), false);
    assert.equal((await db.all("SELECT * FROM measurement_daily_primary")).length, 0);
  } finally { await db.close(); }
  inspect(f.stagePath, (db) => {
    const row = db.prepare("SELECT * FROM r04_measurement_receipt").get()!, receipt = JSON.parse(row.target_json as string) as { weightReconciliation: { sameValueSignalClients: number }; profileSnapshots: { targetId: null; datePrecision: string }[] };
    assert.equal(receipt.weightReconciliation.sameValueSignalClients, 1); assert.deepEqual(receipt.profileSnapshots.map((p) => [p.targetId, p.datePrecision]), [[null, "UNKNOWN"]]);
    assert.equal(row.target_sha256, createHash("sha256").update(row.target_json as string).digest("hex"));
    for (const issue of ["PRECISION_NOT_REPRESENTABLE", "NONPOSITIVE_VALUE", "INVALID_DATE", "FUTURE_DATE"]) assert.ok((row.target_json as string).includes(issue));
    assert.ok((row.source_json as string).includes("35,5000")); assert.ok((row.source_json as string).includes("Retained daily source")); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });
  assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha); assert.equal(result.finalizable, false);
}));

test("every async measurement boundary rolls back all owners then retries and reordered replay preserve identities", async () => {
  for (const phase of [...phases, "before-commit"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator(), async (at) => { if (at === phase) { await Promise.resolve(); throw new Error("PRIVATE interrupted measurement"); } }), /WRITE_FAILED/u); empty(f.stagePath);
    await stage.stageClients(f.snapshots.clients, allocator()); const before = records(f.stagePath), reordered = structuredClone(f.snapshots);
    for (const rows of [reordered.measurements.rows, reordered.measurements.clientDays]) (rows as unknown[]).reverse();
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(reordered)); await reopened.stageClients(reordered.clients, () => assert.fail("replay allocated")); assert.deepEqual(records(f.stagePath), before);
    assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("measurement commit acknowledgement loss and post-commit close failure permit replay without duplicate observations", async () => {
  for (const kind of ["commit", "close"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let failed = false;
    f.native.state.after = (call) => { if (!failed && (kind === "commit" ? call.kind === "exec" && call.sql === "COMMIT" : call.kind === "close")) { failed = true; throw new Error("PRIVATE acknowledgement lost"); } };
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); const before = records(f.stagePath); f.native.state.after = undefined;
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await reopened.stageClients(f.snapshots.clients, () => assert.fail("committed ID allocated")); assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
  });
});

test("measurement raw rows and profile weights are captured before earlier-owner callbacks and awaits", () => fixture(async (f) => {
  const input = structuredClone(f.snapshots), owner = extension(input); Object.assign(input.measurements.rows![0]!, { neck: "99" });
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owner);
  await stage.stageClients(f.snapshots.clients, allocator(), (at) => { if (at === "after-ids") { Object.assign(input.measurements.clientDays![0]!, { weight: "99" }); Object.assign(f.snapshots.clients.rows[0]!, { weight: "99" }); } });
  inspect(f.stagePath, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM body_measurements WHERE value_x10=990").get()!.n, 0); assert.ok((db.prepare("SELECT source_json FROM r04_measurement_receipt").get()!.source_json as string).includes('"value":"80.1"')); });
}));

test("measurement foreign owners, duplicate source atoms, changed scope and cross-owner UUID collisions roll back preceding owners", async () => {
  for (const kind of ["owner", "duplicate", "scope", "collision"] as const) await fixture(async (f) => {
    const input = structuredClone(f.snapshots);
    if (kind === "owner") Object.assign(input.measurements.rows![0]!, { client_id: "absent" });
    if (kind === "duplicate") (input.measurements.rows as unknown[]).push(input.measurements.rows![0]);
    if (kind === "scope") Object.assign(input.measurements, { accountScope: "foreign" });
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(input)); let measurement = false, collided = false; const next = allocator();
    await assert.rejects(stage.stageClients(input.clients, () => { if (measurement && !collided) { collided = true; return "11111111-1111-4111-8111-000000000001"; } return next(); },
      (at) => { if (kind === "collision" && at === "after-execution-receipt") measurement = true; }), /R04_ID_LEDGER_(?:MEASUREMENTS_|WRITE_FAILED)/u); empty(f.stagePath);
  });
});

test("measurement guarded reads and replay reject fact, primary, identity and receipt drift without overwriting rows", async () => {
  for (const sql of ["UPDATE body_measurements SET value_x10=value_x10+1", "INSERT INTO measurement_daily_primary SELECT workspace_id,client_id,type,local_date,id FROM body_measurements LIMIT 1",
    "UPDATE r04_measurement_ids SET source_key=source_key||' '", "UPDATE r04_measurement_receipt SET source_json='{}'", "UPDATE r04_measurement_receipt SET target_json='{}'", "UPDATE r04_measurement_receipt SET target_sha256=printf('%064d',0)"]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator()); inspect(f.stagePath, (db) => db.exec(sql)); const before = records(f.stagePath);
    const db = await openIsolatedSqliteConnection(f.native.open); try { await assert.rejects(runLegacyWritePlan(db, legacyLoadMeasurementsPlan()), /MEASUREMENTS_PARITY_MISMATCH/u); } finally { await db.close(); }
    await assert.rejects(stage.stageClients(f.snapshots.clients, () => assert.fail("drift allocated")), /MEASUREMENTS_(?:PARITY_MISMATCH|IDENTITY_INVALID)/u); assert.deepEqual(records(f.stagePath), before);
  });
});

test("fixed measurement reference day and preceding execution mode cannot be bypassed on reopen", () => fixture(async (f) => {
  assert.throws(() => combineLegacyStageExtensions(legacyMeasurementStagingExtension(f.snapshots.measurements, referenceDay)), /EXTENSION_ORDER_INVALID/u);
  assert.throws(() => legacyMeasurementStagingExtension(f.snapshots.measurements, "2026-02-30"), /CONTEXT_INVALID/u);
  await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const before = digest(f.stagePath);
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots, "2026-10-25")), /CONTEXT_MISMATCH/u); assert.equal(digest(f.stagePath), before);
}));

test("measurement schema and row I/O failures leave no partial schema or owner writes and allow retry", async () => {
  for (const kind of ["schema", "write"] as const) await fixture(async (f) => {
    if (kind === "write") await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    let failed = false; f.native.state.fail = (call) => { if (!failed && call.kind === "run" && (kind === "schema" ? call.sql.startsWith("CREATE TABLE r04_measurement_ids(") : call.sql.startsWith("INSERT INTO body_measurements("))) { failed = true; return true; } return false; };
    if (kind === "schema") { await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /WRITE_FAILED/u); inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(), [])); }
    else { const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); empty(f.stagePath); }
    assert.equal(failed, true); assert.equal(f.native.handles.size, 0); f.native.state.fail = undefined;
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator());
  });
});

test("absent measurement stores remain distinct from observed empty tables on otherwise identical replay", () => trainingFixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator()); assert.equal(result.extensionResult![1].measurementRows, 0);
  const input = structuredClone(f.snapshots); Object.assign(input.measurements, { rows: [], clientDays: [] }); const before = records(f.stagePath);
  const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(input)); await assert.rejects(reopened.stageClients(input.clients, () => assert.fail("empty allocated")), /MEASUREMENTS_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), before);
}));
