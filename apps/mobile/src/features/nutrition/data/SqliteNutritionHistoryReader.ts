import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import { readStoredJson } from "../../../shared/db/StoredJson.ts";
import { reportReadIssue } from "../../../shared/diagnostics/ReadIssues.ts";
import { isNutritionArchiveWeekSnapshot } from "../domain/NutritionHistorySnapshot.ts";
import type { NutritionHistoryPort, RetainedNutritionWeek } from "../domain/NutritionHistoryPort.ts";

interface Row {
  readonly id: string; readonly clientId: string; readonly sourceKey: string;
  readonly snapshot: string; readonly snapshotDigest: string; readonly sourceRow: string; readonly sourceRowDigest: string;
  readonly review: string; readonly reviewDigest: string; readonly sourceDigest: string; readonly sourceFormat: string; readonly importedAt: string;
}
const digest = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));
/** Must join the explicit client-deletion workflow when the candidate schema is admitted. */
export const nutritionHistoryClientDeletionParticipant = {
  owner: "nutrition.history", tables: ["nutrition_history_weeks"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    return (await tx.first<{ n: number }>("SELECT count(*) AS n FROM nutrition_history_weeks WHERE workspace_id=? AND client_id=?", [workspaceId, clientId]))?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM nutrition_history_weeks WHERE workspace_id=? AND client_id=?", [workspaceId, clientId]);
  },
};
/** Read adapter only. Schema installation/admission belongs to app composition.
 * Candidate schema is not yet registered in the production catalog. */
export class SqliteNutritionHistoryReader implements NutritionHistoryPort {
  private readonly reader: SqliteStatementPort;
  private readonly workspaceId: string;
  constructor(reader: SqliteStatementPort, workspaceId: string) {
    if (!workspaceId.trim()) throw new Error("NUTRITION_HISTORY_SCOPE_INVALID");
    this.reader = reader; this.workspaceId = workspaceId;
  }
  async listWeeks(clientId: string): Promise<readonly RetainedNutritionWeek[]> {
    const rows = await this.reader.all<Row>(`SELECT w.id,w.client_id AS clientId,w.source_key AS sourceKey,
      w.snapshot_json AS snapshot,w.snapshot_sha256 AS snapshotDigest,w.source_row_json AS sourceRow,w.source_row_sha256 AS sourceRowDigest,
      w.review_json AS review,w.review_sha256 AS reviewDigest,s.source_digest AS sourceDigest,s.source_format AS sourceFormat,s.imported_at AS importedAt
      FROM nutrition_history_weeks w JOIN nutrition_history_sources s ON s.id=w.source_id AND s.workspace_id=w.workspace_id
      WHERE w.workspace_id=? AND w.client_id=? ORDER BY w.source_key,w.id`, [this.workspaceId, clientId]);
    const result: RetainedNutritionWeek[] = [];
    for (const row of rows) {
      if (typeof row.snapshot !== "string" || typeof row.sourceRow !== "string" || typeof row.review !== "string"
        || digest(row.snapshot) !== row.snapshotDigest || digest(row.sourceRow) !== row.sourceRowDigest || digest(row.review) !== row.reviewDigest
        || typeof row.sourceDigest !== "string" || !/^[0-9a-f]{64}$/u.test(row.sourceDigest) || typeof row.sourceFormat !== "string" || !row.sourceFormat.trim()
        || typeof row.importedAt !== "string" || Number.isNaN(Date.parse(row.importedAt))) {
        reportReadIssue("nutrition.history"); continue;
      }
      const snapshot = readStoredJson(row.snapshot, isNutritionArchiveWeekSnapshot, "nutrition.history");
      if (snapshot === null) continue;
      if (snapshot.id !== row.id || snapshot.clientId !== row.clientId || snapshot.clientId !== clientId || snapshot.sourceKey !== row.sourceKey) {
        reportReadIssue("nutrition.history"); continue;
      }
      result.push({ snapshot, provenance: { sourceDigest: row.sourceDigest, sourceFormat: row.sourceFormat, importedAt: row.importedAt, sourceRowDigest: row.sourceRowDigest } });
    }
    return result;
  }
}
