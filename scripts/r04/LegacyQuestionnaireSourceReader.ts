import type { DatabaseSync } from "node:sqlite";
import { projectLegacyQuestionnaire } from "../../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { legacyQuestionnaireReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacyProfileReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";
export * from "../../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";

export function readLegacyQuestionnaireInSnapshot(db: DatabaseSync, accountScope: string) {
  const source = runNodeLegacyReadPlan(db, legacyQuestionnaireReadPlan(accountScope));
  return source === null ? null : projectLegacyQuestionnaire(source);
}