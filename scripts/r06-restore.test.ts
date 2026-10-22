import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { GuardedRestore, RestoreProtocolError, type RestorePlan, type RestoreSlot } from "../apps/mobile/src/features/backup/public.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { HostRestoreStorage } from "./r06/HostRestoreStorage.ts";

const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
async function fixture(onBoundary?: (event: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "athlete-r06-"));
  const storage = new HostRestoreStorage(directory, onBoundary);
  for (const [slot, marker] of [["LIVE", "before"], ["INCOMING", "restored"]] as const) {
    const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(storage.path(slot))));
    await prepareProductionDatabase(shared);
    const db = new DatabaseSync(storage.path(slot));
    db.prepare("UPDATE workspaces SET display_name = ?").run(marker);
    db.close();
  }
  const plan: RestorePlan = { operationId: "synthetic-restore", currentSha256: digest(storage.path("LIVE")), incomingSha256: digest(storage.path("INCOMING")) };
  writeFileSync(join(directory, "plan.json"), JSON.stringify(plan));
  const source = readFileSync(storage.path("INCOMING"));
  const before = readFileSync(storage.path("LIVE"));
  return { directory, storage, plan, before, source, protocol: new GuardedRestore(storage),
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function crash(directory: string, event: string, action = "restore") {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./r06/restore-crash-worker.ts", import.meta.url)), directory, event, action],
    { encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.ok(!child.error, String(child.error));
  assert.ok(child.signal !== null || child.status !== 0, "worker must actually be killed");
  assert.equal(child.stderr.includes("Error:"), false, child.stderr);
}
const hasCode = (code: RestoreProtocolError["code"]) => (error: unknown) => error instanceof RestoreProtocolError && error.code === code;

test("R06 complete closed SQLite replacement preserves old bytes and source; replay never restores twice", async () => {
  const f = await fixture();
  try {
    assert.equal(await f.protocol.restore(f.plan), "COMMITTED");
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.source);
    assert.deepEqual(readFileSync(f.storage.path("SAFETY")), f.before);
    assert.deepEqual(readFileSync(f.storage.path("PREVIOUS")), f.before);
    // Runtime changes after success are legitimate; receipt is not a permanent byte checksum.
    const db = new DatabaseSync(f.storage.path("LIVE"));
    db.exec("UPDATE workspaces SET display_name='later write'"); db.close();
    const later = readFileSync(f.storage.path("LIVE"));
    assert.equal(await f.protocol.restore(f.plan), "COMMITTED");
    assert.equal(await f.protocol.recover(), "COMMITTED");
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), later);
    assert.deepEqual(readFileSync(f.storage.path("SAFETY")), f.before);
    await assert.rejects(f.protocol.restore({ ...f.plan, operationId: "another" }), hasCode("RESTORE_BUSY"));
  } finally { f.cleanup(); }
});

for (const event of ["guard-pending:PREPARED", "guard:PREPARED", "move:LIVE:PREVIOUS", "move:INCOMING:LIVE",
  "guard-pending:COMMITTED", "guard:COMMITTED", "guard-pending:COMPLETED", "guard:COMPLETED"]) {
  test(`R06 actual process kill at ${event}; new process object recovers a complete DB`, async () => {
    const f = await fixture();
    try {
      crash(f.directory, event);
      const restarted = new GuardedRestore(new HostRestoreStorage(f.directory));
      const committed = ["guard:COMMITTED", "guard-pending:COMPLETED", "guard:COMPLETED"].includes(event);
      const expected = event === "guard-pending:PREPARED" ? "NO_OPERATION" : committed ? "COMMITTED" : "ROLLED_BACK";
      assert.equal(await restarted.recover(), expected);
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), committed ? f.source : f.before);
      assert.deepEqual(readFileSync(f.storage.path("SAFETY")), f.before);
      assert.equal(await restarted.recover(), expected);
    } finally { f.cleanup(); }
  });
}

