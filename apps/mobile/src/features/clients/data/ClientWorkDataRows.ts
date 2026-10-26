import type { SqlValue } from "../../../shared/db/SqlitePort.ts";
import type { SafetyImportReview } from "../domain/ClientWorkDataModel.ts";
import { trainerTagName, TRAINER_TAG_NAME_POLICY } from "../domain/ClientWorkDataModel.ts";
import type { ClientWorkImportEvidence, StoredTrainerNote, StoredTrainerTag } from "../domain/ClientWorkDataPort.ts";

export const WORK_DATA_FORMAT = { version: 1, tagNamePolicy: TRAINER_TAG_NAME_POLICY } as const;
export const WORK_DATA_TABLES = ["trainer_notes", "trainer_tags", "client_tag_assignments", "client_safety_import_reviews", "client_work_import_evidence"] as const;
export type WorkDataTable = typeof WORK_DATA_TABLES[number];
export type WorkDataRow = Readonly<Record<string, SqlValue>>;
export type WorkDataRows = Readonly<Record<WorkDataTable, readonly WorkDataRow[]>>;
export const WORK_DATA_COLUMNS: Readonly<Record<WorkDataTable, readonly string[]>> = {
  trainer_notes: ["id", "workspace_id", "client_id", "body", "created_at", "updated_at", "pinned", "context_json", "revision"],
  trainer_tags: ["id", "workspace_id", "name", "normalized_name", "color", "lifecycle", "revision"],
  client_tag_assignments: ["workspace_id", "client_id", "tag_id"],
  client_safety_import_reviews: ["id", "workspace_id", "client_id", "status", "source_field", "body", "imported_at", "source_client_updated_at"],
  client_work_import_evidence: ["workspace_id", "client_id", "source_sha256", "source_key", "imported_at", "source_json", "projection_json"],
};
export function workDataFail(code: string): never { throw new Error(`CLIENT_WORK_DATA_${code}`); }
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const workDataTime = (v: unknown): v is string => text(v) && /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(v) && Number.isFinite(Date.parse(v));
export const workDataRevision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const objectJson = (v: unknown) => {
  if (typeof v !== "string") return false;
  try { const value: unknown = JSON.parse(v); return value !== null && typeof value === "object" && !Array.isArray(value); } catch { return false; }
};
export function workNote(r: WorkDataRow): StoredTrainerNote {
  if (![r.id, r.workspace_id, r.client_id, r.body].every(text) || !workDataTime(r.created_at) || !workDataTime(r.updated_at)
    || !workDataRevision(r.revision) || ![0, 1].includes(r.pinned as number) || typeof r.context_json !== "string") return workDataFail("ROW_INVALID");
  let context: unknown; try { context = JSON.parse(r.context_json); } catch { return workDataFail("ROW_INVALID"); }
  if (context !== null && (typeof context !== "object" || Array.isArray(context) || (context as Record<string, unknown>).type !== "LEGACY_IMPORT"
    || !text((context as Record<string, unknown>).reference) || Object.keys(context).length !== 2)) return workDataFail("ROW_INVALID");
  return { id: r.id as string, workspaceId: r.workspace_id as string, clientId: r.client_id as string, body: r.body as string,
    createdAt: r.created_at, updatedAt: r.updated_at, pinned: r.pinned === 1, context: context as StoredTrainerNote["context"], revision: r.revision };
}
export function workTag(r: WorkDataRow): StoredTrainerTag {
  if (![r.id, r.workspace_id, r.name, r.normalized_name].every(text) || !workDataRevision(r.revision)
    || r.color !== null && !text(r.color) || !["ACTIVE", "ARCHIVED"].includes(r.lifecycle as string)) return workDataFail("ROW_INVALID");
  const normalized = trainerTagName(r.name as string);
  if (normalized.name !== r.name || normalized.key !== r.normalized_name) return workDataFail("ROW_INVALID");
  return { id: r.id as string, workspaceId: r.workspace_id as string, name: r.name as string, normalizedName: r.normalized_name as string,
    color: r.color as string | null, lifecycle: r.lifecycle as StoredTrainerTag["lifecycle"], revision: r.revision };
}
export function workReview(r: WorkDataRow): SafetyImportReview {
  if (![r.id, r.workspace_id, r.client_id, r.body].every(text) || r.status !== "PENDING_REVIEW"
    || !["diagnoses", "injuries", "pain", "hardMovements", "unwantedLoad"].includes(r.source_field as string)
    || !workDataTime(r.imported_at) || !workDataTime(r.source_client_updated_at)) return workDataFail("ROW_INVALID");
  return { id: r.id as string, workspaceId: r.workspace_id as string, clientId: r.client_id as string, body: r.body as string,
    status: "PENDING_REVIEW", sourceField: r.source_field as SafetyImportReview["sourceField"], importedAt: r.imported_at, sourceClientUpdatedAt: r.source_client_updated_at };
}
export function workEvidence(r: WorkDataRow): ClientWorkImportEvidence {
  if (![r.workspace_id, r.client_id, r.source_key].every(text) || typeof r.source_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(r.source_sha256)
    || !workDataTime(r.imported_at) || !objectJson(r.source_json) || !objectJson(r.projection_json)) return workDataFail("ROW_INVALID");
  return { workspaceId: r.workspace_id as string, clientId: r.client_id as string, sourceSha256: r.source_sha256, sourceKey: r.source_key as string,
    importedAt: r.imported_at, sourceJson: r.source_json as string, projectionJson: r.projection_json as string };
}
export function checkWorkDataRow(table: WorkDataTable, row: WorkDataRow): void {
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...WORK_DATA_COLUMNS[table]].sort())) workDataFail("ROW_INVALID");
  if (table === "trainer_notes") workNote(row);
  else if (table === "trainer_tags") workTag(row);
  else if (table === "client_safety_import_reviews") workReview(row);
  else if (table === "client_work_import_evidence") workEvidence(row);
  else if (![row.workspace_id, row.client_id, row.tag_id].every(text)) workDataFail("ROW_INVALID");
}
