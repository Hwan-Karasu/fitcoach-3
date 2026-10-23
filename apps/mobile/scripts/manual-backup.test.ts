import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ManualBackupService } from "../src/features/backup/application/ManualBackupService.ts";
import { BackupStorageError, type BackupDestination, type PublishedBackup } from "../src/features/backup/domain/BackupPublication.ts";
import { ManualBackupError, parseBackupLocation, type ManualBackupState } from "../src/features/backup/domain/ManualBackupPort.ts";
import { RuntimeCommandGate } from "../src/app/runtime/RuntimeCommandGate.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createLocalRepositories } from "../src/app/composition/createLocalRepositories.ts";
import { prepareProductionDatabase, PRODUCTION_WORKSPACE_ID as WS } from "../src/app/composition/productionDatabase.ts";
import type { SystemCatalog } from "../src/features/exercises/domain/ExerciseModel.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";
import { createSqliteBackup, prepareBackupForRestore, validateSqliteBackup } from "../../../scripts/r06/SqliteBackup.ts";

type Options = ConstructorParameters<typeof ManualBackupService>[0];
const artifact = { sourceUri: "file:///private/synthetic.atbackup", backupId: "10000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-23T15:24:05.000Z", sha256: "a".repeat(64), bytes: 12288 };
const receipt: PublishedBackup = { uri: "content://media/external_primary/downloads/42",
  filename: "athlete-diary-20261023-152405-10000000-0000-4000-8000-000000000001.atbackup", sha256: artifact.sha256, bytes: artifact.bytes };
const picked: BackupDestination = { kind: "DIRECTORY", uri: "content://documents/tree/primary%3ASynthetic" };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { release, promise }; }
function world(overrides: Partial<Options> = {}) {
  let destination: BackupDestination = { kind: "DOWNLOADS" }; let selected: BackupDestination | null = picked;
  let failPublish = false; let failWrite = false;
  const calls = { prepare: 0, cleanup: 0, picker: 0, preferenceWrites: 0, publications: [] as BackupDestination[] };
  const commands = new RuntimeCommandGate();
  const options: Options = {
    enabled: true, locations: { read: async () => destination, write: async (next) => {
      if (failWrite) throw new ManualBackupError("BACKUP_FOLDER_UNAVAILABLE"); destination = next; calls.preferenceWrites++;
    } },
    publisher: { available: true, supportsDownloads: true, publish: async (_file, target) => {
      calls.publications.push(target); if (failPublish) throw new BackupStorageError("BACKUP_DESTINATION_UNAVAILABLE"); return receipt;
    } },
    prepare: async () => { calls.prepare++; return artifact; }, cleanup: async () => { calls.cleanup++; },
    chooseDirectory: async () => { calls.picker++; return selected; }, run: (task) => commands.run(task), ...overrides,
  };
  return { options, service: new ManualBackupService(options), commands, calls, get destination() { return destination; },
    select: (value: BackupDestination | null) => { selected = value; }, failPublish: () => { failPublish = true; }, failWrite: () => { failWrite = true; } };
}

test("R06 manual copy waits for verified publication and cleanup; duplicate export cannot open a second picker", async () => {
  const writing = latch(); const cleanup = latch();
  const w = world({ publisher: { available: true, supportsDownloads: true, publish: async () => { await writing.promise; return receipt; } },
    cleanup: () => cleanup.promise });
  const states: ManualBackupState["phase"][] = [];
  const off = w.service.subscribe(() => states.push(w.service.state.phase));
  const saving = w.service.createNow(); await tick();
  const publishingState = w.service.state;
  assert.equal(publishingState.phase, "PUBLISHING"); assert.equal(publishingState.lastSaved, null);
  assert.deepEqual(await w.service.exportElsewhere(), { kind: "FAILED", code: "BACKUP_BUSY" });
  assert.equal(w.calls.picker, 0);
  let drained = false; w.commands.pause(); const draining = w.commands.idle().then(() => { drained = true; });
  writing.release(); await tick(); assert.equal(drained, false); assert.equal(w.service.state.phase, "PUBLISHING");
  cleanup.release(); assert.equal((await saving).kind, "SAVED"); await draining;
  assert.equal(w.service.state.phase, "IDLE"); assert.equal(w.service.state.lastSaved?.filename, receipt.filename);
  assert.ok(states.includes("CREATING") && states.includes("PUBLISHING")); off();
});

test("R06 cancelling export/folder selection does not create a snapshot or change the current destination", async () => {
  const w = world(); w.select(null);
  assert.equal((await w.service.exportElsewhere()).kind, "CANCELLED");
  assert.equal((await w.service.chooseFolder()).kind, "CANCELLED");
  assert.equal(w.calls.prepare, 0); assert.equal(w.calls.preferenceWrites, 0); assert.deepEqual(w.calls.publications, []);
  assert.deepEqual(w.destination, { kind: "DOWNLOADS" }); assert.equal(w.service.state.error, null);
});

