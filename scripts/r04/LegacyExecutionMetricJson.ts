import { parseSourceJson } from "../../apps/mobile/src/features/legacy-import/domain/SourceJson.ts";

/** v2 snapshot metrics can be JSON numbers. Keep their original decimal token,
 * including digits JSON.parse would otherwise round, also without reviver context. */
export function parseLegacyExecutionMetricJson(value: unknown): unknown {
  const invalid = (): never => { throw new Error("R04_ID_LEDGER_EXECUTION_METRIC_JSON_INVALID"); };
  if (typeof value !== "string") return invalid();
  try {
    return parseSourceJson(value, (key, source) => ["reps", "weight", "rpe"].includes(key) ? source : Number(source));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("R04_")) throw error;
    // A SyntaxError can contain personal source text; expose only a fixed code.
    return invalid();
  }
}
