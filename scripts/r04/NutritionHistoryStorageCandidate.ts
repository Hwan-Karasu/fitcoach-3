import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { DatabaseOwnerCatalog } from "../../apps/mobile/src/shared/db/DatabaseIdentity.ts";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import { loadStagedNutrition } from "./LegacyNutritionStage.ts";
import { isNutritionArchiveWeekSnapshot } from "../../apps/mobile/src/features/nutrition/domain/NutritionHistorySnapshot.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const checksum = (column: string) => `length(${column})=64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
/** Isolated prototype DDL. Never registered in production SCHEMA_OWNERS until
 * related migration/owner/Android gates have evidence. */
const statements = [
  `CREATE TABLE nutrition_history_sources(id TEXT PRIMARY KEY NOT NULL CHECK(${checksum("id")}),workspace_id TEXT NOT NULL,
    source_digest TEXT NOT NULL CHECK(${checksum("source_digest")}),source_format TEXT NOT NULL,imported_at TEXT NOT NULL,
    UNIQUE(id,workspace_id),FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT)`,
  `CREATE TABLE nutrition_history_weeks(id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,source_id TEXT NOT NULL,source_key TEXT NOT NULL,
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),snapshot_sha256 TEXT NOT NULL CHECK(${checksum("snapshot_sha256")}),
    source_row_json TEXT NOT NULL CHECK(json_valid(source_row_json)),source_row_sha256 TEXT NOT NULL CHECK(${checksum("source_row_sha256")}),
    review_json TEXT NOT NULL CHECK(json_valid(review_json)),review_sha256 TEXT NOT NULL CHECK(${checksum("review_sha256")}),
    UNIQUE(workspace_id,source_key),CHECK(json_extract(snapshot_json,'$.version') IS 1 AND json_extract(snapshot_json,'$.id') IS id
      AND json_extract(snapshot_json,'$.clientId') IS client_id AND json_extract(snapshot_json,'$.sourceKey') IS source_key),
    FOREIGN KEY(client_id,workspace_id) REFERENCES clients(id,workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY(source_id,workspace_id) REFERENCES nutrition_history_sources(id,workspace_id) ON DELETE RESTRICT)`,
  "CREATE INDEX nutrition_history_by_client ON nutrition_history_weeks(workspace_id,client_id)",
  "CREATE TRIGGER nutrition_history_source_immutable BEFORE UPDATE ON nutrition_history_sources BEGIN SELECT RAISE(ABORT,'NUTRITION_HISTORY_IMMUTABLE'); END",
  "CREATE TRIGGER nutrition_history_week_immutable BEFORE UPDATE ON nutrition_history_weeks BEGIN SELECT RAISE(ABORT,'NUTRITION_HISTORY_IMMUTABLE'); END",
];
export const NUTRITION_HISTORY_CANDIDATE_OWNER: DatabaseOwnerCatalog = { owner: "nutrition_history", ledger: "nutrition_history_schema_migrations",
  chain: [{ version: 1, checksum: `candidate-nutrition-history-${hash(statements.join("\n"))}`, statements }] };