test("R06 chosen folder is used after controller recreation; one-off export never changes it", async () => {
  const w = world(); assert.equal((await w.service.chooseFolder()).kind, "UPDATED");
  const reopened = new ManualBackupService(w.options); await reopened.refresh();
  assert.equal(reopened.state.location, "DIRECTORY"); assert.equal((await reopened.createNow()).kind, "SAVED");
  assert.equal(w.calls.picker, 1, "normal backup must not ask for the folder again");
  assert.deepEqual(w.calls.publications, [picked]);
  const another: BackupDestination = { kind: "DIRECTORY", uri: "content://documents/tree/primary%3AElsewhere" };
  w.select(another); assert.equal((await reopened.exportElsewhere()).kind, "SAVED");
  assert.deepEqual(w.destination, picked); assert.equal(w.calls.preferenceWrites, 1);
  assert.deepEqual(w.calls.publications, [picked, another]);
  assert.equal((await reopened.useDefaultFolder()).kind, "UPDATED"); assert.deepEqual(w.destination, { kind: "DOWNLOADS" });
});

test("R06 failed publication retains the earlier success and returns only a known error; source job is cleaned", async () => {
  const w = world(); await w.service.createNow(); const previous = w.service.state.lastSaved;
  w.failPublish(); assert.deepEqual(await w.service.createNow(), { kind: "FAILED", code: "BACKUP_DESTINATION_UNAVAILABLE" });
  assert.strictEqual(w.service.state.lastSaved, previous); assert.equal(w.service.state.phase, "IDLE"); assert.equal(w.calls.cleanup, 2);
});

test("R06 a wrong native receipt cannot become success or overwrite the previous summary", async () => {
  const w = world({ publisher: { available: true, supportsDownloads: true, publish: async () => ({ ...receipt, sha256: "b".repeat(64) }) } });
  assert.deepEqual(await w.service.createNow(), { kind: "FAILED", code: "BACKUP_PUBLICATION_INVALID" });
  assert.equal(w.service.state.lastSaved, null); assert.equal(w.calls.cleanup, 1);
});

test("R06 source failure never invokes the external publisher or exposes a native path", async () => {
  const w = world({ prepare: async () => { throw new Error("PRIVATE_SOURCE_PATH_AND_PLATFORM_DETAIL"); } });
  assert.deepEqual(await w.service.createNow(), { kind: "FAILED", code: "BACKUP_SOURCE_UNAVAILABLE" });
  assert.deepEqual(w.calls.publications, []); assert.equal(w.calls.cleanup, 0);
});

test("R06 absent native capability and disabled development mode do not touch the source, preferences or picker", async () => {
  for (const overrides of [{ enabled: false }, { publisher: { available: false, supportsDownloads: false, publish: async () => receipt } }]) {
    const w = world(overrides);
    for (const action of [() => w.service.refresh(), () => w.service.createNow(), () => w.service.exportElsewhere(), () => w.service.chooseFolder()]) {
      assert.deepEqual(await action(), { kind: "FAILED", code: "BACKUP_STORAGE_UNAVAILABLE" });
    }
    assert.equal(w.service.state.available, false); assert.equal(w.calls.prepare, 0); assert.equal(w.calls.preferenceWrites, 0); assert.equal(w.calls.picker, 0);
  }
});

test("R06 unsupported default location fails before preparing an internal copy and still permits explicit export", async () => {
  const w = world({ publisher: { available: true, supportsDownloads: false, publish: async () => receipt } });
  assert.deepEqual(await w.service.createNow(), { kind: "FAILED", code: "BACKUP_LOCATION_UNSUPPORTED" });
  assert.equal(w.calls.prepare, 0); assert.equal((await w.service.exportElsewhere()).kind, "SAVED");
});

test("R06 failed folder write keeps the old destination; corrupt saved preferences never fall back silently", async () => {
  const w = world(); await w.service.refresh(); w.failWrite();
  assert.deepEqual(await w.service.chooseFolder(), { kind: "FAILED", code: "BACKUP_FOLDER_UNAVAILABLE" });
  assert.equal(w.service.state.location, "DOWNLOADS"); assert.deepEqual(w.destination, { kind: "DOWNLOADS" });
  for (const invalid of [null, { version: 2, kind: "DOWNLOADS" }, { version: 1, kind: "DIRECTORY", uri: "file:///unknown" },
    { version: 1, kind: "DOWNLOADS", extra: true }]) assert.throws(() => parseBackupLocation(invalid), ManualBackupError);
  assert.deepEqual(parseBackupLocation({ version: 1, ...picked }), picked);
});

