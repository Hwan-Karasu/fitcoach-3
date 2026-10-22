import type { DatabaseSync } from "node:sqlite";
import type { LegacySetSource } from "./SourceFactPreflight.ts";
import type { LegacyHistorySource } from "./HistoryLinkPreflight.ts";
import type { LegacyCurrentSetSource } from "./LegacyCurrentSetSourceReader.ts";
import type { ArchivePayloadInventory } from "./LegacyArchiveSetInventory.ts";
import { legacyObjectJson } from "./LegacyExerciseCatalogSourceReader.ts";
import { convertLegacySetMetrics } from "./LegacySetMetricCandidates.ts";

type FactSource = "session" | "current" | "history" | "archive";
export interface LegacyFactAtom {
  readonly sourceKey: string;
  readonly accountScope: string;
  readonly clientId: string;
  readonly kind: FactSource;
  readonly factId: string | null;
  readonly raw: unknown;
  readonly metrics: ReturnType<typeof convertLegacySetMetrics>;
  readonly warnings: readonly string[];
}

export interface LegacyFactGroup {
  readonly key: string;
  readonly atoms: readonly LegacyFactAtom[];
  readonly status: "METRIC_CONFLICT" | "REQUIRES_REVIEW" | "CONSISTENT_METRICS";
  readonly targetFactId: null;
}

/** Source identity is evidence, never a target ID. Equal metrics without ID cannot merge facts. */
export function groupLegacyFactAtoms(atoms: readonly LegacyFactAtom[]) {
  const seen = new Set<string>();
  const groups = new Map<string, LegacyFactAtom[]>();
  const unresolved: LegacyFactAtom[] = [];
  for (const atom of atoms) {
    if (!atom.accountScope.trim() || !atom.clientId.trim() || !atom.sourceKey.trim() || seen.has(atom.sourceKey)) {
      throw new Error("R04_FACT_LEDGER_PROVENANCE_INVALID");
    }
    seen.add(atom.sourceKey);
    if (atom.factId === null || !atom.factId.trim()) { unresolved.push(atom); continue; }
    const key = JSON.stringify([atom.accountScope, atom.clientId, atom.factId]);
    const group = groups.get(key) ?? []; group.push(atom); groups.set(key, group);
  }
  const result: LegacyFactGroup[] = [];
  for (const [key, entries] of groups) {
    const variants = new Set(entries.filter((atom) => atom.metrics.metricIssues.length === 0)
      .map((atom) => JSON.stringify(atom.metrics.values)));
    result.push({ key, atoms: entries,
      status: variants.size > 1 ? "METRIC_CONFLICT"
        : entries.some((atom) => atom.metrics.metricIssues.length > 0 || atom.warnings.length > 0)
          ? "REQUIRES_REVIEW" : "CONSISTENT_METRICS", targetFactId: null });
  }
  return { groups: result, unresolved };
}

interface FactEvidence {
  readonly sets: readonly LegacySetSource[];
  readonly history: readonly LegacyHistorySource[];
  readonly currentSets: readonly LegacyCurrentSetSource[] | null;
  readonly archiveSetInventory: readonly ArchivePayloadInventory[] | null;
}

