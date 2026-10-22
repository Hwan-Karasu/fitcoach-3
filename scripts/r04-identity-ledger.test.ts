import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCandidateIdentityLedger, type CandidateIdentityContext } from "./r04/CandidateIdentityLedger.ts";
import { projectClientIdentityDrafts } from "./r04/ProjectClientIdentityDraft.ts";
import type { LegacyClientIdentityCandidate } from "./r04/LegacyClientIdentitySourceReader.ts";

const context: CandidateIdentityContext = {
  sourceSha256: "a".repeat(64), accountScope: "synthetic-account",
  sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer",
};
const key = (id: string) => JSON.stringify([context.accountScope, id]);
const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";
const uuidC = "33333333-3333-4333-8333-333333333333";
function memory(run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:"); try { run(db); } finally { db.close(); }
}
function file(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-id-ledger-"));
  try { run(join(dir, "synthetic-staging.sqlite")); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("candidate IDs survive closing/reopening the staging file and reordered retries", () => file((path) => {
  let db = new DatabaseSync(path);
  try {
    const ledger = prepareCandidateIdentityLedger(db, context);
    const ids = [uuidA, uuidB];
    const result = ledger.reserveClientIds([key("b"), key("a")], () => ids.shift()!);
    assert.equal(result.get(key("a")), uuidA);
    db.close(); db = new DatabaseSync(path);
    const reopened = prepareCandidateIdentityLedger(db, context);
    assert.deepEqual(reopened.reserveClientIds([key("a"), key("b")], () => { throw new Error("must not allocate"); }), result);
    assert.equal(reopened.loadClientDraftIds().workspaces.get(JSON.stringify([context.accountScope, context.sourceWorkspaceId])), "local-trainer");
  } finally { db.close(); }
}));

test("every allocation failure rolls back the entire batch and permits a clean retry", () => {
  for (const failAt of [0, 1, 2]) memory((db) => {
    const ledger = prepareCandidateIdentityLedger(db, context);
    let calls = 0;
    assert.throws(() => ledger.reserveClientIds([key("a"), key("b"), key("c")], () => {
      if (calls === failAt) throw new Error("synthetic crash");
      return [uuidA, uuidB, uuidC][calls++]!;
    }), /R04_ID_LEDGER_WRITE_FAILED/u);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(db.isTransaction, false);
    const values = [uuidA, uuidB, uuidC];
    assert.equal(ledger.reserveClientIds([key("a"), key("b"), key("c")], () => values.shift()!).size, 3);
  });
});

test("collision and invalid generated UUID cannot leave partial client mappings", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context);
  assert.throws(() => ledger.reserveClientIds([key("a"), key("b")], () => uuidA), /TARGET_COLLISION/u);
  assert.equal(ledger.loadClientDraftIds().clients.size, 0);
  assert.throws(() => ledger.reserveClientIds([key("a")], () => "bad"), /INVALID_TARGET_ID/u);
  assert.equal(ledger.loadClientDraftIds().clients.size, 0);
}));

test("committed IDs remain intact when a later batch fails", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context);
  ledger.reserveClientIds([key("a")], () => uuidA);
  assert.throws(() => ledger.reserveClientIds([key("b")], () => uuidA), /TARGET_COLLISION/u);
  assert.equal(ledger.loadClientDraftIds().clients.get(key("a")), uuidA);
  assert.equal(ledger.loadClientDraftIds().clients.size, 1);
}));

test("different source hash, account, source workspace or target workspace is rejected without changing bytes", () => file((path) => {
  let db = new DatabaseSync(path);
  prepareCandidateIdentityLedger(db, context).reserveClientIds([key("a")], () => uuidA);
  db.close();
  const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const before = hash();
  for (const changed of [{ sourceSha256: "b".repeat(64) }, { accountScope: "other" },
    { sourceWorkspaceId: "other" }, { targetWorkspaceId: "other" }]) {
    db = new DatabaseSync(path);
    try { assert.throws(() => prepareCandidateIdentityLedger(db, { ...context, ...changed }), /CONTEXT_MISMATCH/u); }
    finally { db.close(); }
    assert.equal(hash(), before);
  }
}));

