import { DatabaseSync } from "node:sqlite";
import { inspectLegacyBackup } from "../r02/LegacyBackupInspector.ts";
import { hasSingleAuditCopyArgument } from "../r03/AuditLegacyCopy.ts";
import { summarizeHistoryLinks, type HistoryLinkPreflightReport } from "./HistoryLinkPreflightReport.ts";
import { readLegacyEvidence } from "./LegacyEvidenceReader.ts";
import { summarizeSourceFactPreflight, type SourceFactPreflightReport } from "./SourceFactPreflightReport.ts";

export type R04CopyReport =
  | (SourceFactPreflightReport & Readonly<{ history: HistoryLinkPreflightReport }>)
  | Readonly<{ status: "blocked"; reasons: readonly string[] }>;

export { hasSingleAuditCopyArgument };

/** Operates on one explicit read-only copy and returns only aggregate reason counts. */
export function auditSourceFactCopy(path: string): R04CopyReport {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const source = inspectLegacyBackup(db);
    if (source.status !== "candidate") return { status: "blocked", reasons: source.reasons };
    const binding = db.prepare("SELECT scope_key FROM account_database_binding").get() as { scope_key: string } | undefined;
    if (!binding?.scope_key?.trim()) return { status: "blocked", reasons: ["R04_ACCOUNT_SCOPE_REQUIRED"] };
    const evidence = readLegacyEvidence(db, binding.scope_key);
    return { ...summarizeSourceFactPreflight(evidence.sets),
      history: summarizeHistoryLinks(evidence.history, evidence.sets) };
  } catch (error) {
    const code = error instanceof Error && /^R04_[A-Z_]+$/u.test(error.message)
      ? error.message : "R04_PREFLIGHT_FAILED";
    return { status: "blocked", reasons: [code] };
  } finally {
    try { db?.close(); } catch { /* A read-only handle closing cannot publish source details. */ }
  }
}
