import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { copyFileSync, statSync } from "node:fs";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { legacySettingsStagingExtension } from "../apps/mobile/src/features/settings/data/legacy-import/LegacySettingsStaging.ts";
import { legacySettingsStagePlan } from "../apps/mobile/src/features/settings/data/legacy-import/LegacySettingsStagePlan.ts";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { legacySettingsReadPlan } from "../apps/mobile/src/features/legacy-import/data/LegacyProfileReadPlans.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import { runNodeLegacyReadPlan } from "./r04/NodeLegacySourceReadPlan.ts";
import { runNodeLegacyWritePlan } from "./r04/NodeLegacyWritePlan.ts";
import { parseAppearance } from "../apps/mobile/src/features/settings/domain/SettingsPort.ts";
import { projectLegacySettings } from "../apps/mobile/src/features/settings/domain/legacy-import/LegacySettingsProjection.ts";
import { resolvePalette } from "../apps/mobile/src/shared/ui/theme/resolver.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { createSqliteBackup, prepareBackupForRestore } from "./r06/SqliteBackup.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { fixture as nutritionFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";
import { nativeFactory } from "./support/legacy-staging-native.ts";
import { runLegacyJobWorker } from "./support/legacy-job-worker.ts";
import { updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";

const time = "2026-10-01 12:00:00";
const card = { clientCardMetricIds: ["pack", "weight", "visit"], showHealthBadge: false, showBirthdayBadge: false, birthdayPinDays: 7,
  clientStartTab: "training", showBackToClients: true, showNavigationLabels: false };
function seed(db: DatabaseSync) {
  for (const [key, value] of [["theme", "light"], ["client_card_ui_settings", JSON.stringify(card)],
    ["training_builder_draft:a", '{"kind":"simple","draft":{"title":"Original draft"}}'],
    ["training_builder_draft_v2:a:[\"simple\",null,null]", '{"kind":"simple","draft":{"title":"New draft"}}'],
    ["backup_interval_minutes", "30"], ["rest_timer_state_v1", '{"notificationId":"SYNTHETIC-OS-ID"}'], ["future_setting", "{broken"]]) {
    db.prepare("INSERT INTO app_settings VALUES(?,?,?)").run(key!, value!, time);
  }
}
const fixture = (run: Parameters<typeof nutritionFixture>[0], amend: (db: DatabaseSync) => void = () => undefined) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }); seed(db); amend(db);
});
type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const stage = (f: Fixture, checkpoint?: Parameters<typeof stageLegacyImportCandidate>[1]) => stageLegacyImportCandidate({ openStaging: f.native.open,
  context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() }, checkpoint);
