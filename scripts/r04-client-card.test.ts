import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectLegacyClientCard, readLegacyClientCardsInSnapshot, summarizeLegacyClientCards } from "./r04/LegacyClientCardProjection.ts";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import type { LegacyClientIdentityCandidate } from "./r04/LegacyClientIdentitySourceReader.ts";

const context = { sourceSha256: "a".repeat(64), accountScope: "synthetic-account", sourceWorkspaceId: "synthetic-workspace", targetWorkspaceId: "local-trainer" };
const identity: LegacyClientIdentityCandidate = {
  sourceIdentityKey: JSON.stringify([context.accountScope, "synthetic-client"]), accountScope: context.accountScope,
  sourceClientId: "synthetic-client", sourceWorkspaceId: context.sourceWorkspaceId, displayName: "Синтетический клиент",
  createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-02T10:00:00Z", archivedAt: null,
  lifecycleCandidate: "ACTIVE", issues: [], targetWorkspaceId: null, targetClientId: null,
};
const raw = { id: "synthetic-client", workspace_id: context.sourceWorkspaceId, birthdate: "2000-01-02",
  height: "180,5", gender: "Мужской", avatar_emoji: "🏋️", profile_json: '{"trainerNotes":"Исходная заметка","healthCleared":false}',
  weight: "80", session_pack_total: "12", session_pack_used: "2", session_price: "1500", last_training: null };
const uuid = "11111111-1111-4111-8111-111111111111";
const options = { clientIdentityRehearsal: { createdAt: "2026-01-03T10:00:00Z" } };
function fixture(run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:"); try { run(db); } finally { db.close(); }
}

test("exact v2 base card projects to actual v3 values with original typed profile retained", () => {
  const candidate = projectLegacyClientCard(identity, raw);
  assert.deepEqual(candidate.fields, { birthDate: "2000-01-02", heightCmX10: 1805, sex: "MALE", emoji: "🏋️" });
  assert.equal(candidate.raw.profile_json, raw.profile_json);
  assert.deepEqual(candidate.legacyProfile, { trainerNotes: "Исходная заметка", healthCleared: false });
  assert.deepEqual(candidate.issues, []);
});

test("sex is mapped only from the two verified source labels; missing stays null", () => {
  assert.equal(projectLegacyClientCard(identity, { ...raw, gender: "Женский" }).fields?.sex, "FEMALE");
  assert.equal(projectLegacyClientCard(identity, { ...raw, gender: "" }).fields?.sex, null);
  assert.ok(projectLegacyClientCard(identity, { ...raw, gender: "MALE" }).issues.includes("R04_CLIENT_CARD_SEX_UNRESOLVED"));
});

test("height is never rounded; trailing zeros are lossless and missing height is null", () => {
  assert.equal(projectLegacyClientCard(identity, { ...raw, height: "180.5000" }).fields?.heightCmX10, 1805);
  assert.equal(projectLegacyClientCard(identity, { ...raw, height: "" }).fields?.heightCmX10, null);
  for (const height of ["180.55", "0", "-1", "180 см", "9007199254740992"]) {
    const candidate = projectLegacyClientCard(identity, { ...raw, height });
    assert.equal(candidate.fields, null);
    assert.equal(candidate.raw.height, height);
  }
});

test("invalid birth dates and unsupported emoji length cannot become silent defaults", () => {
  for (const birthdate of ["2000-02-30", "01.02.2000", "2999-01-01"]) {
    assert.ok(projectLegacyClientCard(identity, { ...raw, birthdate }).issues.includes("R04_CLIENT_CARD_BIRTH_DATE_INVALID"));
  }
  assert.equal(projectLegacyClientCard(identity, { ...raw, birthdate: "" }).fields?.birthDate, null);
  assert.ok(projectLegacyClientCard(identity, { ...raw, avatar_emoji: "123456789" }).issues.includes("R04_CLIENT_CARD_EMOJI_INVALID"));
});

test("invalid profile JSON is retained and blocks the card rather than being replaced with defaults", () => {
  const candidate = projectLegacyClientCard(identity, { ...raw, profile_json: "{broken" });
  assert.equal(candidate.fields, null);
  assert.equal(candidate.raw.profile_json, "{broken");
  assert.equal(candidate.legacyProfile, null);
});

test("foreign source row and source owner are rejected before card conversion", () => {
  assert.throws(() => projectLegacyClientCard(identity, { ...raw, id: "other" }), /SCOPE_MISMATCH/u);
  assert.throws(() => projectLegacyClientCard(identity, { ...raw, workspace_id: "other" }), /SCOPE_MISMATCH/u);
});

