import { resizeBuilderWeeks } from "./MesocycleBuilder.ts";
import type { BuilderWeek, CycleType, Mesocycle } from "./PeriodizedModel.ts";
import type { PlannedWorkout } from "./SimplePlanModel.ts";
import { formatRange } from "./SimplePlanRules.ts";

/** Состояние цикла в конструкторе: всё, что экран заменяет при переключении цикла на месте (CYCLE-STRIP-3). */
export interface CycleState {
  readonly title: string;
  readonly cycleType: CycleType;
  readonly repsText: string;
  readonly startDate: string;
  readonly weeks: readonly BuilderWeek[];
  /** Недели сохранённого цикла: по ним черновик переносится на изменившийся цикл; у нового цикла — `null`. */
  readonly baseWeeks: readonly BuilderWeek[] | null;
  /** Недели «до правки» для меню области; у нового цикла пусто. */
  readonly baselines: ReadonlyMap<number, readonly PlannedWorkout[]>;
}

/**
 * Состояние цикла из уже прочитанного плана программы — без чтения базы. `cycleId` без цикла в плане (или `undefined`) — новый цикл:
 * следующий номер, четыре пустые недели и настройки по умолчанию.
 */
export function cycleStateFrom(plan: Readonly<{ mesocycles: readonly Mesocycle[] }>, cycleId: string | undefined, today: string): CycleState {
  const cycle = cycleId === undefined ? undefined : plan.mesocycles.find((item) => item.id === cycleId);
  if (cycle === undefined) {
    return { title: `Мезоцикл ${plan.mesocycles.length + 1}`, cycleType: "hypertrophy", repsText: "8-12", startDate: today,
      weeks: resizeBuilderWeeks([{ type: "base", workouts: [] }], 4), baseWeeks: null, baselines: new Map() };
  }
  const weeks = cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts }));
  return { title: cycle.title, cycleType: cycle.cycleType ?? "hypertrophy",
    repsText: cycle.repRange == null ? "" : formatRange(cycle.repRange).replace("–", "-"), startDate: cycle.startDate ?? today,
    weeks, baseWeeks: weeks, baselines: new Map(weeks.map((week, index) => [index, week.workouts])) };
}
