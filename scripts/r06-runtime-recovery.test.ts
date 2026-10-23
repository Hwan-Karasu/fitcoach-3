import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { BootCoordinator } from "../apps/mobile/src/app/bootstrap/BootCoordinator.ts";
import { parsePendingRuntimeRestore, recoverRuntimeRestore, type PendingRuntimeRestore } from "../apps/mobile/src/app/bootstrap/recoverRuntimeRestore.ts";
import { GuardedRestore } from "../apps/mobile/src/features/backup/public.ts";
import { restoreWithRuntimeJournal, type RuntimeRestoreJournal } from "../apps/mobile/src/app/runtime/JournaledRestore.ts";
import { prepareProductionDatabase, PRODUCTION_IDENTITY } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { HostRestoreStorage } from "./r06/HostRestoreStorage.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function journalAt(directory: string): RuntimeRestoreJournal {
  const path = join(directory, "pending.json");
  return {
    readPending: async () => existsSync(path) ? { value: JSON.parse(readFileSync(path, "utf8")) as unknown } : null,
    readGuard: async () => { throw new Error("UNEXPECTED_PREVIOUS_JOB"); },
    publish: async (plan) => { const next = join(directory, "pending.next"); writeFileSync(next, JSON.stringify(plan)); renameSync(next, path); },
  };
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "athlete-runtime-recovery-")); const storage = new HostRestoreStorage(directory);
  for (const slot of ["LIVE", "INCOMING"] as const) {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(storage.path(slot)))));
    const db = new DatabaseSync(storage.path(slot)); db.prepare("UPDATE workspaces SET display_name=?").run(slot); db.close();
  }
  const plan: PendingRuntimeRestore = { version: 1, operationId: "10000000-0000-4000-8000-000000000001",
    currentSha256: hash(storage.path("LIVE")), incomingSha256: hash(storage.path("INCOMING")) };
  return { directory, storage, plan, recover: () => recoverRuntimeRestore(async () => ({ value: plan }), () => storage, async () => {
    if (!existsSync(storage.path("LIVE"))) return false;
    const bytes = readFileSync(storage.path("LIVE"));
    return bytes.length >= 100 && bytes.readUInt32BE(68) === PRODUCTION_IDENTITY.applicationId;
  }),
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("R06 no pending journal never constructs storage or opens a database", async () => {
  await recoverRuntimeRestore(async () => null, () => { throw new Error("MUST_NOT_OPEN"); }, async () => { throw new Error("MUST_NOT_READ"); });
});

test("R06 confirmed restore publishes its journal before file replacement inside one uninterrupted closed lease", async () => {
  const f = await fixture(); const incoming = readFileSync(f.storage.path("INCOMING")); const journal = journalAt(f.directory);
  let leases = 0; let closed = false; const original = f.storage.withClosedDatabase.bind(f.storage);
  f.storage.withClosedDatabase = (task) => original(async () => { leases++; closed = true; try { return await task(); } finally { closed = false; } });
  const move = f.storage.moveExclusive.bind(f.storage);
  f.storage.moveExclusive = async (from, to) => {
    assert.equal(closed, true);
    assert.deepEqual((await journal.readPending())?.value, f.plan);
    return move(from, to);
  };
  try {
    assert.equal(await restoreWithRuntimeJournal(f.plan, f.storage, journal), "COMMITTED");
    assert.equal(leases, 1); assert.equal(closed, false);
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), incoming);
    assert.deepEqual((await journal.readPending())?.value, f.plan);
  } finally { f.cleanup(); }
});

test("R06 failure after journal publication but before PREPARED leaves the original recoverable by cold boot", async () => {
  const f = await fixture(); const before = readFileSync(f.storage.path("LIVE")); const journal = journalAt(f.directory);
  try {
    await assert.rejects(restoreWithRuntimeJournal(f.plan, f.storage, { ...journal, publish: async (plan) => {
      await journal.publish(plan); throw new Error("SYNTHETIC_INTERRUPTION");
    } }));
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), before);
    assert.equal(existsSync(f.storage.guardPath()), false);
    await recoverRuntimeRestore(() => journal.readPending(), () => f.storage, async () => existsSync(f.storage.path("LIVE")));
    assert.equal(JSON.parse(readFileSync(f.storage.guardPath(), "utf8")).phase, "ROLLED_BACK");
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), before);
  } finally { f.cleanup(); }
});

