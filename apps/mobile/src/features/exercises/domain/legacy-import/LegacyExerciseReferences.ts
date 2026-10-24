import { legacyObjectJson } from "../../../../shared/migration/LegacyValues.ts";
import type { LegacyExerciseReferenceSource } from "../../../../shared/migration/LegacyExerciseSources.ts";
import type { LegacySourceRow } from "../../../../shared/migration/LegacyProfileSources.ts";
import type { LegacyExerciseCatalogCandidate } from "./LegacyExerciseCatalogProjection.ts";

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

/** Derive join ownership without shadowing physical columns or multiplying rows. */
export function projectLegacyExerciseReferencesFromSource(source: LegacyExerciseReferenceSource, catalog: readonly LegacyExerciseCatalogCandidate[]) {
  if (source.clients === null || source.workouts === null || source.exercises === null || source.history === null) throw new Error("R04_EXERCISE_SHAPE_UNSUPPORTED");
  function index(rows: readonly LegacySourceRow[]): ReadonlyMap<string, LegacySourceRow> {
    const result = new Map<string, LegacySourceRow>();
    for (const row of rows) {
      if (typeof row.id !== "string" || !row.id.trim() || result.has(row.id)) throw new Error("R04_EXERCISE_REFERENCE_IDENTITY_INVALID");
      result.set(row.id, row);
    }
    return result;
  }
  const clients = index(source.clients), workouts = index(source.workouts);
  for (const row of source.exercises) if (Object.hasOwn(row, "client_id") || Object.hasOwn(row, "owner_client_id")) throw new Error("R04_EXERCISE_REFERENCE_RESERVED_COLUMN");
  for (const row of source.history) if (Object.hasOwn(row, "owner_client_id")) throw new Error("R04_EXERCISE_REFERENCE_RESERVED_COLUMN");
  return projectLegacyExerciseReferences(source.accountScope, catalog, source.exercises.map((row) => {
    const workout = typeof row.workout_id === "string" ? workouts.get(row.workout_id) : undefined;
    const clientId = workout?.client_id ?? null;
    return { ...row, client_id: clientId, owner_client_id: typeof clientId === "string" && clients.has(clientId) ? clientId : null };
  }), source.history.map((row) => ({ ...row, owner_client_id: typeof row.client_id === "string" && clients.has(row.client_id) ? row.client_id : null })));
}

export function projectLegacyExerciseReferences(accountScope: string, catalog: readonly LegacyExerciseCatalogCandidate[],
  exercises: readonly Readonly<Record<string, unknown>>[], history: readonly Readonly<Record<string, unknown>>[]): readonly LegacyExerciseReferenceCandidate[] {
  if (!accountScope.trim() || catalog.some((row) => row.accountScope !== accountScope)) throw new Error("R04_EXERCISE_ACCOUNT_MISMATCH");
  const catalogIds = new Set(catalog.map((row) => row.sourceCatalogId));
  if (catalogIds.size !== catalog.length) throw new Error("R04_EXERCISE_CATALOG_IDENTITY_INVALID");
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
