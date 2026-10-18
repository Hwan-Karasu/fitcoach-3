import type { SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { WeekScope, WeekType } from "./PeriodizedModel.ts";

export type PeriodizedDraft = Readonly<{
  baseRevision: number;
  draft: SimpleProgramDraft;
  clientIds: readonly string[];
}> & (Readonly<{ kind: "MESOCYCLE" }> | Readonly<{
  kind: "WEEK"; mesocycleId: string; weekIndex: number; type: WeekType; scope: WeekScope;
  replaceConflicts?: readonly string[];
}>);

export function periodizedDraftKey(draft: PeriodizedDraft): string {
  return draft.kind === "MESOCYCLE" ? "new:MESOCYCLE" : `week:${draft.mesocycleId}:${draft.weekIndex}`;
}
