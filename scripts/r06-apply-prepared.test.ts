import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { applyPreparedRestore, type PreparedRestoreIdentity } from "../apps/mobile/src/app/runtime/ApplyPreparedRestore.ts";
import { recoverRuntimeRestore } from "../apps/mobile/src/app/bootstrap/recoverRuntimeRestore.ts";
import { ReturnPointCompletion, RestoreActionError, restoreSpaceRequired, parseReturnPointState } from "../apps/mobile/src/features/backup/public.ts";
import { RuntimeCommandGate } from "../apps/mobile/src/app/runtime/RuntimeCommandGate.ts";
import { RuntimeMaintenance } from "../apps/mobile/src/app/runtime/RuntimeMaintenance.ts";
import { SharedSqliteDatabase, type SqliteDatabaseLease } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase, PRODUCTION_WORKSPACE_ID } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { HostManagedRestoreStorage, HostReturnPointStore, fileHash } from "./r06/HostReturnPointStore.ts";
import { canonicalContentSha256 } from "./r06/SqliteBackup.ts";

const hashContent = (file: string) => { const db = new DatabaseSync(file, { readOnly: true }); try { return canonicalContentSha256(db); } finally { db.close(); } };
const failure = (code: RestoreActionError["code"]) => (error: unknown) => error instanceof RestoreActionError && error.code === code;
async function fixture(boundary?: (event: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "athlete-apply-preview-")); const images = join(root, "images"); mkdirSync(images);
  const live = join(root, "live.db"); const id = randomUUID(); const storage = new HostManagedRestoreStorage(root, id, boundary);
  for (const [file, label] of [[live, "BEFORE"], [storage.path("INCOMING"), "RESTORED"]] as const) {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file))));
    const db = new DatabaseSync(file); db.prepare("UPDATE workspaces SET display_name=?").run(label); db.close();
  }
  const photo = join(images, "synthetic.png"); writeFileSync(photo, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", "base64"));
  const seed = new DatabaseSync(live);
  seed.prepare(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, details_json)
    VALUES (?,?,?,10,1,?,?,?)`).run(randomUUID(), PRODUCTION_WORKSPACE_ID, "SYNTHETIC PREVIEW PHOTO", "2026-10-23", "2026-10-23",
    JSON.stringify({ photoUri: pathToFileURL(photo).href })); seed.close();
  const store = new HostReturnPointStore(root, images); const commands = new RuntimeCommandGate();
  let opens = 0; let reopens = 0; let lease: SqliteDatabaseLease | null = null;
  const shared = new SharedSqliteDatabase(async () => { opens++; return nodeSqlitePort(new DatabaseSync(live)); });
  lease = await shared.acquire();
  const closeBusiness = async () => { if (lease !== null) { await shared.release(); lease = null; } };
  const maintenance = new RuntimeMaintenance({ database: shared, commands, drainBackground: async () => undefined,
    closeOwners: closeBusiness, reopen: async () => { lease = await shared.acquire(); reopens++; }, invalidate: () => undefined });
  const host = storage.withClosedDatabase.bind(storage); storage.withClosedDatabase = (task) => maintenance.withClosedDatabase(() => host(task));
  const completion = new ReturnPointCompletion(store, { kind: "RESTORE", createPoint: (plan) => store.createPoint(plan) });
  const recoverPublished = () => recoverRuntimeRestore(() => store.journal().readPending(), (plan) => new HostManagedRestoreStorage(root, plan.operationId),
    async () => existsSync(live), new ReturnPointCompletion(store));
  const job: PreparedRestoreIdentity = { id, currentContentSha256: hashContent(live), incomingSha256: fileHash(storage.path("INCOMING")) };
  const options = { storage, journal: store.journal(), completion, currentContentSha256: async () => {
    assert.equal(maintenance.state, "CLOSED"); return hashContent(live);
  }, checkSpace: async () => undefined, recoverPublished };
  return { root, images, live, photo, storage, store, commands, maintenance, job, options, closeBusiness,
    write: (name: string) => commands.run(() => lease!.writer.write((tx) => tx.run("UPDATE workspaces SET display_name=?", [name]))),
    wal: () => commands.run(() => lease!.connection.run("PRAGMA journal_mode=WAL")),
    get opens() { return opens; }, get reopens() { return reopens; },
    async cleanup() { await closeBusiness(); rmSync(root, { recursive: true, force: true }); } };
}

test("R06 prepared application compares logical current state under one maintenance lease before replacing files", async () => {
  const f = await fixture(); const incoming = readFileSync(f.storage.path("INCOMING"));
  try {
    assert.equal(await applyPreparedRestore(f.job, f.options), "COMMITTED");
    assert.deepEqual(readFileSync(f.live), incoming); assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(f.reopens, 1);
    assert.equal(parseReturnPointState(await f.store.readState()).point?.operationId, f.job.id);
  } finally { await f.cleanup(); }
});
test("R06 an intervening business write rejects stale confirmation and reopens healthy unchanged current data", async () => {
  const f = await fixture();
  try {
    await f.write("NEW BUSINESS DATA"); const current = hashContent(f.live);
    await assert.rejects(applyPreparedRestore(f.job, f.options), failure("RESTORE_STALE_PREVIEW"));
    assert.equal(hashContent(f.live), current); assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(f.reopens, 1);
    assert.equal(existsSync(f.storage.path("SAFETY")), false); assert.equal(await f.store.readState(), null);
    await f.write("STILL USABLE");
  } finally { await f.cleanup(); }
});
test("R06 a real WAL checkpoint changes raw bytes without invalidating the logical confirmation", async () => {
  const f = await fixture();
  try {
    await f.wal(); await f.write("COMMITTED IN WAL");
    const job = { ...f.job, currentContentSha256: hashContent(f.live) }; const rawBefore = fileHash(f.live);
    assert.equal(existsSync(`${f.live}-wal`), true);
    assert.equal(await applyPreparedRestore(job, f.options), "COMMITTED");
    assert.notEqual(rawBefore, fileHash(f.storage.path("SAFETY")), "closing the runtime checkpoints real WAL");
    const point = parseReturnPointState(await f.store.readState()).point!;
    const db = new DatabaseSync(f.store.pointFile(point), { readOnly: true });
    try { assert.equal(db.prepare("SELECT display_name FROM workspaces").get()?.display_name, "COMMITTED IN WAL"); } finally { db.close(); }
    assert.equal(f.maintenance.state, "ACTIVE");
  } finally { await f.cleanup(); }
});
for (const corrupt of [false, true]) test(`R06 ${corrupt ? "invalid" : "changed"} staged input is rejected before safety or journal mutation`, async () => {
  const f = await fixture();
  try {
    const before = hashContent(f.live);
    if (corrupt) writeFileSync(f.storage.path("INCOMING"), "SYNTHETIC INVALID SQLITE");
    else { const db = new DatabaseSync(f.storage.path("INCOMING")); db.exec("UPDATE workspaces SET display_name='CHANGED SOURCE'"); db.close(); }
    await assert.rejects(applyPreparedRestore(f.job, f.options), failure("RESTORE_INVALID_BACKUP"));
    assert.equal(hashContent(f.live), before); assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(await f.store.journal().readPending(), null);
  } finally { await f.cleanup(); }
});
test("R06 insufficient capacity is a normal preflight rejection, without leaving the app in recovery mode", async () => {
  const f = await fixture();
  try {
    const before = hashContent(f.live);
    await assert.rejects(applyPreparedRestore(f.job, { ...f.options, checkSpace: async () => { throw new RestoreActionError("RESTORE_NO_SPACE"); } }), failure("RESTORE_NO_SPACE"));
    assert.equal(hashContent(f.live), before); assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(await f.store.readState(), null);
  } finally { await f.cleanup(); }
});
test("R06 failed full point preparation proves current data intact before returning an ordinary error", async () => {
  const f = await fixture();
  try {
    const before = hashContent(f.live); rmSync(f.photo);
    await assert.rejects(applyPreparedRestore(f.job, f.options), failure("RESTORE_FAILED"));
    assert.equal(hashContent(f.live), before); assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(await f.store.journal().readPending(), null);
  } finally { await f.cleanup(); }
});
test("R06 failed physical switch is fully retired by the cold protocol before ordinary runtime returns", async () => {
  let failed = false;
  const f = await fixture((event) => { if (event === "move:INCOMING:LIVE" && !failed) { failed = true; throw new Error("SYNTHETIC_IO"); } });
  try {
    const before = hashContent(f.live); assert.equal(await applyPreparedRestore(f.job, f.options), "ROLLED_BACK");
    assert.equal(hashContent(f.live), before); assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(parseReturnPointState(await f.store.readState()).point, null);
  } finally { await f.cleanup(); }
});
test("R06 a transient point state write finishes recovery inside the same closed lease before reporting success", async () => {
  const f = await fixture(); const write = f.store.writeState.bind(f.store); let attempts = 0;
  try {
    f.store.writeState = async (state) => { if (attempts++ === 0) throw new Error("SYNTHETIC_TRANSIENT_IO"); return write(state); };
    assert.equal(await applyPreparedRestore(f.job, f.options), "COMMITTED"); assert.equal(attempts, 2); assert.equal(f.reopens, 1);
    assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(parseReturnPointState(await f.store.readState()).point?.operationId, f.job.id);
  } finally { await f.cleanup(); }
});
test("R06 unresolved point publication keeps runtime closed, and later recovery restores admission safely", async () => {
  const f = await fixture(); const write = f.store.writeState.bind(f.store);
  try {
    f.store.writeState = async () => { throw new Error("SYNTHETIC_PERSISTENT_IO"); };
    await assert.rejects(applyPreparedRestore(f.job, f.options), failure("RESTORE_RECOVERY_REQUIRED"));
    assert.equal(f.maintenance.state, "RECOVERY_REQUIRED"); assert.equal(f.reopens, 0); await assert.rejects(f.write("MUST NOT RUN"));
    f.store.writeState = write; await f.maintenance.withClosedDatabase(() => f.options.recoverPublished());
    assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(f.reopens, 1); await f.write("AFTER RECOVERY");
  } finally { await f.cleanup(); }
});
test("R06 prepared identity is captured before awaiting runtime drain", async () => {
  const f = await fixture();
  try {
    const input = { ...f.job }; const applying = applyPreparedRestore(input, f.options);
    input.id = randomUUID(); input.incomingSha256 = "0".repeat(64);
    assert.equal(await applying, "COMMITTED"); assert.equal(parseReturnPointState(await f.store.readState()).point?.operationId, f.job.id);
  } finally { await f.cleanup(); }
});
test("R06 missing LIVE fails closed without creating a new empty database", async () => {
  const f = await fixture();
  try {
    await f.closeBusiness(); rmSync(f.live);
    await assert.rejects(applyPreparedRestore(f.job, f.options), failure("RESTORE_RECOVERY_REQUIRED"));
    assert.equal(existsSync(f.live), false); assert.equal(f.maintenance.state, "RECOVERY_REQUIRED"); assert.equal(f.reopens, 0);
  } finally { await f.cleanup(); }
});
test("R06 capacity estimate reserves safety/point/metadata space and rejects unsafe arithmetic", () => {
  const full = restoreSpaceRequired(1024 * 1024, 512 * 1024, 1, "RESTORE");
  assert.ok(full > 4 * 1024 * 1024); assert.ok(restoreSpaceRequired(1024 * 1024, 512 * 1024, 1, "RETURN") < full);
  for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => restoreSpaceRequired(value, 10, 1, "RESTORE"), failure("RESTORE_NO_SPACE"));
});
