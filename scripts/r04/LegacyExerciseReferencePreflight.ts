import type { DatabaseSync } from "node:sqlite";
import { legacyObjectJson, requireLegacyColumns, type LegacyExerciseCatalogCandidate } from "./LegacyExerciseCatalogSourceReader.ts";

export type ExerciseReferenceIssue = "MISSING_OWNER" | "INVALID_JSON" | "INVALID_CATALOG_REFERENCE" |
  "MISSING_CATALOG_REFERENCE" | "UNKNOWN_CATALOG_REFERENCE" | "CONFLICTING_CATALOG_REFERENCES" |
  "FOREIGN_CLIENT_INSTANCE" | "UNRESOLVED_INSTANCE";

export interface LegacyExerciseReferenceCandidate {
  readonly accountScope: string;
  readonly sourceTable: "training_exercises" | "training_exercise_history";
  readonly sourceRowId: string;
  readonly sourceIdentityKey: string;
  readonly clientId: string | null;
  /** Source snapshot kept even when a reference cannot be resolved. */
  readonly raw: Readonly<Record<string, unknown>>;
  readonly sourceCatalogId: string | null;
  readonly issues: readonly ExerciseReferenceIssue[];
  readonly status: "linked-source" | "requires-link-review";
  readonly targetExerciseId: null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function resolveReferences(
  refs: readonly unknown[], catalogIds: ReadonlySet<string>, issues: Set<ExerciseReferenceIssue>,
): string | null {
  const ids: string[] = [];
  for (const ref of refs) {
    if (ref === null || ref === undefined || ref === "") continue;
    if (typeof ref !== "string" || !ref.trim()) issues.add("INVALID_CATALOG_REFERENCE");
    else ids.push(ref);
  }
  const unique = new Set(ids);
  if (unique.size === 0) issues.add("MISSING_CATALOG_REFERENCE");
  if (unique.size > 1) issues.add("CONFLICTING_CATALOG_REFERENCES");
  if (ids.some((id) => !catalogIds.has(id))) issues.add("UNKNOWN_CATALOG_REFERENCE");
  return unique.size === 1 && catalogIds.has(ids[0]!) ? ids[0]! : null;
}

/** Explicit source identity only. Does not replay v2's repairing backfill or fuzzy aliases. */
export function readLegacyExerciseReferencesInSnapshot(
  db: DatabaseSync, accountScope: string, catalog: readonly LegacyExerciseCatalogCandidate[],
): readonly LegacyExerciseReferenceCandidate[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  if (catalog.some((entry) => entry.accountScope !== accountScope)) {
    throw new Error("R04_EXERCISE_ACCOUNT_MISMATCH");
  }
  const catalogIds = new Set(catalog.map((entry) => entry.sourceCatalogId));
  if (catalogIds.size !== catalog.length) throw new Error("R04_EXERCISE_CATALOG_IDENTITY_INVALID");
  requireLegacyColumns(db, "training_exercises", ["id", "workout_id", "name", "template_exercise_id", "data_json", "deleted_at"]);
  requireLegacyColumns(db, "training_workouts", ["id", "client_id"]);
  requireLegacyColumns(db, "training_exercise_history", ["id", "client_id", "exercise_key", "data_json", "deleted_at"]);
  requireLegacyColumns(db, "clients", ["id"]);
  const exercises = db.prepare(`SELECT e.*,
    w.client_id AS client_id,c.id AS owner_client_id FROM training_exercises e
    LEFT JOIN training_workouts w ON w.id=e.workout_id
    LEFT JOIN clients c ON c.id=w.client_id ORDER BY e.id`).all();
  const history = db.prepare(`SELECT h.*,
    c.id AS owner_client_id FROM training_exercise_history h
    LEFT JOIN clients c ON c.id=h.client_id ORDER BY h.id`).all();
  const rows: LegacyExerciseReferenceCandidate[] = [];
  const seen = new Set<string>();
  function append(
    sourceTable: LegacyExerciseReferenceCandidate["sourceTable"], raw: Readonly<Record<string, unknown>>,
    refs: readonly unknown[], issues: Set<ExerciseReferenceIssue>,
  ): LegacyExerciseReferenceCandidate {
    const sourceRowId = text(raw.id);
    if (sourceRowId === null) throw new Error("R04_EXERCISE_REFERENCE_IDENTITY_INVALID");
    const sourceIdentityKey = JSON.stringify([accountScope, sourceTable, sourceRowId]);
    if (seen.has(sourceIdentityKey)) throw new Error("R04_EXERCISE_REFERENCE_IDENTITY_INVALID");
    seen.add(sourceIdentityKey);
    const clientId = text(raw.client_id);
    if (clientId === null || raw.owner_client_id !== clientId) issues.add("MISSING_OWNER");
    const sourceCatalogId = resolveReferences(refs, catalogIds, issues);
    const candidate: LegacyExerciseReferenceCandidate = {
      accountScope, sourceTable, sourceRowId, sourceIdentityKey, clientId, raw,
      sourceCatalogId: issues.size === 0 ? sourceCatalogId : null,
      issues: [...issues], status: issues.size === 0 ? "linked-source" : "requires-link-review",
      targetExerciseId: null,
    };
    rows.push(candidate);
    return candidate;
  }
  const byInstance = new Map<string, LegacyExerciseReferenceCandidate>();
  for (const raw of exercises) {
    const data = legacyObjectJson(raw.data_json);
    const issues = new Set<ExerciseReferenceIssue>();
    if (data === null) issues.add("INVALID_JSON");
    const candidate = append("training_exercises", raw, [raw.template_exercise_id, data?.catalogId], issues);
    byInstance.set(candidate.sourceRowId, candidate);
  }
  for (const raw of history) {
    const data = legacyObjectJson(raw.data_json);
    const issues = new Set<ExerciseReferenceIssue>();
    if (data === null) issues.add("INVALID_JSON");
    const key = text(raw.exercise_key);
    if (typeof raw.exercise_key !== "string") issues.add("INVALID_CATALOG_REFERENCE");
    // Unprefixed noncatalog keys can be names in legacy; they are never matched by name.
    const keyRef = key?.startsWith("catalog:") ? key.slice(8)
      : key !== null && catalogIds.has(key) ? key : null;
    if (key?.startsWith("catalog:") && !keyRef) issues.add("INVALID_CATALOG_REFERENCE");
    const refs: unknown[] = [data?.catalogId, keyRef];
    if (data?.exerciseId != null && data.exerciseId !== "") {
      const instanceId = text(data.exerciseId);
      const instance = instanceId === null ? undefined : byInstance.get(instanceId);
      if (instance !== undefined) {
        if (instance.clientId !== raw.client_id) issues.add("FOREIGN_CLIENT_INSTANCE");
        else if (instance.status !== "linked-source") issues.add("UNRESOLVED_INSTANCE");
        else refs.push(instance.sourceCatalogId);
      } else if (instanceId !== null && catalogIds.has(instanceId)) refs.push(instanceId);
      else issues.add("UNRESOLVED_INSTANCE");
    }
    append("training_exercise_history", raw, refs, issues);
  }
  const exerciseCount = db.prepare("SELECT count(*) AS count FROM training_exercises").get()!.count;
  const historyCount = db.prepare("SELECT count(*) AS count FROM training_exercise_history").get()!.count;
  if (exercises.length !== exerciseCount || history.length !== historyCount) {
    throw new Error("R04_EXERCISE_REFERENCE_CARDINALITY_MISMATCH");
  }
  return rows;
}

export function summarizeLegacyExercises(
  catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[],
) {
  return {
    status: "requires-mapping" as const,
    catalogRows: catalog.length,
    customRows: catalog.filter((row) => row.origin === "CUSTOM").length,
    stockRows: catalog.filter((row) => row.origin === "SYSTEM").length,
    deletedCatalogRows: catalog.filter((row) => row.lifecycle === "DELETED_SOURCE").length,
    invalidCatalogRows: catalog.filter((row) => row.issues.length > 0).length,
    exactCategoryRows: catalog.filter((row) => row.classification === "EXACT_CATEGORY").length,
    categoryMappingRequiredRows: catalog.filter((row) => row.classification === "REQUIRES_CATEGORY_MAPPING").length,
    missingEquipmentRows: catalog.filter((row) => row.equipment === null).length,
    exerciseReferenceRows: refs.filter((row) => row.sourceTable === "training_exercises").length,
    historyReferenceRows: refs.filter((row) => row.sourceTable === "training_exercise_history").length,
    linkedSourceRows: refs.filter((row) => row.status === "linked-source").length,
    unresolvedReferenceRows: refs.filter((row) => row.status !== "linked-source").length,
    foreignClientReferenceRows: refs.filter((row) => row.issues.includes("FOREIGN_CLIENT_INSTANCE")).length,
    targetMappedExercises: 0 as const, targetWrites: 0 as const,
  };
}
