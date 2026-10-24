import type { LegacyStageExtension } from "../../../../shared/migration/LegacyStageExtension.ts";
import { legacyClientWorkDataStagePlan, legacyWorkDataSchemaPlan, workDataRehearsalObjects, type LegacyWorkDataStageResult } from "./LegacyClientWorkDataStagePlan.ts";

/** WorkData follows full profile/questionnaire validation in the same client tx. */
export function legacyClientWorkDataStagingExtension(): LegacyStageExtension<LegacyWorkDataStageResult> {
  return Object.freeze<LegacyStageExtension<LegacyWorkDataStageResult>>({
    modeTags: Object.freeze(["WORK_DATA_REHEARSAL_V1"]),
    requiredModeTags: Object.freeze(["PROFILE_REHEARSAL_V1", "QUESTIONNAIRE_COMPOSITION_V1"]),
    objects: Object.freeze({ ...workDataRehearsalObjects }), clientWorkspaceIndex: true,
    createSchema: legacyWorkDataSchemaPlan,
    stage: legacyClientWorkDataStagePlan,
  });
}
