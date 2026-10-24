import type { LegacySourceRow } from "./LegacyProfileSources.ts";

export const legacyMeasurementFields = ["neck", "shoulders", "chest", "waist", "hips", "upper_arm", "thigh", "calf"] as const;
export interface LegacyMeasurementsSnapshot {
  readonly accountScope: string;
  /** Optional absence is different from an observed empty table. */
  readonly rows: readonly LegacySourceRow[] | null;
  readonly clientDays: readonly LegacySourceRow[] | null;
}
