import type { LegacySourceRow } from "./LegacyProfileSources.ts";

/** All settings, including opaque drafts; null means the physical store is absent. */
export interface LegacySettingsSource {
  readonly accountScope: string;
  readonly rows: readonly LegacySourceRow[] | null;
}