const records = (path: string) => inspect(path, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name as string}`).all()]));
function empty(f: Fixture) {
  inspect(f.stagePath, (db) => {
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_'").all()) {
      if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  });
  assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}

test("all app settings are read and accounted for; supported preferences reach native Settings and raw drafts stay explicit review", () => fixture(async (f) => {
  assert.equal(f.snapshots.settings.rows!.length, 9);
  assert.deepEqual(inspect(f.sourcePath, (db) => runNodeLegacyReadPlan(db, legacySettingsReadPlan(f.context.accountScope))), f.snapshots.settings);
  const result = await stage(f); assert.deepEqual(result.owners.settings, { settingsRows: 1, sourceSettingRows: 9, settingsReviewRows: 4, settingsResetRows: 1, delegatedSettingRows: 3, finalizable: false });
  inspect(f.stagePath, (db) => {
    const row = db.prepare("SELECT * FROM settings").get()!; assert.equal(row.updated_at, importedAt); assert.equal(row.workspace_id, f.context.targetWorkspaceId);
    assert.deepEqual(parseAppearance(row.value_json as string), { themeId: "polar-teal", accentId: null, showClientListShortcut: true, hideNavigationLabels: true,
      clientCards: { startSection: "Training", metricIds: ["credits", "weight", "lastTraining"], showHealthBadge: false } });
    const source = db.prepare("SELECT * FROM r04_settings_source WHERE source_setting_key='training_builder_draft:a'").get()!;
    assert.equal(source.disposition, "DELEGATED_TRAINING_DRAFT"); assert.match(source.source_json as string, /Original draft/u);
    const plans = JSON.parse(db.prepare("SELECT target_json FROM r04_plan_receipt").get()!.target_json as string);
    assert.equal(plans.builderRepresentations.find((r: { sourceKey: string }) => r.sourceKey === source.source_key).disposition, "SHADOWED");
    assert.ok(plans.builderRepresentations.some((r: { disposition: string }) => r.disposition === "REVIEW_REQUIRED"));
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_settings_source").get()!.n, f.snapshots.settings.rows!.length);
    assert.equal((row.value_json as string).includes("SYNTHETIC-OS-ID"), false);
    assert.equal(db.prepare("SELECT disposition FROM r04_settings_source WHERE source_setting_key='rest_timer_state_v1'").get()!.disposition, "TECHNICAL_RESET");
  });
  const before = records(f.stagePath);
  await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: { ...f.snapshots, settings: { ...f.snapshots.settings, rows: [...f.snapshots.settings.rows!].reverse() } }, importedAt, referenceDay, allocate: () => assert.fail("settings replay allocated") });
  assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("sync and async Settings use the same plan, preserve blobs, and distinguish absent from empty stores", () => fixture(async (f) => {
  const source = { accountScope: f.context.accountScope, rows: [...f.snapshots.settings.rows!, { key: "blob", value: new Uint8Array([0, 255, 1]), updated_at: null }] };
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, importedAt, legacySettingsStagingExtension(source)); await stage.stageClients(f.snapshots.clients, allocator());
  const hostPath = join(f.dir, "host.sqlite"), native = nativeFactory(hostPath), host = await prepareLegacyClientStaging(native.open, f.context, importedAt, legacySettingsStagingExtension(source));
  inspect(hostPath, (db) => { db.exec("BEGIN IMMEDIATE"); runNodeLegacyWritePlan(db, legacySettingsStagePlan(f.context, importedAt, source)); db.exec("COMMIT"); });
  for (const table of ["settings", "r04_settings_source", "r04_settings_receipt"]) assert.deepEqual(inspect(f.stagePath, (db) => db.prepare(`SELECT * FROM ${table}`).all()), inspect(hostPath, (db) => db.prepare(`SELECT * FROM ${table}`).all()));
  assert.equal((await host.loadClientIds()).clients.size, 0);
  inspect(f.stagePath, (db) => assert.match(db.prepare("SELECT source_json FROM r04_settings_source WHERE source_setting_key='blob'").get()!.source_json as string, /"sqlBlobHex":"00ff01"/u));
  const absentPath = join(f.dir, "absent.sqlite"), absent = await prepareLegacyClientStaging(nativeFactory(absentPath).open, f.context, importedAt, legacySettingsStagingExtension({ accountScope: f.context.accountScope, rows: null }));
  await absent.stageClients(f.snapshots.clients, allocator());
  const changed = await prepareLegacyClientStaging(nativeFactory(absentPath).open, f.context, importedAt, legacySettingsStagingExtension({ accountScope: f.context.accountScope, rows: [] }));
  await assert.rejects(changed.stageClients(f.snapshots.clients, allocator()), /SETTINGS_PARITY_MISMATCH/u);
}));

test("invalid optional preferences remain raw review and cannot partially change navigation or block earlier facts", async () => {
  for (const raw of ['{broken', '{"showBackToClients":true,"clientCardMetricIds":["missing"]}', '{"showNavigationLabels":false,"showHealthBadge":"false"}',
    '{"clientCardMetricIds":["pack","program"]}', '{"showBackToClients":true,"birthdayPinDays":1.0000000000000001}']) await fixture(async (f) => {
    const result = await stage(f); assert.equal(result.owners.executions.performedFacts, 6);
    inspect(f.stagePath, (db) => {
      assert.deepEqual(parseAppearance(db.prepare("SELECT value_json FROM settings").get()!.value_json as string), { themeId: "polar-teal", accentId: null });
      const row = db.prepare("SELECT * FROM r04_settings_source WHERE source_setting_key='client_card_ui_settings'").get()!;
      assert.equal(row.disposition, "REVIEW_REQUIRED"); assert.match(row.issues_json as string, /CARD_SETTINGS_INVALID/u); assert.equal(JSON.parse(row.source_json as string).value, raw);
    });
    assert.equal(digest(f.sourcePath), f.sha);
  }, (db) => db.prepare("UPDATE app_settings SET value=? WHERE key='client_card_ui_settings'").run(raw));
});

test("light/dark aliases resolve through the normal theme reader, while grouped tabs and partial settings remain explicit", () => {
  for (const theme of ["light", "dark"] as const) for (const tab of ["home", "kbju", "training", "profile", "archive"]) {
    const result = projectLegacySettings({ accountScope: "synthetic", rows: [{ key: "theme", value: theme, updated_at: time },
      { key: "client_card_ui_settings", value: JSON.stringify({ ...card, clientStartTab: tab }), updated_at: time }] });
    assert.equal(resolvePalette(result.appearance!, "warm-sand").tone, theme);
    assert.equal(result.appearance!.clientCards!.startSection, ({ home: "Home", kbju: "Nutrition", training: "Training", profile: "More", archive: "More" } as Record<string, string>)[tab]);
    assert.equal(result.sourceRows.find((r) => r.key === "client_card_ui_settings")!.issues.includes("START_TAB_GROUPED_MORE"), tab === "profile" || tab === "archive");
  }
  const partial = projectLegacySettings({ accountScope: "synthetic", rows: [{ key: "client_card_ui_settings", value: '{"showHealthBadge":false}', updated_at: time }] });
  assert.equal(partial.appearance!.clientCards!.showHealthBadge, false); assert.equal(resolvePalette(partial.appearance!, "warm-sand").tone, "dark");
  assert.ok(partial.sourceRows[0]!.issues.includes("CARD_DEFAULTS_FOR_MISSING_PROPERTIES"));
});

test("every Settings checkpoint and before-commit interruption rolls back all owners and permits stable retry", async () => {
  for (const phase of ["after-settings-rows", "after-settings-source", "after-settings-receipt", "before-commit"] as const) await fixture(async (f) => {
    await assert.rejects(stage(f, async (at) => { if (at === phase) { await Promise.resolve(); throw new Error("PRIVATE interruption"); } }), { message: "R04_ID_LEDGER_WRITE_FAILED" }); empty(f);
    await stage(f); const before = records(f.stagePath); await stage(f); assert.deepEqual(records(f.stagePath), before);
  });
});

test("settings inputs are captured before awaiting and source, native row, source ledger or receipt drift never overwrites data", () => fixture(async (f) => {
  const source = structuredClone(f.snapshots), pending = stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() });
  Object.assign(source.settings.rows!.find((r) => r.key === "theme")!, { value: "dark" }); await pending;
  inspect(f.stagePath, (db) => assert.equal(parseAppearance(db.prepare("SELECT value_json FROM settings").get()!.value_json as string)!.themeId, "polar-teal"));
  await assert.rejects(stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() }), /SETTINGS_PARITY_MISMATCH/u);
  for (const [table, column, value, where] of [["settings", "value_json", "{}", "key='appearance'"], ["r04_settings_source", "disposition", "CHANGED", "source_setting_key='theme'"], ["r04_settings_receipt", "target_json", "{}", "id=1"]] as const) {
    const original = inspect(f.stagePath, (db) => db.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${where}`).get()!.v);
    inspect(f.stagePath, (db) => db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${where}`).run(value)); const damaged = records(f.stagePath);
    await assert.rejects(stage(f), /SETTINGS_PARITY_MISMATCH/u); assert.deepEqual(records(f.stagePath), damaged);
    inspect(f.stagePath, (db) => db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${where}`).run(original!));
  }
  await stage(f); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("native Settings schema/INSERT failures roll back initialization or the entire import and can be retried", async () => {
  for (const mode of ["schema", "insert"] as const) await fixture(async (f) => {
    let failed = false;
    f.native.state.fail = (call) => { if (!failed && call.kind === "run" && call.sql.startsWith(mode === "schema" ? "CREATE TABLE settings " : "INSERT INTO settings(")) { failed = true; return true; } return false; };
    await assert.rejects(stage(f), /WRITE_FAILED/u); assert.equal(failed, true); assert.equal(f.native.handles.size, 0);
    if (mode === "schema") inspect(f.stagePath, (db) => assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_'").all(), [])); else empty(f);
    f.native.state.fail = undefined; assert.equal((await stage(f)).owners.settings.settingsRows, 1);
  });
});

test("ambiguous settings identities and wrong scope roll back earlier owners; incompatible candidate modes reject before WAL", async () => {
  for (const mode of ["duplicate", "scope", "key"] as const) await fixture(async (f) => {
    const source = structuredClone(f.snapshots);
    if (mode === "scope") Object.assign(source.settings, { accountScope: "PRIVATE-other" });
    else if (mode === "duplicate") Object.assign(source.settings, { rows: [...source.settings.rows!, source.settings.rows![0]!] });
    else Object.assign(source.settings.rows![0]!, { key: null });
    await assert.rejects(stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source, importedAt, referenceDay, allocate: allocator() }),
      mode === "scope" ? /BUILDER_SCOPE_MISMATCH/u : /SETTINGS_IDENTITY_INVALID/u); empty(f);
  });
  await fixture(async (f) => {
    await prepareLegacyClientStaging(f.native.open, f.context, importedAt); const before = digest(f.stagePath), count = f.native.calls.length;
    await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, importedAt, legacySettingsStagingExtension(f.snapshots.settings)), /FOREIGN_DATABASE/u);
    assert.equal(digest(f.stagePath), before); assert.equal(f.native.calls.slice(count).some((call) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(call.sql)), false);
    assert.ok(f.native.calls.slice(0, count).some((call) => /^PRAGMA\s+journal_mode\s*=\s*WAL$/iu.test(call.sql))); assert.equal(f.native.handles.size, 0);
  });
});

