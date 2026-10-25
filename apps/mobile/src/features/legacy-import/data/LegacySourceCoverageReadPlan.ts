import { collectedLegacyTables, coverageDigest, coverageFailure, coverageRows, legacyCoverageMetadata,
  type LegacySourceCoverage, type LegacySourceCoverageObject } from "../domain/LegacySourceCoverage.ts";
import type { LegacyImportSourceSnapshots, LegacySourceRow } from "../domain/LegacySourceSnapshots.ts";
import { readLegacySourceTable, type LegacySourceReadPlan } from "../../../shared/migration/LegacyReadPlan.ts";

/** Same pinned source transaction as the full collectors. Unknown regular tables
 * are retained without interpreting their payloads. Views are never executed. */
export function* legacySourceCoverageReadPlan(accountScope: string, source: Omit<LegacyImportSourceSnapshots, "coverage">): LegacySourceReadPlan<LegacySourceCoverage> {
  const schema = yield { sql: "SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name COLLATE BINARY", bindings: [] };
  const physical = yield { sql: "SELECT name,type FROM pragma_table_list WHERE schema='main'", bindings: [] };
  // Reading arbitrary virtual/shadow stores can invoke modules and is not a
  // generic row capture. They need an explicit source adapter before row capture.
  if (physical.some((r) => r.type === "virtual" || r.type === "shadow")) throw new Error("R04_SOURCE_COVERAGE_VIRTUAL_STORE_UNSUPPORTED");
  const collected = collectedLegacyTables(source), seen = new Set<string>(), objects: LegacySourceCoverageObject[] = [];
  for (const item of schema) {
    if (typeof item.name !== "string" || !["table", "view"].includes(item.type as string) || item.sql !== null && typeof item.sql !== "string") return coverageFailure();
    const name = item.name, lower = name.replace(/[A-Z]/gu, (c) => c.toLowerCase());
    if (seen.has(lower)) return coverageFailure(); seen.add(lower);
    if (item.type === "view") { objects.push({ name, type: "view", sql: item.sql as string | null, columns: [], disposition: "REVIEW_REQUIRED", rowCount: null, rowsSha256: null, retainedRows: null }); continue; }
    const columns = yield { sql: "SELECT cid,name,type,\"notnull\",dflt_value,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid", bindings: [name] };
    if (!columns.length || columns.some((c) => typeof c.name !== "string" || ![0, 1, 2, 3].includes(c.hidden as number))) return coverageFailure();
    const count = yield { sql: `SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`, bindings: [] };
    if (count.length !== 1 || !Number.isSafeInteger(count[0]?.n) || (count[0]!.n as number) < 0) return coverageFailure();
    const rowCount = count[0]!.n as number;
    if (lower.startsWith("sqlite_")) { objects.push({ name, type: "table", sql: item.sql as string | null, columns, disposition: "SQLITE_INTERNAL", rowCount, rowsSha256: null, retainedRows: null }); continue; }
    let rows: readonly LegacySourceRow[], disposition: LegacySourceCoverageObject["disposition"];
    if (collected.has(lower)) {
      const captured = collected.get(lower); if (captured === null || captured === undefined) return coverageFailure();
      rows = captured; disposition = "CAPTURED";
    } else {
      rows = (yield* readLegacySourceTable(name, [], "R04_SOURCE_COVERAGE_SHAPE_UNSUPPORTED", "R04_SOURCE_COVERAGE_CARDINALITY_MISMATCH")) ?? coverageFailure();
      disposition = legacyCoverageMetadata.has(lower) ? "METADATA" : "REVIEW_REQUIRED";
    }
    const names = columns.filter((c) => c.hidden !== 1).map((c) => c.name as string).sort();
    if (rows.length !== rowCount || rows.some((r) => JSON.stringify(Object.keys(r).sort()) !== JSON.stringify(names))) return coverageFailure();
    const encoded = coverageRows(rows);
    objects.push({ name, type: "table", sql: item.sql as string | null, columns, disposition, rowCount, rowsSha256: coverageDigest(encoded), retainedRows: encoded });
  }
  for (const [name, rows] of collected) if (rows !== null && !seen.has(name)) return coverageFailure();
  return { accountScope, objects };
}
