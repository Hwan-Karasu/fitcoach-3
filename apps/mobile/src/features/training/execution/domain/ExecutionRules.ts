import type { ConfirmationMode, SetType, SetValues, TrackingMetric, WeekStatus, WorkoutOutcome,
  WorkoutStatus } from "./ExecutionModel.ts";

/** Поле факта подхода, которое заполняет величина профиля (§33.2). */
export type SetField = keyof SetValues;

export function fieldsOf(metrics: readonly TrackingMetric[]): readonly SetField[] {
  return metrics.map((metric): SetField => metric === "reps" ? "reps" : metric === "duration" ? "durationSec"
    : metric === "distance" ? "distanceM" : "loadGrams");
}

export const VALUE_LIMITS: Readonly<Record<SetField, Readonly<{ min: number; max: number }>>> = {
  reps: { min: 1, max: 999 },
  loadGrams: { min: 0, max: 1_000_000 },
  durationSec: { min: 1, max: 86_400 },
  distanceM: { min: 1, max: 1_000_000 },
};

const ALL_FIELDS = Object.keys(VALUE_LIMITS) as readonly SetField[];

/** Значения по профилю: лишних полей нет, числа целые и в пределах; RPE — 1–10 или пусто (§48.65 п. 6). */
export function validateValues(values: SetValues, rpe: number | null, metrics: readonly TrackingMetric[]): void {
  const allowed = new Set(fieldsOf(metrics));
  for (const field of ALL_FIELDS) {
    const value = values[field];
    if (value === null) continue;
    const limit = VALUE_LIMITS[field];
    if (!allowed.has(field) || !Number.isInteger(value) || value < limit.min || value > limit.max) {
      throw new Error("INVALID_METRIC");
    }
  }
  if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) throw new Error("INVALID_METRIC");
}

/** §48.52: все обязательные величины профиля заполнены; `0 кг` — заполнено, RPE не обязателен. */
export function isComplete(values: SetValues, metrics: readonly TrackingMetric[]): boolean {
  return metrics.length > 0 && fieldsOf(metrics).every((field) => values[field] !== null);
}

export interface ConfirmationChange {
  readonly confirmed: boolean;
  /** Новый переход «не выполнен → выполнен»: от него запускается таймер отдыха (§48.55). */
  readonly confirmedNow: boolean;
}

/**
 * Подтверждение после сохранения значений — ввод или нажатие «Пред.» (§48.48, §48.55, §48.69).
 * Автоматический режим: полный подход выполнен; очистка обязательного поля снимает подтверждение.
 * Ручной: значения не подтверждают, но неполный подход подтверждённым не остаётся.
 */
export function confirmationAfterSave(mode: ConfirmationMode, wasConfirmed: boolean, values: SetValues,
  metrics: readonly TrackingMetric[]): ConfirmationChange {
  if (!isComplete(values, metrics)) return { confirmed: false, confirmedNow: false };
  if (mode === "AUTO") return { confirmed: true, confirmedNow: !wasConfirmed };
  return { confirmed: wasConfirmed, confirmedNow: false };
}

/** Галочка ручного режима — обратимая (§48.55 п. 2); подтвердить неполный подход нельзя (§48.52 п. 4). */
export function toggleConfirmation(wasConfirmed: boolean, values: SetValues,
  metrics: readonly TrackingMetric[]): ConfirmationChange {
  if (wasConfirmed) return { confirmed: false, confirmedNow: false };
  if (!isComplete(values, metrics)) throw new Error("INVALID_METRIC");
  return { confirmed: true, confirmedNow: true };
}

/** Начата ли тренировка (§48.34): есть внесённое значение или подтверждённый подход; просмотр — не начало. */
export function hasEnteredData(facts: Iterable<Readonly<{ values: SetValues; confirmed: boolean }>>): boolean {
  for (const fact of facts) {
    if (fact.confirmed || ALL_FIELDS.some((field) => fact.values[field] !== null)) return true;
  }
  return false;
}

export function workoutStatus(outcome: WorkoutOutcome | null, started: boolean): WorkoutStatus {
  return outcome ?? (started ? "IN_PROGRESS" : "NOT_STARTED");
}

/** §48.38: повторное нажатие активного исхода снимает его, другой исход заменяет прежний. */
export function nextOutcome(current: WorkoutOutcome | null, pressed: WorkoutOutcome): WorkoutOutcome | null {
  return current === pressed ? null : pressed;
}

/** §48.26, §48.46: статус недели по статусам её тренировок. */
export function weekStatus(statuses: readonly WorkoutStatus[]): WeekStatus {
  if (statuses.length === 0) return "NOT_STARTED";
  if (statuses.every((status) => status === "COMPLETED")) return "COMPLETED";
  if (statuses.every((status) => status !== "NOT_STARTED" && status !== "IN_PROGRESS")) return "CLOSED_WITH_DEVIATIONS";
  return statuses.some((status) => status !== "NOT_STARTED") ? "IN_PROGRESS" : "NOT_STARTED";
}

/**
 * §37.11, §48.75: подход сопоставляется с прошлым по типу и номеру внутри своего типа; разминка не сдвигает
 * рабочие, недостающий подход остаётся без «Пред.», чужой тип не подставляется.
 */
export function matchPrevious<T>(current: readonly Readonly<{ plannedSetId: string; setType: SetType }>[],
  source: readonly Readonly<{ setType: SetType; value: T }>[]): ReadonlyMap<string, T> {
  const byType = new Map<SetType, T[]>();
  for (const set of source) byType.set(set.setType, [...(byType.get(set.setType) ?? []), set.value]);
  const used = new Map<SetType, number>();
  const result = new Map<string, T>();
  for (const set of current) {
    const ordinal = used.get(set.setType) ?? 0;
    used.set(set.setType, ordinal + 1);
    const match = byType.get(set.setType)?.[ordinal];
    if (match !== undefined) result.set(set.plannedSetId, match);
  }
  return result;
}

/** Локальная календарная дата `YYYY-MM-DD` (§48.84 п. 1). */
export function localDateOf(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
