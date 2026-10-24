/** v2 snapshot metrics can be JSON numbers. Keep their original decimal token,
 * including digits JSON.parse would otherwise round. Requires pinned Node 24. */
export function parseLegacyExecutionMetricJson(value: unknown): unknown {
  const invalid = (): never => { throw new Error("R04_ID_LEDGER_EXECUTION_METRIC_JSON_INVALID"); };
  if (typeof value !== "string") return invalid();
  try {
    return JSON.parse(value, (key: string, parsed: unknown, context?: { source?: string }): unknown => {
      if (typeof parsed !== "number" || !["reps", "weight", "rpe"].includes(key)) return parsed;
      if (typeof context?.source !== "string") throw new Error("R04_ID_LEDGER_EXECUTION_NUMERIC_SOURCE_UNAVAILABLE");
      return context.source;
    }) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("R04_")) throw error;
    // A SyntaxError can contain personal source text; expose only a fixed code.
    return invalid();
  }
}