/** Called inside the same immutable R04 snapshot as all source readers. */
export function readLegacyFactLedgerInSnapshot(db: DatabaseSync, accountScope: string, evidence: FactEvidence) {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const atoms: LegacyFactAtom[] = [];
  function rawRows(table: "training_session_sets" | "training_set_logs" | "training_exercise_history") {
    const index = new Map<string, Readonly<Record<string, unknown>>>();
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      if (typeof row.id !== "string" || !row.id.trim() || index.has(row.id)) {
        throw new Error("R04_FACT_LEDGER_ROW_IDENTITY_INVALID");
      }
      index.set(row.id, row);
    }
    return index;
  }
  function append(kind: FactSource, table: string, id: string, clientId: string, scope: string,
    factId: string | null, raw: Readonly<Record<string, unknown>>, reps: unknown, weight: unknown, warnings: string[]) {
    if (scope !== accountScope) throw new Error("R04_FACT_LEDGER_SCOPE_MISMATCH");
    atoms.push({ sourceKey: JSON.stringify([scope, table, id]), accountScope: scope, clientId,
      kind, factId, raw, metrics: convertLegacySetMetrics(reps, weight), warnings });
  }
  const sessionRaw = rawRows("training_session_sets");
  if (sessionRaw.size !== evidence.sets.length) throw new Error("R04_FACT_LEDGER_COVERAGE_MISMATCH");
  for (const row of evidence.sets) {
    const raw = sessionRaw.get(row.sourceRowId);
    if (!raw) throw new Error("R04_FACT_LEDGER_COVERAGE_MISMATCH");
    const warnings: string[] = [];
    if (row.lifecycleShapeComplete !== true) warnings.push("LIFECYCLE_UNOBSERVED");
    if (!row.completedAtRaw) warnings.push("COMPLETION_UNPROVEN");
    if (row.setDeletedAtRaw != null || row.sessionDeletedAtRaw != null || row.exerciseDeletedAtRaw != null) warnings.push("DELETION_REQUIRES_REVIEW");
    append("session", "training_session_sets", row.sourceRowId, row.clientId, row.accountScope,
      row.sourceFactId, raw, row.repsRaw, row.weightRaw, warnings);
  }
  const historyRaw = rawRows("training_exercise_history");
  if (historyRaw.size !== evidence.history.length) throw new Error("R04_FACT_LEDGER_COVERAGE_MISMATCH");
  for (const row of evidence.history) {
    const raw = historyRaw.get(row.sourceRowId);
    if (!raw) throw new Error("R04_FACT_LEDGER_COVERAGE_MISMATCH");
    const data = legacyObjectJson(raw.data_json);
    const warnings = ["HISTORY_NOT_PERFORMED_PROOF"];
    if (data === null) warnings.push("HISTORY_PAYLOAD_UNREADABLE_OR_UNOBSERVED");
    if (row.deletedAtRaw != null) warnings.push("DELETION_REQUIRES_REVIEW");
    append("history", "training_exercise_history", row.sourceRowId, row.clientId, row.accountScope,
      row.sourceFactId, raw, data?.reps, data?.weight, warnings);
  }
  if (evidence.currentSets !== null) {
    const currentRaw = rawRows("training_set_logs");
    if (currentRaw.size !== evidence.currentSets.length) throw new Error("R04_FACT_LEDGER_COVERAGE_MISMATCH");
    for (const row of evidence.currentSets) {
      const raw = currentRaw.get(row.sourceRowId);
      if (!raw) throw new Error("R04_FACT_LEDGER_COVERAGE_MISMATCH");
      const warnings: string[] = [];
      if (row.originStatus === "invalid-json" || row.originStatus === "unsupported-origin") warnings.push("INVALID_ORIGIN");
      if (!row.lifecycleShapeComplete) warnings.push("LIFECYCLE_UNOBSERVED");
      if (!row.completedAtRaw) warnings.push("COMPLETION_UNPROVEN");
      if (row.setDeletedAtRaw != null || row.exerciseDeletedAtRaw != null || row.workoutDeletedAtRaw != null) warnings.push("DELETION_REQUIRES_REVIEW");
      append("current", "training_set_logs", row.sourceRowId, row.clientId, row.accountScope,
        row.effectiveSourceFactId, raw, raw.reps, raw.weight, warnings);
    }
  }
  for (const archive of evidence.archiveSetInventory ?? []) {
    if (archive.accountScope !== accountScope) throw new Error("R04_FACT_LEDGER_SCOPE_MISMATCH");
    for (const row of archive.occurrences) {
      if (row.accountScope !== accountScope || row.clientId !== archive.clientId || row.archiveId !== archive.archiveId) {
        throw new Error("R04_FACT_LEDGER_SCOPE_MISMATCH");
      }
      atoms.push({ sourceKey: row.sourceIdentityKey, accountScope, clientId: row.clientId,
        kind: "archive", factId: row.sourceFactId, raw: row.raw, metrics: row.metrics,
        warnings: ["ARCHIVE_NOT_PERFORMED_PROOF", ...(row.identityIssue === null ? [] : [row.identityIssue])],
      });
    }
  }
  const ledger = groupLegacyFactAtoms(atoms);
  if (ledger.groups.reduce((sum, group) => sum + group.atoms.length, 0) + ledger.unresolved.length !== atoms.length) {
    throw new Error("R04_FACT_LEDGER_COVERAGE_MISMATCH");
  }
  return { atoms, ...ledger };
}

export function summarizeLegacyFactLedger(ledger: ReturnType<typeof readLegacyFactLedgerInSnapshot>) {
  return {
    status: "requires-semantic-review" as const, physicalAtoms: ledger.atoms.length,
    sessionAtoms: ledger.atoms.filter((atom) => atom.kind === "session").length,
    currentAtoms: ledger.atoms.filter((atom) => atom.kind === "current").length,
    historyAtoms: ledger.atoms.filter((atom) => atom.kind === "history").length,
    archiveAtoms: ledger.atoms.filter((atom) => atom.kind === "archive").length,
    sourceIdentityGroups: ledger.groups.length, unresolvedIdentityAtoms: ledger.unresolved.length,
    repeatedRepresentationGroups: ledger.groups.filter((group) => group.atoms.length > 1).length,
    crossSourceGroups: ledger.groups.filter((group) => new Set(group.atoms.map((atom) => atom.kind)).size > 1).length,
    metricConflictGroups: ledger.groups.filter((group) => group.status === "METRIC_CONFLICT").length,
    reviewGroups: ledger.groups.filter((group) => group.status === "REQUIRES_REVIEW").length,
    consistentMetricGroups: ledger.groups.filter((group) => group.status === "CONSISTENT_METRICS").length,
    targetFactsCreated: 0 as const, targetWrites: 0 as const,
  };
}