test("COMMIT acknowledgement loss keeps the committed settings and a replay verifies them without allocating new IDs", () => fixture(async (f) => {
  let committing = false, lost = false;
  f.native.state.after = (call) => { if (committing && !lost && call.kind === "exec" && call.sql === "COMMIT") { lost = true; throw new Error("PRIVATE acknowledgement loss"); } };
  await assert.rejects(stage(f, (phase) => { if (phase === "before-commit") committing = true; }), /WRITE_FAILED/u); assert.equal(lost, true);
  const before = records(f.stagePath); f.native.state.after = undefined;
  const result = await stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: () => assert.fail("committed replay allocated") });
  assert.equal(result.owners.settings.sourceSettingRows, 9); assert.deepEqual(records(f.stagePath), before); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
}));

test("all-setting reads detect dropped rows and unsafe SQLite numbers before returning a partial snapshot", () => fixture(async (f) => {
  const native = nativeFactory(f.sourcePath), open = async () => { const db = await native.open(); return { ...db, getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
    const rows = await db.getAllAsync<Row>(sql, ...bindings as (string | number | null | Uint8Array)[]); return sql === 'SELECT * FROM "app_settings" ORDER BY "key"' ? rows.slice(1) : rows;
  } }; };
  await assert.rejects(readAdmittedLegacyDomainSnapshots(open, inspect(f.sourcePath, (db) => Number(db.prepare("PRAGMA page_count").get()!.page_count) * Number(db.prepare("PRAGMA page_size").get()!.page_size))), /SETTINGS_COVERAGE_MISMATCH/u);
  assert.equal(native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
  const unsafePath = join(f.dir, "unsafe.sqlite"); copyFileSync(f.sourcePath, unsafePath);
  inspect(unsafePath, (db) => { db.exec("ALTER TABLE app_settings ADD COLUMN future_counter INTEGER; UPDATE app_settings SET future_counter=9007199254740993 WHERE key='future_setting'"); updateLegacyManifestSize(db); });
  const unsafe = nativeFactory(unsafePath), before = digest(unsafePath);
  await assert.rejects(readAdmittedLegacyDomainSnapshots(unsafe.open, statSync(unsafePath).size), /SOURCE_SQL_NUMBER_UNREPRESENTABLE/u);
  assert.equal(unsafe.calls.some((call) => call.sql === 'SELECT * FROM "app_settings" ORDER BY "key"'), false);
  assert.equal(unsafe.handles.size, 0); assert.equal(digest(unsafePath), before); assert.equal(digest(f.sourcePath), f.sha);
}));

