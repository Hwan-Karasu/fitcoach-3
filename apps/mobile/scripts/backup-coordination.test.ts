import assert from "node:assert/strict";
import test from "node:test";
import { AutomaticBackupService, AutomaticBackupError, AUTO_BACKUP_INTERVAL, AUTO_BUSY_RETRY, automaticFilename, automaticPrepareError,
  parseAutomaticCatalog, parseAutomaticFailure, BackupExclusive, BackupRunClock, ManualBackupService, ManualBackupError, manualPrepareError,
  classifyPrepareFailure, isStorageFull, SnapshotError, type AutomaticBackupFiles, type AutomaticBackupStore, type AutomaticCatalog,
  type AutomaticFailure, type BackupObserver, type BackupDestination, type PublishedBackup, type VerifiedBackupFile } from "../src/features/backup/public.ts";

const monday = Date.parse("2026-10-19T10:00:00.000Z");
const copy = <T>(value: T): T => structuredClone(value);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { release, promise }; }

function auto(exclusive = new BackupExclusive()) {
  let time = monday; let data = 1; let number = 0; let token = 0; let catalog: AutomaticCatalog | null = null; let failure: AutomaticFailure | null = null;
  let fail: AutomaticBackupError | null = null; let gate: Promise<void> | null = null; const external = new Map<string, PublishedBackup>();
  const stages: string[] = []; const calls = { prepare: 0, inspect: 0 };
  const store: AutomaticBackupStore = {
    readFailure: async () => copy(failure), writeFailure: async (value) => { failure = parseAutomaticFailure(copy(value)); },
    read: async () => catalog === null ? null : parseAutomaticCatalog(copy(catalog)), archive: async () => undefined,
    write: async (value) => { catalog = parseAutomaticCatalog(copy(value)); },
  };
  const files: AutomaticBackupFiles = {
    available: true,
    prepare: async (previous, observe) => {
      calls.prepare++; observe?.({ stage: "SNAPSHOT", done: null, total: null });
      if (gate !== null) await gate;
      observe?.({ stage: "CONTENT", done: 5, total: 10 });
      if (fail !== null) throw fail;
      if (previous === data.toString(16).padStart(64, "0")) return null;
      const id = `10000000-0000-4000-8000-${(++number).toString().padStart(12, "0")}`;
      return { backupId: id, createdAt: new Date(time).toISOString(), contentSha256: data.toString(16).padStart(64, "0"), sha256: number.toString(16).padStart(64, "0"), bytes: 4096 };
    },
    publish: async (p) => {
      external.set(p.backupId, { uri: `content://synthetic/${p.backupId}`, filename: automaticFilename(p), bytes: p.bytes, sha256: p.sha256 });
      return copy(external.get(p.backupId)!);
    },
    inspect: async (entry) => { calls.inspect++; return external.has(entry.backupId) ? "VALID" : "MISSING"; },
    verify: async () => undefined, remove: async (entry) => { external.delete(entry.backupId); }, cleanup: async () => undefined,
  };
  const make = () => new AutomaticBackupService({ enabled: true, exclusive, files, store, location: async () => ({ kind: "DOWNLOADS" } as BackupDestination),
    now: () => time, offset: () => 0, ready: () => true, run: (task) => task(), changeToken: () => token });
  const service = make();
  service.subscribe(() => { const p = service.state.progress; if (p !== null && stages.at(-1) !== p.stage) stages.push(p.stage); });
  return { service, make, calls, stages, external, get failure() { return failure; },
    later: (ms: number) => { time += ms; }, change: () => { data++; token++; }, write: () => { token++; },
    fail: (error: AutomaticBackupError | null) => { fail = error; }, hold: (promise: Promise<void> | null) => { gate = promise; } };
}
const artifact: VerifiedBackupFile = { sourceUri: "file:///private/synthetic.atbackup", backupId: "10000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-23T15:24:05.000Z", sha256: "a".repeat(64), bytes: 12288 };
const receipt: PublishedBackup = { uri: "content://media/external_primary/downloads/42",
  filename: "athlete-diary-20261023-152405-10000000-0000-4000-8000-000000000001.atbackup", sha256: artifact.sha256, bytes: artifact.bytes };
