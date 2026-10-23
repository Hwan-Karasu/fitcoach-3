import { ALL_OPTION, completedCount, sortHistory, type FilterOption, type TrainingHistoryEntry } from "./trainingHistory.ts";
import { compareOptionalDays as compareWorkoutDays } from "../../../../shared/format/calendarDay.ts";

/**
 * Иерархия истории «программа → мезоцикл → тренировка → выполнения» (UX-контракт истории v1.2). Чистые функции над единой хронологией
 * (§48.85); ничего не читают и не пишут. Группировка — по ключам, не по названиям: одинаковые названия разных тренировок не склеиваются.
 */

export interface ProgramHistorySummary {
  readonly programId: string;
  readonly title: string;
  readonly kind: TrainingHistoryEntry["programKind"];
  readonly archived: boolean;
  /** План удалён с сохранением истории: ленты мезоциклов нет, выполнения — одним блоком. */
  readonly planDeleted: boolean;
  /** Все записи истории программы (в том числе «В работе», «Пропущена», «Отменена»). */
  readonly records: number;
  /** «Проведено» — только `Завершена` (§48.51). */
  readonly completed: number;
  /** Рабочие подходы: засчитанные, без разминки. */
  readonly workingSets: number;
  /** Мезоциклы с историей; у Простой программы и у «план удалён» — 0. */
  readonly mesocycles: number;
  readonly lastDate: string | null;
}

/** Программы, у которых есть записи, — по дате последнего занятия (новее выше), при равенстве — стабильно по id. */
export function programsWithHistory(entries: readonly TrainingHistoryEntry[]): readonly ProgramHistorySummary[] {
  const byProgram = new Map<string, TrainingHistoryEntry[]>();
  for (const entry of entries) byProgram.set(entry.programId, [...(byProgram.get(entry.programId) ?? []), entry]);
  return [...byProgram].map(([programId, items]): ProgramHistorySummary => {
    const latest = sortHistory(items)[0]!;
    return { programId, title: latest.programTitle, kind: latest.programKind, archived: latest.archived, planDeleted: latest.planDeleted,
      records: items.length, completed: completedCount(items), workingSets: items.reduce((sum, item) => sum + item.workingSets, 0),
      mesocycles: new Set(items.flatMap((item) => item.mesocycleId === null ? [] : [item.mesocycleId])).size, lastDate: latest.actualDate };
  }).sort((a, b) => compareWorkoutDays(a.lastDate, b.lastDate) || a.programId.localeCompare(b.programId));
}

export interface MesocycleOption {
  readonly mesocycleId: string;
  readonly title: string;
}

/** Лента мезоциклов выбранной программы: только те, где есть занятия, в порядке плана, без повторов. */
export function mesocyclesWithHistory(entries: readonly TrainingHistoryEntry[], programId: string): readonly MesocycleOption[] {
  const found = new Map<string, MesocycleOption & { readonly index: number }>();
  for (const entry of entries) {
    if (entry.programId !== programId || entry.mesocycleId === null || entry.mesocycleIndex === null || found.has(entry.mesocycleId)) continue;
    found.set(entry.mesocycleId, { mesocycleId: entry.mesocycleId, title: entry.mesocycleTitle ?? "Мезоцикл", index: entry.mesocycleIndex });
  }
  return [...found.values()].sort((a, b) => a.index - b.index).map(({ mesocycleId, title }) => ({ mesocycleId, title }));
}

export interface WorkoutGroup {
  /** Ключ группировки: родство (Расширенная) или id плановой тренировки. */
  readonly key: string;
  /** Название ближайшего по дате выполнения; если его нет — ближайшее непустое; иначе «Тренировка». */
  readonly title: string;
  /** Новые сверху. */
  readonly occurrences: readonly TrainingHistoryEntry[];
  readonly completed: number;
}

/** Тренировки выбранной программы (`mesocycleId = null` — вся программа) с их выполнениями, по названию числовым порядком. */
export function workoutGroups(entries: readonly TrainingHistoryEntry[], scope: Readonly<{ programId: string; mesocycleId: string | null }>):
  readonly WorkoutGroup[] {
  const byKey = new Map<string, TrainingHistoryEntry[]>();
  for (const entry of entries) {
    if (entry.programId !== scope.programId || (scope.mesocycleId !== null && entry.mesocycleId !== scope.mesocycleId)) continue;
    byKey.set(entry.workoutKey, [...(byKey.get(entry.workoutKey) ?? []), entry]);
  }
  return [...byKey].map(([key, items]): WorkoutGroup => {
    const occurrences = sortHistory(items);
    return { key, title: occurrences.find((item) => item.workoutTitle !== null)?.workoutTitle ?? "Тренировка", occurrences,
      completed: completedCount(occurrences) };
  }).sort((a, b) => a.title.localeCompare(b.title, "ru", { numeric: true }) || a.key.localeCompare(b.key));
}

/** «Все тренировки» и тренировки выбранной программы (и мезоцикла) — варианты третьей пилюли фильтра. */
export function workoutOptions(entries: readonly TrainingHistoryEntry[], programId: string, mesocycleId: string | null): readonly FilterOption[] {
  return [{ value: ALL_OPTION, label: "Все тренировки" },
    ...workoutGroups(entries, { programId, mesocycleId }).map((group) => ({ value: group.key, label: group.title }))];
}

export interface ScopeSummary {
  readonly records: number;
  readonly completed: number;
  readonly workingSets: number;
}

/** «Проведено · Записей · Рабочих подходов» по записям выбора (программа или её мезоцикл). */
export function scopeSummary(entries: readonly TrainingHistoryEntry[]): ScopeSummary {
  return { records: entries.length, completed: completedCount(entries), workingSets: entries.reduce((sum, item) => sum + item.workingSets, 0) };
}
