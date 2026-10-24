import type { LegacyClientCardCandidate } from "../../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { projectLegacyClientProfile } from "./LegacyClientProfileProjection.ts";
import type { DatabaseSync } from "node:sqlite";
import type { LegacyClientIdentityCandidate } from "./LegacyClientIdentitySourceReader.ts";
import { projectLegacyClientCards } from "../../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";
import { legacyClientsReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacyProfileReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";
export * from "../../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientCardProjection.ts";

export function readLegacyClientCardsInSnapshot(db: DatabaseSync, accountScope: string,
  identities: readonly LegacyClientIdentityCandidate[]) {
  if (!accountScope.trim() || identities.some((row) => row.accountScope !== accountScope)) throw new Error("R04_CLIENT_CARD_SCOPE_MISMATCH");
  return projectLegacyClientCards(runNodeLegacyReadPlan(db, legacyClientsReadPlan(accountScope, "card")), identities);
}
export function summarizeLegacyClientCards(rows: readonly LegacyClientCardCandidate[]) {
  const profiles = rows.filter((row) => row.legacyProfile !== null).map((row) => projectLegacyClientProfile(row.legacyProfile!));
  return { status: "requires-mapping" as const, sourceRows: rows.length,
    cardCandidates: rows.filter((row) => row.fields !== null).length,
    rowsRequiringReview: rows.filter((row) => row.issues.length > 0).length,
    retainedLegacyProfileRows: rows.filter((row) => row.legacyProfile !== null).length,
    profileAnswerCandidates: profiles.reduce((n, row) => n + Object.keys(row.answers ?? {}).length, 0),
    profilesRequiringReview: rows.length - profiles.filter((row) => row.answers !== null).length,
    workDataCandidateRows: profiles.filter(({ workData: w }) => w.trainerNote !== null || w.manualTags.length > 0 || w.loadAvoidance !== null || w.safety.length > 0).length,
    targetWrites: 0 as const };
}