test("R06 unavailable preference can be repaired or bypassed by one-off export without mutating it", async () => {
  const writes: BackupDestination[] = [];
  const w = world({ locations: { read: async () => { throw new ManualBackupError("BACKUP_FOLDER_UNAVAILABLE"); }, write: async (value) => { writes.push(value); } } });
  assert.equal((await w.service.refresh()).kind, "FAILED"); assert.equal((await w.service.exportElsewhere()).kind, "SAVED");
  assert.deepEqual(writes, []); assert.equal((await w.service.useDefaultFolder()).kind, "UPDATED"); assert.deepEqual(writes, [{ kind: "DOWNLOADS" }]);
});

test("R06 screen unsubscribe and a failed private cleanup do not lose the verified external copy", async () => {
  let notified = 0;
  const w = world({ cleanup: async () => { throw new Error("PRIVATE_CLEANUP_IO_FAILURE"); } });
  const off = w.service.subscribe(() => { notified++; }); off();
  w.service.subscribe(() => { throw new Error("BROKEN_OBSERVER"); });
  assert.equal((await w.service.createNow()).kind, "SAVED"); assert.equal(notified, 0); assert.equal(w.service.state.error, null);
});

test("R06 manual operation publishes a real self-contained SQLite snapshot, usable after the original install is removed", async () => {
  const root = mkdtempSync(join(tmpdir(), "athlete-manual-"));
  const privateRoot = join(root, "private"); const publicRoot = join(root, "public"); mkdirSync(privateRoot); mkdirSync(publicRoot);
  const sourceFile = join(privateRoot, "live.db"); const privateCopy = join(privateRoot, "copy.atbackup");
  const database = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(sourceFile)));
  const catalog = JSON.parse(readFileSync(new URL("../src/features/exercises/data/system-catalog.generated.json", import.meta.url), "utf8")) as SystemCatalog;
  const owners = createLocalRepositories(database, WS, catalog); const gate = new RuntimeCommandGate();
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  let external = "";
  try {
    await prepareProductionDatabase(database); await owners.initialize();
    const client = await owners.clients.create({ displayName: "Синтетический атлет 🏋️" });
    const service = new ManualBackupService({ enabled: true, locations: { read: async () => ({ kind: "DOWNLOADS" }), write: async () => undefined },
      chooseDirectory: async () => { throw new Error("MANUAL_DEFAULT_MUST_NOT_ASK"); }, run: (task) => gate.run(task),
      prepare: async () => {
        const source = new DatabaseSync(sourceFile, { readOnly: true });
        const metadata = { backupId: randomUUID(), createdAt: "2026-10-23T15:24:05.000Z" };
        try { await createSqliteBackup(source, join(privateRoot, "copy.partial"), privateCopy, metadata); }
        finally { source.close(); }
        return { sourceUri: pathToFileURL(privateCopy).href, ...metadata, sha256: sha(privateCopy), bytes: statSync(privateCopy).size };
      }, cleanup: async (snapshot) => { rmSync(fileURLToPath(snapshot.sourceUri)); },
      publisher: { available: true, supportsDownloads: true, publish: async (snapshot) => {
        external = join(publicRoot, "independent.atbackup");
        copyFileSync(fileURLToPath(snapshot.sourceUri), external, constants.COPYFILE_EXCL);
        // Native IO is the replaced platform boundary; validation of the actual file remains real.
        const manifest = await validateSqliteBackup(external);
        assert.equal(manifest.backupId, snapshot.backupId);
        return { uri: "content://synthetic/downloads/42", filename: `athlete-diary-20261023-152405-${snapshot.backupId}.atbackup`, bytes: statSync(external).size, sha256: sha(external) };
      } },
    });
    assert.equal((await service.createNow()).kind, "SAVED"); assert.equal(existsSync(privateCopy), false);
    assert.equal((await owners.clients.get(client.id))?.displayName, "Синтетический атлет 🏋️");
    await owners.close(); rmSync(privateRoot, { recursive: true });
    assert.ok(existsSync(external)); assert.equal(readFileSync(external).subarray(0, 16).toString(), "SQLite format 3\0");
    const restoredFile = join(root, "restored.db"); await prepareBackupForRestore(external, restoredFile);
    const restored = createLocalRepositories(new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(restoredFile))), WS, catalog);
    try { await restored.initialize(); assert.equal((await restored.clients.get(client.id))?.displayName, "Синтетический атлет 🏋️"); }
    finally { await restored.close(); }
  } finally { await owners.close(); rmSync(root, { recursive: true, force: true }); }
});
