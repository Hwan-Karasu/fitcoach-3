import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { ReturnPointCompletion, parseReturnPointState, type ReturnPointState } from "../apps/mobile/src/features/backup/public.ts";
import { restoreWithRuntimeJournal } from "../apps/mobile/src/app/runtime/JournaledRestore.ts";
import { parsePendingRuntimeRestore, recoverRuntimeRestore, type PendingRuntimeRestore } from "../apps/mobile/src/app/bootstrap/recoverRuntimeRestore.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { RuntimeMaintenance } from "../apps/mobile/src/app/runtime/RuntimeMaintenance.ts";
import { RuntimeCommandGate } from "../apps/mobile/src/app/runtime/RuntimeCommandGate.ts";
import { prepareProductionDatabase, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { HostManagedRestoreStorage, HostReturnPointStore, fileHash } from "./r06/HostReturnPointStore.ts";
import { prepareBackupForRestore, validateSqliteBackup } from "./r06/SqliteBackup.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", "base64");
const STAMP = "2026-10-23T12:00:00.000Z";
async function database(file: string, label: string, clients: number, photo?: string): Promise<void> {
  await prepareProductionDatabase(new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file))));
  const db = new DatabaseSync(file);
  try {
    db.prepare("UPDATE workspaces SET display_name=?").run(label);
    for (let i = 0; i < clients; i++) db.prepare(`INSERT INTO clients
      (id,workspace_id,display_name,lifecycle,revision,created_at,updated_at) VALUES (?,?,?,'ACTIVE',1,?,?)`)
      .run(randomUUID(), PRODUCTION_WORKSPACE_ID, `SYNTHETIC ${label} ${i}`, STAMP, STAMP);
    if (photo) db.prepare(`INSERT INTO recipes (id,workspace_id,name,servings_x10,revision,created_at,updated_at,details_json)
      VALUES (?,?,?,10,7,?,?,?)`).run(randomUUID(), PRODUCTION_WORKSPACE_ID, "SYNTHETIC RETURN PHOTO", STAMP, STAMP,
      JSON.stringify({ prepMinutes: 0, cookMinutes: 5, categories: [], steps: ["Synthetic"], photoUri: pathToFileURL(photo).href }));
  } finally { db.close(); }
}
function inspect(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return { label: String(db.prepare("SELECT display_name FROM workspaces").get()?.display_name),
    clients: Number(db.prepare("SELECT count(*) AS n FROM clients").get()?.n),
    details: db.prepare("SELECT details_json FROM recipes").get()?.details_json }; }
  finally { db.close(); }
}
function rows(file: string, table: "clients" | "recipes") {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(); } finally { db.close(); }
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "athlete-return-point-")); const images = join(root, "images"); mkdirSync(images);
  const live = join(root, "live.db"); const photo = join(images, "original.png"); writeFileSync(photo, PNG);
  await database(live, "A", 30, photo);
  const store = new HostReturnPointStore(root, images);
  const state = async () => parseReturnPointState(await store.readState());
  const make = async (label = "B", clients = 25) => {
    const operationId = randomUUID(); const storage = new HostManagedRestoreStorage(root, operationId);
    await database(storage.path("INCOMING"), label, clients);
    const plan: PendingRuntimeRestore = { version: 2, operationId, currentSha256: fileHash(live), incomingSha256: fileHash(storage.path("INCOMING")) };
    return { plan, storage };
  };
  const service = () => new ReturnPointCompletion(store, { kind: "RESTORE", createPoint: (plan) => store.createPoint(plan) });
  const restore = async (label = "B", clients = 25) => {
    const job = await make(label, clients); assert.equal(await restoreWithRuntimeJournal(job.plan, job.storage, store.journal(), service()), "COMMITTED"); return job;
  };
  const recover = () => recoverRuntimeRestore(() => store.journal().readPending(),
    (plan) => new HostManagedRestoreStorage(root, plan.operationId), async () => {
      if (!existsSync(live)) return false; const bytes = readFileSync(live);
      return bytes.length >= 100 && bytes.readUInt32BE(68) === PRODUCTION_IDENTITY.applicationId;
    }, new ReturnPointCompletion(store));
  const returnJob = async () => {
    const point = (await state()).point!; const operationId = randomUUID(); const storage = new HostManagedRestoreStorage(root, operationId);
    await prepareBackupForRestore(store.pointFile(point), storage.path("INCOMING"), { mediaRoot: images, restoreId: operationId });
    const plan: PendingRuntimeRestore = { version: 2, operationId, currentSha256: fileHash(live), incomingSha256: fileHash(storage.path("INCOMING")) };
    const completion = new ReturnPointCompletion(store, { kind: "RETURN", expectedPointOperationId: point.operationId });
    return { plan, storage, point, completion };
  };
  return { root, images, live, photo, store, state, make, service, restore, recover, returnJob,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("R06 managed restore 30→25 creates one full private point; Return restores 30 and embedded photo exactly once", async () => {
  const f = await fixture();
  try {
    const originalClients = rows(f.live, "clients"); const originalRecipe = rows(f.live, "recipes")[0]!;
    const restored = await f.restore(); assert.equal(inspect(f.live).clients, 25);
    const point = (await f.state()).point!; assert.equal(point.operationId, restored.plan.operationId);
    assert.equal((await validateSqliteBackup(f.store.pointFile(point))).media?.entries, 1);
    rmSync(f.images, { recursive: true }); mkdirSync(f.images);
    const returning = await f.returnJob();
    assert.equal(await restoreWithRuntimeJournal(returning.plan, returning.storage, f.store.journal(), returning.completion), "COMMITTED");
    const current = inspect(f.live); assert.equal(current.label, "A"); assert.equal(current.clients, 30);
    assert.deepEqual(rows(f.live, "clients"), originalClients, "IDs, revisions, dates and every client column survive Return");
    const restoredRecipe = rows(f.live, "recipes")[0]!;
    assert.deepEqual({ ...restoredRecipe, details_json: originalRecipe.details_json }, { ...originalRecipe });
    const photoUri = (JSON.parse(String(current.details)) as { photoUri: string }).photoUri;
    assert.notEqual(photoUri, pathToFileURL(f.photo).href); assert.deepEqual(readFileSync(fileURLToPath(photoUri)), PNG);
    assert.deepEqual({ ...JSON.parse(String(current.details)), photoUri: pathToFileURL(f.photo).href }, JSON.parse(String(originalRecipe.details_json)));
    assert.equal((await f.state()).point, null); assert.equal(existsSync(f.store.pointFile(point)), false);
    assert.equal(existsSync(join(f.root, "jobs", returning.plan.operationId, "return.atbackup")), false, "Return creates no reverse user point");
    await f.recover(); assert.equal((await f.state()).point, null); assert.equal(inspect(f.live).clients, 30);
    const replay = await restoreWithRuntimeJournal(returning.plan, returning.storage, f.store.journal(), returning.completion);
    assert.equal(replay, "COMMITTED"); assert.equal((await f.state()).point, null);
  } finally { f.cleanup(); }
});

test("R06 point survives a new store and cold boot, while later business writes remain intact", async () => {
  const f = await fixture();
  try {
    await f.restore(); const before = await f.state();
    await new HostReturnPointStore(f.root, f.images).verifyPoint(before.point!);
    const db = new DatabaseSync(f.live); db.exec("UPDATE workspaces SET display_name='AFTER RESTORE'"); db.close();
    const later = readFileSync(f.live); await f.recover(); await f.recover();
    assert.deepEqual(readFileSync(f.live), later); assert.deepEqual(await f.state(), before);
  } finally { f.cleanup(); }
});

test("R06 the next successful restore replaces the point with the immediately preceding state", async () => {
  const f = await fixture();
  try {
    await f.restore(); const old = (await f.state()).point!;
    const next = await f.restore("C", 20); const point = (await f.state()).point!;
    assert.equal(point.operationId, next.plan.operationId); assert.equal(inspect(f.store.pointFile(point)).clients, 25);
    assert.equal(inspect(f.store.pointFile(point)).label, "B"); assert.equal(existsSync(f.store.pointFile(old)), false);
    assert.equal(inspect(f.live).clients, 20);
  } finally { f.cleanup(); }
});

test("R06 failed swap keeps the old point and exact LIVE; cold retirement does not lose it", async () => {
  const f = await fixture();
  try {
    await f.restore(); const old = (await f.state()).point!; const oldBytes = readFileSync(f.store.pointFile(old)); const before = readFileSync(f.live);
    const job = await f.make("C", 20); let failed = false;
    const storage = new HostManagedRestoreStorage(f.root, job.plan.operationId, (event) => {
      if (event === "move:INCOMING:LIVE" && !failed) { failed = true; throw new Error("SYNTHETIC_IO"); }
    });
    await assert.rejects(restoreWithRuntimeJournal(job.plan, storage, f.store.journal(), f.service()));
    assert.deepEqual(readFileSync(f.live), before); assert.deepEqual((await f.state()).point, old);
    await f.recover(); assert.deepEqual((await f.state()).point, old); assert.deepEqual(readFileSync(f.store.pointFile(old)), oldBytes);
    await new ReturnPointCompletion(f.store).deletePoint(old.operationId);
    await f.recover(); assert.equal((await f.state()).point, null, "rolled-back finalization cannot resurrect a deleted point");
  } finally { f.cleanup(); }
});

test("R06 incomplete/full-disk point preparation never publishes a new operation or removes the old point", async () => {
  const f = await fixture();
  try {
    await f.restore(); const state = await f.state(); const pending = await f.store.journal().readPending(); const before = readFileSync(f.live);
    const job = await f.make("C", 20);
    const completion = new ReturnPointCompletion(f.store, { kind: "RESTORE", createPoint: async () => {
      writeFileSync(join(f.root, "jobs", job.plan.operationId, "return.atbackup"), "SYNTHETIC PARTIAL"); throw new Error("SYNTHETIC_ENOSPC");
    } });
    await assert.rejects(restoreWithRuntimeJournal(job.plan, job.storage, f.store.journal(), completion));
    assert.deepEqual(readFileSync(f.live), before); assert.deepEqual(await f.state(), state);
    assert.deepEqual(await f.store.journal().readPending(), pending); await f.store.verifyPoint(state.point!);
  } finally { f.cleanup(); }
});

test("R06 corrupt or changed point rejects confirmed Return before LIVE is touched", async () => {
  const f = await fixture();
  try {
    await f.restore(); const returning = await f.returnJob(); const state = await f.state(); const before = readFileSync(f.live);
    writeFileSync(f.store.pointFile(returning.point), "SYNTHETIC CORRUPTION");
    await assert.rejects(restoreWithRuntimeJournal(returning.plan, returning.storage, f.store.journal(), returning.completion));
    assert.deepEqual(readFileSync(f.live), before); assert.deepEqual(await f.state(), state);
    assert.equal(existsSync(returning.storage.path("SAFETY")), false);
  } finally { f.cleanup(); }
});

test("R06 a damaged unused candidate does not prevent safe cold rollback to original data and previous point", async () => {
  const f = await fixture();
  try {
    await f.restore(); const previous = (await f.state()).point!; const before = readFileSync(f.live);
    const job = await f.make("C", 20); await f.service().prepare(job.plan); await f.store.journal().publish(job.plan);
    writeFileSync(join(f.root, "jobs", job.plan.operationId, "return.atbackup"), "SYNTHETIC DAMAGED UNUSED CANDIDATE");
    await f.recover();
    assert.deepEqual(readFileSync(f.live), before); assert.deepEqual((await f.state()).point, previous); await f.store.verifyPoint(previous);
  } finally { f.cleanup(); }
});

test("R06 point publication failure after COMMITTED is not success; cold recovery finishes before opening runtime", async () => {
  const f = await fixture();
  try {
    await f.restore(); const previous = await f.state(); const job = await f.make("C", 20); const write = f.store.writeState.bind(f.store);
    f.store.writeState = async () => { throw new Error("SYNTHETIC_STATE_WRITE_FAILED"); };
    await assert.rejects(restoreWithRuntimeJournal(job.plan, job.storage, f.store.journal(), f.service()));
    assert.deepEqual(await f.state(), previous); assert.equal(inspect(f.live).clients, 20);
    f.store.writeState = write; await f.recover();
    assert.equal((await f.state()).point?.operationId, job.plan.operationId); assert.equal(inspect(f.store.pointFile((await f.state()).point!)).clients, 25);
  } finally { f.cleanup(); }
});

test("R06 a new restore settles the previous committed point publication before replacing its routing record", async () => {
  const f = await fixture();
  try {
    const job = await f.make(); const write = f.store.writeState.bind(f.store);
    f.store.writeState = async () => { throw new Error("SYNTHETIC_STATE_WRITE_FAILED"); };
    await assert.rejects(restoreWithRuntimeJournal(job.plan, job.storage, f.store.journal(), f.service()));
    f.store.writeState = write; await f.restore("C", 20);
    const point = (await f.state()).point!; assert.equal(inspect(f.store.pointFile(point)).clients, 25);
    await f.recover(); assert.equal(inspect(f.live).clients, 20);
  } finally { f.cleanup(); }
});

test("R06 real runtime stays closed after failed point publication and reopens only after recovery finalizes it", async () => {
  const f = await fixture(); let held = false;
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(f.live)));
  try {
    await f.restore(); const job = await f.make("C", 20); const commands = new RuntimeCommandGate(); let reopened = 0;
    await shared.acquire(); held = true;
    const maintenance = new RuntimeMaintenance({ database: shared, commands, drainBackground: async () => undefined,
      closeOwners: async () => { if (held) { await shared.release(); held = false; } },
      reopen: async () => {
        assert.equal((await f.state()).point?.operationId, job.plan.operationId, "point is durable before runtime opens");
        await shared.acquire(); held = true; reopened++;
      }, invalidate: () => undefined });
    const attach = (storage: HostManagedRestoreStorage) => {
      const host = storage.withClosedDatabase.bind(storage);
      storage.withClosedDatabase = (task) => maintenance.withClosedDatabase(() => host(task)); return storage;
    };
    const write = f.store.writeState.bind(f.store);
    f.store.writeState = async () => { throw new Error("SYNTHETIC_STATE_WRITE_FAILED"); };
    await assert.rejects(restoreWithRuntimeJournal(job.plan, attach(job.storage), f.store.journal(), f.service()));
    assert.equal(maintenance.state, "RECOVERY_REQUIRED"); assert.equal(reopened, 0); assert.equal(held, false);
    await assert.rejects(commands.run(async () => undefined));
    f.store.writeState = write;
    await recoverRuntimeRestore(() => f.store.journal().readPending(), (plan) => attach(new HostManagedRestoreStorage(f.root, plan.operationId)),
      async () => existsSync(f.live), new ReturnPointCompletion(f.store));
    assert.equal(maintenance.state, "ACTIVE"); assert.equal(reopened, 1); assert.equal(held, true);
    assert.equal(await commands.run(async () => inspect(f.live).clients), 20);
  } finally { if (held) await shared.release(); f.cleanup(); }
});