test("R06 a queued confirmation cannot be changed through its caller's object", async () => {
  const f = await fixture(); const journal = journalAt(f.directory);
  const expected = readFileSync(f.storage.path("INCOMING")); const input = { ...f.plan };
  try {
    const restoring = restoreWithRuntimeJournal(input, f.storage, journal);
    input.operationId = "20000000-0000-4000-8000-000000000002";
    input.incomingSha256 = "a".repeat(64);
    assert.equal(await restoring, "COMMITTED");
    assert.deepEqual((await journal.readPending())?.value, f.plan);
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), expected);
  } finally { f.cleanup(); }
});

for (const event of ["journal:pending", "journal:published", "guard:PREPARED", "move:INCOMING:LIVE", "guard:COMMITTED"]) {
  test(`R06 actual process death at ${event} recovers through the published routing journal`, async () => {
    const f = await fixture(); const journal = journalAt(f.directory);
    const before = readFileSync(f.storage.path("LIVE")); const incoming = readFileSync(f.storage.path("INCOMING"));
    try {
      writeFileSync(join(f.directory, "plan.json"), JSON.stringify(f.plan));
      const child = spawnSync(process.execPath, ["--experimental-strip-types",
        fileURLToPath(new URL("./r06/journal-crash-worker.ts", import.meta.url)), f.directory, event],
      { encoding: "utf8", timeout: 20_000, windowsHide: true });
      assert.ok(!child.error, String(child.error));
      assert.ok(child.signal !== null || child.status !== 0);
      assert.equal(child.stdout.trim(), `R06_JOURNAL_KILL:${event}`);
      assert.equal(child.stderr.includes("Error:"), false, child.stderr);
      const committed = event === "guard:COMMITTED";
      await recoverRuntimeRestore(() => journal.readPending(), () => new HostRestoreStorage(f.directory), async () => existsSync(f.storage.path("LIVE")));
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), committed ? incoming : before);
      if (event === "journal:pending") assert.equal(await journal.readPending(), null);
      else assert.equal(JSON.parse(readFileSync(f.storage.guardPath(), "utf8")).phase, committed ? "COMPLETED" : "ROLLED_BACK");
      if (existsSync(f.storage.path("SAFETY"))) assert.deepEqual(readFileSync(f.storage.path("SAFETY")), before);
      const db = new DatabaseSync(f.storage.path("LIVE"));
      db.exec("UPDATE workspaces SET display_name='SYNTHETIC AFTER RECOVERY'"); db.close();
      const later = readFileSync(f.storage.path("LIVE"));
      await recoverRuntimeRestore(() => journal.readPending(), () => new HostRestoreStorage(f.directory), async () => existsSync(f.storage.path("LIVE")));
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), later);
    } finally { f.cleanup(); }
  });
}

for (const phase of [null, "PREPARED", "COMMITTED"] as const) test(`R06 a new restore cannot replace an unfinished ${phase ?? "unguarded"} journal`, async () => {
  const f = await fixture(); const before = readFileSync(f.storage.path("LIVE")); const journal = journalAt(f.directory);
  const old = { ...f.plan, operationId: "20000000-0000-4000-8000-000000000002" };
  try {
    await journal.publish(old);
    await assert.rejects(restoreWithRuntimeJournal(f.plan, f.storage, { ...journal,
      readGuard: async () => phase === null ? null : { ...old, phase } }));
    assert.deepEqual((await journal.readPending())?.value, old);
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), before);
    assert.equal(existsSync(f.storage.guardPath()), false);
  } finally { f.cleanup(); }
});

for (const phase of ["COMPLETED", "ROLLED_BACK"] as const) test(`R06 a settled ${phase} journal may be replaced by the next confirmed operation`, async () => {
  const f = await fixture(); const journal = journalAt(f.directory);
  const old = { ...f.plan, operationId: "20000000-0000-4000-8000-000000000002" };
  try {
    await journal.publish(old);
    assert.equal(await restoreWithRuntimeJournal(f.plan, f.storage, { ...journal, readGuard: async () => ({ ...old, phase }) }), "COMMITTED");
    assert.deepEqual((await journal.readPending())?.value, f.plan);
  } finally { f.cleanup(); }
});

