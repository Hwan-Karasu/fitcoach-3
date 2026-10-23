import { Directory, File, Paths } from "expo-file-system";
import { uuid, requireOptionalNativeModule } from "expo-modules-core";
import * as SQLite from "expo-sqlite";
import { AutomaticBackupService, AutomaticBackupError, type AutomaticBackupFiles, type AutomaticEntry, parseAutomaticPublication } from "../../features/backup/public.ts";
import { ExpoAutomaticBackupFiles } from "../../features/backup/data/ExpoAutomaticBackupFiles.ts";
import { expoAutomaticBackupStore } from "../../features/backup/data/ExpoAutomaticBackupStore.ts";
import { ExpoSqliteBackup } from "../../features/backup/data/ExpoSqliteBackup.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../../shared/db/IsolatedSqliteConnection.ts";
import { RuntimeCommandGate } from "../runtime/RuntimeCommandGate.ts";
import { createLocalRepositories } from "./createLocalRepositories.ts";
import { prepareProductionDatabase, inspectProductionDatabase, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID } from "./productionDatabase.ts";
import { SCHEMA_OWNERS } from "./schema.ts";
import systemCatalog from "../../features/exercises/data/system-catalog.generated.json";
import type { SystemCatalog } from "../../features/exercises/public.ts";
import type { R06NativeReport } from "./runR06NativeProbe.ts";

interface NativeFixture {
  createAutomaticFixture(): Promise<string>;
  publishAutomaticFixture(source: string, id: string, created: string, sha: string, size: number, token: string): Promise<unknown>;
  removeAutomaticFixtureFile(token: string, id: string, staleRow: boolean): Promise<"ROW_PRESENT" | "ROW_ABSENT">;
  removeAutomaticFixtureDirectory(token: string): Promise<boolean>;
  inspectAutomatic(id: string, uri: string, sha: string, bytes: number): Promise<unknown>;
}
/** Real MediaStore faults in a native-owned, debug-only UUID directory. The shared
 * publisher/service/schema are exercised without deleting the actual default folder. */
