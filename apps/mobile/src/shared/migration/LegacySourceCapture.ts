import type { LegacySourceRow } from "./LegacyProfileSources.ts";

/** Capture raw SQL values before awaiting. Derived objects are not source SQL cells. */
export function captureLegacySourceRow(row: LegacySourceRow): LegacySourceRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value instanceof Uint8Array) return [key, new Uint8Array(value)];
    if (value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return [key, value];
    throw new Error("R04_ID_LEDGER_SOURCE_PAYLOAD_INVALID");
  }));
}
