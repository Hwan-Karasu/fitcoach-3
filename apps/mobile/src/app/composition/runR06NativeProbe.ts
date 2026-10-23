import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { uuid } from "expo-modules-core";
import { Image } from "react-native";
import { ReturnPointCompletion, RestoreActionsService, parseReturnPointState, RestoreProtocolError, SnapshotError } from "../../features/backup/public.ts";
import { ExpoRestoreJobs } from "./ExpoRestoreJobs.ts";
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
import { parsePendingRuntimeRestore } from "../bootstrap/recoverRuntimeRestore.ts";
import { recoverLocalRestore } from "./recoverProductionRestore.ts";
import { restoreWithRuntimeJournal } from "../runtime/JournaledRestore.ts";
import { ExpoRuntimeRestoreJournal } from "./ExpoRuntimeRestoreJournal.ts";
import { ExpoReturnPointStore } from "../../features/backup/data/ExpoReturnPointStore.ts";
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
  readonly expectCommit: boolean;
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
    typeof state.operationId !== "string" || !uuid.test(state.operationId) || typeof state.expectCommit !== "boolean") throw new Error("R06_PENDING_INVALID");
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
      check(state.expectCommit ? "native_kill_completes_commit" : "native_kill_rolls_back",
        JSON.parse(await new File(storage.file("SAFETY").parentDirectory, "guard.json").text()).phase === (state.expectCommit ? "COMPLETED" : "ROLLED_BACK"));
      check(state.expectCommit ? "native_kill_committed_bytes" : "native_kill_original_bytes",
        (await expoFileSha256(storage.file("LIVE"))).sha256 === (state.expectCommit ? state.incomingHash : state.oldHash));
      check("native_kill_safety_intact", (await expoFileSha256(storage.file("SAFETY"))).sha256 === state.oldHash);
      check(state.expectCommit ? "native_kill_previous_preserved" : "native_kill_rejected_preserved",
        state.expectCommit ? (await expoFileSha256(storage.file("PREVIOUS"))).sha256 === state.oldHash : storage.file("REJECTED").exists);
      const points = new ExpoReturnPointStore(journal, { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
      const point = parseReturnPointState(await points.readState()).point;
      check(state.expectCommit ? "native_v2_committed_point_activated" : "native_v2_rollback_keeps_point_retired",
        state.expectCommit ? point?.operationId === state.operationId : point === null);
      if (state.expectCommit) { await points.verifyPoint(point!); check("native_v2_committed_point_valid", true); }
    }, prepareWorkspace: async () => { events.push("workspace"); return { id: PRODUCTION_WORKSPACE_ID }; },
    openDatabase: async () => { events.push("database"); await prepareProductionDatabase(runtime.database); await runtime.initialize(); },
    loadThemePreference: async () => (await runtime.owners.settings.readAppearance()) ?? { themeId: null, accentId: null } });
    check("native_boot_ready_after_recovery", (await boot.start()).kind === "APP_READY");
    check("native_recovery_workspace_database_order", events.join(",") === "recovery,workspace,database");
    check("native_all_owners_reopened_after_kill", runtime.owners.ownerCount === 15 && runtime.handles === 1 && runtime.peak === 1);
    check(state.expectCommit ? "native_kill_restored_client" : "native_kill_original_client",
      state.expectCommit ? (await clients.get(state.restoredId))?.displayName === "R06 SYNTHETIC RESTORED"
        : (await clients.get(state.beforeId))?.displayName === "R06 SYNTHETIC BEFORE");
    check("native_kill_no_partial_merge", await clients.get(state.expectCommit ? state.beforeId : state.restoredId) === null);
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
export async function runR06NativeProbe(mode: "NORMAL" | "ACTIONS" | "ACTIONS_RECOVERY" | "INTERRUPT" | "INTERRUPT_FINALIZATION" | "RECOVER" = "NORMAL"): Promise<R06NativeReport> {
  if (mode === "ACTIONS_RECOVERY") return recoverActionsProbe();
  if (mode === "RECOVER") return recoverInterruptedProbe();
  if (mode !== "NORMAL" && pendingProbe().exists) throw new Error("R06_PENDING_REHEARSAL_EXISTS");
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
  const liveImages = new Directory(root, "live-images"); liveImages.create();
  const livePhoto = new File(liveImages, "before-restore.png"); const liveRecipeId = uuid.v4();
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
    livePhoto.write(image);
    const imageHash = (await expoFileSha256(originalPhoto)).sha256;
    const seed = await SQLite.openDatabaseAsync("source.db", { useNewConnection: true }, root.uri);
    try {
      await seed.execAsync("PRAGMA foreign_keys=ON");
      await seed.runAsync(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, details_json, archived_at)
        VALUES (?, ?, ?, 10, 7, ?, ?, ?, ?)`, [recipeId, PRODUCTION_WORKSPACE_ID, "R06 SYNTHETIC RECIPE",
        "2026-10-23T08:00:00.000Z", "2026-10-23T08:00:00.000Z", JSON.stringify(photoDetails, null, 2), "2026-10-23T08:00:00.000Z"]);
    } finally { await seed.closeAsync(); }
    const liveSeed = await SQLite.openDatabaseAsync("live.db", { useNewConnection: true }, root.uri);
    try {
      await liveSeed.execAsync("PRAGMA foreign_keys=ON");
      await liveSeed.runAsync(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, details_json)
        VALUES (?, ?, ?, 10, 9, ?, ?, ?)`, [liveRecipeId, PRODUCTION_WORKSPACE_ID, "R06 SYNTHETIC BEFORE RECIPE",
        "2026-10-23T07:00:00.000Z", "2026-10-23T07:00:00.000Z", JSON.stringify({ ...photoDetails, photoUri: livePhoto.uri })]);
    } finally { await liveSeed.closeAsync(); }
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
    if (mode === "ACTIONS") {
      stage = "RESTORE_ACTIONS";
      await runtime.initialize();
      const makeJobs = () => new ExpoRestoreJobs({ root: journal, live: liveFile, images: liveImages,
        maintenance: runtime.maintenance, pick: async () => snapshotFile });
      let jobs = makeJobs();
      const service = () => new RestoreActionsService({ enabled: true, jobs, read: (task) => runtime.commands.run(task),
        ready: () => runtime.maintenance.state === "ACTIVE" });
      let actions = service();
      const actionCheck = (name: string, passed: boolean) => { check(name, passed); console.info(`R06_ACTIONS_CHECK ${name}`); };
      await actions.chooseFile(); const cancelled = actions.state.preview;
      actionCheck("native_actions_verified_preview_without_replacement", cancelled?.activeClients === 1 && cancelled.archivedClients === 0 &&
        (await clients.get(before.id)) !== null && (await clients.get(restored.id)) === null);
      await actions.cancelPreview();
      actionCheck("native_actions_cancel_cleans_only_own_preparation", !new Directory(journal, "jobs", cancelled!.id).exists &&
        livePhoto.exists && !liveImages.list().some((file) => file.name.startsWith(`restore-${cancelled!.id}-`)));
      await actions.chooseFile(); const staleId = actions.state.preview!.id;
      const intervening = (await runtime.card.save(null, { displayName: "R06 SYNTHETIC PREVIEW WRITE" }, {})).client;
      const stale = await actions.confirmPreview(staleId);
      actionCheck("native_actions_business_write_rejects_stale_preview", stale.kind === "FAILED" && stale.code === "RESTORE_STALE_PREVIEW" &&
        runtime.maintenance.state === "ACTIVE" && (await clients.get(intervening.id)) !== null && (await clients.get(restored.id)) === null);
      actionCheck("native_actions_stale_cleanup_preserves_source_and_live", !new Directory(journal, "jobs", staleId).exists && livePhoto.exists &&
        (await expoFileSha256(snapshotFile)).sha256 === snapshotHash);
      // A new adapter models the in-memory ownership loss of an abandoned pre-confirmation job.
      await jobs.prepareFile(); const orphanNames = new Directory(journal, "jobs").list().map((entry) => entry.name);
      jobs = makeJobs(); actions = service();
      await actions.chooseFile();
      actionCheck("native_actions_abandoned_preview_cleanup", orphanNames.filter((name) => name !== operationId).every((name) => !new Directory(journal, "jobs", name).exists));
      const restoreId = actions.state.preview!.id;
      actionCheck("native_actions_confirm_restores", (await actions.confirmPreview(restoreId)).kind === "RESTORED");
      actionCheck("native_actions_full_runtime_reopened_without_merge", runtime.handles === 1 && runtime.peak === 1 && runtime.owners.ownerCount === 15 &&
        (await clients.get(restored.id)) !== null && (await clients.get(before.id)) === null && (await clients.get(intervening.id)) === null);
      const restoredRecipe = await runtime.owners.nutrition.recipes.get(recipeId);
      actionCheck("native_actions_exact_restored_photo", restoredRecipe?.details?.photoUri !== null && restoredRecipe?.details?.photoUri !== undefined &&
        (await expoFileSha256(new File(restoredRecipe.details.photoUri))).sha256 === imageHash);
      const point = actions.state.point;
      actionCheck("native_actions_point_survives_job_cleanup", point?.id === restoreId && new File(journal, "jobs", restoreId, "return.atbackup").exists &&
        new File(journal, "jobs", restoreId, "guard.json").exists && !new File(journal, "jobs", restoreId, "safety.db").exists);
      livePhoto.delete();
      await actions.previewReturn();
      actionCheck("native_actions_return_preview_uses_full_point", actions.state.preview?.kind === "RETURN" && actions.state.preview.activeClients === 2);
      const returned = await actions.confirmPreview(actions.state.preview!.id);
      actionCheck("native_actions_return_consumes_without_reverse", returned.kind === "RETURNED" && actions.state.point === null &&
        (await clients.get(before.id)) !== null && (await clients.get(intervening.id)) !== null && (await clients.get(restored.id)) === null);
      const priorRecipe = await runtime.owners.nutrition.recipes.get(liveRecipeId);
      actionCheck("native_actions_return_photo_after_original_loss", priorRecipe?.details?.photoUri !== null && priorRecipe?.details?.photoUri !== undefined &&
        (await expoFileSha256(new File(priorRecipe.details.photoUri))).sha256 === imageHash);
      actionCheck("native_actions_old_restored_media_collected_after_return", !new File(restoredRecipe!.details!.photoUri!).exists);
      const later = (await runtime.card.save(null, { displayName: "R06 SYNTHETIC ACTIONS LATER" }, {})).client;
      await runtime.close(); runtime.cold();
      await recoverLocalRestore(runtime.maintenance, journal, liveFile); await runtime.initialize();
      actionCheck("native_actions_cleaned_receipts_keep_later_writes", (await clients.get(later.id)) !== null && await jobs.readPoint() === null);
      await actions.chooseFile();
      actionCheck("native_actions_second_restore_replaces_point", (await actions.confirmPreview(actions.state.preview!.id)).kind === "RESTORED" && actions.state.point !== null);
      actionCheck("native_actions_old_return_media_embedded_before_collection", !new File(priorRecipe!.details!.photoUri!).exists &&
        (await jobs.readPoint())?.id === actions.state.point!.id);
      const deleteId = actions.state.point!.id;
      actionCheck("native_actions_explicit_point_deletion", (await actions.deletePoint(deleteId)).kind === "POINT_DELETED" && actions.state.point === null);
      await runtime.close(); runtime.cold(); await recoverLocalRestore(runtime.maintenance, journal, liveFile); await runtime.initialize();
      actionCheck("native_actions_deleted_point_not_resurrected", await jobs.readPoint() === null && (await clients.get(restored.id)) !== null);
      actionCheck("native_actions_external_copy_unchanged", (await expoFileSha256(snapshotFile)).sha256 === snapshotHash);
      return { kind: "R06_NATIVE", checks, allPassed: checks.every((item) => item.passed), elapsedMs: Date.now() - started };
    }
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
    const points = new ExpoReturnPointStore(journal, { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
    const completion = new ReturnPointCompletion(points, { kind: "RESTORE", createPoint: (plan) => points.createPoint(plan, liveFile, liveImages) });
    const protocol = { restore: (plan: RestorePlan) => restoreWithRuntimeJournal({ version: 2, ...plan }, observed, runtimeJournal, completion) };
    const currentHash = (await expoFileSha256(liveFile)).sha256;
    const plan = { operationId, currentSha256: currentHash, incomingSha256: incomingHash };
    if (mode === "INTERRUPT" || mode === "INTERRUPT_FINALIZATION") {
      pendingProbe().write(JSON.stringify({ rootUri: root.uri, beforeId: before.id, restoredId: restored.id,
        oldHash: currentHash, incomingHash, operationId, expectCommit: mode === "INTERRUPT_FINALIZATION" } satisfies InterruptedProbe));
    }
    if (mode === "INTERRUPT_FINALIZATION") {
      points.writeState = async () => {
        console.info("R06_INTERRUPT_READY AFTER_COMMIT_BEFORE_POINT_PUBLICATION");
        await new Promise<void>(() => { /* Real process death, before atomic point state publication. */ });
      };
    }
    if (mode === "INTERRUPT") {
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
    const point = parseReturnPointState(await points.readState()).point;
    check("native_v2_point_activated", point?.operationId === operationId);
    if (point === null) throw new Error("R06_POINT_MISSING");
    await points.verifyPoint(point);
    check("native_v2_full_point_embeds_before_photo", (await backupDriver.validatePrivateSnapshot(points.pointFile(point))).media?.entries === 1);
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
    check("native_v2_point_survives_cold_boot", parseReturnPointState(await points.readState()).point?.operationId === operationId);
    stage = "RETURN_STAGING";
    liveImages.delete(); // Only synthetic originals; the full point must be independently sufficient.
    const returnId = uuid.v4(); const returnDirectory = new Directory(journal, "jobs", returnId); returnDirectory.create();
    await backupDriver.prepareForRestore(points.pointFile(point), new File(returnDirectory, "inspection.atbackup"), new File(returnDirectory, "incoming.db"),
      { files: expoSnapshotMedia(newImages), restoreId: returnId });
    await runtime.initialize(); await runtime.primeWorkflow();
    const returning = new ExpoRestoreStorage({ live: liveFile, directory: returnDirectory,
      withClosedDatabase: (task) => runtime.maintenance.withClosedDatabase(task), inspectDatabase: inspectProductionDatabase });
    const returnPlan = { version: 2, operationId: returnId, currentSha256: (await expoFileSha256(liveFile)).sha256,
      incomingSha256: (await expoFileSha256(returning.file("INCOMING"))).sha256 };
    stage = "RETURN_APPLY";
    check("native_v2_return_committed", await restoreWithRuntimeJournal(returnPlan, returning, runtimeJournal,
      new ReturnPointCompletion(points, { kind: "RETURN", expectedPointOperationId: point.operationId })) === "COMMITTED");
    check("native_v2_return_original_client_id", (await clients.get(before.id))?.displayName === "R06 SYNTHETIC BEFORE");
    check("native_v2_return_no_merge", await clients.get(restored.id) === null && await clients.get(afterClient.id) === null);
    const returnedLease = await live.acquire();
    let returnedPhotoUri: string;
    try {
      const row = await returnedLease.connection.first<{ revision: number; created_at: string; details_json: string }>(
        "SELECT revision, created_at, details_json FROM recipes WHERE id=?", [liveRecipeId]);
      check("native_v2_return_recipe_id_revision_dates", row?.revision === 9 && row.created_at === "2026-10-23T07:00:00.000Z");
      returnedPhotoUri = String((JSON.parse(row!.details_json) as { photoUri: string }).photoUri);
    } finally { await live.release(); }
    check("native_v2_return_embedded_photo_after_original_loss", !liveImages.exists && returnedPhotoUri !== livePhoto.uri &&
      (await expoFileSha256(new File(returnedPhotoUri))).sha256 === imageHash);
    check("native_v2_return_point_consumed_without_reverse", parseReturnPointState(await points.readState()).point === null &&
      !points.pointFile(point).exists && !new File(returnDirectory, "return.atbackup").exists);
    await runtime.card.save(null, { displayName: "R06 SYNTHETIC AFTER RETURN" }, {}); await runtime.close(); runtime.cold();
    const afterReturn = (await expoFileSha256(liveFile)).sha256;
    await recoverLocalRestore(runtime.maintenance, journal, liveFile);
    check("native_v2_consumed_point_not_resurrected", parseReturnPointState(await points.readState()).point === null &&
      (await expoFileSha256(liveFile)).sha256 === afterReturn && runtime.handles === 0);
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((item) => item.passed), elapsedMs: Date.now() - started };
  } catch (error) {
    const code = error instanceof RestoreProtocolError || error instanceof LocalFileHashError || error instanceof DatabaseCompatibilityError || error instanceof SnapshotError
      ? error.code : "NATIVE_API_FAILED";
    console.info(`R06_PROBE_FAILURE ${JSON.stringify({ stage, code, checks })}`);
    throw error;
  } finally { await historicOwners.close(); await runtime.close(); }
}

