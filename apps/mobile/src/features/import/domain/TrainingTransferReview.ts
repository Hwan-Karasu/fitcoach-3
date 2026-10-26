import type { TrainingTransfer, TransferWorkout, TransferWeek, TransferCycle } from "../../../shared/training-transfer/TrainingTransfer.ts";

export interface TransferReviewScope {
  readonly id: string;
  readonly programId: string | null;
  readonly title: string;
  readonly settings?: Pick<TransferCycle, "cycleType" | "repRange" | "startDate">;
  readonly weeks: readonly { readonly index: number; readonly type?: TransferWeek["type"]; readonly workouts: readonly TransferWorkout[] }[];
}

/** Presentation projections only: original IDs, per-week plans and history remain untouched. */
export function transferReviewScopes(value: TrainingTransfer): readonly TransferReviewScope[] {
  const scopes: TransferReviewScope[] = [];
  const represented = new Set<string>();
  for (const p of value.programs) {
    if (p.simple) scopes.push({ id: JSON.stringify([p.id, "simple"]), programId: p.id, title: p.title,
      weeks: Array.from({ length: p.simple.weeks }, (_, i) => ({ index: i + 1, workouts: p.simpleWeeks.find((w) => w.index === i + 1)?.workouts ?? p.simple!.workouts })) });
    for (const cycle of p.mesocycles) scopes.push({ id: JSON.stringify([p.id, cycle.id]), programId: p.id, title: cycle.title, weeks: cycle.weeks, settings: { cycleType: cycle.cycleType, repRange: cycle.repRange, startDate: cycle.startDate } });
  }
  for (const scope of scopes) for (const week of scope.weeks) for (const w of week.workouts) for (const e of w.exercises) represented.add(e.exerciseId);
  const historical = value.exercises.filter((e) => !represented.has(e.id));
  // Catalog entries used only by old plan versions/deleted exercises must also be matched.
  if (historical.length) scopes.push({ id: "history-exercises", programId: null, title: "Упражнения из истории", weeks: [{ index: 1,
    workouts: [{ id: "history-exercises", title: "Сохранённые упражнения", exercises: historical.map((e) => ({ id: e.id, exerciseId: e.id, restSec: null, instruction: null, rir: null, sets: [] })) }] }] });
  return scopes;
}
