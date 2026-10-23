import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { uuid } from "expo-modules-core";
import { Image } from "react-native";
import { GuardedRestore, RestoreProtocolError, SnapshotError } from "../../features/backup/public.ts";
import { ExpoRestoreStorage } from "../../features/backup/data/ExpoRestoreStorage.ts";
import { ExpoSqliteBackup } from "../../features/backup/data/ExpoSqliteBackup.ts";
import { expoSnapshotMedia } from "../../features/backup/data/ExpoSnapshotMedia.ts";
import { expoSnapshotSql } from "../../features/backup/data/ExpoSnapshotSql.ts";
import { snapshotContentSha256 } from "../../features/backup/data/SnapshotContentHash.ts";
import { DevClientRepository } from "../../features/clients/data/DevClientRepository.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../../shared/db/IsolatedSqliteConnection.ts";
import { expoFileSha256 } from "../../shared/files/ExpoFileSha256.ts";
import { LocalFileHashError } from "../../shared/files/LocalFileSha256.ts";
import { DatabaseCompatibilityError } from "../../shared/db/DatabaseIdentity.ts";
import type { RestoreStorage } from "../../features/backup/public.ts";
import { inspectProductionDatabase, prepareProductionDatabase, PRODUCTION_WORKSPACE_ID, PRODUCTION_IDENTITY } from "./productionDatabase.ts";
import { SCHEMA_OWNERS } from "./schema.ts";
import { R06_SCALAR_FIXTURE_SHA256, R06_SCALAR_FIXTURE_SQL } from "./r06ScalarFixture.ts";

export interface R06NativeReport {
  readonly kind: "R06_NATIVE";
  readonly checks: readonly { readonly name: string; readonly passed: boolean }[];
  readonly allPassed: boolean;
  readonly elapsedMs: number;
}
interface InterruptedProbe {
  readonly rootUri: string;
  readonly beforeId: string;
  readonly restoredId: string;
  readonly oldHash: string;
}
const pendingProbe = () => new File(Paths.document, "r06-native-pending.json");
const databaseAt = (root: Directory, name: string) => new SharedSqliteDatabase(() => openIsolatedSqliteConnection(
  () => SQLite.openDatabaseAsync(name, { useNewConnection: true }, root.uri), inspectProductionDatabase));

async function recoverInterruptedProbe(): Promise<R06NativeReport> {
  const started = Date.now();
  const saved: unknown = JSON.parse(await pendingProbe().text());
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("R06_PENDING_INVALID");
  const state = saved as Partial<InterruptedProbe>;
  const prefix = `${Paths.document.uri.replace(/\/$/u, "")}/r06-native/`;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  if (typeof state.rootUri !== "string" || !state.rootUri.startsWith(prefix) || !/^run-[a-z0-9-]+\/?$/u.test(state.rootUri.slice(prefix.length)) ||
    typeof state.beforeId !== "string" || !uuid.test(state.beforeId) || typeof state.restoredId !== "string" || !uuid.test(state.restoredId) ||
    typeof state.oldHash !== "string" || !/^[a-f0-9]{64}$/u.test(state.oldHash)) throw new Error("R06_PENDING_INVALID");
  const root = new Directory(state.rootUri);
  const live = databaseAt(root, "live.db");
  const clients = new DevClientRepository(live, PRODUCTION_WORKSPACE_ID, []);
  const storage = new ExpoRestoreStorage({ live: new File(root, "live.db"), directory: new Directory(root, "restore"),
    withClosedDatabase: (task) => live.withClosedDatabase(() => clients.close(), task), inspectDatabase: inspectProductionDatabase });
  const protocol = new GuardedRestore(storage);
  const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => { checks.push({ name, passed }); if (!passed) throw new Error("R06_RECOVERY_CHECK_FAILED"); };
  try {
    // Before opening any SQLite handle, PREPARED must restore the original physical file.
    check("native_kill_rolls_back", await protocol.recover() === "ROLLED_BACK");
    check("native_kill_original_bytes", (await expoFileSha256(storage.file("LIVE"))).sha256 === state.oldHash);
    check("native_kill_safety_intact", (await expoFileSha256(storage.file("SAFETY"))).sha256 === state.oldHash);
    check("native_kill_rejected_preserved", storage.file("REJECTED").exists);
    await clients.initialize();
    check("native_kill_original_client", (await clients.get(state.beforeId))?.displayName === "R06 SYNTHETIC BEFORE");
    check("native_kill_no_partial_merge", await clients.get(state.restoredId) === null);
    await clients.create({ displayName: "R06 SYNTHETIC AFTER RECOVERY" });
    await clients.close();
    const later = (await expoFileSha256(storage.file("LIVE"))).sha256;
    check("native_kill_idempotent_recovery", await protocol.recover() === "ROLLED_BACK" && (await expoFileSha256(storage.file("LIVE"))).sha256 === later);
    pendingProbe().delete();
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((item) => item.passed), elapsedMs: Date.now() - started };
  } finally { await clients.close(); }
}
/** Only invoked by the isolated SQLite spike. Always uses a newly allocated synthetic private
 * directory, never runtime DB names, sources, imports or actual user data. No cleanup of other jobs.
 */
