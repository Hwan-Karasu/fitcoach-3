import type { LegacyStageExtension } from "../../../../shared/migration/LegacyStageExtension.ts";
import type { LegacySettingsSource } from "../../../../shared/migration/LegacySettingsSource.ts";
import { captureLegacySourceRow } from "../../../../shared/migration/LegacySourceCapture.ts";
import { legacySettingsSchemaPlan, legacySettingsStagePlan, settingsRehearsalObjects, type LegacySettingsStageResult } from "./LegacySettingsStagePlan.ts";

export function legacySettingsStagingExtension(source: LegacySettingsSource): LegacyStageExtension<LegacySettingsStageResult> {
  if (source.rows !== null && !Array.isArray(source.rows)) throw new Error("R04_ID_LEDGER_SETTINGS_SOURCE_INVALID");
  const snapshot = { accountScope: source.accountScope, rows: source.rows?.map(captureLegacySourceRow) ?? null };
  return Object.freeze<LegacyStageExtension<LegacySettingsStageResult>>({ modeTags: Object.freeze(["SETTINGS_REHEARSAL_V1"]), objects: Object.freeze({ ...settingsRehearsalObjects }),
    createSchema: legacySettingsSchemaPlan, stage: (context, importedAt) => legacySettingsStagePlan(context, importedAt, snapshot) });
}