function manual(exclusive: BackupExclusive, prepare: (observe: BackupObserver) => Promise<VerifiedBackupFile> = async () => artifact) {
  const published: BackupDestination[] = [];
  const service = new ManualBackupService({ enabled: true, exclusive, locations: { read: async () => ({ kind: "DOWNLOADS" }), write: async () => undefined },
    publisher: { available: true, supportsDownloads: true, publish: async (_file, target) => { published.push(target); return receipt; } },
    prepare, cleanup: async () => undefined, chooseDirectory: async () => ({ kind: "DIRECTORY", uri: "content://documents/tree/primary%3ASynthetic" }),
    run: (task) => task() });
  return { service, published };
}

test("BKP-DIAG-1 сбой подготовки получает причину по этапу и ошибке, а не «проверьте место»", () => {
  const media = new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA");
  assert.equal(classifyPrepareFailure("space", new Error("SPACE_LOW")), "SPACE_LOW");
  assert.equal(classifyPrepareFailure("seal", new Error("Error code \r: database or disk is full")), "SPACE_LOW");
  assert.equal(classifyPrepareFailure("seal", new SnapshotError("SNAPSHOT_SPACE_LOW")), "SPACE_LOW");
  assert.equal(classifyPrepareFailure("seal", media), "MEDIA_UNAVAILABLE");
  assert.equal(classifyPrepareFailure("copy", new Error("Error code \u0005: database is locked")), "SNAPSHOT_FAILED");
  assert.equal(classifyPrepareFailure("identity", new Error("NOT_OWNED")), "SNAPSHOT_FAILED");
  assert.equal(classifyPrepareFailure("verify", new SnapshotError("SNAPSHOT_INVALID")), "ARCHIVE_INVALID");
  assert.equal(classifyPrepareFailure("digest", new Error("LOCAL_FILE_HASH_FAILED")), "WRITE_FAILED");
  assert.equal(classifyPrepareFailure("orphans", new SyntaxError("Unexpected token")), "UNKNOWN");
  assert.equal(isStorageFull(new Error("ENOSPC: no space left on device")), true);
  assert.equal(isStorageFull(new Error("SQLITE_BUSY")), false);
  assert.deepEqual([automaticPrepareError("seal", media).code, automaticPrepareError("seal", media).stage], ["AUTO_MEDIA_UNAVAILABLE", "seal"]);
  assert.equal(automaticPrepareError("orphans", new Error()).code, "AUTO_SOURCE_UNAVAILABLE");
  assert.deepEqual([manualPrepareError("verify", new Error()).code, manualPrepareError("verify", new Error()).stage], ["BACKUP_ARCHIVE_INVALID", "verify"]);
});

test("BKP-DIAG-1 статус сбоя прежних сборок {at,code} читается; новый хранит этап; чужой этап отвергается", () => {
  assert.deepEqual(parseAutomaticFailure({ code: "AUTO_SOURCE_UNAVAILABLE", at: 5 }), { code: "AUTO_SOURCE_UNAVAILABLE", at: 5 });
  assert.deepEqual(parseAutomaticFailure({ code: "AUTO_SNAPSHOT_FAILED", at: 5, stage: "copy" }), { code: "AUTO_SNAPSHOT_FAILED", at: 5, stage: "copy" });
  assert.throws(() => parseAutomaticFailure({ code: "AUTO_SNAPSHOT_FAILED", at: 5, stage: "/sdcard/x" }), AutomaticBackupError);
});

