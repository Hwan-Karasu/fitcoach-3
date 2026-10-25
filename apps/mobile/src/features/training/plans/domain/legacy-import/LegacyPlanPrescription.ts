import type { PlanRange } from "../SimplePlanModel.ts";
import { convertLegacySetMetrics } from "../../../../../shared/migration/LegacySetMetricConversion.ts";
import { parseRoundTripSourceJson } from "../../../../../shared/migration/SourceJson.ts";

function fail(code = "PRESCRIPTION_INVALID"): never { throw new Error(`R04_ID_LEDGER_PLANS_${code}`); }
export const LEGACY_REST_DEFAULT = 120;

/** Pinned v2 getter/setter semantics. The similarly named restSec property was
 * never read by that getter. A new 3.x exercise's default is a separate policy. */
export function projectLegacyRest(exercise: Readonly<Record<string, unknown>>) {
  const value = exercise.restSeconds, issues: string[] = [];
  if (Object.hasOwn(exercise, "restSec")) issues.push("REST_SEC_NOT_SOURCE_FIELD");
  if (value === undefined) return { seconds: LEGACY_REST_DEFAULT, basis: "LEGACY_DEFAULT_120", issues };
  // The v2 card checked typeof number, while its completion handler coerced with
  // Number(). Null/strings/booleans can therefore disagree about enabled/time.
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > 1859) return fail("REST_UNREPRESENTABLE");
  return { seconds: value === 0 ? null : value, basis: "exercise.restSeconds", issues };
}
export function sourceObject(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") return fail();
  let parsed: unknown;
  try { parsed = parseRoundTripSourceJson(value); }
  catch (error) {
    if (error instanceof RangeError) return fail("NUMBER_UNREPRESENTABLE");
    return fail();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail();
  return parsed as Readonly<Record<string, unknown>>;
}
export function sourcePlanRange(value: unknown, minimum: number, maximum: number): PlanRange | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return fail();
  const raw = value.trim(); if (!raw) return null;
  const match = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/u.exec(raw);
  if (!match) return fail();
  const min = Number(match[1]), max = match[2] === undefined ? null : Number(match[2]);
  if (!Number.isSafeInteger(min) || min < minimum || min > maximum || max !== null && (!Number.isSafeInteger(max) || max < min || max > maximum)) return fail();
  return { min, max: max === min ? null : max };
}
/** Exact precedence from build120 setLogPlan. These are plan-only properties:
 * physical row reps/weight/completed_at/segments are retained for Execution. */
function pick(groups: readonly { object: Readonly<Record<string, unknown>>; keys: readonly string[]; prefix: string }[]) {
  for (const { object, keys, prefix } of groups) for (const key of keys) {
    const value = object[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") return fail();
    if (value.trim()) return { raw: value, basis: `${prefix}.${key}` };
  }
  return { raw: "", basis: "ABSENT" };
}
export function projectLegacyPlanPrescription(set: Readonly<Record<string, unknown>>, exercise: Readonly<Record<string, unknown>>) {
  const reps = pick([{ object: set, keys: ["plannedReps", "targetReps", "plan"], prefix: "set" },
    { object: exercise, keys: ["repRange", "plannedReps", "targetReps"], prefix: "exercise" }]);
  const weight = pick([{ object: set, keys: ["plannedWeight", "targetWeight"], prefix: "set" },
    { object: exercise, keys: ["plannedWeight", "targetWeight"], prefix: "exercise" }]);
  const range = sourcePlanRange(reps.raw, 1, 999);
  const load = weight.raw.trim() ? convertLegacySetMetrics("1", weight.raw).values.loadGrams : null;
  if (weight.raw.trim() && (load === null || load > 1_000_000)) return fail();
  return { reps: range?.min ?? null, repsMax: range?.max ?? null, loadGrams: load, durationSec: null, distanceM: null,
    basis: { reps: reps.basis, load: weight.basis } };
}
