import { formatDuration, parseDuration, parseLoad } from "../../plans/public.ts";
import type { SetType, SetValues, TrackingMetric, WeekStatus, WorkoutStatus } from "../domain/ExecutionModel.ts";
import { fieldsOf, type SetField } from "../domain/ExecutionRules.ts";

/** Порядок колонок дневника (§48.65 п. 1): повторы, затем вес; дистанция перед временем. */
const FIELD_ORDER: readonly SetField[] = ["reps", "loadGrams", "distanceM", "durationSec"];

export function diaryFields(metrics: readonly TrackingMetric[]): readonly SetField[] {
  const own = new Set(fieldsOf(metrics));
  return FIELD_ORDER.filter((field) => own.has(field));
}

export const fieldHeaders: Readonly<Record<SetField, string>> = { reps: "повт.", loadGrams: "кг", distanceM: "м", durationSec: "время" };

export const fieldNames: Readonly<Record<SetField, string>> = { reps: "Повторы", loadGrams: "Вес, кг", distanceM: "Метры", durationSec: "Время" };

export function rawOf(values: SetValues, field: SetField): string {
  const value = values[field];
  if (value === null) return "";
  if (field === "loadGrams") return String(value / 1000).replace(".", ",");
  if (field === "durationSec") return formatDuration(value);
  return String(value);
}

export function parseField(field: SetField, text: string): number | null | "invalid" {
  if (field === "loadGrams") return parseLoad(text);
  if (field === "durationSec") return parseDuration(text);
  const value = text.trim();
  if (value === "") return null;
  return /^\d+$/.test(value) ? Number(value) : "invalid";
}

/** Компактно для колонок «План» и «Пред.»: `8 × 60`; пусто — «—». */
export function compactValues(values: SetValues, fields: readonly SetField[]): string {
  const parts = fields.map((field) => values[field] === null ? null : rawOf(values, field)).filter((part) => part !== null);
  return parts.length === 0 ? "—" : parts.join(" × ");
}

export const setTypeLabels: Readonly<Record<SetType, string>> = { NORMAL: "Обычный", WARMUP: "Разминочный", FAILURE: "Отказной" };

/** Короткая метка подхода: номер рабочего, «Р» — разминка, «О» — отказ. */
export function setMarker(type: SetType, ordinal: number): string {
  return type === "WARMUP" ? "Р" : type === "FAILURE" ? "О" : String(ordinal);
}

export const workoutStatusLabels: Readonly<Record<WorkoutStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", MISSED: "Пропущена", CANCELLED: "Отменена",
};

export const weekStatusLabels: Readonly<Record<WeekStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", CLOSED_WITH_DEVIATIONS: "Закрыта с отклонениями",
};

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** `2026-10-17` → «17 окт». */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""}`;
}