/** Focused replay of the last completed ACTIONS fixture; never reruns its expensive setup.
 * Only this spike's strictly named synthetic namespace is eligible, not production/legacy. */
async function recoverActionsProbe(): Promise<R06NativeReport> {
  const started = Date.now(); const parent = new Directory(Paths.document, "r06-native");
  const root = parent.list().filter((item): item is Directory => item instanceof Directory && /^run-\d{13}-[a-z0-9]+$/u.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name)).at(-1);
  if (!root) throw new Error("R06_ACTIONS_FIXTURE_MISSING");
  const journal = new Directory(root, "journal"); const pointer = new ExpoRuntimeRestoreJournal(journal);
  const pending = await pointer.readPending(); if (pending === null) throw new Error("R06_ACTIONS_FIXTURE_MISSING");
  const plan = parsePendingRuntimeRestore(pending.value);
  const owner = new File(journal, "jobs", plan.operationId, "owner.json");
  if (!owner.exists || owner.size > 200 || await owner.text() !== JSON.stringify({ kind: "athlete-restore-job", version: 1, operationId: plan.operationId })) throw new Error("R06_ACTIONS_FIXTURE_MISSING");
  const runtime = probeRuntime(root, "live.db"); const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => { checks.push({ name, passed }); if (!passed) throw new Error("R06_ACTIONS_RECOVERY_FAILED"); };
  try {
    await runtime.initialize();
    const later = (await runtime.card.save(null, { displayName: "R06 SYNTHETIC RECEIPT LATER" }, {})).client;
    const jobs = new ExpoRestoreJobs({ root: journal, live: new File(root, "live.db"), images: new Directory(root, "live-images"), maintenance: runtime.maintenance });
    const receipt = await jobs.recover();
    check("native_actions_recovery_returns_matching_terminal_receipt", receipt?.id === plan.operationId && receipt.outcome === "COMMITTED");
    const actions = new RestoreActionsService({ enabled: true, jobs, read: (task) => runtime.commands.run(task), ready: () => runtime.maintenance.state === "ACTIVE" });
    await actions.recover();
    check("native_actions_recovery_older_receipt_reports_checked", actions.state.notice === "CHECKED" && actions.state.phase === "IDLE" && actions.state.error === null);
    check("native_actions_recovery_keeps_later_writes_and_deleted_point", (await runtime.owners.clients.get(later.id)) !== null && await jobs.readPoint() === null && runtime.handles === 1 && runtime.peak === 1);
    return { kind: "R06_NATIVE", checks, allPassed: true, elapsedMs: Date.now() - started };
  } finally { await runtime.close(); }
}