test("R06 physical cleanup failure cannot reactivate a consumed point on cold recovery", async () => {
  const f = await fixture();
  try {
    await f.restore(); const returning = await f.returnJob(); const remove = f.store.removePoint.bind(f.store);
    f.store.removePoint = async () => { throw new Error("SYNTHETIC_CLEANUP_FAILED"); };
    assert.equal(await restoreWithRuntimeJournal(returning.plan, returning.storage, f.store.journal(), returning.completion), "COMMITTED");
    assert.equal((await f.state()).point, null); assert.equal(existsSync(f.store.pointFile(returning.point)), true);
    f.store.removePoint = remove; await f.recover();
    assert.equal((await f.state()).point, null); assert.equal(existsSync(f.store.pointFile(returning.point)), false);
  } finally { f.cleanup(); }
});

test("R06 explicit confirmed deletion remains retired after cold boot and rejects a stale point ID", async () => {
  const f = await fixture();
  try {
    await f.restore(); const point = (await f.state()).point!; const service = new ReturnPointCompletion(f.store);
    await assert.rejects(service.deletePoint(randomUUID())); await f.store.verifyPoint(point);
    await service.deletePoint(point.operationId); await f.recover();
    assert.equal((await f.state()).point, null); assert.equal(existsSync(f.store.pointFile(point)), false);
  } finally { f.cleanup(); }
});

