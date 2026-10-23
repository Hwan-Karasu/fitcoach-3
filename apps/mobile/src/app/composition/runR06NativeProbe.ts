import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { uuid } from "expo-modules-core";
import { Image } from "react-native";
import { RestoreProtocolError, SnapshotError } from "../../features/backup/public.ts";
import { ExpoRestoreStorage } from "../../features/backup/data/ExpoRestoreStorage.ts";
import { ExpoSqliteBackup } from "../../features/backup/data/ExpoSqliteBackup.ts";
import { expoSnapshotMedia } from "../../features/backup/data/ExpoSnapshotMedia.ts";
import { expoSnapshotSql } from "../../features/backup/data/ExpoSnapshotSql.ts";
import { snapshotContentSha256 } from "../../features/backup/data/SnapshotContentHash.ts";
import { createLocalRepositories } from "./createLocalRepositories.ts";
import systemCatalogJson from "../../features/exercises/data/system-catalog.generated.json";
import type { SystemCatalog } from "../../features/exercises/public.ts";
import { RuntimeCommandGate } from "../runtime/RuntimeCommandGate.ts";
import { RuntimeMaintenance } from "../runtime/RuntimeMaintenance.ts";
import { WorkflowDatabaseLease } from "../runtime/WorkflowDatabaseLease.ts";
import { BootCoordinator } from "../bootstrap/BootCoordinator.ts";
import { recoverLocalRestore } from "./recoverProductionRestore.ts";
import { restoreWithRuntimeJournal } from "../runtime/JournaledRestore.ts";
import { ExpoRuntimeRestoreJournal } from "./ExpoRuntimeRestoreJournal.ts";
import { createClientCardWorkflow } from "../../workflows/saveClientCard.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../../shared/db/IsolatedSqliteConnection.ts";
import { expoFileSha256 } from "../../shared/files/ExpoFileSha256.ts";
import { LocalFileHashError } from "../../shared/files/LocalFileSha256.ts";
import { DatabaseCompatibilityError } from "../../shared/db/DatabaseIdentity.ts";
import type { RestorePlan, RestoreStorage } from "../../features/backup/public.ts";
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
  readonly incomingHash: string;
  readonly operationId: string;
}
const pendingProbe = () => new File(Paths.document, "r06-native-pending.json");
const databaseAt = (root: Directory, name: string) => new SharedSqliteDatabase(() => openIsolatedSqliteConnection(
  () => SQLite.openDatabaseAsync(name, { useNewConnection: true }, root.uri), inspectProductionDatabase));

function probeRuntime(root: Directory, name: string, cold = false) {
  let handles = 0; let peak = 0; let opens = 0; let invalidations = 0; let ready = !cold;
  const database = new SharedSqliteDatabase(async () => {
    const connection = await openIsolatedSqliteConnection(
      () => SQLite.openDatabaseAsync(name, { useNewConnection: true }, root.uri), inspectProductionDatabase);
    handles++; opens++; peak = Math.max(peak, handles);
    return { ...connection, async close() { await connection.close(); handles--; } };
  });
  const owners = createLocalRepositories(database, PRODUCTION_WORKSPACE_ID, systemCatalogJson as SystemCatalog);
  const workflow = new WorkflowDatabaseLease(database); const commands = new RuntimeCommandGate();
  const card = commands.port(createClientCardWorkflow((task) => workflow.write(task), owners.clients.cardParticipant, owners.questionnaire.answersParticipant));
  const initialize = async () => { await owners.initialize(); workflow.resume(); ready = true; };
  const close = async () => {
    const results = await Promise.allSettled([owners.close(), workflow.close()]);
    if (results.some((result) => result.status === "rejected")) throw new Error("R06_OWNER_CLOSE_FAILED");
  };
  const maintenance = new RuntimeMaintenance({ database, commands, drainBackground: async () => undefined,
    closeOwners: close, shouldReopen: () => ready, reopen: initialize, invalidate: () => { invalidations++; } });
  return { database, owners, card, commands, maintenance, initialize, close,
    primeWorkflow: () => commands.run(() => workflow.write((tx) => tx.first("SELECT id FROM workspaces WHERE id=?", [PRODUCTION_WORKSPACE_ID]))),
    get handles() { return handles; }, get opens() { return opens; }, get peak() { return peak; },
    get invalidations() { return invalidations; }, cold: () => { ready = false; } };
}