test("card fields, opaque original profile and IDs commit atomically into the rehearsal", () => fixture((db) => {
  const candidate = projectLegacyClientCard(identity, raw), ledger = prepareCandidateIdentityLedger(db, context, options);
  ledger.stageClientCards([candidate], () => uuid);
  const stored = db.prepare("SELECT * FROM clients WHERE id=?").get(uuid)!;
  assert.equal(stored.birth_date, "2000-01-02");
  assert.equal(stored.height_cm_x10, 1805);
  assert.equal(stored.sex, "MALE");
  assert.equal(stored.emoji, "🏋️");
  const retained = db.prepare("SELECT source_payload_json FROM r04_candidate_ids WHERE kind='CLIENT'").get()!;
  assert.deepEqual(JSON.parse(String(retained.source_payload_json)), raw);
  assert.equal(ledger.stageClientCards([candidate], () => { throw new Error("no new UUID"); }).unchangedRows, 1);
}));

test("failure after card insert rolls back both structured card and retained original payload", () => fixture((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  assert.throws(() => ledger.stageClientCards([projectLegacyClientCard(identity, raw)], () => uuid, (stage) => {
    if (stage === "after-client") throw new Error("synthetic interruption");
  }), /WRITE_FAILED/u);
  assert.equal(db.prepare("SELECT count(*) AS count FROM clients").get()?.count, 0);
  assert.equal(ledger.loadClientDraftIds().clients.size, 0);
}));

test("raw profile drift blocks replay even if converted card fields are unchanged", () => fixture((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  ledger.stageClientCards([projectLegacyClientCard(identity, raw)], () => uuid);
  assert.throws(() => ledger.stageClientCards([projectLegacyClientCard(identity, { ...raw, profile_json: "{}" })]), /PARITY_MISMATCH/u);
  assert.equal(db.prepare("SELECT source_payload_json FROM r04_candidate_ids WHERE kind='CLIENT'").get()?.source_payload_json, JSON.stringify(raw));
  assert.throws(() => ledger.stageClientIdentities([identity]), /PARITY_MISMATCH/u);
}));

test("card and original source payload survive file close/reopen without allocating new IDs", () => {
  const directory = mkdtempSync(join(tmpdir(), "athlete-client-card-"));
  const path = join(directory, "synthetic-stage.sqlite");
  let db = new DatabaseSync(path);
  try {
    const candidate = projectLegacyClientCard(identity, raw);
    prepareCandidateIdentityLedger(db, context, options).stageClientCards([candidate], () => uuid);
    db.close(); db = new DatabaseSync(path);
    const ledger = prepareCandidateIdentityLedger(db, context, options);
    assert.equal(ledger.stageClientCards([candidate], () => { throw new Error("no new ID"); }).unchangedRows, 1);
    assert.equal(db.prepare("SELECT height_cm_x10 FROM clients WHERE id=?").get(uuid)?.height_cm_x10, 1805);
    assert.deepEqual(JSON.parse(String(db.prepare("SELECT source_payload_json FROM r04_candidate_ids WHERE kind='CLIENT'").get()?.source_payload_json)), raw);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("blocked card does not allocate IDs or overwrite structured data", () => fixture((db) => {
  const ledger = prepareCandidateIdentityLedger(db, context, options);
  assert.throws(() => ledger.stageClientCards([projectLegacyClientCard(identity, { ...raw, height: "bad" })]), /CARD_BLOCKED/u);
  assert.equal(ledger.loadClientDraftIds().clients.size, 0);
}));

test("reader requires complete coverage and retains every source column", () => fixture((db) => {
  db.exec("CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT,weight TEXT)");
  db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,?,?,?)").run(raw.id, raw.workspace_id, raw.birthdate, raw.height, raw.gender, raw.avatar_emoji, raw.profile_json, raw.weight);
  const candidates = readLegacyClientCardsInSnapshot(db, context.accountScope, [identity]);
  assert.equal(candidates[0]?.raw.weight, "80");
  assert.throws(() => readLegacyClientCardsInSnapshot(db, context.accountScope, []), /COVERAGE_MISMATCH/u);
  assert.throws(() => readLegacyClientCardsInSnapshot(db, "other", [identity]), /SCOPE_MISMATCH/u);
}));

test("card aggregate excludes names, birth dates, notes, values and IDs", () => {
  const summary = summarizeLegacyClientCards([projectLegacyClientCard(identity, raw)]);
  assert.equal(summary.cardCandidates, 1);
  assert.equal(summary.retainedLegacyProfileRows, 1);
  assert.doesNotMatch(JSON.stringify(summary), /synthetic|2000|Исходная|1805|profile_json/u);
  assert.equal(summary.targetWrites, 0);
});