test("R06 v2 cannot run or cold-open without its completion protocol", async () => {
  const f = await fixture();
  try {
    const job = await f.make(); const before = readFileSync(f.live);
    await assert.rejects(restoreWithRuntimeJournal(job.plan, job.storage, f.store.journal()));
    await f.store.journal().publish(job.plan); let constructed = false;
    await assert.rejects(recoverRuntimeRestore(() => f.store.journal().readPending(), () => { constructed = true; return job.storage; }, async () => true));
    assert.equal(constructed, false); assert.deepEqual(readFileSync(f.live), before);
    await assert.rejects(f.recover()); assert.deepEqual(readFileSync(f.live), before, "missing required intent is never treated as old v1");
  } finally { f.cleanup(); }
});

for (const change of ["hash", "foreign path", "null", "state"] as const) test(`R06 invalid completion ${change} blocks recovery before mutation`, async () => {
  const f = await fixture();
  try {
    const job = await f.make(); await f.service().prepare(job.plan); await f.store.journal().publish(job.plan);
    const before = readFileSync(f.live); const intentFile = join(f.root, "jobs", job.plan.operationId, "completion.json");
    const intent = JSON.parse(readFileSync(intentFile, "utf8")) as Record<string, unknown>;
    if (change === "hash") intent.incomingSha256 = "a".repeat(64);
    if (change === "foreign path") intent.livePath = "file:///foreign";
    if (change === "state") await f.store.writeState({ version: 1, settledOperationId: randomUUID(), point: null });
    else writeFileSync(intentFile, change === "null" ? "null" : JSON.stringify(intent));
    await assert.rejects(f.recover()); assert.deepEqual(readFileSync(f.live), before); assert.equal(existsSync(job.storage.path("SAFETY")), false);
  } finally { f.cleanup(); }
});

