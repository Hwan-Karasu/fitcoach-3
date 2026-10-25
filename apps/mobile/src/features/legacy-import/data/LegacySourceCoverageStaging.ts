import type { LegacyStageExtension } from "../../../shared/migration/LegacyStageExtension.ts";
import { legacyStageQuery as query, legacyStageRun as run } from "../../../shared/migration/LegacyWritePlan.ts";
import { captureLegacySourceRow } from "../../../shared/migration/LegacySourceCapture.ts";
import { collectedLegacyTables, coverageDigest, coverageFailure, coverageRows, legacyCoverageMetadata } from "../domain/LegacySourceCoverage.ts";
import type { LegacyImportSourceSnapshots } from "../domain/LegacySourceSnapshots.ts";

export interface LegacySourceCoverageStageResult {
  readonly capturedTables: number;
  readonly retainedTables: number;
  readonly retainedRows: number;
  readonly reviewTables: number;
  readonly reviewRows: number;
  readonly reviewViews: number;
  readonly finalizable: false;
}
const objects = { r04_source_coverage: "table", r04_source_coverage_receipt: "table" } as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Coverage means capture, not complete semantic mapping. Unclaimed stores are
 * retained verbatim as tagged cells and remain explicitly unresolved. */
export function legacySourceCoverageStagingExtension(source: LegacyImportSourceSnapshots): LegacyStageExtension<LegacySourceCoverageStageResult> {
  const accountScope = source.coverage.accountScope;
  const entries = source.coverage.objects.map((r) => ({ ...r, columns: r.columns.map(captureLegacySourceRow) })).sort((a, b) => compare(a.name, b.name));
  const captured = new Map([...collectedLegacyTables(source)].map(([name, rows]) => [name, rows === null ? null : { count: rows.length, digest: coverageDigest(coverageRows(rows)) }]));
  return Object.freeze<LegacyStageExtension<LegacySourceCoverageStageResult>>({
    modeTags: Object.freeze(["SOURCE_COVERAGE_REHEARSAL_V1"]), objects: Object.freeze(objects),
    *createSchema() {
      yield run("CREATE TABLE r04_source_coverage(name TEXT PRIMARY KEY NOT NULL,object_type TEXT NOT NULL CHECK(object_type IN ('table','view')),schema_sql TEXT,columns_json TEXT NOT NULL CHECK(json_valid(columns_json)),disposition TEXT NOT NULL CHECK(disposition IN ('CAPTURED','METADATA','REVIEW_REQUIRED','SQLITE_INTERNAL')),row_count INTEGER CHECK(row_count IS NULL OR row_count>=0),rows_sha256 TEXT,retained_rows_json TEXT CHECK(retained_rows_json IS NULL OR json_valid(retained_rows_json)))");
      yield run("CREATE TABLE r04_source_coverage_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_sha256 TEXT NOT NULL,target_json TEXT NOT NULL CHECK(json_valid(target_json)),target_sha256 TEXT NOT NULL)");
    },
    *stage(context) {
      if (accountScope !== context.accountScope) return coverageFailure();
      const seen = new Set<string>();
      for (const r of entries) {
        if (typeof r.name !== "string" || !r.name || r.sql !== null && typeof r.sql !== "string") return coverageFailure();
        const name = r.name.replace(/[A-Z]/gu, (c) => c.toLowerCase());
        if (seen.has(name)) return coverageFailure(); seen.add(name);
        if (r.type === "view") {
          if (r.disposition !== "REVIEW_REQUIRED" || r.rowCount !== null || r.rowsSha256 !== null || r.retainedRows !== null || r.columns.length) return coverageFailure();
          continue;
        }
        if (r.type !== "table" || !Number.isSafeInteger(r.rowCount) || r.rowCount! < 0 || !r.columns.length) return coverageFailure();
        if (name.startsWith("sqlite_")) {
          if (r.disposition !== "SQLITE_INTERNAL" || r.rowsSha256 !== null || r.retainedRows !== null) return coverageFailure();
        } else if (captured.has(name)) {
          const table = captured.get(name);
          if (r.disposition !== "CAPTURED" || !table || r.rowCount !== table.count || r.rowsSha256 !== table.digest || typeof r.retainedRows !== "string" || coverageDigest(r.retainedRows) !== table.digest) return coverageFailure();
        } else {
          if (r.disposition !== (legacyCoverageMetadata.has(name) ? "METADATA" : "REVIEW_REQUIRED") || typeof r.retainedRows !== "string" || r.rowsSha256 !== coverageDigest(r.retainedRows)) return coverageFailure();
          let rows: unknown;
          try { rows = JSON.parse(r.retainedRows) as unknown; } catch { return coverageFailure(); }
          if (!Array.isArray(rows) || rows.length !== r.rowCount || rows.some((v) => typeof v !== "string") || JSON.stringify([...rows].sort(compare)) !== r.retainedRows) return coverageFailure();
        }
      }
      for (const [name, table] of captured) if (table !== null && !seen.has(name)) return coverageFailure();
      const rows = entries.map((r) => ({ name: r.name, object_type: r.type, schema_sql: r.sql, columns_json: coverageRows(r.columns), disposition: r.disposition,
        row_count: r.rowCount, rows_sha256: r.rowsSha256, retained_rows_json: r.retainedRows }));
      const targetJson = JSON.stringify(rows), targetSha = coverageDigest(targetJson);
      const receipts = yield query("SELECT * FROM r04_source_coverage_receipt");
      if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_sha256 !== context.sourceSha256 || receipts[0]?.target_json !== targetJson || receipts[0]?.target_sha256 !== targetSha)) return coverageFailure();
      if (!receipts.length) {
        if ((yield query("SELECT 1 FROM r04_source_coverage LIMIT 1")).length) return coverageFailure();
        for (const row of rows) yield run("INSERT INTO r04_source_coverage VALUES(?,?,?,?,?,?,?,?)", Object.values(row));
      }
      const actual = yield query("SELECT * FROM r04_source_coverage");
      if (JSON.stringify([...actual].sort((a, b) => compare(a.name as string, b.name as string))) !== targetJson) return coverageFailure();
      yield { kind: "checkpoint", phase: "after-source-coverage-rows" };
      if (!receipts.length) yield run("INSERT INTO r04_source_coverage_receipt VALUES(1,?,?,?)", [context.sourceSha256, targetJson, targetSha]);
      const receipt = (yield query("SELECT * FROM r04_source_coverage_receipt"))[0];
      if (receipt?.id !== 1 || receipt.source_sha256 !== context.sourceSha256 || receipt.target_json !== targetJson || receipt.target_sha256 !== targetSha) return coverageFailure();
      yield { kind: "checkpoint", phase: "after-source-coverage-receipt" };
      const retained = entries.filter((r) => r.retainedRows !== null), review = entries.filter((r) => r.disposition === "REVIEW_REQUIRED");
      return { capturedTables: entries.filter((r) => r.disposition === "CAPTURED").length, retainedTables: retained.length,
        retainedRows: retained.reduce((n, r) => n + (r.rowCount ?? 0), 0), reviewTables: review.filter((r) => r.type === "table").length,
        reviewRows: review.reduce((n, r) => n + (r.rowCount ?? 0), 0), reviewViews: review.filter((r) => r.type === "view").length, finalizable: false };
    },
  });
}