test("actual Expo runtime preserves native Settings and every raw setting across fresh-process resume", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), started = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start" }); assert.equal(started.ok, true, started.code);
  const job = started.jobs[0]!, target = join(root, "legacy-import-jobs", job.jobId, "candidate.sqlite"), before = records(target);
  inspect(target, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM r04_settings_source").get()!.n, 9));
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(resumed.ok, true, resumed.code); assert.equal(resumed.issued, 0); assert.deepEqual(records(target), before); assert.equal(resumed.handles, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("imported native preferences survive actual 3.x snapshot restore and a normal Settings reader without the importer", () => fixture(async (f) => {
  await stage(f); const live = join(f.dir, "normal.sqlite"), db = new DatabaseSync(live);
  try {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => ({ ...nodeSqlitePort(db), close: async () => undefined })));
    for (const row of inspect(f.stagePath, (staging) => staging.prepare("SELECT * FROM settings").all())) {
      db.prepare("INSERT INTO settings(workspace_id,key,value_json,revision,updated_at) VALUES(?,?,?,?,?)").run(row.workspace_id!, row.key!, row.value_json!, row.revision!, row.updated_at!);
    }
    await createSqliteBackup(db, join(f.dir, "backup.partial"), join(f.dir, "normal.atbackup"), { backupId: "77777777-7777-4777-8777-777777777777", createdAt: new Date(importedAt).toISOString() });
  } finally { db.close(); }
  const restored = join(f.dir, "restored.sqlite"); await prepareBackupForRestore(join(f.dir, "normal.atbackup"), restored);
  const script = `import {parentPort,workerData} from 'node:worker_threads';import {registerHooks} from 'node:module';import {DatabaseSync} from 'node:sqlite';
    registerHooks({resolve(s,c,next){const r=next(s,c);if(/legacy-import|shared\\/migration|scripts\\/r04\\//.test(r.url))throw Error('IMPORTER_REMOVED');return r;}});
    let blocked=false;try{await import(workerData.probe);}catch(e){blocked=e.message==='IMPORTER_REMOVED';}if(!blocked)throw Error('REMOVAL_GUARD_INACTIVE');
    const {DevSettingsRepository}=await import(workerData.reader),{SharedSqliteDatabase}=await import(workerData.shared),{nodeSqlitePort}=await import(workerData.port),{resolvePalette}=await import(workerData.theme);
    const db=new DatabaseSync(workerData.file),repo=new DevSettingsRepository(new SharedSqliteDatabase(async()=>({...nodeSqlitePort(db),close:async()=>undefined})),'local-trainer');
    await repo.initialize();const appearance=await repo.readAppearance();const tone=resolvePalette(appearance,'warm-sand').tone;await repo.close();db.close();parentPort.postMessage({appearance,tone,blocked});`;
  const result = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"], workerData: { file: restored,
      probe: new URL("../apps/mobile/src/features/settings/domain/legacy-import/LegacySettingsProjection.ts", import.meta.url).href,
      reader: new URL("../apps/mobile/src/features/settings/data/DevSettingsRepository.ts", import.meta.url).href,
      shared: new URL("../apps/mobile/src/shared/db/SharedSqliteDatabase.ts", import.meta.url).href,
      port: new URL("./support/node-sqlite-port.ts", import.meta.url).href,
      theme: new URL("../apps/mobile/src/shared/ui/theme/resolver.ts", import.meta.url).href } });
    let received: unknown; worker.once("message", (value: unknown) => { received = value; }); worker.once("error", reject);
    worker.once("exit", (code) => code || received === undefined ? reject(new Error(`SETTINGS_READER_EXIT_${code}`)) : resolve(received));
  });
  assert.deepEqual(result, { blocked: true, tone: "light", appearance: { themeId: "polar-teal", accentId: null, showClientListShortcut: true, hideNavigationLabels: true,
    clientCards: { startSection: "Training", metricIds: ["credits", "weight", "lastTraining"], showHealthBadge: false } } });
  assert.equal(digest(f.sourcePath), f.sha);
}));
