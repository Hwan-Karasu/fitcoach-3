import type { BodyPart } from "../ExerciseModel.ts";
import type { LegacyExerciseCatalogSource } from "../../../../shared/migration/LegacyProfileSources.ts";
import { isExplicitTimestamp, LEGACY_V2_TRACKING_PROFILE } from "../../../../shared/migration/LegacyValues.ts";
/** Exact meanings verified against v2 seed categories and v3 body-part labels. */
const categoryBodyParts: Readonly<Record<string, BodyPart>> = {
  "Грудь": "chest", "Спина": "back", "Плечи": "shoulders", "Кор": "core",
};

export type ExerciseCatalogIssue = "MISSING_NAME" | "UNKNOWN_SOURCE" | "INVALID_CATEGORY" |
  "INVALID_EQUIPMENT" | "INVALID_ALIASES" | "INVALID_CREATED_AT" | "INVALID_UPDATED_AT" |
  "INVALID_DELETED_AT";

export interface LegacyExerciseCatalogCandidate {
  readonly accountScope: string;
  readonly sourceCatalogId: string;
  readonly sourceIdentityKey: string;
  /** Exact source columns, including soft-deletion and unparsed aliases. Never log this. */
  readonly raw: Readonly<Record<string, unknown>>;
  readonly name: string | null;
  readonly sourceCategory: string | null;
  readonly equipment: string | null;
  readonly aliases: readonly string[] | null;
  readonly origin: "CUSTOM" | "SYSTEM" | null;
  readonly trackingProfile: typeof LEGACY_V2_TRACKING_PROFILE;
  readonly classification: "EXACT_CATEGORY" | "REQUIRES_CATEGORY_MAPPING";
  readonly bodyPart: BodyPart | null;
  readonly lifecycle: "ACTIVE_SOURCE" | "DELETED_SOURCE" | "UNRESOLVED";
  readonly issues: readonly ExerciseCatalogIssue[];
  readonly targetExerciseId: null;
}

function aliases(raw: unknown): readonly string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item: unknown) => typeof item === "string")
      ? parsed as string[] : null;
  } catch { return null; }
}

export function projectLegacyExerciseCatalog(source: LegacyExerciseCatalogSource): readonly LegacyExerciseCatalogCandidate[] {
  if (!source.accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const seen = new Set<string>();
  return source.rows.map((raw) => {
    if (typeof raw.id !== "string" || !raw.id.trim() || seen.has(raw.id)) throw new Error("R04_EXERCISE_CATALOG_IDENTITY_INVALID");
    seen.add(raw.id);
    return projectLegacyExerciseCatalogRow(source.accountScope, raw);
  });
}
/** Reparse retained raw rows; candidate-derived fields never authorize staged values. */
export function projectLegacyExerciseCatalogRow(accountScope: string, raw: Readonly<Record<string, unknown>>): LegacyExerciseCatalogCandidate {
  if (!accountScope.trim() || typeof raw.id !== "string" || !raw.id.trim()) throw new Error("R04_EXERCISE_CATALOG_IDENTITY_INVALID");
  const issues: ExerciseCatalogIssue[] = [];
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : null;
  if (name === null) issues.push("MISSING_NAME");
  const sourceCategory = typeof raw.category === "string" ? raw.category : null;
  const categoryKey = sourceCategory?.trim() ?? "";
  const bodyPart = Object.hasOwn(categoryBodyParts, categoryKey) ? categoryBodyParts[categoryKey]! : null;
  if (sourceCategory === null) issues.push("INVALID_CATEGORY");
  const equipment = typeof raw.equipment === "string" ? raw.equipment.trim() || null : null;
  if (typeof raw.equipment !== "string") issues.push("INVALID_EQUIPMENT");
  const parsedAliases = aliases(raw.aliases_json);
  if (parsedAliases === null) issues.push("INVALID_ALIASES");
  const origin = raw.source === "user" ? "CUSTOM" : raw.source === "stock" ? "SYSTEM" : null;
  if (origin === null) issues.push("UNKNOWN_SOURCE");
  if (!isExplicitTimestamp(raw.created_at)) issues.push("INVALID_CREATED_AT");
  if (!isExplicitTimestamp(raw.updated_at)) issues.push("INVALID_UPDATED_AT");
  if (raw.deleted_at !== null && !isExplicitTimestamp(raw.deleted_at)) issues.push("INVALID_DELETED_AT");
  return {
    accountScope, sourceCatalogId: raw.id,
    sourceIdentityKey: JSON.stringify([accountScope, "exercise_catalog", raw.id]), raw,
    name, sourceCategory, equipment, aliases: parsedAliases, origin,
    trackingProfile: LEGACY_V2_TRACKING_PROFILE,
    classification: bodyPart === null ? "REQUIRES_CATEGORY_MAPPING" : "EXACT_CATEGORY", bodyPart,
    lifecycle: raw.deleted_at === null ? "ACTIVE_SOURCE"
      : isExplicitTimestamp(raw.deleted_at) ? "DELETED_SOURCE" : "UNRESOLVED",
    issues, targetExerciseId: null,
  };
}