test("BKP-STAGE-1 секундомер закрывает этап при смене, прогресс внутри этапа не дробит его", () => {
  let now = 1000; const clock = new BackupRunClock(() => now);
  clock.mark("SNAPSHOT"); now += 40; clock.mark("CONTENT"); now += 100; clock.mark("CONTENT"); now += 60; clock.mark("PUBLISH"); now += 300;
  assert.deepEqual(clock.finish(), { totalMs: 500, stages: [{ stage: "SNAPSHOT", ms: 40 }, { stage: "CONTENT", ms: 160 }, { stage: "PUBLISH", ms: 300 }] });
});

test("BKP-STAGE-1 автокопия показывает этапы, после сбоя индикатор гаснет, причина и этап сохраняются после пересоздания", async () => {
  const w = auto(); await w.service.check(); w.later(AUTO_BACKUP_INTERVAL); w.change(); await w.service.check();
  assert.deepEqual(w.stages, ["SNAPSHOT", "CONTENT", "PUBLISH", "ROTATE"]);
  assert.equal(w.service.state.lastRun?.stages.map((s) => s.stage).join(","), "SNAPSHOT,CONTENT,PUBLISH,ROTATE");
  w.later(AUTO_BACKUP_INTERVAL); w.change(); w.fail(new AutomaticBackupError("AUTO_SNAPSHOT_FAILED", "copy")); await w.service.check();
  assert.equal(w.service.state.phase, "IDLE"); assert.equal(w.service.state.progress, null);
  assert.deepEqual([w.service.state.error, w.service.state.errorStage], ["AUTO_SNAPSHOT_FAILED", "copy"]);
  assert.deepEqual(w.failure, { code: "AUTO_SNAPSHOT_FAILED", at: monday + 2 * AUTO_BACKUP_INTERVAL, stage: "copy" });
  w.fail(null); const restarted = w.make(); w.hold(new Promise<void>(() => undefined)); void restarted.retry(); await tick(); await tick();
  assert.deepEqual([restarted.state.error, restarted.state.errorStage], ["AUTO_SNAPSHOT_FAILED", "copy"]);
});

test("BKP-PERF-3 без записей в базу проверка не копирует базу и не перечитывает файлы; запись, «Повторить» и перезапуск — полный путь", async () => {
  const w = auto(); await w.service.check(); w.later(AUTO_BACKUP_INTERVAL); w.change(); await w.service.check();
  assert.equal(w.calls.prepare, 1); assert.equal(w.external.size, 1);
  const inspected = w.calls.inspect;
  w.later(AUTO_BACKUP_INTERVAL); await w.service.check();
  assert.equal(w.calls.prepare, 1, "no commits since the last comparison"); assert.equal(w.calls.inspect, inspected);
  assert.equal(w.service.state.nextCheckAt, monday + 2 * AUTO_BACKUP_INTERVAL + AUTO_BACKUP_INTERVAL);
  w.later(AUTO_BACKUP_INTERVAL); w.write(); await w.service.check();
  assert.equal(w.calls.prepare, 2, "a commit (even with equal content) requires comparison"); assert.equal(w.external.size, 1, "equal content: no duplicate");
  w.later(AUTO_BACKUP_INTERVAL); await w.service.retry(); assert.equal(w.calls.prepare, 3, "explicit retry is always full");
  w.later(AUTO_BACKUP_INTERVAL); await w.make().check(); assert.equal(w.calls.prepare, 4, "first check after restart is full");
});

test("BKP-LOCK-1 автокопия не стартует во время ручной: откладывается на минуту, база не читается", async () => {
  const exclusive = new BackupExclusive(); const w = auto(exclusive); await w.service.check(); w.later(AUTO_BACKUP_INTERVAL); w.change();
  const preparing = latch(); const m = manual(exclusive, async () => { await preparing.promise; return artifact; });
  const saving = m.service.createNow(); await tick();
  assert.equal(m.service.state.phase, "CREATING"); assert.equal(exclusive.busy, true);
  await w.service.check();
  assert.equal(w.calls.prepare, 0); assert.equal(w.service.state.phase, "IDLE");
  assert.equal(w.service.state.nextCheckAt, monday + AUTO_BACKUP_INTERVAL + AUTO_BUSY_RETRY);
  preparing.release(); assert.equal((await saving).kind, "SAVED"); assert.equal(exclusive.busy, false);
  await w.service.check(); assert.equal(w.calls.prepare, 1, "runs once the manual copy finished");
});

