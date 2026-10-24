import type { NutritionArchiveWeekSnapshot } from "./NutritionHistorySnapshot.ts";

export interface RetainedNutritionWeek {
  readonly snapshot: NutritionArchiveWeekSnapshot;
  readonly provenance: Readonly<{ sourceDigest: string; sourceFormat: string; importedAt: string; sourceRowDigest: string }>;
}
/** Reads already normalized 3.x data. No legacy file or importer is needed. */
export interface NutritionHistoryPort {
  listWeeks(clientId: string): Promise<readonly RetainedNutritionWeek[]>;
}
