import assert from "node:assert/strict";
import test from "node:test";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import type { SqliteConnectionPort } from "../apps/mobile/src/shared/db/SqlitePort.ts";

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function fixture() {
  let opens = 0; let closes = 0; let live = 0; let peak = 0;
  let closeGate: Promise<void> | null = null;
  let readGate: Promise<void> | null = null;
  let failOpen = false; let failClose = false;
  const events: string[] = [];
  const database = new SharedSqliteDatabase(async () => {
    opens++; events.push("open");
    if (failOpen) throw new Error("synthetic open failure");
    live++; peak = Math.max(peak, live);
    const raw: SqliteConnectionPort = {
      run: async () => { events.push("run"); return { changes: 1, lastInsertRowId: 1 }; },
      first: async <Row>(): Promise<Row | null> => { events.push("read-start"); await readGate; events.push("read-end"); return null; },
      all: async <Row>(): Promise<readonly Row[]> => [],
      exclusive: async (task) => { events.push("write-start"); const result = await task(raw); events.push("write-end"); return result; },
      close: async () => { events.push("close-start"); await closeGate; if (failClose) throw new Error("private path close error"); closes++; live--; events.push("closed"); },
    };
    return raw;
  });
  return { database, events, get opens() { return opens; }, get closes() { return closes; }, get peak() { return peak; },
    waitClose: (gate: Promise<void>) => { closeGate = gate; }, waitRead: (gate: Promise<void>) => { readGate = gate; },
    failOpen: (value: boolean) => { failOpen = value; }, failClose: () => { failClose = true; } };
}

test("R06 shared DB serializes last close with reacquire; physical handles never overlap", async () => {
  const f = fixture(); const closing = latch(); f.waitClose(closing.promise);
  const first = await f.database.acquire();
  const release = f.database.release();
  const acquire = f.database.acquire();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.opens, 1); assert.equal(f.closes, 0);
  closing.release(); await release;
  const second = await acquire;
  assert.notEqual(first, second); assert.equal(f.peak, 1);
  await assert.rejects(first.connection.all("SELECT 1"), /DATABASE_LEASE_RELEASED/u);
  await assert.rejects(first.writer.write(async () => undefined), /DATABASE_LEASE_RELEASED/u);
  await f.database.release(); assert.equal(f.closes, 2);
});

test("R06 maintenance blocks new readers/writers/leases, drains admitted work, then closes before file work", async () => {
  const f = fixture(); const reading = latch(); const writing = latch();
  f.waitRead(reading.promise);
  const lease = await f.database.acquire();
  const read = lease.connection.first("SELECT 1");
  const write = lease.writer.write(async (tx) => { await writing.promise; await tx.run("UPDATE synthetic"); });
  let stopped = false; let files = false;
  const maintenance = f.database.withClosedDatabase(async () => { stopped = true; await f.database.release(); }, async () => {
    assert.equal(f.closes, 1); files = true;
    await assert.rejects(f.database.acquire(), /DATABASE_MAINTENANCE/u);
    return 42;
  });
  await assert.rejects(lease.connection.all("SELECT 2"), /DATABASE_MAINTENANCE/u);
  await assert.rejects(lease.writer.write(async () => undefined), /DATABASE_MAINTENANCE/u);
  await assert.rejects(f.database.acquire(), /DATABASE_MAINTENANCE/u);
  await assert.rejects(f.database.withClosedDatabase(async () => undefined, async () => undefined), /DATABASE_MAINTENANCE_BUSY/u);
  assert.equal(stopped, false); assert.equal(files, false);
  writing.release(); await write;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopped, true); assert.equal(f.closes, 0); assert.equal(files, false);
  reading.release(); await read;
  assert.equal(await maintenance, 42);
  assert.ok(f.events.indexOf("write-end") < f.events.indexOf("closed"));
  assert.ok(f.events.indexOf("read-end") < f.events.indexOf("closed"));
  await f.database.acquire(); await f.database.release();
});

test("R06 unreleased holder prevents replacement and resumes existing writer after abort", async () => {
  const f = fixture(); const lease = await f.database.acquire();
  let files = false;
  await assert.rejects(f.database.withClosedDatabase(async () => undefined, async () => { files = true; }), /DATABASE_LEASES_REMAIN/u);
  assert.equal(files, false); assert.equal(f.closes, 0);
  await lease.writer.write(async (tx) => { await tx.run("safe write"); });
  await lease.connection.all("safe read");
  await f.database.release();
});

test("R06 failed file task blocks normal runtime until successful recovery, including failed recovery setup", async () => {
  const f = fixture(); await f.database.acquire();
  await assert.rejects(f.database.withClosedDatabase(() => f.database.release(), async () => { throw new Error("synthetic file failure"); }), /synthetic file failure/u);
  await assert.rejects(f.database.acquire(), /DATABASE_RECOVERY_REQUIRED/u);
  await assert.rejects(f.database.withClosedDatabase(async () => { throw new Error("setup failed"); }, async () => undefined), /setup failed/u);
  await assert.rejects(f.database.acquire(), /DATABASE_RECOVERY_REQUIRED/u);
  assert.equal(await f.database.withClosedDatabase(async () => undefined, async () => "verified recovery"), "verified recovery");
  await f.database.acquire(); await f.database.release();
});

test("R06 uncertain native close fails closed; no second open or file mutation", async () => {
  const f = fixture(); await f.database.acquire(); f.failClose();
  let files = false;
  await assert.rejects(f.database.withClosedDatabase(() => f.database.release(), async () => { files = true; }), /DATABASE_CLOSE_FAILED/u);
  assert.equal(files, false);
  await assert.rejects(f.database.acquire(), /DATABASE_CLOSE_FAILED/u);
  await assert.rejects(f.database.withClosedDatabase(async () => undefined, async () => undefined), /DATABASE_CLOSE_FAILED/u);
  assert.equal(f.opens, 1);
});

test("R06 failed open is retryable, parallel acquire shares one connection and close must use release", async () => {
  const f = fixture(); f.failOpen(true);
  await assert.rejects(f.database.acquire(), /synthetic open failure/u);
  f.failOpen(false);
  const [one, two] = await Promise.all([f.database.acquire(), f.database.acquire()]);
  assert.equal(one, two); assert.equal(f.opens, 2);
  await assert.rejects(one.connection.close(), /DATABASE_RELEASE_REQUIRED/u);
  await f.database.release(); assert.equal(f.closes, 0);
  await f.database.release(); assert.equal(f.closes, 1);
});

test("R06 another owner of writer quiescence aborts maintenance without poisoning later release", async () => {
  const f = fixture(); const lease = await f.database.acquire();
  const resume = await lease.writer.quiesce();
  let files = false;
  await assert.rejects(f.database.withClosedDatabase(async () => undefined, async () => { files = true; }), /WRITES_ALREADY_QUIESCED/u);
  assert.equal(files, false);
  resume();
  await lease.writer.write(async () => undefined);
  await f.database.release();
  assert.equal(f.closes, 1);
});

test("R06 failed admitted transaction drains and does not prevent safe physical close", async () => {
  const f = fixture(); const lease = await f.database.acquire();
  const write = assert.rejects(lease.writer.write(async () => { throw new Error("synthetic transaction rollback"); }), /synthetic transaction rollback/u);
  let files = false;
  await f.database.withClosedDatabase(() => f.database.release(), async () => { files = true; });
  await write;
  assert.equal(f.closes, 1); assert.equal(files, true);
});