export async function runR06NativeProbe(mode: "NORMAL" | "INTERRUPT" | "RECOVER" = "NORMAL"): Promise<R06NativeReport> {
  if (mode === "RECOVER") return recoverInterruptedProbe();
  if (mode === "INTERRUPT" && pendingProbe().exists) throw new Error("R06_PENDING_REHEARSAL_EXISTS");
  const started = Date.now();
  const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => { checks.push({ name, passed }); if (!passed) throw new Error("R06_NATIVE_CHECK_FAILED"); };
  const root = new Directory(Paths.document, "r06-native", `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  root.create({ intermediates: true });
  const restoreDirectory = new Directory(root, "restore"); restoreDirectory.create();
  const liveFile = new File(root, "live.db"); const sourceFile = new File(root, "source.db");
  const live = databaseAt(root, "live.db"); const source = databaseAt(root, "source.db");
  const clients = new DevClientRepository(live, PRODUCTION_WORKSPACE_ID, []);
  const historic = new DevClientRepository(source, PRODUCTION_WORKSPACE_ID, []);
  const oldImages = new Directory(root, "old-images"); oldImages.create();
  const newImages = new Directory(root, "new-images"); newImages.create();
  const originalPhoto = new File(oldImages, "synthetic.png");
  const recipeId = uuid.v4();
  const photoDetails = { prepMinutes: 0, cookMinutes: 5, categories: [], photoUri: originalPhoto.uri,
    steps: ["Synthetic step"], preservedUnknown: { zero: 0, flag: false } };
  const backupDriver = new ExpoSqliteBackup({ identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
  const snapshotFile = new File(root, "synthetic.atbackup");
  let stage = "SCALAR_PARITY";
  try {
    const scalars = await SQLite.openDatabaseAsync("scalars.db", { useNewConnection: true }, root.uri);
    try {
      await scalars.execAsync(R06_SCALAR_FIXTURE_SQL);
      // Independent Node oracle, including exact int64 and IEEE edge cases (same fixture).
      const scalarHash = await snapshotContentSha256(expoSnapshotSql(scalars));
      if (scalarHash !== R06_SCALAR_FIXTURE_SHA256) {
        // Synthetic scalars only, no application/user rows or paths.
        const values = await scalars.getAllAsync<{ type: string; value: string | null }>("SELECT typeof(a) AS type, printf('%!.26g', a) AS value FROM atoms ORDER BY rowid");
        console.info(`R06_SCALAR_DIAGNOSTIC ${JSON.stringify({ scalarHash, values })}`);
      }
      check("native_scalar_hash_matches_node", scalarHash === R06_SCALAR_FIXTURE_SHA256);
    } finally { await scalars.closeAsync(); }
    stage = "PREPARE_LIVE";
    await prepareProductionDatabase(live); await clients.initialize();
    const before = await clients.create({ displayName: "R06 SYNTHETIC BEFORE" });
    await clients.close();
    stage = "PREPARE_SOURCE";
    await prepareProductionDatabase(source); await historic.initialize();
    const restored = await historic.create({ displayName: "R06 SYNTHETIC RESTORED", emoji: "🏋️" });
    await historic.close();
    stage = "PREPARE_MEDIA";
    originalPhoto.write("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", { encoding: "base64" });
    const png = await originalPhoto.bytes();
    const image = new Uint8Array(256 * 1024 * 2 + 19); image.set(png); originalPhoto.write(image);
    const imageHash = (await expoFileSha256(originalPhoto)).sha256;
    const seed = await SQLite.openDatabaseAsync("source.db", { useNewConnection: true }, root.uri);
    try {
      await seed.execAsync("PRAGMA foreign_keys=ON");
      await seed.runAsync(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, details_json, archived_at)
        VALUES (?, ?, ?, 10, 7, ?, ?, ?, ?)`, [recipeId, PRODUCTION_WORKSPACE_ID, "R06 SYNTHETIC RECIPE",
        "2026-10-23T08:00:00.000Z", "2026-10-23T08:00:00.000Z", JSON.stringify(photoDetails, null, 2), "2026-10-23T08:00:00.000Z"]);
    } finally { await seed.closeAsync(); }
    stage = "HASH_CLOSED_FILES";
    const oldHash = (await expoFileSha256(liveFile)).sha256;
    const sourceHash = (await expoFileSha256(sourceFile)).sha256;
    check("streaming_sha256", oldHash.length === 64 && sourceHash.length === 64 && oldHash !== sourceHash);
    stage = "NATIVE_BACKUP";
    const sourceHandle = await SQLite.openDatabaseAsync("source.db", { useNewConnection: true }, root.uri);
    try {
      await sourceHandle.execAsync("PRAGMA query_only=ON");
      const manifest = await backupDriver.createSnapshot(sourceHandle, new File(root, "copy.partial"), snapshotFile,
        { backupId: uuid.v4(), createdAt: "2026-10-23T08:00:00.000Z" }, { files: expoSnapshotMedia(oldImages) });
      check("native_manifest_embeds_media", manifest.media?.entries === 1 && manifest.media.bytes === image.length);
    } finally { await sourceHandle.closeAsync(); }
    check("native_backup_preserves_source", (await expoFileSha256(sourceFile)).sha256 === sourceHash);
    const snapshotHash = (await expoFileSha256(snapshotFile)).sha256;
    originalPhoto.delete();
    stage = "VALIDATE_COMPLETE_SNAPSHOT";
    const manifest = await backupDriver.validateExternal(snapshotFile, new File(root, "inspection.db"));
    check("native_self_contained_after_photo_loss", manifest.media?.entries === 1 && !originalPhoto.exists);
    stage = "STAGE_COMPLETE_SNAPSHOT";
    const staged = await backupDriver.prepareForRestore(snapshotFile, new File(root, "restore-source.db"), new File(restoreDirectory, "incoming.db"),
      { files: expoSnapshotMedia(newImages), restoreId: uuid.v4() });
    check("native_staging_manifest_parity", JSON.stringify(staged) === JSON.stringify(manifest));
    check("native_external_backup_unchanged", (await expoFileSha256(snapshotFile)).sha256 === snapshotHash);
    stage = "RESTORE_ADAPTER";
    const storage = new ExpoRestoreStorage({ live: liveFile, directory: restoreDirectory,
      withClosedDatabase: (task) => live.withClosedDatabase(() => clients.close(), task), inspectDatabase: inspectProductionDatabase });
    // Reopen a holder: the adapter's gate must release it before touching files.
    await clients.initialize();
    const incomingHash = (await expoFileSha256(storage.file("INCOMING"))).sha256;
    const observed: RestoreStorage = new Proxy(storage, {
      get(target, key, receiver) {
        const method: unknown = Reflect.get(target, key, receiver);
        if (typeof method !== "function") return method;
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(method, target, args);
          if (!(result instanceof Promise)) return result;
          return result.catch((error: unknown) => {
            if (["validateDatabase", "copyExclusive", "moveExclusive", "saveGuard"].includes(String(key))) {
              const name = error instanceof Error && /^[a-zA-Z]{1,50}$/u.test(error.name) ? error.name : "NativeError";
              const code = error instanceof DatabaseCompatibilityError ? error.code : "NATIVE_API_FAILED";
              const slot = typeof args[0] === "string" && /^[A-Z_]+$/u.test(args[0]) ? args[0] : "GUARD";
              console.info(`R06_STORAGE_FAILURE ${JSON.stringify({ operation: String(key), slot, name, code })}`);
            }
            throw error;
          });
        };
      },
    });
    const protocol = new GuardedRestore(observed);
    const plan = { operationId: "r06-native-synthetic", currentSha256: oldHash, incomingSha256: incomingHash };
    if (mode === "INTERRUPT") {
      pendingProbe().write(JSON.stringify({ rootUri: root.uri, beforeId: before.id, restoredId: restored.id, oldHash } satisfies InterruptedProbe));
      const move = storage.moveExclusive.bind(storage);
      storage.moveExclusive = async (from, to) => {
        await move(from, to);
        if (from === "INCOMING" && to === "LIVE") {
          console.info("R06_INTERRUPT_READY AFTER_FILE_SWITCH_BEFORE_COMMIT");
          await new Promise<void>(() => { /* ADB kills this process; no simulated exception/rollback. */ });
        }
      };
    }
    stage = "GUARDED_REPLACE";
    check("guarded_replace", await protocol.restore(plan) === "COMMITTED");
    check("independent_safety", (await expoFileSha256(storage.file("SAFETY"))).sha256 === oldHash);
    check("previous_preserved", (await expoFileSha256(storage.file("PREVIOUS"))).sha256 === oldHash);
    stage = "REOPEN_REPOSITORY";
    await clients.initialize();
    check("reopen_restored_client", (await clients.get(restored.id))?.emoji === "🏋️");
    check("snapshot_not_merge", await clients.get(before.id) === null);
    stage = "RESTORED_MEDIA";
    const lease = await live.acquire();
    let details: Record<string, unknown>;
    try {
      const row = await lease.connection.first<{ details_json: string; revision: number; archived_at: string }>("SELECT details_json, revision, archived_at FROM recipes WHERE id=?", [recipeId]);
      if (!row) throw new Error("R06_RESTORED_RECIPE_MISSING");
      check("native_recipe_revision_archive_preserved", row.revision === 7 && row.archived_at === "2026-10-23T08:00:00.000Z");
      details = JSON.parse(row.details_json) as Record<string, unknown>;
      check("native_recipe_json_parity", JSON.stringify({ ...details, photoUri: originalPhoto.uri }) === JSON.stringify(photoDetails));
    } finally { await live.release(); }
    const restoredPhoto = new File(String(details.photoUri));
    check("native_photo_private_relocation", restoredPhoto.uri.startsWith(`${newImages.uri.replace(/\/$/u, "")}/`) && restoredPhoto.uri !== originalPhoto.uri);
    check("native_photo_exact_bytes", (await expoFileSha256(restoredPhoto)).sha256 === imageHash && restoredPhoto.size === image.length);
    const dimensions = await Image.getSize(restoredPhoto.uri);
    check("native_photo_decoder_accepts", dimensions.width === 1 && dimensions.height === 1);
    await clients.create({ displayName: "R06 SYNTHETIC AFTER RESTORE" });
    await clients.close();
    const after = (await expoFileSha256(liveFile)).sha256;
    stage = "REPLAY";
    check("receipt_replay", await protocol.restore(plan) === "COMMITTED");
    check("replay_preserves_later_writes", (await expoFileSha256(liveFile)).sha256 === after);
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((item) => item.passed), elapsedMs: Date.now() - started };
  } catch (error) {
    const code = error instanceof RestoreProtocolError || error instanceof LocalFileHashError || error instanceof DatabaseCompatibilityError || error instanceof SnapshotError
      ? error.code : "NATIVE_API_FAILED";
    console.info(`R06_PROBE_FAILURE ${JSON.stringify({ stage, code, checks })}`);
    throw error;
  } finally { await historic.close(); await clients.close(); }
}