export async function runR06AutomaticMissingProbe(): Promise<R06NativeReport> {
  const started = Date.now(); const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed }); console.info(`R06_AUTO_MISSING_CHECK ${name} ${passed ? "PASS" : "FAIL"}`);
    if (!passed) throw new Error("R06_AUTO_MISSING_CHECK_FAILED");
  };
  const root = new Directory(Paths.document, "r06-auto-missing", uuid.v4()); root.create({ intermediates: true });
  const images = new Directory(root, "images"); images.create(); const live = new File(root, "live.db");
  const schema = { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS };
  const database = new SharedSqliteDatabase(() => openIsolatedSqliteConnection(() => SQLite.openDatabaseAsync(live.name,
    { useNewConnection: true }, root.uri), inspectProductionDatabase));
  const owners = createLocalRepositories(database, PRODUCTION_WORKSPACE_ID, systemCatalog as SystemCatalog);
  const commands = new RuntimeCommandGate(); const clients = commands.port(owners.clients);
  let time = Date.parse("2001-01-01T10:00:00.000Z"); let failPreparation = false; let stage = "START";
  const store = expoAutomaticBackupStore(new Directory(root, "state"));
  const files = new ExpoAutomaticBackupFiles({ root: new Directory(root, "state"), live, images, schema,
    pendingIds: () => store.protectedJobIds(), now: () => time });
  const native = requireOptionalNativeModule<NativeFixture>("AthleteBackupStorage");
  check("native_auto_missing_capability", files.available && native !== null);
  const token = await native!.createAutomaticFixture(); const ids: string[] = [];
  const observed: AutomaticBackupFiles = { available: files.available,
    prepare: (previous) => { if (failPreparation) throw new AutomaticBackupError("AUTO_SOURCE_UNAVAILABLE"); return files.prepare(previous); },
    publish: async (p) => {
      const raw = await native!.publishAutomaticFixture(new File(root, "state", "automatic-jobs", p.backupId, "snapshot.atbackup").uri,
        p.backupId, p.createdAt, p.sha256, p.bytes, token);
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true) throw new Error("R06_AUTO_FIXTURE_PUBLICATION");
      const r = raw as Record<string, unknown>;
      return parseAutomaticPublication({ uri: r.uri, filename: r.filename, sha256: r.sha256, bytes: r.bytes }, p);
    },
    inspect: (e) => files.inspect(e), verify: (e) => files.verify(e), remove: (e) => files.remove(e), cleanup: (id) => files.cleanup(id) };
  const create = () => new AutomaticBackupService({ enabled: true, files: observed, store, now: () => time, offset: () => 0,
    ready: () => true, location: async () => ({ kind: "DOWNLOADS" }), run: (task) => commands.run(task) });
  const inspect = (entry: AutomaticEntry) => native!.inspectAutomatic(entry.backupId, entry.uri, entry.sha256, entry.bytes);
  try {
    await prepareProductionDatabase(database); await owners.initialize(); const service = create();
    stage = "DAILY";
    for (let day = 0; day < 3; day++) {
      time = Date.parse("2001-01-01T10:00:00.000Z") + day * 86_400_000;
      ids.push((await clients.create({ displayName: `R06 SYNTHETIC MISSING ${day}` })).id); await service.retry();
      check(`native_auto_missing_day_${day}_published`, service.state.error === null && (await store.read())!.entries.length === day + 1);
    }
    const before = (await store.read())!; const latest = before.entries[0]!; const historical = before.entries[1]!;
    check("native_auto_missing_unknown_receipt_unavailable", await native!.inspectAutomatic(uuid.v4(), latest.uri, latest.sha256, latest.bytes) === "UNAVAILABLE");
    check("native_auto_missing_wrong_hash_unavailable", await native!.inspectAutomatic(latest.backupId, latest.uri, "0".repeat(64), latest.bytes) === "UNAVAILABLE");
    stage = "HISTORICAL";
    check("native_auto_missing_historical_external_delete", await native!.removeAutomaticFixtureFile(token, historical.backupId, false) === "ROW_ABSENT");
    check("native_auto_missing_zero_row_tombstone", await inspect(historical) === "MISSING" && await inspect(historical) === "MISSING");
    await service.retry(); const reduced = (await store.read())!;
    check("native_auto_missing_history_metadata_only", service.state.error === null && reduced.sequence === before.sequence && reduced.entries.length === 2 &&
      reduced.entries[0]!.backupId === latest.backupId && reduced.entries[1]!.backupId === before.entries[2]!.backupId);
    for (const entry of reduced.entries) await files.verify(entry);
    check("native_auto_missing_healthy_versions_exact", true);
    stage = "STALE_ROW";
    const row = await native!.removeAutomaticFixtureFile(token, latest.backupId, true);
    check(row === "ROW_PRESENT" ? "native_auto_missing_unlink_left_stale_row" : "native_auto_missing_unlink_also_removed_row", row === "ROW_PRESENT" || row === "ROW_ABSENT");
    check(row === "ROW_PRESENT" ? "native_auto_missing_stale_row_absence_proven" : "native_auto_missing_unlinked_file_absence_proven", await inspect(latest) === "MISSING");
    failPreparation = true; const failed = create(); await failed.retry();
    const predecessor = (await store.read())!.entries[0]!;
    check("native_auto_missing_failed_repair_keeps_predecessor", failed.state.error === "AUTO_SOURCE_UNAVAILABLE" && predecessor.backupId === before.entries[2]!.backupId && await inspect(predecessor) === "VALID");
    failPreparation = false; const repaired = create(); await repaired.retry(); const restored = (await store.read())!;
    check("native_auto_missing_current_recreated_without_business_change", repaired.state.error === null && restored.sequence === before.sequence + 1 &&
      restored.entries.length === 2 && restored.entries[0]!.backupId !== latest.backupId && restored.entries[1]!.backupId === predecessor.backupId);
    stage = "DIRECTORY";
    for (const entry of restored.entries) check("native_auto_missing_remaining_external_delete", await native!.removeAutomaticFixtureFile(token, entry.backupId, false) === "ROW_ABSENT");
    check("native_auto_missing_empty_directory_actually_deleted", await native!.removeAutomaticFixtureDirectory(token));
    const restarted = create(); await restarted.retry(); const recreated = (await store.read())!;
    check("native_auto_missing_same_destination_recreated", restarted.state.error === null && recreated.destination.kind === "DOWNLOADS" &&
      recreated.sequence === restored.sequence + 1 && recreated.entries.length === 1 && recreated.retired.length === 0 && await inspect(recreated.entries[0]!) === "VALID");
    const copy = new File(root, "verified.atbackup"); await new ExpoSqliteBackup(schema).validateExternal(new File(recreated.entries[0]!.uri), copy);
    const read = await SQLite.openDatabaseAsync(copy.name, { useNewConnection: true }, root.uri);
    try {
      const rows = await read.getAllAsync<{ id: string }>("SELECT id FROM clients");
      check("native_auto_missing_recreated_snapshot_has_all_facts", rows.length === ids.length && ids.every((id) => rows.some((r) => r.id === id)));
    } finally { await read.closeAsync(); }
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((c) => c.passed), elapsedMs: Date.now() - started };
  } catch { console.info(`R06_AUTO_MISSING_FAILURE ${stage}`); throw new Error("R06_AUTO_MISSING_FAILED"); }
  finally { await owners.close(); }
}
