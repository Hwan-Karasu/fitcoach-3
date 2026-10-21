import type { PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { BuilderWeek, CycleType, WeekScope, WeekType } from "./PeriodizedModel.ts";

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

/**
 * Черновик конструктора мезоцикла (§48.29): создание Расширенной программы, «+ Мезоцикл» и правка мезоцикла. Хранится отдельно от
 * действующего плана и не создаёт версий; привязан к клиенту, программе и мезоциклу.
 */
export interface MesocycleBuilderDraft {
  /** Ревизия программы, по которой начат черновик; `null` — программа ещё не создана. */
  readonly baseRevision: number | null;
  readonly programTitle: string;
  readonly title: string;
  readonly cycleType: CycleType;
  readonly repsText: string;
  readonly startDate: string;
  readonly weeks: readonly BuilderWeek[];
  readonly editing: number;
  readonly members: readonly string[];
  /** Недели правимого мезоцикла на момент начала правки: если мезоцикл изменился, правки переносятся на текущий план по ним. */
  readonly baseWeeks: readonly BuilderWeek[] | null;
}

/** Объект правки черновика: новая программа, «+ Мезоцикл» в программе или существующий мезоцикл. */
export interface MesocycleBuilderScope {
  readonly programId: string | null;
  readonly mesocycleId: string | null;
}

export function mesocycleBuilderDraftKey(scope: MesocycleBuilderScope): string {
  return scope.programId === null ? "new:PERIODIZED" : `builder:${scope.programId}:${scope.mesocycleId ?? "add"}`;
}
