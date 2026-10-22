import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import type { LegacyClientIdentityCandidate } from "./r04/LegacyClientIdentitySourceReader.ts";

const context = { sourceSha256: "a".repeat(64), accountScope: "synthetic-account",
  sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer" };
const options = { clientIdentityRehearsal: { createdAt: "2026-01-03T10:00:00Z" } };
const uuidA = "11111111-1111-4111-8111-111111111111", uuidB = "22222222-2222-4222-8222-222222222222";
const source: readonly LegacyClientIdentityCandidate[] = ["a", "b"].map((id, index) => ({
  sourceIdentityKey: JSON.stringify([context.accountScope, id]), accountScope: context.accountScope,
  sourceClientId: id, sourceWorkspaceId: context.sourceWorkspaceId, displayName: `Синтетический ${id}`,
  createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-02T10:00:00Z",
  archivedAt: index === 0 ? null : "2026-01-02T10:00:00Z", lifecycleCandidate: index === 0 ? "ACTIVE" : "ARCHIVED",
  issues: [], targetWorkspaceId: null, targetClientId: null,
}));
function allocator() { const values = [uuidA, uuidB]; return () => values.shift()!; }
function memory(run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:"); try { run(db); } finally { db.close(); }
}
const clientCount = (db: DatabaseSync) => db.prepare("SELECT count(*) AS count FROM clients").get()!.count;

test("client identities and ID map commit together using the actual v3 client table definition", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  assert.deepEqual(ledger.stageClientIdentities(source, allocator()), {
    status: "identity-rehearsal-staged", sourceRows: 2, targetRows: 2, insertedRows: 2, unchangedRows: 0, sourceWrites: 0,
  });
  assert.equal(clientCount(db), 2);
  assert.equal(ledger.loadClientDraftIds().clients.size, 2);
  const active = db.prepare("SELECT * FROM clients WHERE id=?").get(uuidA)!;
  const archived = db.prepare("SELECT * FROM clients WHERE id=?").get(uuidB)!;
  assert.equal(active.display_name, source[0]!.displayName);
  assert.equal(active.archived_at, null);
  assert.equal(archived.lifecycle, "ARCHIVED");
  assert.equal(archived.archived_at, source[1]!.archivedAt);
  assert.equal(archived.created_at, source[1]!.createdAt);
  assert.equal(archived.updated_at, source[1]!.updatedAt);
  assert.equal(active.revision, 1);
  assert.equal(active.contact_phone, null);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
}));

test("failure after IDs, either client or before commit rolls back both clients and new IDs", () => {
  for (const failAt of ["after-ids", "first-client", "second-client", "before-commit"]) memory((db) => {
    const ledger = prepareCandidateIdentityLedger(db, context, options);
    let clientCallbacks = 0;
    assert.throws(() => ledger.stageClientIdentities(source, allocator(), (stage) => {
      if (stage === "after-client") clientCallbacks += 1;
      if (stage === failAt || stage === "after-client" && (failAt === "first-client" && clientCallbacks === 1
        || failAt === "second-client" && clientCallbacks === 2)) throw new Error("synthetic interruption");
    }), /WRITE_FAILED/u);
    assert.equal(clientCount(db), 0);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
    assert.equal(db.isTransaction, false);
    assert.equal(ledger.stageClientIdentities(source, allocator()).insertedRows, 2);
  });
});

test("committed IDs survive an interrupted client batch and are used on retry", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  ledger.reserveClientIds(source.map((row) => row.sourceIdentityKey), allocator());
  assert.throws(() => ledger.stageClientIdentities(source, () => { throw new Error("no allocation"); }, () => {
    throw new Error("synthetic interruption");
  }), /WRITE_FAILED/u);
  assert.equal(clientCount(db), 0);
  assert.equal(ledger.loadClientDraftIds().clients.size, 2);
  ledger.stageClientIdentities(source, () => { throw new Error("no allocation"); });
  assert.equal(db.prepare("SELECT id FROM clients ORDER BY id").all()[0]?.id, uuidA);
}));

