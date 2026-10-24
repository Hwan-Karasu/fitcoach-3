import { arrayOf, id, integer, nullableText, object, text } from "../../../shared/domain/JsonShape.ts";
import { isLocalDate } from "./DiaryRules.ts";

/** Permanent 3.x historical observations. These are never added to daily facts. */
export type ArchiveNumber = Readonly<{ state: "ABSENT" | "UNKNOWN" | "UNSUPPORTED" }> | Readonly<{ state: "VALUE"; sourceDecimal: string }>;
export const ARCHIVE_DAY_METRICS = ["weight", "steps", "calories", "fatPercent", "protein", "fat", "carbs"] as const;
export const ARCHIVE_AGGREGATES = ["avg_weight", "avg_steps", "avg_cal", "avg_fat_percent", "train_days", "protein", "fat", "carbs"] as const;
export interface NutritionArchiveDaySnapshot {
  readonly id: string; readonly position: number; readonly localDate: string | null;
  readonly values: Readonly<Record<typeof ARCHIVE_DAY_METRICS[number], ArchiveNumber>>;
  readonly training: Readonly<{ state: "ABSENT" | "UNKNOWN" | "UNSUPPORTED" }> | Readonly<{ state: "VALUE"; value: "YES" | "NO" }>;
  readonly unknownFields: readonly string[]; readonly issues: readonly string[];
}
export interface NutritionArchiveWeekSnapshot {
  readonly version: 1; readonly id: string; readonly clientId: string; readonly sourceKey: string;
  readonly startDate: string | null; readonly endDate: string | null; readonly label: string | null;
  readonly sourceSavedAt: string | null;
  readonly aggregates: Readonly<Record<typeof ARCHIVE_AGGREGATES[number], ArchiveNumber>>;
  readonly detailShape: "ARRAY" | "LEGACY_EMPTY_OBJECT" | "ABSENT" | "UNSUPPORTED";
  readonly days: readonly NutritionArchiveDaySnapshot[]; readonly issues: readonly string[]; readonly unknownFields: readonly string[];
  readonly overlappingArchiveIds: readonly string[];
  readonly currentSourceOverlap: readonly Readonly<{ localDate: string; stores: readonly string[] }>[];
  readonly semantics: "HISTORICAL_SNAPSHOT_NOT_DAILY_FACTS";
}
const uuid = (value: unknown): value is string => text(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const date = (value: unknown): value is string | null => value === null || text(value) && isLocalDate(value);
const unknownState = (value: unknown) => value === "ABSENT" || value === "UNKNOWN" || value === "UNSUPPORTED";
function number(value: unknown): value is ArchiveNumber {
  return object(value) && (unknownState(value.state) || value.state === "VALUE" && text(value.sourceDecimal)
    && /^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(value.sourceDecimal) && Number.isFinite(Number(value.sourceDecimal)));
}
function metrics(value: unknown, keys: readonly string[]): boolean {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => number(value[key]));
}
function day(value: unknown): value is NutritionArchiveDaySnapshot {
  return object(value) && uuid(value.id) && integer(value.position) && value.position >= 0 && date(value.localDate)
    && metrics(value.values, ARCHIVE_DAY_METRICS) && object(value.training)
    && (unknownState(value.training.state) || value.training.state === "VALUE" && (value.training.value === "YES" || value.training.value === "NO"))
    && arrayOf(value.unknownFields, text) && arrayOf(value.issues, text);
}
export function isNutritionArchiveWeekSnapshot(value: unknown): value is NutritionArchiveWeekSnapshot {
  return object(value) && value.version === 1 && uuid(value.id) && uuid(value.clientId) && id(value.sourceKey)
    && date(value.startDate) && date(value.endDate) && nullableText(value.label) && nullableText(value.sourceSavedAt)
    && metrics(value.aggregates, ARCHIVE_AGGREGATES) && ["ARRAY", "LEGACY_EMPTY_OBJECT", "ABSENT", "UNSUPPORTED"].includes(String(value.detailShape))
    && arrayOf(value.days, day) && value.days.every((item, index) => item.position === index)
    && new Set(value.days.map((item) => item.id)).size === value.days.length
    && arrayOf(value.issues, text) && arrayOf(value.unknownFields, text) && arrayOf(value.overlappingArchiveIds, uuid)
    && arrayOf(value.currentSourceOverlap, (item): item is { localDate: string; stores: string[] } => object(item)
      && text(item.localDate) && isLocalDate(item.localDate) && arrayOf(item.stores, id))
    && value.semantics === "HISTORICAL_SNAPSHOT_NOT_DAILY_FACTS";
}
