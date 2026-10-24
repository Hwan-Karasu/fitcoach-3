import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareLegacyClientStaging } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStaging.ts";
import { readAdmittedLegacyDomainSnapshots } from "../apps/mobile/src/features/legacy-import/data/LegacySqliteSource.ts";
import type { NativeSqliteDatabase } from "../apps/mobile/src/shared/db/IsolatedSqliteConnection.ts";
import type { LegacyClientsSource } from "../apps/mobile/src/shared/migration/LegacyProfileSources.ts";
import { projectLegacyClientIdentities } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { projectLegacyClientCards } from "../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { seedLegacyBackupMetadata, updateLegacyManifestSize } from "./support/legacy-backup-metadata.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";

const scope = "portable-client-writer", createdAt = "2026-10-24T12:00:00Z";
const uuids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const allocate = () => { const values = [...uuids]; return () => values.shift()!; };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Call = { kind: "open" | "all" | "first" | "run" | "exec" | "close"; sql: string; handle: number };
function nativeFactory(path: string) {
  const calls: Call[] = [], handles = new Set<number>(); let next = 0;
  const state: { fail?: (call: Call) => boolean; after?: (call: Call, db: DatabaseSync) => void } = {};
  function call(kind: Call["kind"], sql: string, handle: number) {
    const value = { kind, sql, handle }; calls.push(value);
    if (state.fail?.(value)) throw new Error("PRIVATE native SQLite detail");
    return value;
  }
  const open = async (): Promise<NativeSqliteDatabase> => {
    const handle = ++next; call("open", "", handle); const db = new DatabaseSync(path); handles.add(handle);
    return {
      getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => {
        const value = call("all", sql, handle); await Promise.resolve(); const result = db.prepare(sql).all(...bindings as SQLInputValue[]) as Row[]; state.after?.(value, db); return result;
      },
      getFirstAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row | null> => {
        const value = call("first", sql, handle); await Promise.resolve(); const result = db.prepare(sql).get(...bindings as SQLInputValue[]) as Row | undefined; state.after?.(value, db); return result ?? null;
      },
      runAsync: async (sql: string, ...bindings: unknown[]) => {
        const value = call("run", sql, handle); await Promise.resolve(); const result = db.prepare(sql).run(...bindings as SQLInputValue[]); state.after?.(value, db);
        return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
      },
      execAsync: async (sql) => { const value = call("exec", sql, handle); await Promise.resolve(); db.exec(sql); state.after?.(value, db); },
      closeAsync: async () => { db.close(); handles.delete(handle); const value = call("close", "", handle); state.after?.(value, db); },
    };
  };
  return { open, state, calls, handles };
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-client-stage-"));
  try { await run(await setup(dir)); }
  finally {
    const absolute = resolve(dir); assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(basename(absolute).startsWith("athlete-r04-client-stage-")); rmSync(absolute, { recursive: true, force: true });
  }
}
async function setup(dir: string) {
  const sourcePath = join(dir, "source.sqlite"), stagePath = join(dir, "stage.sqlite"), sourceDb = new DatabaseSync(sourcePath);
  seedLegacyBackupMetadata(sourceDb, scope);
  sourceDb.exec(`UPDATE clients SET name='Same name',height='180,5',gender='Мужской',avatar_emoji='🏋️',profile_json='{"trainerNotes":"Original private note"}';
    INSERT INTO clients SELECT 'b',workspace_id,name,created_at,updated_at,'2026-10-03T12:00:00Z',deleted_at,birthdate,height,gender,avatar_emoji,profile_json FROM clients WHERE id='a'`);
  updateLegacyManifestSize(sourceDb); sourceDb.close(); const sourceSha256 = digest(sourcePath);
  const sourceNative = nativeFactory(sourcePath), admitted = await readAdmittedLegacyDomainSnapshots(sourceNative.open, statSync(sourcePath).size);
  assert.equal(sourceNative.handles.size, 0); assert.equal(digest(sourcePath), sourceSha256);
  const context = { sourceSha256, accountScope: admitted.admission.accountScope, sourceWorkspaceId: admitted.admission.sourceWorkspaceId!, targetWorkspaceId: "local-trainer" };
  return { dir, sourcePath, sourceSha256, stagePath, context, source: admitted.snapshots.clients, native: nativeFactory(stagePath) };
}
function records(path: string) {
  const db = new DatabaseSync(path);
  try { return ["r04_candidate_identity", "r04_candidate_ids", "workspaces", "clients"].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]); }
  finally { db.close(); }
}
function assertEmptyClients(path: string) {
  const db = new DatabaseSync(path);
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM clients").get()!.n, 0); assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0); }
  finally { db.close(); }
}

