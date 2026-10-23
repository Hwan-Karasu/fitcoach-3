import type { DatabaseSync } from "node:sqlite";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import { projectLegacyClientProfile } from "./LegacyClientProfileProjection.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import { TRAINER_TAG_NAME_POLICY, trainerTagName, type ClientTagAssignment, type SafetyImportReview,
  type TrainerNote, type TrainerTag } from "../../apps/mobile/src/features/clients/domain/ClientWorkDataModel.ts";

/** Private R04 objects only. This is a normalized owner-shaped rehearsal, not
 * approved production DDL or a migration from an older rehearsal database. */
export const workDataRehearsalObjects: Readonly<Record<string, string>> = Object.fromEntries([
  "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_reviews", "r04_work_receipt",
].map((name) => [name, "table"]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function fail(code: string): never { throw new Error(`R04_ID_LEDGER_WORK_DATA_${code}`); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => compare(a, b));
    return "{" + entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("INVALID_PAYLOAD");
}
export function createWorkDataRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) return fail("TRANSACTION_REQUIRED");
  db.exec(`CREATE TABLE r04_work_ids(kind TEXT NOT NULL CHECK(kind IN ('NOTE','TAG','REVIEW')),source_key TEXT NOT NULL,
    target_id TEXT NOT NULL UNIQUE,PRIMARY KEY(kind,source_key));
    CREATE TABLE r04_work_notes(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,
      body TEXT NOT NULL CHECK(length(trim(body))>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),context_json TEXT NOT NULL CHECK(json_valid(context_json)),
      FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT);
    CREATE TABLE r04_work_tags(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
      name TEXT NOT NULL CHECK(length(trim(name))>0),normalized_name TEXT NOT NULL CHECK(length(trim(normalized_name))>0),color TEXT,
      lifecycle TEXT NOT NULL CHECK(lifecycle IN ('ACTIVE','ARCHIVED')),UNIQUE(workspace_id,normalized_name),UNIQUE(id,workspace_id));
    CREATE TABLE r04_work_assignments(workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,tag_id TEXT NOT NULL,
      PRIMARY KEY(workspace_id,client_id,tag_id),FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT,
      FOREIGN KEY(tag_id,workspace_id) REFERENCES r04_work_tags(id,workspace_id) ON DELETE RESTRICT);
    CREATE TABLE r04_work_reviews(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status='PENDING_REVIEW'),source_field TEXT NOT NULL CHECK(source_field IN ('diagnoses','injuries','pain','hardMovements','unwantedLoad')),
      body TEXT NOT NULL CHECK(length(trim(body))>0),imported_at TEXT NOT NULL,source_client_updated_at TEXT NOT NULL,
      FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT);
    CREATE TABLE r04_work_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),
      target_json TEXT NOT NULL CHECK(json_valid(target_json)));`);
}
export function stageLegacyClientWorkDataInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, allocate: () => string, checkpoint: () => void) {
  if (!db.isTransaction || !isExplicitTimestamp(importedAt)) return fail("TRANSACTION_REQUIRED");
  const ordered = [...cards].sort((a, b) => compare(a.identity.sourceIdentityKey, b.identity.sourceIdentityKey));
  const wantedIds = new Map<string, { kind: "NOTE" | "TAG" | "REVIEW"; sourceKey: string }>();
  const idKey = (kind: "NOTE" | "TAG" | "REVIEW", sourceKey: string) => JSON.stringify([kind, sourceKey]);
  const want = (kind: "NOTE" | "TAG" | "REVIEW", parts: readonly string[]) => {
    const sourceKey = JSON.stringify([context.accountScope, context.sourceWorkspaceId, ...parts]);
    const key = idKey(kind, sourceKey); wantedIds.set(key, { kind, sourceKey }); return key;
  };
  const tagNames = new Map<string, string[]>();
  const sources = ordered.map((card) => {
    if (card.identity.accountScope !== context.accountScope || card.identity.sourceWorkspaceId !== context.sourceWorkspaceId || card.legacyProfile === null) return fail("SCOPE_MISMATCH");
    const clientId = ids.clients.get(card.identity.sourceIdentityKey);
    const updatedAt = card.identity.updatedAt;
    if (!clientId || !isExplicitTimestamp(updatedAt)) return fail("CLIENT_MISSING");
    const profile = projectLegacyClientProfile(card.legacyProfile);
    if (profile.issues.length > 0) return fail("PROFILE_BLOCKED");
    const note = profile.workData.trainerNote;
    const tags = profile.workData.manualTags.map((raw, index) => {
      let parsed: ReturnType<typeof trainerTagName>;
      try { parsed = trainerTagName(raw); } catch { return fail("TAG_INVALID"); }
      const names = tagNames.get(parsed.key) ?? []; names.push(parsed.name); tagNames.set(parsed.key, names);
      return { raw, index, normalizedName: parsed.key, idKey: want("TAG", ["trainerTags", parsed.key]) };
    });
    const reviews = [...profile.workData.safety,
      ...(profile.workData.loadAvoidance === null ? [] : [{ sourceField: "unwantedLoad", text: profile.workData.loadAvoidance }])]
      .map((review) => ({ ...review, idKey: want("REVIEW", [card.identity.sourceClientId, review.sourceField]) }));
    return { card, clientId, updatedAt, tags, reviews, note, noteKey: note === null ? null : want("NOTE", [card.identity.sourceClientId, "trainerNotes"]) };
  });
  const prior = db.prepare("SELECT kind,source_key,target_id FROM r04_work_ids ORDER BY kind,source_key").all();
  const targetIds = new Map<string, string>(); const uniqueIds = new Set<string>();
  for (const row of prior) {
    const key = idKey(row.kind as "NOTE" | "TAG" | "REVIEW", String(row.source_key));
    if (!wantedIds.has(key) || typeof row.target_id !== "string" || !uuid.test(row.target_id) || uniqueIds.has(row.target_id)
      || db.prepare("SELECT 1 FROM r04_candidate_ids WHERE target_id=?").get(row.target_id)) return fail("IDENTITY_MISMATCH");
    targetIds.set(key, row.target_id); uniqueIds.add(row.target_id);
  }
  for (const [key, item] of [...wantedIds].sort(([a], [b]) => compare(a, b))) if (!targetIds.has(key)) {
    const id = allocate();
    if (!uuid.test(id) || uniqueIds.has(id) || db.prepare("SELECT 1 FROM r04_candidate_ids WHERE target_id=?").get(id)) return fail("IDENTITY_COLLISION");
    db.prepare("INSERT INTO r04_work_ids VALUES(?,?,?)").run(item.kind, item.sourceKey, id);
    targetIds.set(key, id); uniqueIds.add(id);
  }
  const notes: TrainerNote[] = [], tags: TrainerTag[] = [], assignments: ClientTagAssignment[] = [], reviews: SafetyImportReview[] = [];
  const provenance = sources.map((source) => {
    const { card, clientId, note, noteKey, updatedAt } = source;
    if (note !== null) notes.push({ id: targetIds.get(noteKey!)!, workspaceId: context.targetWorkspaceId, clientId, body: note,
      createdAt: importedAt, updatedAt: importedAt, pinned: false, context: { type: "LEGACY_IMPORT", reference: card.identity.sourceIdentityKey } });
    for (const tag of source.tags) {
      const tagId = targetIds.get(tag.idKey)!;
      if (!tags.some((item) => item.id === tagId)) tags.push({ id: tagId, workspaceId: context.targetWorkspaceId,
        name: [...tagNames.get(tag.normalizedName)!].sort(compare)[0]!, normalizedName: tag.normalizedName, color: null, lifecycle: "ACTIVE" });
      if (!assignments.some((item) => item.clientId === clientId && item.tagId === tagId)) assignments.push({ workspaceId: context.targetWorkspaceId, clientId, tagId });
    }
    for (const review of source.reviews) reviews.push({ id: targetIds.get(review.idKey)!, workspaceId: context.targetWorkspaceId,
      clientId, status: "PENDING_REVIEW", sourceField: review.sourceField as SafetyImportReview["sourceField"], body: review.text,
      importedAt, sourceClientUpdatedAt: updatedAt });
    return { sourceKey: card.identity.sourceIdentityKey, clientId, sourceClientUpdatedAt: updatedAt,
      noteId: noteKey === null ? null : targetIds.get(noteKey)!, noteTimeBasis: "IMPORT_TIME_SOURCE_NOTE_TIME_UNKNOWN",
      tags: source.tags.map((tag) => ({ sourceIndex: tag.index, sourceLabel: tag.raw, tagId: targetIds.get(tag.idKey)!, normalizedName: tag.normalizedName })),
      reviews: source.reviews.map((review) => ({ sourceField: review.sourceField, reviewId: targetIds.get(review.idKey)! })) };
  });
  notes.sort((a, b) => compare(a.id, b.id)); tags.sort((a, b) => compare(a.id, b.id)); reviews.sort((a, b) => compare(a.id, b.id));
  assignments.sort((a, b) => compare(a.clientId, b.clientId) || compare(a.tagId, b.tagId));
  const tables = [
    { name: "r04_work_notes", rows: notes.map((n) => ({ id: n.id, workspace_id: n.workspaceId, client_id: n.clientId, body: n.body,
      created_at: n.createdAt, updated_at: n.updatedAt, pinned: n.pinned ? 1 : 0, context_json: JSON.stringify(n.context) })) },
    { name: "r04_work_tags", rows: tags.map((t) => ({ id: t.id, workspace_id: t.workspaceId, name: t.name, normalized_name: t.normalizedName, color: t.color, lifecycle: t.lifecycle })) },
    { name: "r04_work_assignments", rows: assignments.map((a) => ({ workspace_id: a.workspaceId, client_id: a.clientId, tag_id: a.tagId })) },
    { name: "r04_work_reviews", rows: reviews.map((r) => ({ id: r.id, workspace_id: r.workspaceId, client_id: r.clientId, status: r.status,
      source_field: r.sourceField, body: r.body, imported_at: r.importedAt, source_client_updated_at: r.sourceClientUpdatedAt })) },
  ];
  const sourceJson = canonical(ordered.map((card) => ({ sourceKey: card.identity.sourceIdentityKey, raw: card.raw })));
  const targetJson = canonical({ tagNamePolicy: TRAINER_TAG_NAME_POLICY, notes, tags, assignments, reviews, provenance });
  const receipts = db.prepare("SELECT * FROM r04_work_receipt").all();
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_json !== sourceJson || receipts[0]?.target_json !== targetJson)) return fail("PARITY_MISMATCH");
  if (receipts.length === 0) {
    for (const table of tables) if (db.prepare(`SELECT count(*) AS n FROM ${table.name}`).get()?.n !== 0) return fail("FOREIGN_TARGET");
    for (const table of tables) {
      for (const row of table.rows) {
        const columns = Object.keys(row);
        db.prepare(`INSERT INTO ${table.name}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      }
      checkpoint();
    }
    db.prepare("INSERT INTO r04_work_receipt VALUES(1,?,?)").run(sourceJson, targetJson);
  }
  for (const table of tables) {
    const actual = db.prepare(`SELECT * FROM ${table.name}`).all().map((row) => canonical({ ...row })).sort(compare);
    const expected = table.rows.map((row) => canonical(row)).sort(compare);
    if (canonical(actual) !== canonical(expected)) return fail("PARITY_MISMATCH");
  }
  const receipt = db.prepare("SELECT * FROM r04_work_receipt WHERE id=1").get();
  if (receipt?.source_json !== sourceJson || receipt?.target_json !== targetJson) return fail("PARITY_MISMATCH");
  return { noteRows: notes.length, tagRows: tags.length, tagAssignmentRows: assignments.length,
    safetyReviewRows: reviews.length, activeSafetyRows: 0 as const, finalizable: false as const };
}