test("BKP-LOCK-1 ручная копия во время автокопии ждёт её окончания и затем сохраняется; вторая ручная — BUSY", async () => {
  const exclusive = new BackupExclusive(); const w = auto(exclusive); await w.service.check(); w.later(AUTO_BACKUP_INTERVAL); w.change();
  const held = latch(); w.hold(held.promise); const automatic = w.service.check(); await tick(); await tick();
  assert.equal(w.service.state.phase, "PREPARING");
  let prepared = 0; const m = manual(exclusive, async () => { prepared++; return artifact; });
  const saving = m.service.createNow(); await tick();
  assert.equal(m.service.state.phase, "WAITING"); assert.equal(prepared, 0);
  assert.deepEqual(await m.service.exportElsewhere(), { kind: "FAILED", code: "BACKUP_BUSY" });
  held.release(); await automatic;
  assert.equal((await saving).kind, "SAVED"); assert.equal(prepared, 1); assert.equal(m.service.state.phase, "IDLE");
});

test("BKP-STAGE-1 сбой ручной копии на любом этапе гасит индикатор, показывает код и этап; «Повторить» идёт в ту же папку", async () => {
  const exclusive = new BackupExclusive(); let fail = true; const seen: string[] = [];
  const m = manual(exclusive, async (observe) => {
    observe({ stage: "SNAPSHOT", done: null, total: null }); observe({ stage: "MEDIA", done: 1, total: 3 });
    if (fail) throw new ManualBackupError("BACKUP_MEDIA_UNAVAILABLE", "seal");
    return artifact;
  });
  m.service.subscribe(() => {
    const p = m.service.state.progress; const label = p === null ? null : `${p.stage}:${p.done ?? "-"}/${p.total ?? "-"}`;
    if (label !== null && seen.at(-1) !== label) seen.push(label);
  });
  assert.deepEqual(await m.service.exportElsewhere(), { kind: "FAILED", code: "BACKUP_MEDIA_UNAVAILABLE" });
  assert.deepEqual(seen, ["SNAPSHOT:-/-", "MEDIA:1/3"]);
  assert.equal(m.service.state.phase, "IDLE"); assert.equal(m.service.state.progress, null);
  assert.deepEqual([m.service.state.error, m.service.state.errorStage], ["BACKUP_MEDIA_UNAVAILABLE", "seal"]);
  assert.equal(exclusive.busy, false);
  fail = false; assert.equal((await m.service.retry()).kind, "SAVED");
  assert.deepEqual(m.published.at(-1), { kind: "DIRECTORY", uri: "content://documents/tree/primary%3ASynthetic" });
  assert.equal(m.service.state.error, null); assert.ok(m.service.state.lastRun !== null);
  assert.deepEqual(m.service.state.lastRun.stages.map((s) => s.stage), ["SNAPSHOT", "MEDIA", "PUBLISH"]);
});

test("BKP-LOCK-1 обслуживание (AUTO_NOT_READY) откладывает автокопию на минуту, а не на секунду", async () => {
  const exclusive = new BackupExclusive(); let time = monday;
  const files = { available: true } as AutomaticBackupFiles;
  const service = new AutomaticBackupService({ enabled: true, exclusive, files, store: {} as AutomaticBackupStore, location: async () => ({ kind: "DOWNLOADS" }),
    now: () => time, ready: () => true, run: async () => { throw new AutomaticBackupError("AUTO_NOT_READY"); } });
  await service.check();
  assert.equal(service.state.nextCheckAt, monday + AUTO_BUSY_RETRY); assert.equal(service.state.error, null); assert.equal(service.state.phase, "IDLE");
  time += 1;
});