for (const event of ["move:LIVE:REJECTED", "move:PREVIOUS:LIVE", "guard-pending:ROLLED_BACK", "guard:ROLLED_BACK"]) {
  test(`R06 recovery itself killed at ${event} is repeatable`, async () => {
    const f = await fixture();
    try {
      crash(f.directory, "move:INCOMING:LIVE");
      crash(f.directory, event, "recover");
      assert.equal(await new GuardedRestore(new HostRestoreStorage(f.directory)).recover(), "ROLLED_BACK");
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.before);
      assert.deepEqual(readFileSync(f.storage.path("REJECTED")), f.source);
      assert.deepEqual(readFileSync(f.storage.path("SAFETY")), f.before);
    } finally { f.cleanup(); }
  });
}

test("R06 fallback uses independent safety, keeps it intact and survives a second kill", async () => {
  const f = await fixture();
  try {
    crash(f.directory, "move:INCOMING:LIVE");
    // Simulate loss of PREVIOUS; SAFETY is independently sufficient, not an incremental patch.
    rmSync(f.storage.path("PREVIOUS"));
    crash(f.directory, "move:ROLLBACK:LIVE", "recover");
    assert.equal(await f.protocol.recover(), "ROLLED_BACK");
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.before);
    assert.deepEqual(readFileSync(f.storage.path("SAFETY")), f.before);
  } finally { f.cleanup(); }
});

for (const kind of ["changed incoming", "changed live", "invalid incoming", "foreign incoming", "empty incoming"] as const) {
  test(`R06 ${kind} is rejected before live mutation`, async () => {
    const f = await fixture();
    try {
      let plan = f.plan;
      if (kind === "changed live") plan = { ...plan, currentSha256: "0".repeat(64) };
      if (kind === "changed incoming") plan = { ...plan, incomingSha256: "0".repeat(64) };
      if (kind === "invalid incoming") writeFileSync(f.storage.path("INCOMING"), "corrupt SQLite");
      if (kind === "foreign incoming" || kind === "empty incoming") {
        rmSync(f.storage.path("INCOMING"));
        const db = new DatabaseSync(f.storage.path("INCOMING"));
        if (kind === "foreign incoming") db.exec("CREATE TABLE foreign_data (id TEXT)");
        db.close();
      }
      if (!["changed incoming", "changed live"].includes(kind)) plan = { ...plan, incomingSha256: digest(f.storage.path("INCOMING")) };
      await assert.rejects(f.protocol.restore(plan), hasCode(kind.startsWith("changed") ? "RESTORE_STALE_PREVIEW" : "RESTORE_FAILED"));
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.before);
      assert.equal(existsSync(f.storage.guardPath()), false);
      assert.equal(existsSync(f.storage.path("SAFETY")), false);
    } finally { f.cleanup(); }
  });
}

for (const event of ["copy:LIVE:SAFETY", "guard:PREPARED", "move:LIVE:PREVIOUS", "move:INCOMING:LIVE", "guard:COMMITTED"]) {
  test(`R06 I/O error at ${event} returns only after recoverable state`, async () => {
    let injected = false;
    const f = await fixture((boundary) => { if (!injected && boundary === event) { injected = true; throw new Error("SYNTHETIC_IO_ERROR"); } });
    try {
      if (event === "guard:COMMITTED") assert.equal(await f.protocol.restore(f.plan), "COMMITTED");
      else await assert.rejects(f.protocol.restore(f.plan), hasCode("RESTORE_FAILED"));
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), event === "guard:COMMITTED" ? f.source : f.before);
      assert.deepEqual(readFileSync(f.storage.path("SAFETY")), f.before);
    } finally { f.cleanup(); }
  });
}

test("R06 invalid guard, corrupt safety and unknown occupied slot preserve evidence and require recovery", async () => {
  for (const kind of ["invalid guard", "corrupt copies", "occupied rejected"] as const) {
    const f = await fixture();
    try {
      crash(f.directory, "move:INCOMING:LIVE");
      if (kind === "invalid guard") writeFileSync(f.storage.guardPath(), '{"phase":"COMPLETED"}');
      if (kind === "corrupt copies") {
        writeFileSync(f.storage.path("PREVIOUS"), "bad"); writeFileSync(f.storage.path("SAFETY"), "bad");
      }
      if (kind === "occupied rejected") copyFileSync(f.storage.path("LIVE"), f.storage.path("REJECTED"));
      const live = readFileSync(f.storage.path("LIVE"));
      await assert.rejects(f.protocol.recover(), hasCode("RESTORE_RECOVERY_REQUIRED"));
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), live);
      assert.equal(existsSync(f.storage.guardPath()), true);
    } finally { f.cleanup(); }
  }
});

