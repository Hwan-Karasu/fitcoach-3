import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyCalendarSnapshot } from "./r04/LegacyCalendarSnapshot.ts";
import { calendarTargetTables } from "./r04/LegacyCalendarStage.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyMeasurementsSnapshotInSnapshot } from "./r04/LegacyMeasurementSourceReader.ts";
import { readLegacyNutritionInSnapshot } from "./r04/LegacyNutritionSourceReader.ts";
import { nutritionNativeTables } from "./r04/LegacyNutritionStage.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "./r04/LegacyPlansSourceReader.ts";
import { EXECUTION_SOURCE_TABLES, type LegacyExecutionSource } from "./r04/LegacyExecutionSourceReader.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { DevCalendarRepository } from "../apps/mobile/src/features/calendar/data/DevCalendarRepository.ts";
import { DevAccountingRepository, devAccountingCalendarHook } from "../apps/mobile/src/features/accounting/data/DevAccountingRepository.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { createSqliteBackup, prepareBackupForRestore } from "./r06/SqliteBackup.ts";
import { readLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";

const context = { sourceSha256: "c".repeat(64), accountScope: "calendar-synthetic", sourceWorkspaceId: "source", targetWorkspaceId: "local-trainer" };
const imported = "2026-10-24T12:00:00.000Z", time = "2026-02-01T10:00:00.000Z", day = "2026-03-01";
const options = { clientIdentityRehearsal: { createdAt: imported, profiles: true as const, questionnaires: true as const, workData: true as const,
  exercises: true as const, plans: true as const, templates: true as const, archives: true as const, executions: true as const,
  measurements: { referenceDay: "2026-10-24" }, nutrition: true as const, calendar: true as const } };
const plans: LegacyPlansSource = { accountScope: context.accountScope, tables: Object.fromEntries(PLAN_SOURCE_TABLES.map((t, i) => [t, i < 5 ? [] : null])) as LegacyPlansSource["tables"] };
const executions: LegacyExecutionSource = { accountScope: context.accountScope, tables: Object.fromEntries(EXECUTION_SOURCE_TABLES.map((t) => [t, t === "training_exercise_history" ? [] : null])) as LegacyExecutionSource["tables"] };
const planner = () => ({ workingDays: [1, 3, 0], startHour: 7, endHour: 22, dutySlots: { [day]: { "09:00": true, "10:00": false } }, blockedSlots: { [day]: { "14:00": true, "15:00": true } } });
function allocator() { let n = 0; return () => `55555555-5555-4555-8555-${String(++n).padStart(12, "0")}`; }
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT,weight TEXT);
    CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT);
    CREATE TABLE calendar_appointments(id TEXT PRIMARY KEY,date_key TEXT,start_time TEXT,end_time TEXT,duration_minutes INTEGER,client_id TEXT,guest_name TEXT,client_name TEXT,appointment_type TEXT,note TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);`);
  for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','',?,'80')").run(id, context.sourceWorkspaceId, `Атлет ${id}`, time, time, '{"trainerNotes":"Рабочая заметка"}');
  db.prepare("INSERT INTO client_day_facts VALUES('a',?,'80.1','100','Да')").run(day);
  for (const [id, start, end, client, guest, type, removed] of [
    ["active-a", "09:00", "10:00", "a", "", "training", null], ["guest", "11:00", "12:00", null, "Атлет a", "guest_visit", null],
    ["removed", "09:00", "10:00", "a", "", "training", time], ["active-b", "13:00", "14:00", "b", "", "initial_instruction", null],
  ] as const) db.prepare("INSERT INTO calendar_appointments VALUES(?,?,?,?,60,?,?,?,?,?,?,?,?)").run(id, day, start, end, client, guest, client ? `Имя ${client} в старом календаре` : "", type, " Заметка\nбез обрезания ", time, time, removed);
  db.prepare("INSERT INTO app_settings VALUES('calendar_planner_settings',?,?)").run(JSON.stringify(planner()), time);
  db.prepare("INSERT INTO app_settings VALUES('other-owner',?,?)").run("not-calendar-owned", time);
}
function input(db: DatabaseSync) { return { cards: readLegacyClientCardsInSnapshot(db, context.accountScope, readLegacyClientIdentityInSnapshot(db, context.accountScope)),
  measurements: readLegacyMeasurementsSnapshotInSnapshot(db, context.accountScope), nutrition: readLegacyNutritionInSnapshot(db, context.accountScope), calendar: readLegacyCalendarSnapshot(db, context.accountScope) }; }
type Checkpoint = Parameters<ReturnType<typeof prepareCandidateIdentityLedger>["stageClientCalendar"]>[10];
function stage(source: DatabaseSync, target: DatabaseSync, checkpoint?: Checkpoint) {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  const result = ledger.stageClientCalendar(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, data.calendar, allocator(), checkpoint);
  return { data, ledger, result };
}
async function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void | Promise<void>) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); await run(source, target); } finally { source.close(); target.close(); }
}
function cleanup(dir: string) { const path = resolve(dir); assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith("athlete-r04-calendar-")); rmSync(path, { recursive: true, force: true }); }
const receipt = (db: DatabaseSync) => db.prepare("SELECT * FROM r04_calendar_receipt").get()!;

test("asynchronous mobile source snapshots feed shared staging, rollback together, and replay with stable IDs", () => fixture(async (source, target) => {
  const expected = input(source), inspection = new DatabaseSync(":memory:"); seed(inspection);
  const actual = await readLegacyDomainSnapshots(async () => ({
    getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => inspection.prepare(sql).all(...bindings as SQLInputValue[]) as Row[],
    execAsync: async (sql: string) => { inspection.exec(sql); }, closeAsync: async () => { inspection.close(); },
  }), context.accountScope);
  assert.deepEqual(actual, { nutrition: expected.nutrition, measurements: expected.measurements, calendar: expected.calendar });
  const ledger = prepareCandidateIdentityLedger(target, context, options);
  const run = (allocate = allocator(), checkpoint?: Checkpoint) => ledger.stageClientCalendar(expected.cards, null, [], [], plans, executions,
    actual.measurements, actual.nutrition, actual.calendar, allocate, checkpoint);
  assert.throws(() => run(allocator(), (point) => { if (point === "after-calendar-receipt") throw new Error("INTERRUPTED_AFTER_MOBILE_SOURCE"); }), /WRITE_FAILED/u);
  for (const table of ["clients", "body_measurements", "r04_work_notes", "r04_nutrition_receipt", "r04_calendar_receipt", ...calendarTargetTables]) {
    assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  }
  const result = run(), appointments = ledger.loadCalendarDraftAppointments(), calendarReceipt = { ...receipt(target) };
  assert.equal(result.calendarAppointmentRows, 4); assert.equal(result.finalizable, false);
  run(() => assert.fail("replay must reuse all target IDs"));
  assert.deepEqual(ledger.loadCalendarDraftAppointments(), appointments); assert.deepEqual({ ...receipt(target) }, calendarReceipt);
  assert.equal(target.prepare("SELECT count(*) AS n FROM credit_ledger").get()!.n, 0);
}));

test("calendar maps schedules/guests/soft-delete visibility and planner flags without completed outcomes, workouts or credits", () => fixture((source, target) => {
  const { result, ledger } = stage(source, target);
  assert.deepEqual([result.calendarAppointmentRows, result.calendarTypeRows, result.calendarIntervalRows, result.calendarReviewRepresentations], [4, 4, 3, 0]);
  assert.equal(result.creditSettlementsCreated, 0); assert.equal(result.paymentFactsCreated, 0); assert.equal(result.finalizable, false);
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_facts").get()?.n, 0);
  for (const table of ["credit_ledger", "session_packs", "payment_records", "credit_reservations"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
  const rows = ledger.loadCalendarDraftAppointments(); assert.equal(rows.length, 4); assert.ok(rows.every((r) => r.outcome === null && r.outcome_at === null && r.credit_bypass === 1));
  assert.ok(rows.filter((r) => r.lifecycle === "SCHEDULED").every((r) => r.cancelled_at === null));
  assert.equal(rows.filter((r) => r.lifecycle === "CANCELLED").length, 1);
  const guest = rows.find((r) => r.guest_name === "Атлет a")!; assert.equal(guest.client_id, null);
  assert.equal(rows[0]!.note, " Заметка\nбез обрезания ");
  const settings = target.prepare("SELECT * FROM calendar_settings").get()!;
  assert.deepEqual([settings.day_start_minute, settings.day_end_minute, settings.visible_weekdays], [420, 1380, "1010001"]);
  assert.equal(target.prepare("SELECT count(*) AS n FROM calendar_intervals WHERE end_minute-start_minute=60").get()?.n, 3);
  assert.doesNotMatch(receipt(target).source_json as string, /not-calendar-owned/u);
}));

test("unsupported values remain explicit raw review without rounding, default type, guessed outcome or midnight splitting", async () => {
  for (const sql of ["UPDATE calendar_appointments SET start_time='09:15',end_time='10:15' WHERE id='active-a'",
    "UPDATE calendar_appointments SET start_time='23:30',end_time='00:30' WHERE id='active-a'",
    "UPDATE calendar_appointments SET duration_minutes=0 WHERE id='active-a'", "UPDATE calendar_appointments SET end_time='11:00' WHERE id='active-a'",
    "UPDATE calendar_appointments SET appointment_type='unknown' WHERE id='active-a'", "UPDATE calendar_appointments SET date_key='2026-02-30' WHERE id='active-a'",
    "UPDATE calendar_appointments SET guest_name='Ambiguous' WHERE id='active-a'", "UPDATE calendar_appointments SET client_id='orphan' WHERE id='active-a'",
    "UPDATE calendar_appointments SET deleted_at='' WHERE id='active-a'",
  ]) await fixture((source, target) => { source.exec(sql); const { result } = stage(source, target); assert.equal(result.calendarAppointmentRows, 3); assert.equal(result.calendarReviewRepresentations, 1); assert.equal(result.creditSettlementsCreated, 0); });
});

test("a source status extension or real financial capability is never treated as an empty ledger", async () => {
  await fixture((source, target) => { source.exec("ALTER TABLE calendar_appointments ADD COLUMN outcome TEXT; UPDATE calendar_appointments SET outcome='completed' WHERE id='active-a'");
    const { result } = stage(source, target); assert.equal(result.calendarReviewRepresentations, 1); assert.equal(result.calendarAppointmentRows, 3); });
  await fixture((source, target) => { source.exec("CREATE TABLE credit_ledger(id TEXT)"); assert.throws(() => stage(source, target), /FINANCIAL_SOURCE_UNSUPPORTED/u);
    for (const table of ["clients", "body_measurements", "nutrition_daily_steps", "calendar_appointments", "r04_calendar_ids"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0); });
});

test("legacy overlapping schedules remain distinct and an appointment ending at midnight keeps its local date", () => fixture((source, target) => {
  source.exec("UPDATE calendar_appointments SET duration_minutes=90,end_time='10:30' WHERE id='active-a'; UPDATE calendar_appointments SET start_time='10:00',end_time='11:00' WHERE id='guest'; UPDATE calendar_appointments SET start_time='23:00',end_time='00:00' WHERE id='active-b'");
  const { result, ledger } = stage(source, target); assert.equal(result.calendarAppointmentRows, 4); assert.equal(result.calendarReviewRepresentations, 0);
  const rows = ledger.loadCalendarDraftAppointments(), late = rows.find((row) => row.start_minute === 1380)!; assert.equal(late.local_date, day); assert.equal(late.duration_minutes, 60);
  const manifest = JSON.parse(receipt(target).target_json as string); assert.equal(manifest.representations.filter((row: { metadata: { overlappingActiveIds?: string[] } }) => row.metadata.overlappingActiveIds?.length === 1).length, 2);
}));

test("source text and representable durations beyond current editor limits survive intact with explicit review", () => fixture((source, target) => {
  const note = "Длинная заметка ".repeat(100), guest = "Г".repeat(130);
  source.prepare("UPDATE calendar_appointments SET note=?,duration_minutes=180,end_time='12:00' WHERE id='active-a'").run(note);
  source.prepare("UPDATE calendar_appointments SET guest_name=? WHERE id='guest'").run(guest);
  const { result } = stage(source, target); assert.equal(result.calendarAppointmentRows, 4); assert.equal(result.calendarReviewRepresentations, 2);
  assert.equal(target.prepare("SELECT note FROM calendar_appointments WHERE duration_minutes=180").get()?.note, note);
  assert.equal(target.prepare("SELECT guest_name FROM calendar_appointments WHERE guest_name IS NOT NULL").get()?.guest_name, guest);
  assert.match(receipt(target).target_json as string, /NOTE_EXCEEDS_CURRENT_EDITOR_LIMIT/u);
}));

test("optional calendar stores remain absent and wrong shapes or older nutrition-only jobs cannot be claimed", () => fixture((source, target) => {
  source.exec("DROP TABLE calendar_appointments; DELETE FROM app_settings WHERE key='calendar_planner_settings'");
  const snapshot = readLegacyCalendarSnapshot(source, context.accountScope); assert.equal(snapshot.appointments, null); assert.deepEqual(snapshot.plannerRows, []);
  const { result } = stage(source, target); assert.equal(result.calendarAppointmentRows, 0); assert.equal(result.calendarIntervalRows, 0);
  assert.throws(() => prepareCandidateIdentityLedger(target, context, { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, calendar: undefined } }), /FOREIGN_DATABASE/u);
  source.exec("CREATE TABLE calendar_appointments(id TEXT)"); assert.throws(() => readLegacyCalendarSnapshot(source, context.accountScope), /SHAPE_UNSUPPORTED/u);
  source.exec("DROP TABLE calendar_appointments; CREATE VIEW calendar_appointments AS SELECT 'wrong-kind' AS id");
  assert.throws(() => readLegacyCalendarSnapshot(source, context.accountScope), /SHAPE_UNSUPPORTED/u);
}));

test("planner fractions, malformed JSON and wrong flag types stay review while independent calendar data survives", async () => {
  for (const value of ["{bad", JSON.stringify({ ...planner(), startHour: "7" }), JSON.stringify({ ...planner(), workingDays: [] }),
    JSON.stringify({ ...planner(), dutySlots: { [day]: { "09:30": true, "10:00": 1 } } }),
    JSON.stringify(planner()).replace('"startHour":7', '"startHour":7.0000000000000001')]) await fixture((source, target) => {
    source.prepare("UPDATE app_settings SET value=? WHERE key='calendar_planner_settings'").run(value);
    const { result } = stage(source, target); assert.equal(result.calendarAppointmentRows, 4); assert.ok(result.calendarReviewRepresentations > 0);
    assert.equal(target.prepare("SELECT count(*) AS n FROM credit_ledger").get()?.n, 0); assert.equal(target.prepare("SELECT count(*) AS n FROM body_measurements").get()?.n, 1);
  });
});

test("every calendar write boundary and before-commit rolls back all previous owners and supports a clean retry", async () => {
  const phases = ["after-calendar-ids", ...calendarTargetTables.map(() => "after-calendar-rows"), "after-calendar-receipt", "before-commit"];
  for (const [index, phase] of phases.entries()) await fixture((source, target) => {
    const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options), occurrence = phases.slice(0, index + 1).filter((p) => p === phase).length; let seen = 0;
    assert.throws(() => ledger.stageClientCalendar(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, data.calendar, allocator(), (point) => { if (point === phase && ++seen === occurrence) throw new Error("injected"); }), /WRITE_FAILED/u);
    for (const table of ["clients", "body_measurements", "r04_work_notes", "r04_nutrition_receipt", "r04_calendar_ids", "r04_calendar_receipt", ...calendarTargetTables]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    assert.equal(ledger.stageClientCalendar(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, data.calendar, allocator()).calendarAppointmentRows, 4);
  });
});

test("calendar snapshots are frozen before earlier callbacks and committed source/target/provenance drift is rejected", () => fixture((source, target) => {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientCalendar(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, data.calendar, allocator(), (point) => {
    if (point === "after-ids") Object.assign(data.calendar.appointments![0]!, { note: "injected" });
  });
  assert.doesNotMatch(receipt(target).source_json as string, /injected/u); assert.equal(ledger.loadCalendarDraftAppointments().length, 4);
  source.exec("UPDATE calendar_appointments SET note='source drift' WHERE id='active-a'"); const changed = input(source);
  assert.throws(() => ledger.stageClientCalendar(changed.cards, null, [], [], plans, executions, changed.measurements, changed.nutrition, changed.calendar, allocator()), /PARITY_MISMATCH/u);
  const row = target.prepare("SELECT * FROM calendar_appointments LIMIT 1").get()!;
  target.prepare("UPDATE calendar_appointments SET note='target drift' WHERE id=?").run(row.id!); assert.throws(() => ledger.loadCalendarDraftAppointments(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE calendar_appointments SET note=? WHERE id=?").run(row.note!, row.id!);
  target.exec("UPDATE r04_calendar_receipt SET target_json=json_set(target_json,'$.accountingBasis','changed')"); assert.throws(() => ledger.loadCalendarDraftAppointments(), /PARITY_MISMATCH/u);
}));

test("calendar source duplicate identities, allocator collisions and incomplete entry points cannot commit partial jobs", async () => {
  await fixture((source, target) => { const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    (data.calendar.appointments as unknown[]).push(data.calendar.appointments![0]);
    assert.throws(() => ledger.stageClientCalendar(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, data.calendar, allocator()), /DUPLICATE_SOURCE_KEY/u);
    assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
    assert.throws(() => ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator()), /CALENDAR_MODE_MISMATCH/u);
  });
  await fixture((source, target) => { const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options), next = allocator(); let injected = false;
    assert.throws(() => ledger.stageClientCalendar(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, data.calendar, () => {
      if (!injected && target.prepare("SELECT count(*) AS n FROM r04_nutrition_receipt").get()?.n === 1) { injected = true; return target.prepare("SELECT id FROM clients LIMIT 1").get()!.id as string; } return next();
    }), /IDENTITY_COLLISION/u); assert.equal(injected, true); assert.equal(target.prepare("SELECT count(*) AS n FROM clients").get()?.n, 0);
  });
});

test("read-only source/reopened target retain calendar bytes, IDs and parity with rows/properties reordered", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-calendar-reopen-")), inputPath = join(dir, "source.db"), outputPath = join(dir, "stage.db");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(inputPath); seed(source); source.close(); source = null; const sourceBytes = readFileSync(inputPath);
    source = new DatabaseSync(inputPath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const data = input(source);
    target = new DatabaseSync(outputPath); const binding = { ...context, sourceSha256: createHash("sha256").update(sourceBytes).digest("hex") };
    const ledger = prepareCandidateIdentityLedger(target, binding, options); ledger.stageClientCalendar(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, data.calendar, allocator());
    const rows = ledger.loadCalendarDraftAppointments(); target.close(); target = null; const before = readFileSync(outputPath); target = new DatabaseSync(outputPath);
    const calendar = { ...data.calendar, appointments: [...data.calendar.appointments!].reverse().map((row) => Object.fromEntries(Object.entries(row).reverse())) };
    const reopened = prepareCandidateIdentityLedger(target, binding, options); reopened.stageClientCalendar([...data.cards].reverse(), null, [], [], plans, executions, data.measurements, data.nutrition, calendar, () => { throw new Error("reuse IDs"); });
    assert.deepEqual(reopened.loadCalendarDraftAppointments(), rows); target.close(); target = null; assert.deepEqual(readFileSync(outputPath), before);
    source.exec("ROLLBACK"); source.close(); source = null; assert.deepEqual(readFileSync(inputPath), sourceBytes);
  } finally { target?.close(); source?.close(); cleanup(dir); }
});

test("normal 3.x backup/restore and repositories keep mapped calendar IDs/settings/outcomes without charging old appointments", () => fixture(async (source, staging) => {
  const { ledger } = stage(source, staging), expected = ledger.loadCalendarDraftAppointments(), dir = mkdtempSync(join(tmpdir(), "athlete-r04-calendar-backup-"));
  const live = join(dir, "live.db"), restored = join(dir, "restored.db"), copy = join(dir, "copy.atbackup");
  try {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(live)))); const db = new DatabaseSync(live);
    try {
      db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      for (const table of ["clients", "body_measurements", ...nutritionNativeTables, ...calendarTargetTables]) for (const row of staging.prepare(`SELECT * FROM ${table}`).all()) {
        const fields = Object.keys(row); db.prepare(`INSERT INTO ${table}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`).run(...Object.values(row));
      }
      db.exec("COMMIT"); const before = readFileSync(live);
      await createSqliteBackup(db, join(dir, "private.partial"), copy, { backupId: "44444444-4444-4444-8444-444444444444", createdAt: imported }); assert.deepEqual(readFileSync(live), before);
    } finally { db.close(); }
    const bytes = readFileSync(copy); await prepareBackupForRestore(copy, restored); assert.deepEqual(readFileSync(copy), bytes);
    const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(restored))), calendar = new DevCalendarRepository(shared, context.targetWorkspaceId, devAccountingCalendarHook), accounting = new DevAccountingRepository(shared, context.targetWorkspaceId);
    await calendar.initialize(); await accounting.initialize();
    try {
      const range = await calendar.listRange(day, day); assert.equal(range.appointments.length, 3); assert.equal(range.intervals.length, 3);
      const types = await calendar.listSessionTypes(); assert.equal(types.length, 4); assert.equal(new Set(types.map((type) => type.name)).size, 4);
      assert.equal(types.find((type) => type.name === "Персональная тренировка")!.requiresCredit, true);
      assert.deepEqual(range.appointments.map((row) => row.id).sort(), expected.filter((row) => row.lifecycle !== "CANCELLED").map((row) => row.id as string).sort());
      assert.ok(range.appointments.every((row) => row.outcome === null && row.lifecycle === "SCHEDULED")); assert.equal((await calendar.getSettings()).dayEndMinute, 1380);
      const client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!, state = await accounting.getClientSnapshot(client);
      assert.equal(state.mode, "UNTRACKED"); assert.deepEqual(state.ledger, []); assert.deepEqual(state.payments, []); assert.deepEqual(state.packs, []);
      await accounting.reconcileDue(new Date(imported)); assert.deepEqual((await accounting.getClientSnapshot(client)).ledger, []);
      await accounting.setClientMode(client, "FITCOACH");
      await accounting.createPack(client, { title: "Новый пакет после переноса", creditScope: "GENERAL", sessionTypeId: null, sessionTypeName: null, grantedCount: 5, totalKopeks: 5000, expiresOn: null });
      const issued = await accounting.getClientSnapshot(client); assert.equal(issued.available, 5);
      await accounting.reconcileDue(new Date(imported)); const reconciled = await accounting.getClientSnapshot(client);
      assert.equal(reconciled.available, 5); assert.deepEqual(reconciled.ledger, issued.ledger); assert.equal(reconciled.reserved, 0);
      const oldAppointment = range.appointments.find((row) => row.clientId === client)!;
      assert.equal(oldAppointment.sessionTypeName, "Тренировка"); assert.equal(oldAppointment.creditBypass, true);
      await calendar.resolveOutcome(oldAppointment.id, oldAppointment.revision, "COMPLETED", new Date(imported));
      assert.deepEqual((await accounting.getClientSnapshot(client)).ledger, issued.ledger);
      assert.equal((await calendar.getAppointment(oldAppointment.id))!.id, oldAppointment.id);
      const check = new DatabaseSync(restored, { readOnly: true }); try { assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name GLOB 'r04_*'").get()?.n, 0); } finally { check.close(); }
    } finally { await accounting.close(); await calendar.close(); }
  } finally { cleanup(dir); }
}));
