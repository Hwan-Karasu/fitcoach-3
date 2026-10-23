import { Directory, File, Paths } from "expo-file-system";
import { uuid, requireOptionalNativeModule } from "expo-modules-core";
import * as SQLite from "expo-sqlite";
import { AutomaticBackupService, AutomaticBackupError, type AutomaticBackupFiles, type PendingAutomatic, type PublishedBackup } from "../../features/backup/public.ts";
import { ExpoAutomaticBackupFiles } from "../../features/backup/data/ExpoAutomaticBackupFiles.ts";
import { expoAutomaticBackupStore } from "../../features/backup/data/ExpoAutomaticBackupStore.ts";
import { nativeBackupPublisher } from "../../features/backup/data/NativeBackupPublisher.ts";
import { ExpoSqliteBackup } from "../../features/backup/data/ExpoSqliteBackup.ts";
import { expoSnapshotMedia } from "../../features/backup/data/ExpoSnapshotMedia.ts";
import { expoFileSha256 } from "../../shared/files/ExpoFileSha256.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../../shared/db/IsolatedSqliteConnection.ts";
import { RuntimeCommandGate } from "../runtime/RuntimeCommandGate.ts";
import { createLocalRepositories } from "./createLocalRepositories.ts";
import { prepareProductionDatabase, inspectProductionDatabase, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID } from "./productionDatabase.ts";
import { SCHEMA_OWNERS } from "./schema.ts";
import systemCatalog from "../../features/exercises/data/system-catalog.generated.json";
import type { SystemCatalog } from "../../features/exercises/public.ts";
import type { R06NativeReport } from "./runR06NativeProbe.ts";

interface Native {
  removeAutomatic(id: string, uri: string, sha: string, bytes: number): Promise<boolean>;
  verifyAutomatic(id: string, uri: string, sha: string, bytes: number): Promise<boolean>;
  publishAutomatic(source: string, id: string, createdAt: string, sha: string, bytes: number, tree: string | null): Promise<unknown>;
}
/** Current native module, full shared engine and actual service; only fresh synthetic
 * private files. Calendar time is injected to test days without a multi-day wait. */
