import type { SetFact, WorkoutStatus } from "../../execution/public.ts";

/**
 * Единая хронология занятий клиента (§48.85, T06): факты дневника из всех его Простых и Расширенных программ — активных
 * и архивных — с происхождением (программа, мезоцикл, тренировочный день, неделя) и фактической датой (§48.84).
 * Одна тренировка — одна запись: выполнение дневника уникально по слоту, поэтому повторное завершение, перестановка
 * недель и версии матрицы дублей не создают.
 */
export interface TrainingHistoryEntry {
  /** ID выполнения — устойчивый ключ записи. */
  readonly key: string;
  readonly programId: string;
  readonly programTitle: string;
  readonly programKind: "SIMPLE" | "PERIODIZED";
  readonly archived: boolean;
  readonly mesocycleId: string | null;
  readonly mesocycleTitle: string | null;
  /** `null` — тренировки больше нет в плане (факты остаются). */
  readonly workoutTitle: string | null;
  readonly weekIndex: number;
  readonly actualDate: string;
  readonly status: WorkoutStatus;
  readonly confirmedSets: number;
  readonly volumeKg: number;
  /** Упражнения в порядке выполнения с их фактами. */
  readonly exercises: readonly Readonly<{ exerciseId: string; facts: readonly SetFact[] }>[];
}

export interface HistoryFilter {
  readonly programId: string | null;
  /** Только у Расширенной программы. */
  readonly mesocycleId: string | null;
}

/** Новые сверху; при совпадении даты — устойчиво по ключу (§50.4 п. 1). */
export function sortHistory(entries: readonly TrainingHistoryEntry[]): readonly TrainingHistoryEntry[] {
  return [...entries].sort((a, b) => b.actualDate.localeCompare(a.actualDate) || a.key.localeCompare(b.key));
}

export function filterHistory(entries: readonly TrainingHistoryEntry[], filter: HistoryFilter): readonly TrainingHistoryEntry[] {
  return entries.filter((entry) => (filter.programId === null || entry.programId === filter.programId)
    && (filter.mesocycleId === null || entry.mesocycleId === filter.mesocycleId));
}

/** §48.51, §48.85 п. 3: проведённой считается только тренировка со статусом «Завершена». */
export function completedCount(entries: readonly TrainingHistoryEntry[]): number {
  return entries.filter((entry) => entry.status === "COMPLETED").length;
}
