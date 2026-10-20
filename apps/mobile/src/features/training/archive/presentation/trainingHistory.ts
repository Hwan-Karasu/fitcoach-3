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
  /** §50.3, действие 1: исходный план удалён, подписи — из неизменяемого снимка происхождения. */
  readonly planDeleted: boolean;
  readonly mesocycleId: string | null;
  readonly mesocycleTitle: string | null;
  /** Порядок мезоцикла в программе клиента (с 0); `null` — Простая программа или план удалён (мезоцикл — только подпись снимка). */
  readonly mesocycleIndex: number | null;
  /** `null` — тренировки больше нет в плане (факты остаются). */
  readonly workoutTitle: string | null;
  /**
   * Ключ группировки «та же тренировка в разных неделях»: у Расширенной — родство тренировки в её мезоцикле, у Простой и у программы
   * с удалённым планом — id плановой тренировки. Не название (одинаковые названия не склеиваются).
   */
  readonly workoutKey: string;
  /** Плановый слот — переход из истории в тренировку (§37.3). */
  readonly plannedWorkoutId: string;
  readonly weekIndex: number;
  readonly actualDate: string;
  readonly status: WorkoutStatus;
  /** Рабочие подходы: засчитанные, без разминки (единое правило `isWorkingSet`). */
  readonly workingSets: number;
  /** Упражнения в порядке выполнения с их фактами. */
  readonly exercises: readonly Readonly<{ exerciseId: string; facts: readonly SetFact[];
    /** Заметка о выполнении упражнения в этой тренировке (§48.67); `null` — нет. */ note: string | null }>[];
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

/** Значение «Все» в списках выбора программы и мезоцикла. */
export const ALL_OPTION = "__all__";

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** Подпись программы в списках: удалённый план и архив помечены (§50.3). */
export function programLabel(entry: Pick<TrainingHistoryEntry, "programTitle" | "planDeleted" | "archived">): string {
  return entry.planDeleted ? `${entry.programTitle} (план удалён)` : entry.archived ? `${entry.programTitle} (архив)` : entry.programTitle;
}

/** «Все программы» и по одной строке на программу, где есть занятия, — в порядке записей (новые сверху). */
export function programOptions(entries: readonly TrainingHistoryEntry[]): readonly FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const entry of entries) if (!seen.has(entry.programId)) seen.set(entry.programId, { value: entry.programId, label: programLabel(entry) });
  return [{ value: ALL_OPTION, label: "Все программы" }, ...seen.values()];
}

/** «Все мезоциклы» и мезоциклы выбранной программы, где есть занятия. */
export function mesocycleOptions(entries: readonly TrainingHistoryEntry[], programId: string): readonly FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const entry of entries) {
    if (entry.programId === programId && entry.mesocycleId !== null && !seen.has(entry.mesocycleId)) {
      seen.set(entry.mesocycleId, { value: entry.mesocycleId, label: entry.mesocycleTitle ?? "Мезоцикл" });
    }
  }
  return [{ value: ALL_OPTION, label: "Все мезоциклы" }, ...seen.values()];
}
