import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { legacyMeasurementFields, readLegacyMeasurementsSnapshotInSnapshot } from "./r04/LegacyMeasurementSourceReader.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "./r04/LegacyPlansSourceReader.ts";
import { EXECUTION_SOURCE_TABLES, type LegacyExecutionSource } from "./r04/LegacyExecutionSourceReader.ts";
import { dailyPoints } from "../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository } from "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { createSqliteBackup, prepareBackupForRestore, canonicalContentSha256 } from "./r06/SqliteBackup.ts";

const context = { sourceSha256: "e".repeat(64), accountScope: "measurements-synthetic", sourceWorkspaceId: "old-workspace", targetWorkspaceId: "local-trainer" };
const importedAt = "2026-10-24T10:00:00Z", referenceDay = "2026-10-24", day = "2026-03-01";
const options = { clientIdentityRehearsal: { createdAt: importedAt, profiles: true as const, questionnaires: true as const, workData: true as const,
  exercises: true as const, plans: true as const, templates: true as const, archives: true as const, executions: true as const, measurements: { referenceDay } } };
const plans: LegacyPlansSource = { accountScope: context.accountScope, tables: Object.fromEntries(PLAN_SOURCE_TABLES.map((t, i) => [t, i < 5 ? [] : null])) as LegacyPlansSource["tables"] };
const executions: LegacyExecutionSource = { accountScope: context.accountScope, tables: Object.fromEntries(EXECUTION_SOURCE_TABLES.map((t) => [t, t === "training_exercise_history" ? [] : null])) as LegacyExecutionSource["tables"] };
function allocator() { let n = 0; return () => `66666666-6666-4666-8666-${String(++n).padStart(12, "0")}`; }
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,
    birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT);
    CREATE TABLE client_measurements(id TEXT PRIMARY KEY,client_id TEXT,date_key TEXT,${legacyMeasurementFields.map((field) => `${field} TEXT`).join(",")},
      created_at TEXT,updated_at TEXT,extra_json TEXT);`);
  for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','','{}')").run(id, context.sourceWorkspaceId, `Синтетический ${id}`, importedAt, importedAt);
  add(db, "one", "a", Object.fromEntries(legacyMeasurementFields.map((field) => [field, "35,5000"])));
  add(db, "two", "a", { neck: "35.5" }); add(db, "other-owner", "b", { neck: "35.5" }); add(db, "empty", "a", {});
}
function add(db: DatabaseSync, id: string, client: string, fields: Readonly<Record<string, unknown>>, date = day) {
  db.prepare(`INSERT INTO client_measurements VALUES(${Array.from({ length: 14 }, () => "?").join(",")})`)
    .run(id, client, date, ...legacyMeasurementFields.map((field) => fields[field] as string ?? null), "2026-03-01T22:13:00Z", "2026-04-01T10:00:00Z", '{"source":"kept"}');
}
function addDay(db: DatabaseSync, client: string, date: string, weight: string | null) {
  db.exec(`CREATE TABLE IF NOT EXISTS client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT,updated_at TEXT,source_hint TEXT,
    PRIMARY KEY(client_id,date_key))`);
  db.prepare("INSERT INTO client_day_facts VALUES(?,?,?,'1234','Да','2026-10-24T09:12:00Z','untouched daily extras')").run(client, date, weight);
}
function profileWeight(db: DatabaseSync, client: string, weight: string) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('clients') WHERE name='weight'").get()) db.exec("ALTER TABLE clients ADD COLUMN weight TEXT");
  db.prepare("UPDATE clients SET weight=? WHERE id=?").run(weight, client);
}
function input(source: DatabaseSync) {
  return { cards: readLegacyClientCardsInSnapshot(source, context.accountScope, readLegacyClientIdentityInSnapshot(source, context.accountScope)),
    measurements: readLegacyMeasurementsSnapshotInSnapshot(source, context.accountScope) };
}
function stage(source: DatabaseSync, target: DatabaseSync) {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  const result = ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements, allocator());
  return { data, ledger, result };
}
async function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void | Promise<void>) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); await run(source, target); } finally { source.close(); target.close(); }
}

test("wide rows stage into actual D01 date-only observations with stable field IDs, unsided types and independent owners", () => fixture((source, target) => {
  const { result, ledger } = stage(source, target), rows = ledger.loadMeasurementDraftFacts();
  assert.deepEqual([result.measurementSourceRows, result.measurementSourceValues, result.measurementRows, result.measurementReviewValues], [4, 10, 10, 0]);
  assert.equal(result.status, "measurements-rehearsal-staged"); assert.equal(result.finalizable, false);
  assert.equal(new Set(rows.map((r) => r.id)).size, 10); assert.equal(new Set(rows.map((r) => r.client_id)).size, 2);
  assert.ok(rows.every((r) => r.local_minute === null && r.value_x10 === 355 && r.method === "MANUAL" && r.created_at === importedAt));
  assert.deepEqual([...new Set(rows.map((r) => r.type))].sort(), ["ARM", "CALF", "CHEST", "HIPS", "NECK", "SHOULDERS", "THIGH", "WAIST"]);
  assert.equal(target.prepare("SELECT count(*) AS n FROM measurement_daily_primary").get()?.n, 0);
  const receipt = target.prepare("SELECT * FROM r04_measurement_receipt").get()!;
  assert.match(receipt.source_json as string, /extra_json|created_at|35,5000/u); assert.match(receipt.target_json as string, /IMPORT_TIME/u);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("unsupported precision, bounds, zero and dates stay explicit source review without rounding, clipping or zero placeholders", () => fixture((source, target) => {
  add(source, "fine", "a", { neck: "35.55", waist: "999", calf: "0", thigh: "bad" });
  add(source, "future", "a", { neck: "35" }, "2027-01-01"); add(source, "invalid-day", "a", { neck: "35" }, "2026-02-30");
  const { result } = stage(source, target);
  assert.equal(result.measurementRows, 10); assert.equal(result.measurementReviewValues, 6);
  const receipt = target.prepare("SELECT * FROM r04_measurement_receipt").get()!;
  for (const issue of ["PRECISION_NOT_REPRESENTABLE", "VALUE_OUTSIDE_TARGET_BOUNDS", "NONPOSITIVE_VALUE", "INVALID_VALUE", "FUTURE_DATE", "INVALID_DATE"]) assert.ok((receipt.target_json as string).includes(issue));
  assert.match(receipt.source_json as string, /35\.55/u);
  const saved = JSON.parse(receipt.target_json as string) as { provenance: { targetId: string | null; issues: string[] }[] };
  assert.equal(saved.provenance.filter((r) => r.targetId === null).length, 6);
}));

test("saved daily kg values get separate dated IDs while matching and different profile snapshots remain undated provenance", () => fixture((source, target) => {
  addDay(source, "a", day, "080,1000"); addDay(source, "a", "2026-03-02", "+80.1"); addDay(source, "b", day, "75");
  addDay(source, "a", "2026-03-03", ""); profileWeight(source, "a", "80.1"); profileWeight(source, "b", "99");
  const { result, ledger } = stage(source, target), weights = ledger.loadMeasurementDraftFacts().filter((r) => r.type === "WEIGHT");
  assert.equal(result.measurementRows, 13); assert.equal(result.weightMeasurementRows, 3); assert.equal(result.dailyWeightSourceRows, 4);
  assert.equal(result.undatedProfileWeightSnapshots, 2); assert.equal(new Set(weights.map((r) => r.id)).size, 3);
  assert.deepEqual(weights.map((r) => r.value_x10).sort(), [750, 801, 801]);
  assert.ok(weights.every((r) => r.local_minute === null && r.created_at === importedAt && r.local_date !== referenceDay));
  const receipt = target.prepare("SELECT * FROM r04_measurement_receipt").get()!;
  const saved = JSON.parse(receipt.target_json as string) as { profileSnapshots: { targetId: null; datePrecision: string }[];
    weightReconciliation: { sameValueSignalClients: number; noSameValueSignalClients: number }; provenance: { unit: string; sourceSemantics: string }[] };
  assert.ok(saved.profileSnapshots.every((p) => p.targetId === null && p.datePrecision === "UNKNOWN"));
  assert.deepEqual([saved.weightReconciliation.sameValueSignalClients, saved.weightReconciliation.noSameValueSignalClients], [1, 1]);
  assert.equal(saved.provenance.filter((p) => p.unit === "kg" && p.sourceSemantics === "SAVED_DAY_VALUE_PROFILE_PREFILL_POSSIBLE").length, 3);
  assert.match(receipt.source_json as string, /080,1000|untouched daily extras|1234|Да/u);
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_facts").get()?.n, 0, "training=Да is not a performed set");
  assert.equal(target.prepare("SELECT count(*) AS n FROM measurement_daily_primary").get()?.n, 0);
}));

test("unsupported daily weights remain review; empty days and an undated profile never become dated measurements", () => fixture((source, target) => {
  for (const [index, weight] of ["0", "-0", "-80", "80.15", "401", "bad"].entries()) addDay(source, "a", `2026-03-${String(index + 1).padStart(2, "0")}`, weight);
  addDay(source, "a", "2026-02-30", "80"); addDay(source, "a", "2027-01-01", "80"); addDay(source, "a", "2026-04-01", null);
  profileWeight(source, "a", "80"); const { result, ledger } = stage(source, target);
  assert.equal(result.weightMeasurementRows, 0); assert.equal(result.measurementReviewValues, 8); assert.equal(result.undatedProfileWeightSnapshots, 1);
  assert.ok(ledger.loadMeasurementDraftFacts().every((r) => r.type !== "WEIGHT"));
  assert.match(target.prepare("SELECT source_json FROM r04_measurement_receipt").get()!.source_json as string, /80\.15/u);
}));

test("daily weights work without a circumference table, while daily table absence and an observed empty table remain distinct", () => fixture((source, target) => {
  source.exec("DROP TABLE client_measurements"); addDay(source, "a", day, "80");
  const { data, result } = stage(source, target); assert.equal(data.measurements.rows, null); assert.equal(result.weightMeasurementRows, 1);
  source.exec("DROP TABLE client_day_facts; CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT)");
  assert.throws(() => readLegacyMeasurementsSnapshotInSnapshot(source, context.accountScope), /SHAPE_UNSUPPORTED/u);
}));

test("daily owner, physical-key duplicates and omitted coverage block the entire transaction", async () => {
  for (const mode of ["owner", "duplicate", "omitted"] as const) await fixture((source, target) => {
    addDay(source, "a", day, "80"); const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    if (mode === "owner") Object.assign(data.measurements.clientDays![0]!, { client_id: "other" });
    if (mode === "duplicate") (data.measurements.clientDays as unknown[]).push(data.measurements.clientDays![0]);
    if (mode === "omitted") Reflect.deleteProperty(data.measurements, "clientDays");
    assert.throws(() => ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements, allocator()), /OWNER_INVALID|WRITE_FAILED|SOURCE_INVALID/u);
    for (const table of ["clients", "body_measurements", "r04_measurement_ids", "r04_execution_receipt", "r04_plan_receipt"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
  });
});

test("daily source input is frozen before earlier callbacks and source-only daily edits cannot overwrite committed facts", () => fixture((source, target) => {
  addDay(source, "a", day, "80"); profileWeight(source, "a", "80"); const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements, allocator(), (phase) => {
    if (phase === "after-ids") { Object.assign(data.measurements.clientDays![0]!, { weight: "90" }); Object.assign(data.cards[0]!.raw, { weight: "99" }); }
  });
  assert.equal(ledger.loadMeasurementDraftFacts().find((r) => r.type === "WEIGHT")!.value_x10, 800);
  assert.match(target.prepare("SELECT source_json FROM r04_measurement_receipt").get()!.source_json as string, /"value":"80"/u);
  source.exec("UPDATE client_day_facts SET source_hint='changed extra'"); const changed = input(source);
  assert.throws(() => ledger.stageClientMeasurements(changed.cards, null, [], [], plans, executions, changed.measurements, allocator()), /PARITY_MISMATCH/u);
}));

test("older circumference-only jobs or manifests cannot claim verified weight coverage", () => fixture((source, target) => {
  const { ledger } = stage(source, target), binding = target.prepare("SELECT * FROM r04_candidate_identity").get()!;
  target.prepare("UPDATE r04_candidate_identity SET context_json=?").run((binding.context_json as string).replace("MEASUREMENTS_REHEARSAL_V2", "MEASUREMENTS_REHEARSAL_V1"));
  assert.throws(() => ledger.loadMeasurementDraftFacts(), /CONTEXT_MISMATCH/u);
  target.prepare("UPDATE r04_candidate_identity SET context_json=?").run(binding.context_json!);
  const receipt = target.prepare("SELECT target_json FROM r04_measurement_receipt").get()!;
  const old = JSON.stringify({ ...JSON.parse(receipt.target_json as string) as Record<string, unknown>, projectionVersion: 1 });
  target.prepare("UPDATE r04_measurement_receipt SET target_json=?,target_sha256=?").run(old, createHash("sha256").update(old).digest("hex"));
  assert.throws(() => ledger.loadMeasurementDraftFacts(), /PARITY_MISMATCH/u);
}));

test("empty optional source absence differs from observed emptiness and incomplete schemas cannot pass as empty", () => fixture((source, target) => {
  source.exec("DROP TABLE client_measurements"); const { data, ledger, result } = stage(source, target);
  assert.equal(data.measurements.rows, null); assert.equal(result.measurementRows, 0);
  assert.throws(() => ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, { ...data.measurements, rows: [] }, allocator()), /PARITY_MISMATCH/u);
  source.exec("CREATE TABLE client_measurements(id TEXT)");
  assert.throws(() => readLegacyMeasurementsSnapshotInSnapshot(source, context.accountScope), /SHAPE_UNSUPPORTED/u);
}));

test("the explicitly bound reference day accepts date-only observations today and retains tomorrow for review", () => fixture((source, target) => {
  add(source, "today", "a", { neck: "35" }, referenceDay); add(source, "tomorrow", "a", { neck: "35" }, "2026-10-25");
  const { result, ledger } = stage(source, target);
  assert.equal(result.measurementRows, 11); assert.equal(result.measurementReviewValues, 1);
  assert.equal(ledger.loadMeasurementDraftFacts().filter((r) => r.local_date === referenceDay).length, 1);
}));

test("foreign owners and duplicate physical source IDs roll back all prior owner writes and client IDs", async () => {
  for (const mode of ["foreign", "duplicate", "scope"] as const) await fixture((source, target) => {
    const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    if (mode === "foreign") Object.assign(data.measurements.rows![0]!, { client_id: "absent" });
    if (mode === "duplicate") (data.measurements.rows as unknown[]).push(data.measurements.rows![0]);
    const payload = mode === "scope" ? { ...data.measurements, accountScope: "other" } : data.measurements;
    assert.throws(() => ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, payload, allocator()), /OWNER_INVALID|WRITE_FAILED|SOURCE_INVALID/u);
    assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
    assert.equal(target.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()?.n, 0);
    assert.equal(target.prepare("SELECT count(*) AS n FROM body_measurements").get()?.n, 0);
  });
});

test("measurement checkpoints roll back the complete owner transaction and retry reuses only committed identities", async () => {
  for (const phase of ["after-measurement-ids", "after-measurement-rows", "after-measurement-receipt", "before-commit"] as const) await fixture((source, target) => {
    const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements, allocator(), (p) => { if (p === phase) throw new Error("injected"); }), /WRITE_FAILED/u);
    for (const table of ["clients", "body_measurements", "measurement_daily_primary", "r04_measurement_ids", "r04_measurement_receipt", "r04_execution_receipt", "r04_plan_receipt", "r04_work_receipt", "questionnaire_answers"]) {
      assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    }
    assert.equal(ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements, allocator()).measurementRows, 10);
  });
});

test("frozen measurements cannot be changed by earlier owner callbacks and guarded reads reject altered values, owners or ID mappings", () => fixture((source, target) => {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements, allocator(), (phase) => {
    if (phase === "after-ids") Object.assign(data.measurements.rows![0]!, { neck: "88" });
  });
  assert.ok(ledger.loadMeasurementDraftFacts().every((r) => r.value_x10 === 355));
  const row = ledger.loadMeasurementDraftFacts()[0]!;
  target.prepare("UPDATE body_measurements SET value_x10=999 WHERE id=?").run(row.id!);
  assert.throws(() => ledger.loadMeasurementDraftFacts(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE body_measurements SET value_x10=355 WHERE id=?").run(row.id!);
  const other = target.prepare("SELECT id FROM clients WHERE id<>?").get(row.client_id!);
  target.prepare("UPDATE body_measurements SET client_id=? WHERE id=?").run(other!.id!, row.id!);
  assert.throws(() => ledger.loadMeasurementDraftFacts(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE body_measurements SET client_id=? WHERE id=?").run(row.client_id!, row.id!);
  const receipt = target.prepare("SELECT * FROM r04_measurement_receipt").get()!;
  target.exec("UPDATE r04_measurement_receipt SET target_json=json_set(target_json,'$.provenance[0].createdAtBasis','changed')");
  assert.throws(() => ledger.loadMeasurementDraftFacts(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE r04_measurement_receipt SET target_json=?").run(receipt.target_json!);
  const oldId = target.prepare("SELECT * FROM r04_measurement_ids LIMIT 1").get()!;
  target.prepare("UPDATE r04_measurement_ids SET target_id=? WHERE source_key=?").run("66666666-6666-4666-8666-999999999999", oldId.source_key!);
  assert.throws(() => ledger.loadMeasurementDraftFacts(), /PARITY_MISMATCH/u);
}));

test("mode and reference-day binding cannot absorb older jobs or bypass required owner staging", () => fixture((source, target) => {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  assert.throws(() => ledger.stageClientExecutions(data.cards, null, [], [], plans, executions), /MEASUREMENTS_MODE_MISMATCH/u);
  assert.throws(() => prepareCandidateIdentityLedger(target, context, { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, measurements: { referenceDay: "2026-10-25" } } }), /CONTEXT_MISMATCH/u);
  assert.throws(() => prepareCandidateIdentityLedger(target, context, { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, measurements: undefined } }), /FOREIGN_DATABASE/u);
  assert.throws(() => prepareCandidateIdentityLedger(target, context, { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, measurements: { referenceDay: "2026-02-30" } } }), /CONTEXT_INVALID/u);
}));

test("read-only source, source drift, reopened target and reordered byte-identical replay preserve all measurement IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-measurements-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex"); let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); addDay(source, "a", day, "80.1"); addDay(source, "a", "2026-03-02", "80.1"); profileWeight(source, "a", "80.1");
    source.close(); source = null; const sourceHash = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const data = input(source), exact = { ...context, sourceSha256: sourceHash };
    target = new DatabaseSync(targetPath); const ledger = prepareCandidateIdentityLedger(target, exact, options);
    ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements, allocator()); const rows = ledger.loadMeasurementDraftFacts();
    const changed = structuredClone(data.measurements); Object.assign(changed.rows![0]!, { extra_json: "changed" });
    assert.throws(() => ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, changed, allocator()), /PARITY_MISMATCH/u);
    target.close(); target = null; const targetHash = hash(targetPath); target = new DatabaseSync(targetPath);
    const reversedRows = (rows: readonly Readonly<Record<string, unknown>>[]) => [...rows].reverse().map((r) => Object.fromEntries(Object.entries(r).reverse()));
    const reordered = { ...data.measurements, rows: reversedRows(data.measurements.rows!), clientDays: reversedRows(data.measurements.clientDays!) };
    const reopened = prepareCandidateIdentityLedger(target, exact, options);
    assert.equal(reopened.stageClientMeasurements([...data.cards].reverse(), null, [], [], plans, executions, reordered, () => { throw new Error("reuse all IDs"); }).measurementRows, 12);
    assert.deepEqual(reopened.loadMeasurementDraftFacts(), rows); target.close(); target = null; assert.equal(hash(targetPath), targetHash);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), sourceHash);
  } finally { target?.close(); source?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("staged observations work in the regular repository without importer code; same-day ambiguity and explicit primary survive correction", () => fixture(async (source, target) => {
  addDay(source, "a", day, "80.1"); addDay(source, "a", "2026-03-02", "80.1"); profileWeight(source, "a", "99");
  const { ledger } = stage(source, target), runtime = new DatabaseSync(":memory:"), shared = new SharedSqliteDatabase(async () => nodeSqlitePort(runtime));
  const clients = new DevClientRepository(shared, context.targetWorkspaceId, []), measurements = new DevMeasurementRepository(shared, context.targetWorkspaceId);
  await clients.initialize(); await measurements.initialize();
  try {
    for (const table of ["clients", "body_measurements"]) for (const row of target.prepare(`SELECT * FROM ${table}`).all()) {
      const keys = Object.keys(row); runtime.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...Object.values(row));
    }
    const client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
    const journal = await measurements.listForClient(client), neck = dailyPoints(journal.measurements, journal.primaries, "NECK");
    assert.equal(journal.measurements.length, 11); assert.equal(neck[0]!.kind, "AMBIGUOUS");
    assert.deepEqual(dailyPoints(journal.measurements, journal.primaries, "WEIGHT").map((point) => point.kind === "VALUE" ? [point.localDate, point.measurement.valueX10] : null),
      [[day, 801], ["2026-03-02", 801]]);
    const first = journal.measurements.find((m) => m.type === "NECK")!;
    await measurements.setPrimary(first.id);
    const corrected = await measurements.correct(first.id, first.revision, { type: first.type, localDate: first.localDate, localMinute: null, valueX10: 360 }, new Date("2026-10-24T12:00:00"));
    assert.equal(corrected.id, first.id); assert.equal(corrected.revision, 2);
    const after = await measurements.listForClient(client), point = dailyPoints(after.measurements, after.primaries, "NECK")[0]!;
    assert.equal(point.kind, "VALUE");
    if (point.kind === "VALUE") { assert.equal(point.measurement.id, first.id); assert.equal(point.measurement.valueX10, 360); assert.equal(point.chosen, true); }
    assert.equal(after.measurements.length, journal.measurements.length);
    assert.equal(runtime.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'r04_%'").get()?.n, 0);
    assert.deepEqual(runtime.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await measurements.close(); await clients.close(); }
}));

test("mapped circumference and daily weight IDs/values survive an ordinary full 3.x backup and restore without importer tables", () => fixture(async (source, target) => {
  addDay(source, "a", day, "80.1"); addDay(source, "a", "2026-03-02", "80.1"); profileWeight(source, "a", "99");
  const { ledger } = stage(source, target), expected = ledger.loadMeasurementDraftFacts();
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-measurement-backup-")), live = join(dir, "live.db"), restored = join(dir, "restored.db"), backup = join(dir, "ordinary.atbackup");
  const initialize = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(live)));
  try {
    await prepareProductionDatabase(initialize);
    const liveDb = new DatabaseSync(live);
    try {
      liveDb.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      for (const table of ["clients", "body_measurements"]) for (const row of target.prepare(`SELECT * FROM ${table}`).all()) {
        const keys = Object.keys(row); liveDb.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...Object.values(row));
      }
      liveDb.exec("COMMIT");
      const original = readFileSync(live), content = canonicalContentSha256(liveDb);
      const manifest = await createSqliteBackup(liveDb, join(dir, "private.partial"), backup, {
        backupId: "77777777-7777-4777-8777-777777777777", createdAt: new Date(importedAt).toISOString() });
      assert.equal(manifest.contentSha256, content); assert.deepEqual(readFileSync(live), original);
    } finally { liveDb.close(); }
    const savedBackup = readFileSync(backup); await prepareBackupForRestore(backup, restored);
    assert.deepEqual(readFileSync(backup), savedBackup);
    const check = new DatabaseSync(restored, { readOnly: true });
    try {
      assert.deepEqual(check.prepare("SELECT * FROM body_measurements ORDER BY id").all(), expected);
      assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'r04_%'").get()?.n, 0);
      assert.equal(check.prepare("SELECT count(*) AS n FROM body_measurements WHERE type='WEIGHT' AND value_x10=990").get()?.n, 0, "profile snapshot never became a measurement");
    } finally { check.close(); }
    const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(restored)));
    const measurements = new DevMeasurementRepository(shared, context.targetWorkspaceId); await measurements.initialize();
    try {
      const client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
      const journal = await measurements.listForClient(client);
      assert.equal(journal.measurements.length, 11);
      assert.deepEqual(dailyPoints(journal.measurements, journal.primaries, "WEIGHT").map((p) => p.kind === "VALUE" ? p.measurement.valueX10 : null), [801, 801]);
    } finally { await measurements.close(); }
  } finally {
    const resolved = resolve(dir);
    assert.equal(dirname(resolved), resolve(tmpdir())); assert.ok(basename(resolved).startsWith("athlete-r04-measurement-backup-"));
    rmSync(resolved, { recursive: true, force: true });
  }
}));