async function recoverInterruptedProbe(): Promise<R06NativeReport> {
  const started = Date.now();
  const saved: unknown = JSON.parse(await pendingProbe().text());
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("R06_PENDING_INVALID");
  const state = saved as Partial<InterruptedProbe>;
  const prefix = `${Paths.document.uri.replace(/\/$/u, "")}/r06-native/`;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  if (typeof state.rootUri !== "string" || !state.rootUri.startsWith(prefix) || !/^run-[a-z0-9-]+\/?$/u.test(state.rootUri.slice(prefix.length)) ||
    typeof state.beforeId !== "string" || !uuid.test(state.beforeId) || typeof state.restoredId !== "string" || !uuid.test(state.restoredId) ||
    typeof state.oldHash !== "string" || !/^[a-f0-9]{64}$/u.test(state.oldHash) ||
    typeof state.incomingHash !== "string" || !/^[a-f0-9]{64}$/u.test(state.incomingHash) ||
    typeof state.operationId !== "string" || !uuid.test(state.operationId)) throw new Error("R06_PENDING_INVALID");
  const root = new Directory(state.rootUri);
  const runtime = probeRuntime(root, "live.db", true); const clients = runtime.owners.clients;
  const journal = new Directory(root, "journal");
  const storage = new ExpoRestoreStorage({ live: new File(root, "live.db"), directory: new Directory(journal, "jobs", state.operationId),
    withClosedDatabase: (task) => runtime.maintenance.withClosedDatabase(task), inspectDatabase: inspectProductionDatabase });
  const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => { checks.push({ name, passed }); if (!passed) throw new Error("R06_RECOVERY_CHECK_FAILED"); };
  try {
    const events: string[] = [];
    const boot = new BootCoordinator({ fallbackThemeId: "graphite-teal", recoverBeforeOpen: async () => {
      events.push("recovery");
      await recoverLocalRestore(runtime.maintenance, journal, storage.file("LIVE"));
      check("native_cold_recovery_before_runtime_open", runtime.opens === 0 && runtime.handles === 0);
      check("native_kill_rolls_back", JSON.parse(await new File(storage.file("SAFETY").parentDirectory, "guard.json").text()).phase === "ROLLED_BACK");
      check("native_kill_original_bytes", (await expoFileSha256(storage.file("LIVE"))).sha256 === state.oldHash);
      check("native_kill_safety_intact", (await expoFileSha256(storage.file("SAFETY"))).sha256 === state.oldHash);
      check("native_kill_rejected_preserved", storage.file("REJECTED").exists);
    }, prepareWorkspace: async () => { events.push("workspace"); return { id: PRODUCTION_WORKSPACE_ID }; },
    openDatabase: async () => { events.push("database"); await prepareProductionDatabase(runtime.database); await runtime.initialize(); },
    loadThemePreference: async () => (await runtime.owners.settings.readAppearance()) ?? { themeId: null, accentId: null } });
    check("native_boot_ready_after_recovery", (await boot.start()).kind === "APP_READY");
    check("native_recovery_workspace_database_order", events.join(",") === "recovery,workspace,database");
    check("native_all_owners_reopened_after_kill", runtime.owners.ownerCount === 15 && runtime.handles === 1 && runtime.peak === 1);
    check("native_kill_original_client", (await clients.get(state.beforeId))?.displayName === "R06 SYNTHETIC BEFORE");
    check("native_kill_no_partial_merge", await clients.get(state.restoredId) === null);
    await runtime.card.save(null, { displayName: "R06 SYNTHETIC AFTER RECOVERY" }, {});
    await runtime.close(); runtime.cold();
    const later = (await expoFileSha256(storage.file("LIVE"))).sha256;
    await recoverLocalRestore(runtime.maintenance, journal, storage.file("LIVE"));
    check("native_kill_idempotent_recovery", (await expoFileSha256(storage.file("LIVE"))).sha256 === later && runtime.handles === 0);
    pendingProbe().delete();
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((item) => item.passed), elapsedMs: Date.now() - started };
  } finally { await runtime.close(); }
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
  const operationId = uuid.v4();
  const journal = new Directory(root, "journal");
  const restoreDirectory = new Directory(journal, "jobs", operationId); restoreDirectory.create({ intermediates: true });
  const liveFile = new File(root, "live.db"); const sourceFile = new File(root, "source.db");
  const runtime = probeRuntime(root, "live.db"); const live = runtime.database; const clients = runtime.owners.clients;
  const source = databaseAt(root, "source.db");
  const historicOwners = createLocalRepositories(source, PRODUCTION_WORKSPACE_ID, systemCatalogJson as SystemCatalog);
  const historic = historicOwners.clients;
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
    await prepareProductionDatabase(live); await runtime.initialize();
    const before = (await runtime.card.save(null, { displayName: "R06 SYNTHETIC BEFORE" }, {})).client;
    check("native_all_owners_and_workflow_initialized", runtime.owners.ownerCount === 15 && runtime.handles === 1);
    await runtime.close();
    stage = "PREPARE_SOURCE";
    await prepareProductionDatabase(source); await historicOwners.initialize();
    const restored = await historic.create({ displayName: "R06 SYNTHETIC RESTORED", emoji: "🏋️" });
    await historicOwners.close();
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
      withClosedDatabase: (task) => runtime.maintenance.withClosedDatabase(async () => {
        check("native_all_runtime_holders_closed_before_files", runtime.handles === 0); return task();
      }), inspectDatabase: inspectProductionDatabase });
    // Reopen a holder: the adapter's gate must release it before touching files.
    await runtime.initialize();
    // A read-only workflow transaction acquires its real holder without changing the pinned file.
    await runtime.primeWorkflow();
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
    const runtimeJournal = new ExpoRuntimeRestoreJournal(journal);
    const protocol = { restore: (plan: RestorePlan) => restoreWithRuntimeJournal({ version: 1, ...plan }, observed, runtimeJournal) };
    const currentHash = (await expoFileSha256(liveFile)).sha256;
    const plan = { operationId, currentSha256: currentHash, incomingSha256: incomingHash };
    if (mode === "INTERRUPT") {
      pendingProbe().write(JSON.stringify({ rootUri: root.uri, beforeId: before.id, restoredId: restored.id,
        oldHash: currentHash, incomingHash, operationId } satisfies InterruptedProbe));
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
    check("independent_safety", (await expoFileSha256(storage.file("SAFETY"))).sha256 === currentHash);
    check("previous_preserved", (await expoFileSha256(storage.file("PREVIOUS"))).sha256 === currentHash);
    stage = "REOPEN_REPOSITORY";
    check("native_runtime_reopened_and_invalidated", runtime.handles === 1 && runtime.peak === 1 && runtime.invalidations === 1 && runtime.maintenance.state === "ACTIVE");
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
    const afterClient = (await runtime.card.save(null, { displayName: "R06 SYNTHETIC AFTER RESTORE" }, {})).client;
    await runtime.close();
    const after = (await expoFileSha256(liveFile)).sha256;
    stage = "REPLAY";
    check("receipt_replay", await protocol.restore(plan) === "COMMITTED");
    check("native_workflow_works_after_reopen", (await clients.get(afterClient.id))?.displayName === afterClient.displayName);
    await runtime.close(); runtime.cold();
    check("replay_preserves_later_writes", (await expoFileSha256(liveFile)).sha256 === after);
    await recoverLocalRestore(runtime.maintenance, journal, liveFile);
    check("native_completed_journal_preserves_later_writes", (await expoFileSha256(liveFile)).sha256 === after && runtime.handles === 0);
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((item) => item.passed), elapsedMs: Date.now() - started };
  } catch (error) {
    const code = error instanceof RestoreProtocolError || error instanceof LocalFileHashError || error instanceof DatabaseCompatibilityError || error instanceof SnapshotError
      ? error.code : "NATIVE_API_FAILED";
    console.info(`R06_PROBE_FAILURE ${JSON.stringify({ stage, code, checks })}`);
    throw error;
  } finally { await historicOwners.close(); await runtime.close(); }
}