for (const kind of ["RESTORE", "RETURN"] as const) {
  const events = kind === "RESTORE"
    ? ["point:sealed", "intent:published", "journal:published", "move:INCOMING:LIVE", "guard:COMMITTED", "state:pending", "state:published", "point:removed"]
    : ["journal:published", "move:INCOMING:LIVE", "guard:COMMITTED", "state:pending", "state:published", "point:removed"];
  for (const event of events) test(`R06 real ${kind} process death at ${event} recovers point and database as one operation`, async () => {
    const f = await fixture();
    try {
      await f.restore(); const previous = (await f.state()).point!;
      const job = kind === "RESTORE" ? await f.make("C", 20) : await f.returnJob();
      const before = readFileSync(f.live); const incoming = readFileSync(job.storage.path("INCOMING"));
      writeFileSync(join(f.root, "plan.json"), JSON.stringify(job.plan));
      const child = spawnSync(process.execPath, ["--experimental-strip-types",
        fileURLToPath(new URL("./r06/return-point-crash-worker.ts", import.meta.url)), f.root, event, kind, previous.operationId],
      { encoding: "utf8", timeout: 20_000, windowsHide: true });
      assert.ok(!child.error, String(child.error)); assert.ok(child.signal !== null || child.status !== 0);
      assert.equal(child.stdout.trim(), `R06_POINT_KILL:${event}`); assert.equal(child.stderr.includes("Error:"), false, child.stderr);
      const committed = ["guard:COMMITTED", "state:pending", "state:published", "point:removed"].includes(event);
      await f.recover();
      assert.deepEqual(readFileSync(f.live), committed ? incoming : before);
      const state: ReturnPointState = await f.state();
      if (!committed) { assert.deepEqual(state.point, previous); await f.store.verifyPoint(previous); }
      else if (kind === "RETURN") { assert.equal(state.point, null); assert.equal(existsSync(f.store.pointFile(previous)), false); }
      else { assert.equal(state.point?.operationId, job.plan.operationId); assert.equal(inspect(f.store.pointFile(state.point!)).clients, 25); }
      const db = new DatabaseSync(f.live); db.exec("UPDATE workspaces SET display_name='AFTER RECOVERY'"); db.close();
      const later = readFileSync(f.live); await f.recover();
      assert.deepEqual(readFileSync(f.live), later); assert.deepEqual(await f.state(), state);
    } finally { f.cleanup(); }
  });
}

// The routing version is intentionally separate from the guard's version=1.
test("R06 managed routing v2 remains strict and captures its values", () => {
  const input = { version: 2, operationId: randomUUID(), currentSha256: "a".repeat(64), incomingSha256: "b".repeat(64) };
  const parsed = parsePendingRuntimeRestore(input); input.incomingSha256 = "c".repeat(64);
  assert.equal(parsed.version, 2); assert.equal(parsed.incomingSha256, "b".repeat(64));
});
