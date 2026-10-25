import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacyCalendarStagingExtension } from "../apps/mobile/src/features/calendar/data/legacy-import/LegacyCalendarStaging.ts";
import { legacyLoadCalendarPlan, calendarTargetTablesFor } from "../apps/mobile/src/features/calendar/data/legacy-import/LegacyCalendarStagePlan.ts";
import { legacyAccountingStagingStatements } from "../apps/mobile/src/features/accounting/data/legacy-import/LegacyAccountingStaging.ts";
import { combineLegacyStageExtensions } from "../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import { runLegacyWritePlan } from "../apps/mobile/src/shared/migration/LegacyWritePlan.ts";
import { openIsolatedSqliteConnection } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import type { LegacyImportSourceSnapshots } from "../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { scope, importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { referenceDay, extension as nutrition, records as nutritionRecords, empty as nutritionEmpty, fixture as nutritionFixture } from "./support/legacy-nutrition-staging.ts";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { legacySourceCoverageStagingExtension } from "../apps/mobile/src/features/legacy-import/data/LegacySourceCoverageStaging.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";
import { legacySettingsStagingExtension } from "../apps/mobile/src/features/settings/data/legacy-import/LegacySettingsStaging.ts";

const calendarTables = calendarTargetTablesFor(legacyAccountingStagingStatements), extraTables = [...calendarTables, "r04_calendar_ids", "r04_calendar_receipt"];
const extension = (s: LegacyImportSourceSnapshots, schema: readonly string[] = legacyAccountingStagingStatements) => combineLegacyStageExtensions(nutrition(s), legacyCalendarStagingExtension(s.calendar, schema));
const records = (path: string) => [...nutritionRecords(path), ...inspect(path, (db) => extraTables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]))];
const applicationRecords = (path: string) => inspect(path, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name as string}`).all()]));
function empty(path: string) { nutritionEmpty(path); inspect(path, (db) => { for (const table of extraTables) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table); }); }
const fixture = (run: Parameters<typeof nutritionFixture>[0], amend: Parameters<typeof nutritionFixture>[1] = () => undefined) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true });
  db.exec("UPDATE clients SET name=(SELECT guest_name FROM calendar_appointments WHERE id='guest') WHERE id='a'"); amend(db);
});

test("admitted full owner chain reaches async calendar staging with host-identical schedules, settings and IDs without financial facts", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator());
  const actual = result.extensionResult![1]; assert.deepEqual([actual.calendarAppointmentRows, actual.calendarIntervalRows, actual.calendarTypeRows, actual.creditSettlementsCreated, actual.paymentFactsCreated], [4, 3, 4, 0, 0]);
  const hostPath = join(f.dir, "host.sqlite"); inspect(f.sourcePath, (source) => inspect(hostPath, (target) => {
    const catalog = readLegacyExerciseCatalogInSnapshot(source, scope), refs = readLegacyExerciseReferencesInSnapshot(source, scope, catalog);
    const ledger = prepareCandidateIdentityLedger(target, f.context, { clientIdentityRehearsal: { createdAt: importedAt, profiles: true, questionnaires: true, workData: true, exercises: true, plans: true, templates: true, archives: true, executions: true, measurements: { referenceDay }, nutrition: true, calendar: true } });
    ledger.stageClientCalendar(projectLegacyClientCards(f.snapshots.clients, projectLegacyClientIdentities(f.snapshots.clients)), projectLegacyQuestionnaire(f.snapshots.questionnaire!), catalog, refs, f.snapshots.plans, f.snapshots.executions, f.snapshots.measurements, f.snapshots.nutrition, f.snapshots.calendar, allocator());
  })); assert.deepEqual(records(f.stagePath), records(hostPath));
  const db = await openIsolatedSqliteConnection(f.native.open);
  try {
    const rows = await runLegacyWritePlan(db, legacyLoadCalendarPlan(legacyAccountingStagingStatements)); assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.outcome === null && r.outcome_at === null && r.credit_bypass === 1)); assert.equal(rows.filter((r) => r.lifecycle === "CANCELLED").length, 1);
    const guest = rows.find((r) => r.guest_name !== null)!; assert.equal(guest.client_id, null);
    const source = f.snapshots.calendar.appointments!.find((r) => r.id === "guest")!; assert.equal(guest.note, source.note);
    assert.equal((await db.first<{ default_mode: string }>("SELECT default_mode FROM accounting_settings"))!.default_mode, "UNTRACKED");
    for (const table of ["credit_ledger", "payment_records", "session_packs", "credit_reservations"]) assert.equal((await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!.n, 0);
    assert.equal((await db.first<{ n: number }>("SELECT count(*) AS n FROM r04_execution_facts"))!.n, 6);
    const settings = await db.first<{ day_start_minute: number; day_end_minute: number; visible_weekdays: string }>("SELECT * FROM calendar_settings"); assert.deepEqual([settings!.day_start_minute, settings!.day_end_minute, settings!.visible_weekdays], [420, 1380, "1010001"]);
  } finally { await db.close(); }
  inspect(f.stagePath, (db) => { const r = db.prepare("SELECT * FROM r04_calendar_receipt").get()!; assert.equal(r.target_sha256, createHash("sha256").update(r.target_json as string).digest("hex")); assert.equal((r.source_json as string).includes("not-calendar-owned"), false); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); });
  assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0); assert.equal(result.finalizable, false);
}));

test("every calendar/accounting table checkpoint and final boundary rolls back all owners then retry/reopen/replay retain IDs", async () => {
  const failures = [{ phase: "after-calendar-ids" as const, occurrence: 1 }, ...calendarTables.map((_, i) => ({ phase: "after-calendar-rows" as const, occurrence: i + 1 })), { phase: "after-calendar-receipt" as const, occurrence: 1 }, { phase: "before-commit" as const, occurrence: 1 }];
  for (const { phase, occurrence } of failures) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let seen = 0;
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator(), async (at) => { if (at === phase && ++seen === occurrence) { await Promise.resolve(); throw new Error("PRIVATE calendar interruption"); } }), /WRITE_FAILED/u); assert.equal(seen, occurrence); empty(f.stagePath);
    await stage.stageClients(f.snapshots.clients, allocator()); const before = records(f.stagePath), input = structuredClone(f.snapshots); (input.calendar.appointments as unknown[]).reverse();
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(input)); await reopened.stageClients(input.clients, () => assert.fail("replay allocated")); assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("calendar commit or close acknowledgement loss cannot duplicate appointments, seed types or intervals", async () => {
  for (const kind of ["commit", "close"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); let failed = false;
    f.native.state.after = (call) => { if (!failed && (kind === "commit" ? call.kind === "exec" && call.sql === "COMMIT" : call.kind === "close")) { failed = true; throw new Error("PRIVATE acknowledgement lost"); } };
    await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); const before = records(f.stagePath); f.native.state.after = undefined;
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await reopened.stageClients(f.snapshots.clients, () => assert.fail("committed ID allocated")); assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0);
  });
});

test("calendar source and accounting schema are captured before awaits and earlier-owner callbacks", () => fixture(async (f) => {
  const input = structuredClone(f.snapshots), schema = [...legacyAccountingStagingStatements], owner = extension(input, schema); schema.splice(0); Object.assign(input.calendar.appointments![0]!, { note: "Changed" }); (input.calendar.unsupportedAccountingTables as string[]).push("payment_records");
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, owner);
  await stage.stageClients(f.snapshots.clients, allocator(), (at) => { if (at === "after-nutrition-receipt") Object.assign(input.calendar.plannerRows![0]!, { value: "Changed private source" }); });
  inspect(f.stagePath, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM calendar_appointments WHERE note='Changed'").get()!.n, 0); assert.equal((db.prepare("SELECT source_json FROM r04_calendar_receipt").get()!.source_json as string).includes("Changed private source"), false); });
}));

test("calendar unsupported financial sources, duplicate identities, wrong scope and cross-owner UUID collision are atomic", async () => {
  for (const kind of ["finance", "duplicate", "scope", "collision"] as const) await fixture(async (f) => {
    const input = structuredClone(f.snapshots);
    if (kind === "finance") (input.calendar.unsupportedAccountingTables as string[]).push("payment_records");
    if (kind === "duplicate") (input.calendar.appointments as unknown[]).push(input.calendar.appointments![0]);
    if (kind === "scope") Object.assign(input.calendar, { accountScope: "foreign" });
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(input)); let active = false, collided = false; const next = allocator();
    await assert.rejects(stage.stageClients(input.clients, () => { if (active && !collided) { collided = true; return "11111111-1111-4111-8111-000000000001"; } return next(); }, (at) => { if (kind === "collision" && at === "after-nutrition-receipt") active = true; }), /R04_ID_LEDGER_CALENDAR_/u); empty(f.stagePath);
  });
});

test("calendar guarded reads and replay reject appointment, type, planner, accounting, ID and receipt drift", async () => {
  for (const sql of ["UPDATE calendar_appointments SET note='Changed'", "UPDATE session_types SET name='Changed'", "UPDATE calendar_settings SET day_start_minute=day_start_minute+30", "UPDATE calendar_intervals SET end_minute=end_minute+30",
    "UPDATE accounting_settings SET default_mode='EXTERNAL'", "UPDATE r04_calendar_ids SET source_key=source_key||' '", "UPDATE r04_calendar_receipt SET source_json='{}'", "UPDATE r04_calendar_receipt SET target_json='{}'", "UPDATE r04_calendar_receipt SET target_sha256=printf('%064d',0)"]) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator()); inspect(f.stagePath, (db) => db.exec(sql)); const before = records(f.stagePath);
    const db = await openIsolatedSqliteConnection(f.native.open); try { await assert.rejects(runLegacyWritePlan(db, legacyLoadCalendarPlan(legacyAccountingStagingStatements)), /CALENDAR_PARITY_MISMATCH/u); } finally { await db.close(); }
    await assert.rejects(stage.stageClients(f.snapshots.clients, () => assert.fail("drift allocated")), /CALENDAR_(?:PARITY_MISMATCH|IDENTITY_INVALID)/u); assert.deepEqual(records(f.stagePath), before);
  });
});

test("calendar mode requires nutrition and owner-provided schema and cannot claim earlier files before WAL", () => fixture(async (f) => {
  assert.throws(() => legacyCalendarStagingExtension(f.snapshots.calendar, []), /SCHEMA_UNAVAILABLE/u);
  assert.throws(() => combineLegacyStageExtensions(legacyCalendarStagingExtension(f.snapshots.calendar, legacyAccountingStagingStatements)), /EXTENSION_ORDER_INVALID/u);
  await prepareLegacyClientStaging(f.native.open, f.context, importedAt, nutrition(f.snapshots)); const before = digest(f.stagePath), count = f.native.calls.length;
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /FOREIGN_DATABASE/u); assert.equal(digest(f.stagePath), before); assert.equal(f.native.calls.slice(count).some((call) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(call.sql)), false);
  assert.ok(f.native.calls.slice(0, count).some((call) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(call.sql)));
}));

test("calendar schema and native row failures roll back every owner and close handles before retry", async () => {
  for (const kind of ["schema", "write"] as const) await fixture(async (f) => {
    if (kind === "write") await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots));
    let failed = false; f.native.state.fail = (call) => { if (!failed && call.kind === "run" && (kind === "schema" ? call.sql.startsWith("CREATE TABLE r04_calendar_ids(") : call.sql.startsWith("INSERT INTO calendar_appointments("))) { failed = true; return true; } return false; };
    if (kind === "schema") { await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)), /WRITE_FAILED/u); inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(), [])); }
    else { const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await assert.rejects(stage.stageClients(f.snapshots.clients, allocator()), /WRITE_FAILED/u); empty(f.stagePath); }
    assert.equal(failed, true); assert.equal(f.native.handles.size, 0); f.native.state.fail = undefined;
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); await stage.stageClients(f.snapshots.clients, allocator());
  });
});

test("unsupported exact planner numeric JSON stays raw review without rounding it into a display setting", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, extension(f.snapshots)); const result = await stage.stageClients(f.snapshots.clients, allocator()); assert.equal(result.extensionResult![1].calendarAppointmentRows, 4); assert.equal(result.extensionResult![1].calendarReviewRepresentations, 1);
  inspect(f.stagePath, (db) => { assert.equal(db.prepare("SELECT count(*) AS n FROM calendar_settings").get()!.n, 0); const r = db.prepare("SELECT * FROM r04_calendar_receipt").get()!; assert.ok((r.source_json as string).includes("7.0000000000000001")); assert.ok((r.target_json as string).includes("PLANNER_NUMBER_UNSUPPORTED")); });
}, (db) => { const row = db.prepare("SELECT value FROM app_settings WHERE key='calendar_planner_settings'").get()!; db.prepare("UPDATE app_settings SET value=? WHERE key='calendar_planner_settings'").run((row.value as string).replace('"startHour":7', '"startHour":7.0000000000000001')); }));

test("application composition stages every owner identically to the manual chain and replays without new IDs", () => fixture(async (f) => {
  const result = await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() });
  assert.equal(result.sourceRows, 2); assert.equal(result.owners.executions.performedFacts, 6); assert.equal(result.owners.measurements.measurementRows, 12);
  assert.equal(result.owners.nutrition.nutritionEntryRows, 4); assert.equal(result.owners.calendar.calendarAppointmentRows, 4); assert.equal(result.finalizable, false);
  const manualPath = join(f.dir, "manual.sqlite"), manual = nativeFactory(manualPath);
  const stage = await prepareLegacyClientStaging(manual.open, f.context, importedAt, combineLegacyStageExtensions(nutrition(f.snapshots, true), legacyCalendarStagingExtension(f.snapshots.calendar, legacyAccountingStagingStatements), legacySettingsStagingExtension(f.snapshots.settings), legacySourceCoverageStagingExtension(f.snapshots))); await stage.stageClients(f.snapshots.clients, allocator());
  assert.deepEqual(applicationRecords(f.stagePath), applicationRecords(manualPath)); const before = applicationRecords(f.stagePath);
  await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: () => assert.fail("application replay allocated") });
  assert.deepEqual(applicationRecords(f.stagePath), before); assert.equal(f.native.handles.size, 0); assert.equal(manual.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("application composition captures clients, owner sources, context, clocks and callbacks before its first await", () => fixture(async (f) => {
  const input = { openStaging: f.native.open, context: { ...f.context }, source: structuredClone(f.snapshots), importedAt, referenceDay, allocate: allocator() };
  const pending = stageLegacyImportCandidate(input);
  Object.assign(input.source.clients.rows[0]!, { name: "Changed client" }); Object.assign(input.source.calendar.appointments![0]!, { note: "Changed note" });
  Object.assign(input.source.measurements.rows![0]!, { neck: "99" }); Object.assign(input.source.nutrition.tables.food_products![0]!, { name: "Changed food" });
  Object.assign(input.context, { accountScope: "changed", sourceSha256: "0".repeat(64) });
  input.importedAt = "2027-01-01T12:00:00Z"; input.referenceDay = "2027-01-01";
  input.openStaging = async () => assert.fail("mutated connection factory used"); input.allocate = () => assert.fail("mutated allocator used");
  await pending;
  const expectedPath = join(f.dir, "expected.sqlite"), expected = nativeFactory(expectedPath);
  await stageLegacyImportCandidate({ openStaging: expected.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() });
  assert.deepEqual(applicationRecords(f.stagePath), applicationRecords(expectedPath)); assert.equal(f.native.handles.size, 0); assert.equal(expected.handles.size, 0);
}));

test("application composition rolls back early and final owner interruption and retries the complete candidate", async () => {
  for (const phase of ["after-plan-receipt", "after-calendar-receipt", "after-settings-receipt"] as const) await fixture(async (f) => {
    const run = (checkpoint?: Parameters<typeof stageLegacyImportCandidate>[1]) => stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() }, checkpoint);
    await assert.rejects(run(async (at) => { if (at === phase) { await Promise.resolve(); throw new Error("PRIVATE application interruption"); } }), /WRITE_FAILED/u); empty(f.stagePath);
    inspect(f.stagePath, (db) => { for (const table of ["settings", "r04_settings_source", "r04_settings_receipt"]) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0); });
    const result = await run(); assert.equal(result.owners.calendar.calendarAppointmentRows, 4); assert.equal(result.finalizable, false); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  });
});