export async function runR06AutomaticProbe(mode: "FULL" | "STATUS" = "FULL"): Promise<R06NativeReport> {
  if (mode === "STATUS") return runStatusProbe();
  const started = Date.now(); const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed }); console.info(`R06_AUTO_CHECK ${name} ${passed ? "PASS" : "FAIL"}`);
    if (!passed) throw new Error("R06_AUTO_CHECK_FAILED");
  };
  const root = new Directory(Paths.document, "r06-auto", uuid.v4()); root.create({ intermediates: true });
  const images = new Directory(root, "images"); images.create();
  const live = new File(root, "live.db"); const schema = { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS };
  const database = new SharedSqliteDatabase(() => openIsolatedSqliteConnection(() => SQLite.openDatabaseAsync(live.name, { useNewConnection: true }, root.uri), inspectProductionDatabase));
  const owners = createLocalRepositories(database, PRODUCTION_WORKSPACE_ID, systemCatalog as SystemCatalog);
  const commands = new RuntimeCommandGate(); const clients = commands.port(owners.clients);
  const monday = Date.parse("2000-01-03T10:00:00.000Z"); let time = monday; const store = expoAutomaticBackupStore(new Directory(root, "state"));
  const files = new ExpoAutomaticBackupFiles({ root: new Directory(root, "state"), live, images, schema,
    pendingIds: () => store.protectedJobIds(), now: () => time });
  const native = requireOptionalNativeModule<Native>("AthleteBackupStorage");
  check("native_auto_capability", files.available && native !== null);
  const photo = new File(images, "synthetic.png");
  let manual: PublishedBackup | null = null; let first: PublishedBackup | null = null; let firstPending: PendingAutomatic | null = null;
  let lateId = ""; let stage = "SEED";
  try {
    await prepareProductionDatabase(database); await owners.initialize();
    const initial = await clients.create({ displayName: "R06 SYNTHETIC AUTO BEFORE" });
    photo.write("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", { encoding: "base64" });
    const photoSha = (await expoFileSha256(photo)).sha256; const recipe = uuid.v4();
    const lease = await database.acquire();
    try {
      await lease.writer.write((tx) => tx.run(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, details_json)
        VALUES (?, ?, ?, 10, 1, ?, ?, ?)`, [recipe, PRODUCTION_WORKSPACE_ID, "R06 SYNTHETIC AUTO RECIPE", new Date(time).toISOString(), new Date(time).toISOString(),
        JSON.stringify({ photoUri: photo.uri, prepMinutes: 0, cookMinutes: 0, categories: [], steps: [] })]));
    } finally { await database.release(); }
    const observed: AutomaticBackupFiles = { available: files.available,
      prepare: (previous) => files.prepare(previous), inspect: (e) => files.inspect(e), verify: (e) => files.verify(e), remove: (e) => files.remove(e), cleanup: (id) => files.cleanup(id),
      publish: async (pending, destination) => {
        if (firstPending === null) {
          firstPending = pending;
          // Ordinary writes continue after the stable snapshot; the next interval must capture them.
          lateId = (await clients.create({ displayName: "R06 SYNTHETIC AUTO LATE" })).id;
          const source = new File(root, "state", "automatic-jobs", pending.backupId, "snapshot.atbackup");
          manual = await nativeBackupPublisher().publish({ ...pending, sourceUri: source.uri }, destination);
        }
        const receipt = await files.publish(pending, destination); if (first === null) first = receipt; return receipt;
      } };
    const service = new AutomaticBackupService({ enabled: true, files: observed, store, now: () => time, offset: () => 0,
      ready: () => true, location: async () => ({ kind: "DOWNLOADS" }), run: (task) => commands.run(task) });
    stage = "FIRST"; await service.check(); check("native_auto_first_check_schedules_without_publication", service.state.lastSaved === null && (await store.read())!.pending === null);
    time += 30 * 60 * 1000; await service.check();
    check("native_auto_first_publication", service.state.error === null && (await store.read())!.entries.length === 1);
    const driver = new ExpoSqliteBackup(schema); const inspected = new File(root, "first.atbackup");
    await driver.validateExternal(new File(first!.uri), inspected);
    const readFirst = await SQLite.openDatabaseAsync(inspected.name, { useNewConnection: true }, root.uri);
    try { check("native_auto_online_snapshot_keeps_consistent_before_late_write", (await readFirst.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM clients"))?.n === 1); }
    finally { await readFirst.closeAsync(); }
    stage = "SAME_DAY"; time += 30 * 60 * 1000; await service.check();
    check("native_auto_late_write_gets_next_same_day_copy", service.state.error === null && (await store.read())!.entries.length === 1 && (await store.read())!.sequence === 2);
    check("native_auto_old_same_day_file_retired", await native!.verifyAutomatic(firstPending!.backupId, first!.uri, first!.sha256, first!.bytes) === false);
    const same = (await store.read())!.entries[0]!.backupId; time += 30 * 60 * 1000; await service.check();
    check("native_auto_unchanged_does_not_duplicate", service.state.error === null && (await store.read())!.entries[0]!.backupId === same && (await store.read())!.sequence === 2);
    stage = "DAYS";
    for (let day = 1; day <= 3; day++) {
      time = monday + day * 86_400_000; await clients.create({ displayName: `R06 SYNTHETIC AUTO DAY ${day}` }); await service.check();
      check(`native_auto_day_${day}_successful`, service.state.error === null);
    }
    const catalog = (await store.read())!;
    check("native_auto_three_daily_versions", catalog.entries.map((e) => e.day).join(",") === "2000-01-06,2000-01-05,2000-01-04" && catalog.retired.length === 0);
    for (const entry of catalog.entries) await files.verify(entry);
    check("native_auto_three_versions_verified", true);
    stage = "OWNERSHIP";
    check("native_auto_manual_file_ineligible_even_with_owned_id", await native!.removeAutomatic(firstPending!.backupId, manual!.uri, manual!.sha256, manual!.bytes) === false);
    check("native_auto_unknown_id_ineligible", await native!.removeAutomatic(uuid.v4(), manual!.uri, manual!.sha256, manual!.bytes) === false);
    const latest = catalog.entries[0]!;
    check("native_auto_changed_receipt_ineligible", await native!.removeAutomatic(latest.backupId, latest.uri, "0".repeat(64), latest.bytes) === false);
    const replay = await native!.publishAutomatic(new File(root, "missing.atbackup").uri, latest.backupId, latest.createdAt, latest.sha256, latest.bytes, null) as { uri?: string; ok?: boolean };
    check("native_auto_native_receipt_replay_without_source", replay.ok === true && replay.uri === latest.uri);
    check("native_auto_retired_tombstone_is_idempotent", await native!.removeAutomatic(firstPending!.backupId, first!.uri, first!.sha256, first!.bytes) === true);
    const manualCopy = new File(root, "manual-after.atbackup"); await new File(manual!.uri).copy(manualCopy);
    check("native_auto_rotation_keeps_manual_export_exact", (await expoFileSha256(manualCopy)).sha256 === manual!.sha256);
    stage = "RESTORE"; photo.delete(); const restoredImages = new Directory(root, "restored-images");
    const incoming = new File(root, "incoming.db");
    await driver.prepareForRestore(new File(latest.uri), new File(root, "inspection.atbackup"), incoming,
      { files: expoSnapshotMedia(restoredImages), restoreId: uuid.v4() });
    const restored = await SQLite.openDatabaseAsync(incoming.name, { useNewConnection: true }, root.uri);
    try {
      const rows = await restored.getAllAsync<{ id: string }>("SELECT id FROM clients");
      check("native_auto_restore_all_client_facts", rows.length === 5 && rows.some((e) => e.id === initial.id) && rows.some((e) => e.id === lateId));
      const row = await restored.getFirstAsync<{ details_json: string }>("SELECT details_json FROM recipes WHERE id=?", [recipe]);
      const uri = (JSON.parse(row!.details_json) as { photoUri: string }).photoUri;
      check("native_auto_restore_embedded_photo_after_loss", (await expoFileSha256(new File(uri))).sha256 === photoSha);
    } finally { await restored.closeAsync(); }
    check("native_auto_live_repositories_remain_usable", (await clients.get(initial.id)) !== null && (await clients.get(lateId)) !== null && owners.ownerCount === 15);
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((c) => c.passed), elapsedMs: Date.now() - started };
  } catch { console.info(`R06_AUTO_FAILURE ${stage}`); throw new Error("R06_AUTO_FAILED"); }
  finally { await owners.close(); }
}

/** Focused private status persistence check on the completed synthetic fixture. No new
 * external copies, no SQLite preparation and no repeat of the daily-rotation scenario. */
async function runStatusProbe(): Promise<R06NativeReport> {
  const started = Date.now(); const parent = new Directory(Paths.document, "r06-auto");
  const root = parent.list().filter((item): item is Directory => item instanceof Directory && /^[a-f0-9-]{36}$/u.test(item.name))
    .sort((a, b) => (a.info().creationTime ?? 0) - (b.info().creationTime ?? 0)).at(-1);
  if (!root) throw new Error("R06_AUTO_FIXTURE_MISSING");
  const store = expoAutomaticBackupStore(new Directory(root, "state")); const prior = await store.read();
  if (!prior || prior.pending !== null || prior.retired.length !== 0 || prior.entries.length !== 3) throw new Error("R06_AUTO_FIXTURE_INCOMPLETE");
  const time = prior.checkedAt + 30 * 60 * 1000;
  const nativeFiles = new ExpoAutomaticBackupFiles({ root: new Directory(root, "state"), live: new File(root, "live.db"), images: new Directory(root, "images"),
    schema: { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS }, pendingIds: () => store.protectedJobIds() });
  let failing = true;
  const files: AutomaticBackupFiles = { available: nativeFiles.available,
    prepare: async () => { if (failing) throw new AutomaticBackupError("AUTO_SOURCE_UNAVAILABLE"); return null; },
    publish: async () => { throw new Error("R06_UNEXPECTED_PUBLICATION"); },
    inspect: (e) => nativeFiles.inspect(e), verify: (e) => nativeFiles.verify(e), remove: (e) => nativeFiles.remove(e), cleanup: async () => undefined };
  const create = () => new AutomaticBackupService({ enabled: true, files, store, ready: () => true, now: () => time,
    offset: () => prior.entries[0]!.offsetMinutes, location: async () => prior.destination, run: (task) => task() });
  const checks: { name: string; passed: boolean }[] = []; const check = (name: string, passed: boolean) => {
    checks.push({ name, passed }); if (!passed) throw new Error("R06_AUTO_STATUS_FAILED");
  };
  await create().retry(); check("native_auto_status_failure_persisted", (await store.readFailure())?.code === "AUTO_SOURCE_UNAVAILABLE");
  const restarted = create(); await restarted.check(); check("native_auto_status_visible_after_recreation", restarted.state.error === "AUTO_SOURCE_UNAVAILABLE");
  failing = false; await restarted.retry();
  check("native_auto_status_cleared_only_after_verified_retry", restarted.state.error === null && await store.readFailure() === null &&
    (await store.read())!.sequence === prior.sequence && (await store.read())!.entries.map((e) => e.backupId).join(",") === prior.entries.map((e) => e.backupId).join(","));
  return { kind: "R06_NATIVE", checks, allPassed: true, elapsedMs: Date.now() - started };
}
