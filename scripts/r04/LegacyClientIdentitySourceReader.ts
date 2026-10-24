import type { DatabaseSync } from "node:sqlite";
import { projectLegacyClientIdentities } from "../../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";
import { legacyClientsReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacyProfileReadPlans.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";
export * from "../../apps/mobile/src/features/clients/domain/legacy-import/LegacyClientIdentity.ts";

export function readLegacyClientIdentityInSnapshot(db: DatabaseSync, accountScope: string) {
  return projectLegacyClientIdentities(runNodeLegacyReadPlan(db, legacyClientsReadPlan(accountScope, "identity")));
}