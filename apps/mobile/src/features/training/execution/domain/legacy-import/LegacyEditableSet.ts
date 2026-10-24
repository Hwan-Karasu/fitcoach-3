import { convertLegacySetMetrics } from "../../../../../shared/migration/LegacySetMetricConversion.ts";
import type { SetValues } from "../ExecutionModel.ts";

/** Unconfirmed source values, never a performed fact. Raw strings remain in the
 * owning representation; invalid values are review issues, never repaired zeros. */
export function projectLegacyEditableSet(input: Readonly<{ reps: unknown; weight: unknown; rpe: unknown;
  setKind: unknown; effort: unknown; segments: readonly Readonly<Record<string, unknown>>[] }>) {
  const issues: string[] = [];
  const missing = (v: unknown) => v == null || typeof v === "string" && v.trim() === "";
  function values(reps: unknown, weight: unknown, prefix: string): SetValues {
    const parsed = convertLegacySetMetrics(reps, weight);
    // An entered zero is permitted in an editable field; it never proves completion.
    const zero = typeof reps === "string" && /^0+$/u.test(reps.trim());
    for (const issue of parsed.metricIssues) if (issue.startsWith("INVALID_") && !(zero && issue === "INVALID_REPS")) issues.push(`${prefix}_${issue}`);
    return { ...parsed.values, reps: zero ? 0 : parsed.values.reps };
  }
  const base = values(input.reps, input.weight, "BASE");
  const segments = input.segments.length ? input.segments.map((s, i) => values(s.reps, s.weight, `SEGMENT_${i}`)) : [base];
  if (segments[0]!.reps !== base.reps || segments[0]!.loadGrams !== base.loadGrams) issues.push("BASE_SEGMENT_CONFLICT");
  const rpe = missing(input.rpe) ? null : typeof input.rpe === "string" && /^\d+$/u.test(input.rpe.trim()) ? Number(input.rpe.trim()) : NaN;
  const validRpe = rpe === null || Number.isInteger(rpe) && rpe >= 1 && rpe <= 10;
  if (!validRpe) issues.push("RPE_INVALID");
  const kind = input.setKind == null ? "working" : ["working", "warmup", "drop"].includes(String(input.setKind)) && typeof input.setKind === "string" ? input.setKind : null;
  const effort = input.effort == null ? "normal" : ["normal", "failure"].includes(String(input.effort)) && typeof input.effort === "string" ? input.effort : null;
  if (kind === null) issues.push("SET_KIND_INVALID");
  if (effort === null) issues.push("EFFORT_INVALID");
  if (kind !== "drop" && segments.length > 1) issues.push("MULTIPLE_SEGMENTS_FOR_NON_DROP");
  const rawSegments = input.segments.length ? input.segments : [{ reps: input.reps, weight: input.weight }];
  const hasInput = !missing(input.reps) || !missing(input.weight) || !missing(input.rpe)
    || rawSegments.some((s) => !missing(s.reps) || !missing(s.weight));
  return { confirmed: false as const, hasInput, values: base, segments, rpe: validRpe ? rpe : null, kind, effort, issues: issues.sort() };
}

export type LegacyEditableSet = ReturnType<typeof projectLegacyEditableSet>;
