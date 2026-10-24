import type { CandidateIdentityContext } from "./LegacyIdentityBinding.ts";
import type { LegacySourceRow } from "./LegacyProfileSources.ts";
import type { LegacyWritePlan } from "./LegacyWritePlan.ts";

/** Private bridge coordination contracts. No feature domain depends on another owner. */
export interface LegacyStageClient {
  readonly identity: { readonly sourceIdentityKey: string; readonly sourceClientId: string; readonly updatedAt: string | null;
    readonly accountScope: string; readonly sourceWorkspaceId: string | null };
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
  readonly requiredModeTags?: readonly string[];
  createSchema(): LegacyWritePlan<void>;
  stage(context: CandidateIdentityContext, createdAt: string, clients: readonly LegacyStageClient[], ids: LegacyStageClientIds, allocate: () => string): LegacyWritePlan<Result>;
}

type Results<Stages extends readonly LegacyStageExtension<unknown>[]> = { readonly [Key in keyof Stages]: Stages[Key] extends LegacyStageExtension<infer Result> ? Result : never };

/** Owners are ordered once, before creating the immutable staging binding. */
export function combineLegacyStageExtensions<const Stages extends readonly LegacyStageExtension<unknown>[]>(...stages: Stages): LegacyStageExtension<Results<Stages>> {
  const captured = stages.map((stage) => ({ ...stage, modeTags: [...stage.modeTags], objects: { ...stage.objects }, requiredModeTags: [...(stage.requiredModeTags ?? [])] }));
  const modeTags: string[] = [], objects: Record<string, string> = {};
  for (const stage of captured) {
    if (stage.requiredModeTags.some((tag) => !modeTags.includes(tag)) || stage.modeTags.some((tag) => modeTags.includes(tag))
      || Object.keys(stage.objects).some((name) => Object.hasOwn(objects, name))) throw new Error("R04_ID_LEDGER_EXTENSION_ORDER_INVALID");
    modeTags.push(...stage.modeTags); Object.assign(objects, stage.objects);
  }
  return Object.freeze<LegacyStageExtension<Results<Stages>>>({
    modeTags: Object.freeze(modeTags), objects: Object.freeze(objects), clientWorkspaceIndex: captured.some((stage) => stage.clientWorkspaceIndex) ? true : undefined,
    *createSchema() { for (const stage of captured) yield* stage.createSchema(); },
    *stage(context, createdAt, clients, ids, allocate) {
      const results: unknown[] = [];
      for (const stage of captured) results.push(yield* stage.stage(context, createdAt, clients, ids, allocate));
      return results as Results<Stages>;
    },
  });
}