const fail = (code: string): never => { throw new Error(`R04_NUTRITION_HISTORY_${code}`); };
const encode = (row: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
function sameFile(left: DatabaseSync, right: DatabaseSync): boolean {
  if (left === right) return true;
  const file = (db: DatabaseSync) => db.prepare("PRAGMA database_list").all().find((row) => row.name === "main")?.file;
  const a = file(left), b = file(right); if (typeof a !== "string" || !a || typeof b !== "string" || !b) return false;
  const first = statSync(a, { bigint: true }), second = statSync(b, { bigint: true });
  return first.dev === second.dev && first.ino === second.ino;
}

/** Copies normalized observations + their OWN client-scoped raw row and review.
 * Caller owns the entire candidate transaction, including native D01 rows. */
export function copyNutritionHistoryCandidate(staging: DatabaseSync, target: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  checkpoint: (phase: "after-source" | "after-week") => void = () => undefined) {
  if (!target.isTransaction || sameFile(staging, target)) return fail("ISOLATED_TRANSACTION_REQUIRED");
  loadStagedNutrition(staging);
  const binding = JSON.parse(staging.prepare("SELECT context_json FROM r04_candidate_identity WHERE id=1").get()!.context_json as string) as unknown[];
  if (binding[0] !== JSON.stringify([2, context.sourceSha256, context.accountScope, context.sourceWorkspaceId, context.targetWorkspaceId]) || binding[2] !== importedAt) return fail("CONTEXT_MISMATCH");
  const receipt = staging.prepare("SELECT * FROM r04_nutrition_receipt WHERE id=1").get()!;
  const source = JSON.parse(receipt.source_json as string) as { accountScope: string; tables: { nutrition_archive_weeks: string[] | null } };
  const manifest = JSON.parse(receipt.target_json as string) as { representations: { sourceKey: string; targetIds: string[] }[] };
  if (source.accountScope !== context.accountScope) return fail("CONTEXT_MISMATCH");
  const sourceRows = new Map((source.tables.nutrition_archive_weeks ?? []).map((raw) => {
    const row = JSON.parse(raw) as Record<string, unknown>;
    return [JSON.stringify([source.accountScope, "nutrition_archive_weeks", row.client_id, row.id]), raw] as const;
  }));
  const rows = staging.prepare("SELECT * FROM r04_nutrition_archive_weeks ORDER BY source_key").all();
  if (rows.length !== sourceRows.size) return fail("SOURCE_COVERAGE_MISMATCH");
  const insert = (table: string, row: Record<string, string>) => {
    const existing = target.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id!);
    if (existing) { if (encode(existing) !== encode(row)) return fail("DESTINATION_MISMATCH"); return; }
    const fields = Object.keys(row); target.prepare(`INSERT INTO ${table}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`).run(...Object.values(row));
  };
  const sourceId = hash(JSON.stringify([context.targetWorkspaceId, context.accountScope, context.sourceSha256]));
  if (rows.length) insert("nutrition_history_sources", { id: sourceId, workspace_id: context.targetWorkspaceId, source_digest: context.sourceSha256,
    source_format: "legacy-2", imported_at: importedAt });
  checkpoint("after-source");
  for (const row of rows) {
    const snapshot = JSON.parse(row.payload_json as string) as unknown, sourceRow = sourceRows.get(row.source_key as string);
    const representation = manifest.representations.find((item) => item.sourceKey === row.source_key);
    if (!isNutritionArchiveWeekSnapshot(snapshot) || snapshot.id !== row.id || snapshot.clientId !== row.client_id || snapshot.sourceKey !== row.source_key
      || row.workspace_id !== context.targetWorkspaceId || sourceRow === undefined || !representation
      || JSON.stringify(representation.targetIds) !== JSON.stringify([snapshot.id, ...snapshot.days.map((day) => day.id)])) return fail("REPRESENTATION_MISMATCH");
    const raw = JSON.parse(sourceRow) as { client_id: string };
    const client = staging.prepare("SELECT target_id FROM r04_candidate_ids WHERE kind='CLIENT' AND source_key=?").get(JSON.stringify([context.accountScope, raw.client_id]));
    if (client?.target_id !== snapshot.clientId) return fail("OWNER_MISMATCH");
    const review = JSON.stringify(representation), json = row.payload_json as string;
    insert("nutrition_history_weeks", { id: snapshot.id, workspace_id: context.targetWorkspaceId, client_id: snapshot.clientId, source_id: sourceId, source_key: snapshot.sourceKey,
      snapshot_json: json, snapshot_sha256: hash(json), source_row_json: sourceRow, source_row_sha256: hash(sourceRow), review_json: review, review_sha256: hash(review) });
    checkpoint("after-week");
  }
  return { historyRows: rows.length, sourceId, finalizable: false as const };
}