test("file reopen and reordered retry verify existing records without duplicates or revision increments", () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-client-rehearsal-"));
  const path = join(directory, "synthetic-stage.sqlite");
  let db = new DatabaseSync(path);
  try {
    prepareCandidateIdentityLedger(db, context, options).stageClientIdentities(source, allocator());
    db.close(); db = new DatabaseSync(path);
    const ledger = prepareCandidateIdentityLedger(db, context, options);
    const result = ledger.stageClientIdentities([...source].reverse(), () => { throw new Error("no allocation"); });
    assert.equal(result.unchangedRows, 2);
    assert.equal(result.insertedRows, 0);
    assert.equal(clientCount(db), 2);
    assert.ok(db.prepare("SELECT revision FROM clients").all().every((row) => row.revision === 1));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("changed source identity fields do not silently overwrite staged records", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  ledger.stageClientIdentities(source, allocator());
  assert.throws(() => ledger.stageClientIdentities([{ ...source[0]!, displayName: "Другое имя" }, source[1]!]), /PARITY_MISMATCH/u);
  assert.equal(db.prepare("SELECT display_name FROM clients WHERE id=?").get(uuidA)?.display_name, source[0]!.displayName);
}));

test("new contact/profile data in target is never erased by an identity-only replay", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  ledger.stageClientIdentities(source, allocator());
  db.exec("UPDATE clients SET contact_email='synthetic@example.invalid'");
  assert.throws(() => ledger.stageClientIdentities(source), /PARITY_MISMATCH/u);
  assert.equal(db.prepare("SELECT contact_email FROM clients WHERE id=?").get(uuidA)?.contact_email, "synthetic@example.invalid");
}));

test("partial or foreign client batch cannot truncate prior staged records", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  ledger.stageClientIdentities(source, allocator());
  assert.throws(() => ledger.stageClientIdentities([source[0]!]), /PARITY_MISMATCH/u);
  assert.throws(() => ledger.stageClientIdentities([{ ...source[0]!, sourceWorkspaceId: "foreign" }]), /SCOPE_MISMATCH/u);
  assert.equal(clientCount(db), 2);
}));

test("unresolved/deleted source row or SQL constraint failure rolls back all new IDs", () => {
  for (const changed of [{ issues: ["MISSING_NAME"] as const }, { lifecycleCandidate: "DELETED_SOURCE" as const }, { displayName: "  " }]) memory((db) => {
    const ledger = prepareCandidateIdentityLedger(db, context, options);
    assert.throws(() => ledger.stageClientIdentities([{ ...source[0]!, ...changed }, source[1]!], allocator()), /R04_ID_LEDGER_/u);
    assert.equal(clientCount(db), 0);
    assert.equal(ledger.loadClientDraftIds().clients.size, 0);
  });
});

test("rehearsal is explicit; default ledger cannot stage client data", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context);
  assert.throws(() => ledger.stageClientIdentities(source), /REHEARSAL_NOT_ENABLED/u);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='clients'").get(), undefined);
}));

test("rehearsal detects disabled foreign keys and unowned client records", () => memory((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  db.exec("PRAGMA foreign_keys=OFF");
  assert.throws(() => ledger.stageClientIdentities(source), /FOREIGN_KEYS_DISABLED/u);
  assert.equal(ledger.loadClientDraftIds().clients.size, 0);
  db.exec("PRAGMA foreign_keys=ON");
  db.prepare("INSERT INTO clients(id,workspace_id,display_name,lifecycle,revision,created_at,updated_at) VALUES(?,?,?,'ACTIVE',1,?,?)")
    .run(uuidA, "local-trainer", "Чужая тестовая запись", source[0]!.createdAt, source[0]!.updatedAt);
  assert.throws(() => ledger.stageClientIdentities(source), /CORRUPT/u);
}));