test("admitted source reaches async SQLite client staging with exactly the host rows and persisted stable IDs", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt);
  const result = await stage.stageClients(f.source, allocate());
  assert.equal(stage.finalizable, false); assert.equal(result.finalizable, false); assert.equal(result.insertedRows, 2);
  assert.equal(result.ids.clients.get(JSON.stringify([scope, "a"])), uuids[0]); assert.equal(result.ids.clients.get(JSON.stringify([scope, "b"])), uuids[1]);
  const hostPath = join(f.dir, "host.sqlite"), host = new DatabaseSync(hostPath);
  try {
    const ledger = prepareCandidateIdentityLedger(host, f.context, { clientIdentityRehearsal: { createdAt } });
    const cards = projectLegacyClientCards(f.source, projectLegacyClientIdentities(f.source));
    ledger.stageClientCards(cards, allocate());
  } finally { host.close(); }
  assert.deepEqual(records(f.stagePath), records(hostPath)); assert.equal(f.native.handles.size, 0);
  const db = new DatabaseSync(f.stagePath);
  try {
    assert.deepEqual(db.prepare("SELECT display_name,lifecycle,height_cm_x10 FROM clients ORDER BY id").all().map((row) => [row.display_name, row.lifecycle, row.height_cm_x10]), [["Same name", "ACTIVE", 1805], ["Same name", "ARCHIVED", 1805]]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
  assert.equal(digest(f.sourcePath), f.sourceSha256);
  assert.ok(f.native.calls.filter((call) => call.kind === "open").length >= 4);
}));

test("checkpoint failures roll back the complete async client/ID batch, then retry and reopen replay allocate nothing", async () => {
  for (const phase of ["after-ids", "after-client", "before-commit"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt);
    await assert.rejects(stage.stageClients(f.source, allocate(), (at) => { if (at === phase) throw new Error("PRIVATE injected failure"); }), { message: "R04_ID_LEDGER_WRITE_FAILED" });
    assertEmptyClients(f.stagePath); assert.equal(f.native.handles.size, 0);
    await stage.stageClients(f.source, allocate()); const before = records(f.stagePath);
    const reopened = await prepareLegacyClientStaging(f.native.open, f.context, createdAt);
    assert.equal((await reopened.stageClients({ ...f.source, rows: [...f.source.rows].reverse() }, () => assert.fail("replay allocated"))).unchangedRows, 2);
    assert.deepEqual(records(f.stagePath), before); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sourceSha256);
  });
});

test("separately committed IDs survive a later write failure and are reused by the async writer", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt), keys = f.source.rows.map((row) => JSON.stringify([scope, row.id]));
  const ids = await stage.reserveClientIds(keys, allocate());
  await assert.rejects(stage.stageClients(f.source, () => assert.fail("reserved ID allocated"), (at) => { if (at === "after-client") throw new Error("injected"); }), /WRITE_FAILED/u);
  assert.deepEqual((await stage.loadClientIds()).clients, ids);
  const result = await stage.stageClients(f.source, () => assert.fail("reserved ID allocated")); assert.deepEqual(result.ids.clients, ids);
  assert.equal(f.native.handles.size, 0);
}));

test("commit acknowledgement loss is recovered by parity replay without duplicate rows or new IDs", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt); let failed = false;
  f.native.state.after = (call) => { if (!failed && call.kind === "exec" && call.sql === "COMMIT") { failed = true; throw new Error("PRIVATE commit acknowledgement lost"); } };
  await assert.rejects(stage.stageClients(f.source, allocate()), { message: "R04_ID_LEDGER_WRITE_FAILED" });
  assert.equal(failed, true); assert.equal(f.native.handles.size, 0); const before = records(f.stagePath);
  f.native.state.after = undefined;
  const reopened = await prepareLegacyClientStaging(f.native.open, f.context, createdAt);
  assert.equal((await reopened.stageClients(f.source, () => assert.fail("committed ID allocated"))).unchangedRows, 2); assert.deepEqual(records(f.stagePath), before);
}));

test("native write and parity failures remain private, rollback atomically and allow a clean retry", async () => {
  for (const kind of ["insert", "parity", "commit-before"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt); let injected = false;
    f.native.state.fail = (call) => {
      if (!injected && (kind === "insert" && call.kind === "run" && call.sql.startsWith("INSERT INTO clients(") || kind === "commit-before" && call.kind === "exec" && call.sql === "COMMIT")) { injected = true; return true; }
      return false;
    };
    f.native.state.after = (call, db) => { if (!injected && kind === "parity" && call.kind === "run" && call.sql.startsWith("INSERT INTO clients(")) { injected = true; db.exec("UPDATE clients SET display_name='PRIVATE drift'"); } };
    await assert.rejects(stage.stageClients(f.source, allocate()), (error) => { assert.ok(error instanceof Error); assert.match(error.message, /^R04_ID_LEDGER_(?:WRITE_FAILED|CLIENT_PARITY_MISMATCH)$/u); assert.equal("cause" in error, false); return true; });
    assert.equal(injected, true); assertEmptyClients(f.stagePath); assert.equal(f.native.handles.size, 0);
    f.native.state.fail = undefined; f.native.state.after = undefined; assert.equal((await stage.stageClients(f.source, allocate())).insertedRows, 2);
  });
});