test("R06 a stale source or a failed journal write never moves LIVE or replaces the previous receipt", async () => {
  const f = await fixture(); const before = readFileSync(f.storage.path("LIVE")); const journal = journalAt(f.directory);
  const old = { ...f.plan, operationId: "20000000-0000-4000-8000-000000000002" };
  try {
    await journal.publish(old);
    const port = { ...journal, readGuard: async () => ({ ...old, phase: "COMPLETED" }), publish: async () => { throw new Error("SYNTHETIC_NO_SPACE"); } };
    await assert.rejects(restoreWithRuntimeJournal({ ...f.plan, incomingSha256: "a".repeat(64) }, f.storage, port));
    await assert.rejects(restoreWithRuntimeJournal(f.plan, f.storage, port));
    assert.deepEqual((await journal.readPending())?.value, old);
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), before);
    assert.equal(existsSync(f.storage.path("SAFETY")), false);
  } finally { f.cleanup(); }
});

test("R06 replay of a journalled restore preserves later writes and never republishes the pointer", async () => {
  const f = await fixture(); const journal = journalAt(f.directory);
  try {
    await restoreWithRuntimeJournal(f.plan, f.storage, journal);
    const db = new DatabaseSync(f.storage.path("LIVE")); db.exec("UPDATE workspaces SET display_name='LATER BUSINESS WRITE'"); db.close();
    const later = readFileSync(f.storage.path("LIVE"));
    assert.equal(await restoreWithRuntimeJournal(f.plan, f.storage, { ...journal, publish: async () => { throw new Error("MUST_NOT_REPUBLISH"); } }), "COMMITTED");
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), later);
    renameSync(f.storage.path("LIVE"), join(f.directory, "preserved.db"));
    await assert.rejects(restoreWithRuntimeJournal(f.plan, f.storage, journal));
    assert.equal(existsSync(f.storage.path("LIVE")), false);
  } finally { f.cleanup(); }
});

test("R06 a corrupted atomic publication cannot start the file replacement", async () => {
  const f = await fixture(); const journal = journalAt(f.directory); const before = readFileSync(f.storage.path("LIVE"));
  try {
    await assert.rejects(restoreWithRuntimeJournal(f.plan, f.storage, { ...journal, publish: (plan) => journal.publish({ ...plan, incomingSha256: "a".repeat(64) }) }));
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), before);
    assert.equal(existsSync(f.storage.path("SAFETY")), false);
  } finally { f.cleanup(); }
});

for (const mutate of [
  () => undefined, () => null, () => [], (p: PendingRuntimeRestore) => ({ ...p, operationId: "../live.db" }),
  (p: PendingRuntimeRestore) => ({ ...p, version: 2 }), (p: PendingRuntimeRestore) => ({ ...p, currentSha256: "ABC" }),
  (p: PendingRuntimeRestore) => ({ ...p, livePath: "file:///foreign" }),
]) test("R06 routing journal rejects malformed/foreign path/version before constructing storage", async () => {
  const plan: PendingRuntimeRestore = { version: 1, operationId: "10000000-0000-4000-8000-000000000001", currentSha256: "a".repeat(64), incomingSha256: "b".repeat(64) };
  assert.throws(() => parsePendingRuntimeRestore(mutate(plan)), /RESTORE_JOURNAL_INVALID/u);
  await assert.rejects(recoverRuntimeRestore(async () => ({ value: mutate(plan) }), () => { throw new Error("MUST_NOT_OPEN"); }, async () => true), /RESTORE_JOURNAL_INVALID/u);
});

test("R06 cold boot routes PREPARED rollback before workspace/database initialization", async () => {
  const f = await fixture(); const before = readFileSync(f.storage.path("LIVE")); const events: string[] = [];
  try {
    await f.storage.withClosedDatabase(async () => {
      await f.storage.copyExclusive("LIVE", "SAFETY"); await f.storage.saveGuard({ ...f.plan, phase: "PREPARED" });
      await f.storage.moveExclusive("LIVE", "PREVIOUS"); await f.storage.moveExclusive("INCOMING", "LIVE");
    });
    const boot = new BootCoordinator({ fallbackThemeId: "zefirka",
      recoverBeforeOpen: async () => { events.push("recover"); await f.recover(); },
      prepareWorkspace: async () => { events.push("workspace"); assert.deepEqual(readFileSync(f.storage.path("LIVE")), before); return { id: "local-trainer" }; },
      openDatabase: async () => { events.push("database"); }, loadThemePreference: async () => ({ themeId: null, accentId: null }) });
    assert.equal((await boot.start()).kind, "APP_READY"); assert.deepEqual(events, ["recover", "workspace", "database"]);
    assert.deepEqual(readFileSync(f.storage.path("SAFETY")), before);
  } finally { f.cleanup(); }
});