test("old prototype format is rejected without rebuilding or modifying its file", () => file((path) => {
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE r04_candidate_identity(id INTEGER PRIMARY KEY,context_json TEXT);
      CREATE TABLE r04_candidate_ids(kind TEXT,source_key TEXT,target_id TEXT);`);
    db.prepare("INSERT INTO r04_candidate_identity VALUES(1,?)").run(JSON.stringify([
      1, context.sourceSha256, context.accountScope, context.sourceWorkspaceId, context.targetWorkspaceId,
    ]));
    const before = readFileSync(path);
    assert.throws(() => prepareCandidateIdentityLedger(db, context), /CONTEXT_MISMATCH/u);
    assert.deepEqual(readFileSync(path), before);
  } finally { db.close(); }
}));

test("a source or runtime-looking database is never claimed as a staging ledger", () => file((path) => {
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE clients(id TEXT PRIMARY KEY); INSERT INTO clients VALUES('synthetic-client')");
    const before = readFileSync(path);
    assert.throws(() => prepareCandidateIdentityLedger(db, context), /FOREIGN_DATABASE/u);
    assert.deepEqual(readFileSync(path), before);
    assert.equal(db.prepare("SELECT count(*) AS count FROM clients").get()?.count, 1);
  } finally { db.close(); }
}));

test("source keys cannot cross accounts or use ambiguous JSON/duplicate identities", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context);
  for (const value of ['["other","a"]', ' ["synthetic-account","a"]', '{}', '["synthetic-account",""]']) {
    assert.throws(() => ledger.reserveClientIds([value]), /SOURCE_KEY_INVALID/u);
  }
  assert.throws(() => ledger.reserveClientIds([key("a"), key("a")]), /DUPLICATE_SOURCE_KEY/u);
  assert.equal(ledger.loadClientDraftIds().clients.size, 0);
}));

test("opening through another SQLite connection reuses committed mapping", () => file((path) => {
  const first = new DatabaseSync(path), second = new DatabaseSync(path);
  try {
    const one = prepareCandidateIdentityLedger(first, context), two = prepareCandidateIdentityLedger(second, context);
    one.reserveClientIds([key("a")], () => uuidA);
    assert.equal(two.reserveClientIds([key("a")], () => uuidB).get(key("a")), uuidA);
    two.reserveClientIds([key("b")], () => uuidB);
    assert.equal(one.loadClientDraftIds().clients.size, 2);
  } finally { first.close(); second.close(); }
}));

test("caller context mutation cannot rebind an already prepared ledger", () => memory((db) => {
  const mutable = { ...context };
  const ledger = prepareCandidateIdentityLedger(db, mutable);
  mutable.accountScope = "other";
  assert.equal(ledger.reserveClientIds([key("a")], () => uuidA).get(key("a")), uuidA);
}));

test("tampered context or workspace mapping fails before returning IDs", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context);
  db.exec("UPDATE r04_candidate_ids SET target_id='other' WHERE kind='WORKSPACE'");
  assert.throws(() => ledger.loadClientDraftIds(), /CORRUPT/u);
  assert.throws(() => ledger.reserveClientIds([key("a")]), /CORRUPT/u);
}));

test("outer transaction is never committed or rolled back by the ledger", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context);
  db.exec("BEGIN");
  assert.throws(() => ledger.reserveClientIds([key("a")]), /TRANSACTION_REQUIRED_EXCLUSIVE/u);
  assert.equal(db.isTransaction, true);
  db.exec("ROLLBACK");
}));

test("durable IDs project both active and archived clients into the explicitly bound runtime workspace", () => memory((db) => {
  const source: LegacyClientIdentityCandidate[] = ["a", "b"].map((id, index) => ({
    sourceIdentityKey: key(id), accountScope: context.accountScope, sourceClientId: id,
    sourceWorkspaceId: context.sourceWorkspaceId, displayName: `Синтетический ${id}`,
    createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-02T10:00:00Z",
    archivedAt: index === 0 ? null : "2026-01-02T10:00:00Z", lifecycleCandidate: index === 0 ? "ACTIVE" : "ARCHIVED",
    issues: [], targetWorkspaceId: null, targetClientId: null,
  }));
  const ledger = prepareCandidateIdentityLedger(db, context), values = [uuidA, uuidB];
  ledger.reserveClientIds(source.map((row) => row.sourceIdentityKey), () => values.shift()!);
  const projection = projectClientIdentityDrafts(source, ledger.loadClientDraftIds(), context.targetWorkspaceId);
  assert.equal(projection.status, "projected-draft");
  if (projection.status !== "projected-draft") return;
  assert.equal(projection.rows.length, 2);
  assert.ok(projection.rows.every((row) => row.workspaceId === "local-trainer"));
  assert.equal(projection.rows[1]?.lifecycle, "ARCHIVED");
  assert.equal(projectClientIdentityDrafts(source, ledger.loadClientDraftIds(), "other").status, "blocked");
}));
