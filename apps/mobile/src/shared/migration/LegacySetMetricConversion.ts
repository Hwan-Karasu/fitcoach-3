interface LegacyLoadRepValues { readonly reps: number | null; readonly loadGrams: number | null; readonly durationSec: null; readonly distanceM: null }

export type LegacySetMetricIssue = "MISSING_REPS" | "INVALID_REPS" | "MISSING_WEIGHT" | "INVALID_WEIGHT";

function missing(value: unknown): boolean {
  return value == null || typeof value === "string" && value.trim() === "";
}

function repetitions(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** Exact kg → integer grams; never round a legacy value to fit the target. */
function weightGrams(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:[.,]\d+)?$/u.test(value.trim())) return null;
  const [whole, rawFraction = ""] = value.trim().replace(",", ".").split(".");
  const fraction = rawFraction.replace(/0+$/u, "");
  if (fraction.length > 3) return null;
  const grams = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return grams <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(grams) : null;
}

/** Shared exact conversion for text metrics in session rows and archived JSON. */
export function convertLegacySetMetrics(repsRaw: unknown, weightRaw: unknown) {
  const reps = repetitions(repsRaw);
  const loadGrams = weightGrams(weightRaw);
  const metricIssues: LegacySetMetricIssue[] = [];
  if (missing(repsRaw)) metricIssues.push("MISSING_REPS");
  else if (reps === null) metricIssues.push("INVALID_REPS");
  if (missing(weightRaw)) metricIssues.push("MISSING_WEIGHT");
  else if (loadGrams === null) metricIssues.push("INVALID_WEIGHT");
  const values: LegacyLoadRepValues = { reps, loadGrams, durationSec: null, distanceM: null };
  return { values, metricIssues };
}