test("R06 death before PREPARED retires a checked original as ROLLED_BACK; following user writes survive", async () => {
  const f = await fixture();
  try {
    await f.recover();
    assert.equal((JSON.parse(readFileSync(f.storage.guardPath(), "utf8")) as { phase: string }).phase, "ROLLED_BACK");
    const db = new DatabaseSync(f.storage.path("LIVE")); db.exec("UPDATE workspaces SET display_name='SYNTHETIC LATER'"); db.close();
    const later = readFileSync(f.storage.path("LIVE")); await f.recover(); assert.deepEqual(readFileSync(f.storage.path("LIVE")), later);
  } finally { f.cleanup(); }
});

for (const missing of [false, true]) test(`R06 journal without guard and ${missing ? "missing" : "changed"} live file blocks boot without creating a new DB`, async () => {
  const f = await fixture(); let opened = false;
  try {
    if (missing) renameSync(f.storage.path("LIVE"), join(f.directory, "preserved.db"));
    else { const db = new DatabaseSync(f.storage.path("LIVE")); db.exec("UPDATE workspaces SET display_name='UNEXPECTED CHANGE'"); db.close(); }
    const boot = new BootCoordinator({ fallbackThemeId: "zefirka", recoverBeforeOpen: f.recover,
      prepareWorkspace: async () => ({ id: "local-trainer" }), openDatabase: async () => { opened = true; },
      loadThemePreference: async () => ({ themeId: null, accentId: null }) });
    assert.deepEqual(await boot.start(), { kind: "BOOT_FAILED", attempt: 1, code: "RESTORE_RECOVERY_REQUIRED" });
    assert.equal(opened, false); assert.equal(existsSync(f.storage.path("LIVE")), !missing);
  } finally { f.cleanup(); }
});

test("R06 routing journal and guard must identify exactly the same confirmed operation", async () => {
  const f = await fixture(); const before = readFileSync(f.storage.path("LIVE"));
  try {
    await f.storage.withClosedDatabase(() => f.storage.saveGuard({ ...f.plan, operationId: "other-operation", phase: "PREPARED" }));
    await assert.rejects(f.recover()); assert.deepEqual(readFileSync(f.storage.path("LIVE")), before);
  } finally { f.cleanup(); }
});

test("R06 a present guard containing JSON null is corruption, not absence", async () => {
  const f = await fixture(); const before = readFileSync(f.storage.path("LIVE"));
  try {
    writeFileSync(f.storage.guardPath(), "null");
    await assert.rejects(f.recover()); assert.deepEqual(readFileSync(f.storage.path("LIVE")), before);
    assert.equal(readFileSync(f.storage.guardPath(), "utf8"), "null");
  } finally { f.cleanup(); }
});

for (const missing of [false, true]) test(`R06 a completed receipt cannot authorize a fresh empty database when LIVE is ${missing ? "missing" : "empty"}`, async () => {
  const f = await fixture();
  try {
    await new GuardedRestore(f.storage).restore(f.plan);
    if (missing) renameSync(f.storage.path("LIVE"), join(f.directory, "preserved.db"));
    else writeFileSync(f.storage.path("LIVE"), "");
    await assert.rejects(f.recover()); assert.equal(existsSync(f.storage.path("LIVE")), !missing);
    if (!missing) assert.equal(readFileSync(f.storage.path("LIVE")).length, 0);
  } finally { f.cleanup(); }
});

test("R06 actual process death after a completed restore leaves later committed WAL for normal SQLite boot", async () => {
  const f = await fixture();
  try {
    await new GuardedRestore(f.storage).restore(f.plan);
    const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./r06/restore-crash-worker.ts", import.meta.url)),
      f.directory, "unused", "wal-after-receipt"], { encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.ok(!child.error, String(child.error)); assert.ok(child.signal !== null || child.status !== 0); assert.equal(child.stderr.includes("Error:"), false, child.stderr);
    const wal = `${f.storage.path("LIVE")}-wal`; assert.ok(existsSync(wal));
    const mainBytes = readFileSync(f.storage.path("LIVE")); const walBytes = readFileSync(wal);
    await f.recover();
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), mainBytes); assert.deepEqual(readFileSync(wal), walBytes);
    const db = new DatabaseSync(f.storage.path("LIVE"));
    try { assert.equal(db.prepare("SELECT display_name FROM workspaces").get()?.display_name, "SYNTHETIC LATER WAL"); }
    finally { db.close(); }
  } finally { f.cleanup(); }
});
