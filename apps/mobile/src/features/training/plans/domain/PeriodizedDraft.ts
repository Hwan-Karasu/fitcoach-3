import type { PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { WeekScope, WeekType } from "./PeriodizedModel.ts";

export type PeriodizedDraft = Readonly<{
  baseRevision: number;
  draft: SimpleProgramDraft;
  clientIds: readonly string[];
}> & (Readonly<{ kind: "MESOCYCLE" }> | Readonly<{
  kind: "WEEK"; mesocycleId: string; weekIndex: number; type: WeekType; scope: WeekScope;
  replaceConflicts?: readonly string[];
  /** Неделя, с которой начата правка: если план потом изменился, правки переносятся на новый план. */
  baseWorkouts?: readonly PlannedWorkout[];
}>);

export function periodizedDraftKey(draft: PeriodizedDraft): string {
  return draft.kind === "MESOCYCLE" ? "new:MESOCYCLE" : `week:${draft.mesocycleId}:${draft.weekIndex}`;
}
