import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { GuardedRestore, RestoreProtocolError } from "../../features/backup/public.ts";
import { ExpoRestoreStorage } from "../../features/backup/data/ExpoRestoreStorage.ts";
import { DevClientRepository } from "../../features/clients/data/DevClientRepository.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../../shared/db/IsolatedSqliteConnection.ts";
import { expoFileSha256 } from "../../shared/files/ExpoFileSha256.ts";
import { LocalFileHashError } from "../../shared/files/LocalFileSha256.ts";
import { DatabaseCompatibilityError } from "../../shared/db/DatabaseIdentity.ts";
import type { RestoreStorage } from "../../features/backup/public.ts";
import { inspectProductionDatabase, prepareProductionDatabase, PRODUCTION_WORKSPACE_ID } from "./productionDatabase.ts";

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
  let stage = "PREPARE_LIVE";
  try {
    await prepareProductionDatabase(live); await clients.initialize();
    const before = await clients.create({ displayName: "R06 SYNTHETIC BEFORE" });
    await clients.close();
    stage = "PREPARE_SOURCE";
    await prepareProductionDatabase(source); await historic.initialize();
    const restored = await historic.create({ displayName: "R06 SYNTHETIC RESTORED", emoji: "🏋️" });
    await historic.close();
    stage = "HASH_CLOSED_FILES";
    const oldHash = (await expoFileSha256(liveFile)).sha256;
    const sourceHash = (await expoFileSha256(sourceFile)).sha256;
    check("streaming_sha256", oldHash.length === 64 && sourceHash.length === 64 && oldHash !== sourceHash);
    stage = "NATIVE_BACKUP";
    const sourceHandle = await SQLite.openDatabaseAsync("source.db", { useNewConnection: true }, root.uri);
    const snapshot = await SQLite.openDatabaseAsync("incoming.db", { useNewConnection: true }, restoreDirectory.uri);
    try {
      await sourceHandle.execAsync("PRAGMA query_only=ON");
      await SQLite.backupDatabaseAsync({ sourceDatabase: sourceHandle, destDatabase: snapshot });
      await snapshot.execAsync("PRAGMA journal_mode=DELETE");
    } finally { await snapshot.closeAsync(); await sourceHandle.closeAsync(); }
    check("native_backup_preserves_source", (await expoFileSha256(sourceFile)).sha256 === sourceHash);
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
    await clients.create({ displayName: "R06 SYNTHETIC AFTER RESTORE" });
    await clients.close();
    const after = (await expoFileSha256(liveFile)).sha256;
    stage = "REPLAY";
    check("receipt_replay", await protocol.restore(plan) === "COMMITTED");
    check("replay_preserves_later_writes", (await expoFileSha256(liveFile)).sha256 === after);
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((item) => item.passed), elapsedMs: Date.now() - started };
  } catch (error) {
    const code = error instanceof RestoreProtocolError || error instanceof LocalFileHashError || error instanceof DatabaseCompatibilityError
      ? error.code : "NATIVE_API_FAILED";
    console.info(`R06_PROBE_FAILURE ${JSON.stringify({ stage, code, passed: checks.map((item) => item.name) })}`);
    throw error;
  } finally { await historic.close(); await clients.close(); }
}
