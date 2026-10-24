import type { LegacyQuestionnaireSource } from "../../../../shared/migration/LegacyProfileSources.ts";
import { captureLegacySourceRow } from "../../../../shared/migration/LegacySourceCapture.ts";
import type { LegacyStageExtension } from "../../../../shared/migration/LegacyStageExtension.ts";
import { projectLegacyQuestionnaire } from "../../domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { legacyClientProfilesStagePlan, legacyProfileSchemaPlan, profileRehearsalObjects, type LegacyProfileStageResult } from "./LegacyClientProfileStagePlan.ts";

/** Capture immutable raw questionnaire input once for this SHA-bound candidate job.
 * undefined = old profile-only mode; null = questionnaire mode with absent stores.
 * Changing mode requires a new staging file, never an in-place schema upgrade.
 */
export function legacyQuestionnaireStagingExtension(source?: LegacyQuestionnaireSource | null): LegacyStageExtension<LegacyProfileStageResult> {
  const snapshot = source == null ? source : { accountScope: source.accountScope, owners: source.owners.map(captureLegacySourceRow),
    templates: source.templates.map(captureLegacySourceRow), revisions: source.revisions.map(captureLegacySourceRow),
    answers: source.answers.map(captureLegacySourceRow), changes: source.changes?.map(captureLegacySourceRow) ?? null };
  const candidates = snapshot == null ? snapshot : projectLegacyQuestionnaire(snapshot);
  return Object.freeze<LegacyStageExtension<LegacyProfileStageResult>>({
    modeTags: Object.freeze(["PROFILE_REHEARSAL_V1", ...(source === undefined ? [] : ["QUESTIONNAIRE_COMPOSITION_V1"])]),
    objects: Object.freeze({ ...profileRehearsalObjects }), clientWorkspaceIndex: true as const,
    createSchema: legacyProfileSchemaPlan,
    stage: (context, createdAt, clients, ids) => legacyClientProfilesStagePlan(context, createdAt, clients, ids, candidates),
  });
}