test("source/foreign database and changed job bindings are rejected before write configuration or byte changes", () => fixture(async (f) => {
  const sourceOpen = nativeFactory(f.sourcePath);
  await assert.rejects(prepareLegacyClientStaging(sourceOpen.open, f.context, createdAt), /FOREIGN_DATABASE/u);
  assert.equal(sourceOpen.calls.some((call) => call.kind === "exec" || call.kind === "run"), false); assert.equal(sourceOpen.handles.size, 0); assert.equal(digest(f.sourcePath), f.sourceSha256);
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt); await stage.stageClients(f.source, allocate()); const before = digest(f.stagePath);
  for (const changed of [{ sourceSha256: "a".repeat(64) }, { accountScope: "other" }, { sourceWorkspaceId: "other" }, { targetWorkspaceId: "other" }]) {
    const start = f.native.calls.length;
    await assert.rejects(prepareLegacyClientStaging(f.native.open, { ...f.context, ...changed }, createdAt), /CONTEXT_MISMATCH/u);
    assert.equal(f.native.calls.slice(start).some((call) => call.kind === "exec" || call.kind === "run"), false); assert.equal(digest(f.stagePath), before);
  }
}));

test("async staging snapshots caller inputs before awaiting and rejects raw unsupported values without defaults", () => fixture(async (f) => {
  const mutableContext = { ...f.context }, stage = await prepareLegacyClientStaging(f.native.open, mutableContext, createdAt);
  mutableContext.accountScope = "other";
  const rows = f.source.rows.map((row) => ({ ...row })), source: LegacyClientsSource = { accountScope: scope, rows };
  const pending = stage.stageClients(source, allocate()); rows[0]!.name = "Changed after call"; rows[0]!.height = "99";
  await pending; const db = new DatabaseSync(f.stagePath);
  try { assert.equal(db.prepare("SELECT display_name FROM clients WHERE id=?").get(uuids[0]!)!.display_name, "Same name"); } finally { db.close(); }
  const before = records(f.stagePath);
  for (const patch of [{ height: "180.55" }, { id: "" }, { extra: 9007199254740992 }, { extra: { unexpected: true } }]) {
    await assert.rejects(stage.stageClients({ ...f.source, rows: [{ ...f.source.rows[0]!, ...patch }, f.source.rows[1]!] }, () => assert.fail("bad input allocated")), /R04_(?:ID_LEDGER|CLIENT)_/u);
    assert.deepEqual(records(f.stagePath), before);
  }
}));

test("allocation collisions and failures close every handle without partial mappings", async () => {
  for (const kind of ["invalid", "collision", "throw"] as const) await fixture(async (f) => {
    const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt);
    await assert.rejects(stage.stageClients(f.source, () => { if (kind === "throw") throw new Error("PRIVATE allocator detail"); return kind === "invalid" ? "bad" : uuids[0]!; }), /R04_ID_LEDGER_(?:INVALID_TARGET_ID|TARGET_COLLISION|WRITE_FAILED)/u);
    assertEmptyClients(f.stagePath); assert.equal(f.native.handles.size, 0);
  });
});

test("initial schema write interruption leaves no partial ledger and a repeated preparation can recover", () => fixture(async (f) => {
  let failed = false;
  f.native.state.fail = (call) => {
    if (!failed && call.kind === "run" && call.sql.startsWith("CREATE TABLE clients ")) { failed = true; return true; }
    return false;
  };
  await assert.rejects(prepareLegacyClientStaging(f.native.open, f.context, createdAt), { message: "R04_ID_LEDGER_WRITE_FAILED" });
  assert.equal(failed, true); assert.equal(f.native.handles.size, 0);
  const db = new DatabaseSync(f.stagePath);
  try { assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_'").all(), []); } finally { db.close(); }
  f.native.state.fail = undefined;
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt); assert.equal((await stage.stageClients(f.source, allocate())).insertedRows, 2);
}));

test("handle-close failure after commit reports failure but replay preserves the committed IDs and rows", () => fixture(async (f) => {
  const stage = await prepareLegacyClientStaging(f.native.open, f.context, createdAt); let committed = false, failed = false;
  f.native.state.after = (call) => {
    if (call.kind === "exec" && call.sql === "COMMIT") committed = true;
    if (committed && !failed && call.kind === "close") { failed = true; throw new Error("PRIVATE close failure"); }
  };
  await assert.rejects(stage.stageClients(f.source, allocate()), { message: "R04_ID_LEDGER_WRITE_FAILED" });
  assert.equal(failed, true); assert.equal(f.native.handles.size, 0); const before = records(f.stagePath);
  f.native.state.after = undefined;
  const reopened = await prepareLegacyClientStaging(f.native.open, f.context, createdAt);
  assert.equal((await reopened.stageClients(f.source, () => assert.fail("close failure duplicated IDs"))).unchangedRows, 2);
  assert.deepEqual(records(f.stagePath), before);
}));
