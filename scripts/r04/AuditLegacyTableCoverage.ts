import { DatabaseSync } from "node:sqlite";
import { inspectLegacyBackup } from "../r02/LegacyBackupInspector.ts";
import { auditLegacyTableCoverage, type LegacyTableCoverage } from "./LegacyTableCoverage.ts";

export type LegacyTableCoverageReport = LegacyTableCoverage
  | Readonly<{ status: "blocked"; reasons: readonly string[] }>;

/** Reports counts only; no table names, source records or paths in the result. */
export function auditLegacyTableCoverageFile(path: string): LegacyTableCoverageReport {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    db.exec("BEGIN");
    const source = inspectLegacyBackup(db);
    if (source.status !== "candidate") return { status: "blocked", reasons: source.reasons };
    const binding = db.prepare("SELECT scope_key FROM account_database_binding").get() as
      { scope_key: string } | undefined;
    if (!binding?.scope_key?.trim()) return { status: "blocked", reasons: ["R04_ACCOUNT_SCOPE_REQUIRED"] };
    return auditLegacyTableCoverage(db, undefined, binding.scope_key);
  } catch {
    return { status: "blocked", reasons: ["R04_COVERAGE_FAILED"] };
  } finally {
    try { if (db?.isTransaction) db.exec("ROLLBACK"); } catch { /* Never print source-specific details. */ }
    try { db?.close(); } catch { /* Never print a source-specific exception. */ }
  }
}
