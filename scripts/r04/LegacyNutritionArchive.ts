import type { NutritionRaw as Raw } from "./LegacyNutritionSourceReader.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import { isLocalDate } from "../../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { parseSourceJson } from "../../apps/mobile/src/features/legacy-import/domain/SourceJson.ts";

import { ARCHIVE_DAY_METRICS, type ArchiveNumber, type NutritionArchiveDaySnapshot, type NutritionArchiveWeekSnapshot } from "../../apps/mobile/src/features/nutrition/domain/NutritionHistorySnapshot.ts";
export type { NutritionArchiveDaySnapshot, NutritionArchiveWeekSnapshot } from "../../apps/mobile/src/features/nutrition/domain/NutritionHistorySnapshot.ts";
const aggregates = ["avg_weight", "avg_steps", "avg_cal", "avg_fat_percent", "train_days", "protein", "fat", "carbs"] as const;
class NumberToken { readonly source: string; constructor(source: string) { this.source = source; } }
const isObject = (value: unknown): value is Raw => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof NumberToken);

/** No numeric strings/defaults, no rounding to the current D01 scale. Values are
 * exact source decimals for archival display, not new measurements/food facts. */
function numberCell(row: Raw, field: string, issues: string[]): ArchiveNumber {
  if (!Object.hasOwn(row, field)) return { state: "ABSENT" };
  const raw = row[field]; if (raw === null) return { state: "UNKNOWN" };
  const token = raw instanceof NumberToken ? raw.source : typeof raw === "number" ? Object.is(raw, -0) ? "-0" : String(raw) : null;
  if (token === null || token.startsWith("-") || !Number.isFinite(Number(token))) {
    issues.push(`UNSUPPORTED_NUMBER:${field}`); return { state: "UNSUPPORTED" };
  }
  return { state: "VALUE", sourceDecimal: token };
}
function dateValue(raw: unknown, field: string, issues: string[]): string | null {
  if (typeof raw === "string" && isLocalDate(raw)) return raw;
  issues.push(`UNKNOWN_DATE:${field}`); return null;
}
function daySnapshot(raw: unknown, position: number, allocate: (position: number) => string): NutritionArchiveDaySnapshot {
  const issues: string[] = [], row = isObject(raw) ? raw : {};
  if (!isObject(raw)) issues.push("DAY_SHAPE_UNSUPPORTED");
  const values = Object.fromEntries(ARCHIVE_DAY_METRICS.map((field) => [field, numberCell(row, field, issues)])) as NutritionArchiveDaySnapshot["values"];
  const flag = row.training;
  const training: NutritionArchiveDaySnapshot["training"] = !Object.hasOwn(row, "training") ? { state: "ABSENT" }
    : flag === null || flag === "" ? { state: "UNKNOWN" } : flag === "Да" || flag === "Нет" ? { state: "VALUE", value: flag === "Да" ? "YES" : "NO" } : { state: "UNSUPPORTED" };
  if (training.state === "UNSUPPORTED") issues.push("TRAINING_FLAG_UNSUPPORTED");
  const known = new Set<string>(["dateKey", "training", ...ARCHIVE_DAY_METRICS]);
  const unknownFields = Object.keys(row).filter((key) => !known.has(key)).sort(); if (unknownFields.length) issues.push("DAY_FIELDS_UNSUPPORTED");
  return { id: allocate(position), position, localDate: dateValue(row.dateKey, "dateKey", issues), values, training, unknownFields, issues };
}
export function projectNutritionArchive(row: Raw, sourceKey: string, clientId: string, id: string,
  allocateDay: (position: number) => string): NutritionArchiveWeekSnapshot {
  const issues: string[] = [], startDate = dateValue(row.start_date, "start_date", issues), endDate = dateValue(row.end_date, "end_date", issues);
  if (startDate !== null && endDate !== null && endDate < startDate) issues.push("PERIOD_REVERSED");
  const sourceSavedAt = isExplicitTimestamp(row.saved_at) ? row.saved_at : null;
  if (sourceSavedAt === null) issues.push("SAVED_TIME_UNKNOWN");
  const totals = Object.fromEntries(aggregates.map((field) => [field, numberCell(row, field, issues)])) as NutritionArchiveWeekSnapshot["aggregates"];
  if (aggregates.some((field) => totals[field].state === "ABSENT")) issues.push("AGGREGATE_FIELDS_ABSENT");
  let detailShape: NutritionArchiveWeekSnapshot["detailShape"] = "ABSENT", days: NutritionArchiveDaySnapshot[] = [];
  if (!Object.hasOwn(row, "days_json")) issues.push("DAYS_FIELD_ABSENT");
  else {
    let parsed: unknown, readable = false;
    if (typeof row.days_json !== "string") { detailShape = "UNSUPPORTED"; issues.push("DAYS_JSON_UNREADABLE"); }
    else try {
      parsed = parseSourceJson(row.days_json, (_key, source) => new NumberToken(source));
      readable = true;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      detailShape = "UNSUPPORTED"; issues.push("DAYS_JSON_UNREADABLE");
    }
    if (readable) {
      if (Array.isArray(parsed)) { detailShape = "ARRAY"; days = parsed.map((day, index) => daySnapshot(day, index, allocateDay)); }
      else if (isObject(parsed) && Object.keys(parsed).length === 0) detailShape = "LEGACY_EMPTY_OBJECT";
      else { detailShape = "UNSUPPORTED"; issues.push("DAYS_SHAPE_UNSUPPORTED"); }
    }
  }
  const counts = new Map<string, number>();
  for (const day of days) if (day.localDate !== null) counts.set(day.localDate, (counts.get(day.localDate) ?? 0) + 1);
  days = days.map((day) => ({ ...day, issues: [...day.issues,
    ...(day.localDate !== null && counts.get(day.localDate)! > 1 ? ["DUPLICATE_DAY_DATE"] : []),
    ...(day.localDate !== null && startDate !== null && endDate !== null && (day.localDate < startDate || day.localDate > endDate) ? ["DAY_OUTSIDE_PERIOD"] : [])] }));
  const known = new Set<string>(["id", "client_id", "start_date", "end_date", "label", "saved_at", "days_json", ...aggregates]);
  const unknownFields = Object.keys(row).filter((key) => !known.has(key)).sort(); if (unknownFields.length) issues.push("WEEK_FIELDS_UNSUPPORTED");
  if (typeof row.label !== "string") issues.push("LABEL_UNSUPPORTED");
  return { version: 1, id, clientId, sourceKey, startDate, endDate, label: typeof row.label === "string" ? row.label : null,
    sourceSavedAt, aggregates: totals, detailShape, days, issues, unknownFields, overlappingArchiveIds: [], currentSourceOverlap: [], semantics: "HISTORICAL_SNAPSHOT_NOT_DAILY_FACTS" };
}