test("R06 concurrent double tap is serialized, invalid plans and WAL sidecars never mutate live", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.protocol.restore({ ...f.plan, operationId: "../outside" }), hasCode("RESTORE_INVALID_PLAN"));
    writeFileSync(`${f.storage.path("LIVE")}-wal`, "synthetic sidecar");
    await assert.rejects(f.protocol.restore(f.plan), hasCode("RESTORE_RECOVERY_REQUIRED"));
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.before);
    rmSync(`${f.storage.path("LIVE")}-wal`);
    assert.deepEqual(await Promise.all([f.protocol.restore(f.plan), new GuardedRestore(f.storage).restore(f.plan)]), ["COMMITTED", "COMMITTED"]);
  } finally { f.cleanup(); }
});

test("R06 partial safety copy / full disk and failed guard publication leave live byte-identical", async () => {
  for (const kind of ["partial safety", "guard pending"] as const) {
    let failed = false;
    const f = await fixture((event) => {
      if (kind === "guard pending" && event === "guard-pending:PREPARED") throw new Error("ENOSPC private path");
    });
    try {
      if (kind === "partial safety") {
        f.storage.copyExclusive = async () => { failed = true; writeFileSync(f.storage.path("SAFETY"), "partial"); throw new Error("ENOSPC private path"); };
      }
      await assert.rejects(f.protocol.restore(f.plan), hasCode("RESTORE_FAILED"));
      if (kind === "partial safety") assert.equal(failed, true);
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.before);
      assert.equal(await f.protocol.recover(), "NO_OPERATION");
      assert.equal(existsSync(f.storage.guardPath()), false);
      await assert.rejects(f.protocol.restore(f.plan), hasCode("RESTORE_BUSY"));
    } finally { f.cleanup(); }
  }
});

test("R06 rolled back operation is terminal; replay does not try to restore it again", async () => {
  const f = await fixture();
  try {
    crash(f.directory, "move:INCOMING:LIVE");
    assert.equal(await f.protocol.recover(), "ROLLED_BACK");
    const db = new DatabaseSync(f.storage.path("LIVE"));
    db.exec("UPDATE workspaces SET display_name='later old database write'"); db.close();
    const later = readFileSync(f.storage.path("LIVE"));
    assert.equal(await f.protocol.restore(f.plan), "ROLLED_BACK");
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), later);
    assert.deepEqual(readFileSync(f.storage.path("REJECTED")), f.source);
  } finally { f.cleanup(); }
});

test("R06 caller cannot change a queued confirmation or inject journal fields", async () => {
  const f = await fixture();
  try {
    const plan = { ...f.plan, phase: "COMPLETED", unexpected: "not journal data" };
    const result = f.protocol.restore(plan);
    plan.incomingSha256 = "0".repeat(64);
    assert.equal(await result, "COMMITTED");
    assert.equal(await f.protocol.recover(), "COMMITTED");
    assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.source);
  } finally { f.cleanup(); }
});

test("R06 every scratch slot is exclusive; prior files are not overwritten", async () => {
  for (const slot of ["SAFETY", "PREVIOUS", "REJECTED", "ROLLBACK"] as const satisfies readonly RestoreSlot[]) {
    const f = await fixture();
    try {
      writeFileSync(f.storage.path(slot), "existing evidence");
      await assert.rejects(f.protocol.restore(f.plan), hasCode("RESTORE_BUSY"));
      assert.deepEqual(readFileSync(f.storage.path("LIVE")), f.before);
      assert.equal(readFileSync(f.storage.path(slot), "utf8"), "existing evidence");
    } finally { f.cleanup(); }
  }
});
