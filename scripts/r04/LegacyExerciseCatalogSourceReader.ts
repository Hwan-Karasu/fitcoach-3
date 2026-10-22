import type { DatabaseSync } from "node:sqlite";
import type { BodyPart } from "../../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import { LEGACY_V2_TRACKING_PROFILE } from "./LegacySetMetricCandidates.ts";

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

export function requireLegacyColumns(db: DatabaseSync, table: string, required: readonly string[]): void {
  // Table names are fixed by callers, not supplied by the backup or user.
  if (!/^[a-z_]+$/u.test(table)) throw new Error("R04_EXERCISE_TABLE_INVALID");
  const columns = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
  if (required.some((column) => !columns.has(column))) throw new Error("R04_EXERCISE_SHAPE_UNSUPPORTED");
}

export function legacyObjectJson(raw: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function aliases(raw: unknown): readonly string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item: unknown) => typeof item === "string")
      ? parsed as string[] : null;
  } catch { return null; }
}

/** Caller owns a read snapshot. Includes deleted stock/user records; no name-based matching. */
export function readLegacyExerciseCatalogInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyExerciseCatalogCandidate[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  requireLegacyColumns(db, "exercise_catalog", ["id", "name", "category", "equipment",
    "aliases_json", "source", "created_at", "updated_at", "deleted_at"]);
  const rows = db.prepare("SELECT * FROM exercise_catalog ORDER BY id").all();
  const seen = new Set<string>();
  return rows.map((raw): LegacyExerciseCatalogCandidate => {
    if (typeof raw.id !== "string" || !raw.id.trim() || seen.has(raw.id)) {
      throw new Error("R04_EXERCISE_CATALOG_IDENTITY_INVALID");
    }
    seen.add(raw.id);
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
  });
}
