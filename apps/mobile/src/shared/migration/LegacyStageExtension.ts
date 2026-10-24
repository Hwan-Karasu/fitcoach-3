import type { CandidateIdentityContext } from "./LegacyIdentityBinding.ts";
import type { LegacySourceRow } from "./LegacyProfileSources.ts";
import type { LegacyWritePlan } from "./LegacyWritePlan.ts";

/** Private bridge coordination contracts. No feature domain depends on another owner. */
export interface LegacyStageClient {
  readonly identity: { readonly sourceIdentityKey: string; readonly sourceClientId: string; readonly updatedAt: string | null };
  readonly raw: LegacySourceRow;
}
export interface LegacyStageClientIds {
  readonly workspaces: ReadonlyMap<string, string>;
  readonly clients: ReadonlyMap<string, string>;
}
export interface LegacyStageExtension<Result> {
  readonly modeTags: readonly string[];
  readonly objects: Readonly<Record<string, string>>;
  readonly clientWorkspaceIndex?: true;
  createSchema(): LegacyWritePlan<void>;
  stage(context: CandidateIdentityContext, createdAt: string, clients: readonly LegacyStageClient[], ids: LegacyStageClientIds): LegacyWritePlan<Result>;
}
