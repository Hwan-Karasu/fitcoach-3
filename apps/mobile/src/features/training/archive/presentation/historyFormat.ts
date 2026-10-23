import type { StatusKind } from "../../../../shared/ui/components/public.ts";
import type { SetFact, SetValues, WorkoutStatus } from "../../execution/public.ts";
import { isCalendarDay as isWorkoutDay } from "../../../../shared/format/calendarDay.ts";
import { formatDuration } from "../../plans/public.ts";
import type { TrainingHistoryEntry } from "./trainingHistory.ts";

/** Подписи истории занятий: дата, подход в величинах профиля (общие для архива и истории упражнения). */
export const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const dateText = (date: string | null) => {
  if (!isWorkoutDay(date)) return "Дата неизвестна";
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""} ${year}`;
};
/** «80 кг × 8», «1:30», «500 м» — только введённые величины. */
export function valuesText(values: SetValues): string {
  const parts = [values.loadGrams === null ? null : `${(values.loadGrams / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} кг`,
    values.reps === null ? null : `${values.reps} повт.`, values.durationSec === null ? null : formatDuration(values.durationSec),
    values.distanceM === null ? null : `${values.distanceM} м`].filter((part): part is string => part !== null);
  return parts.length === 0 ? "—" : parts.join(" × ");
}
export function factText(fact: SetFact): string {
  if (fact.sides !== null) return `Л ${valuesText(fact.sides.left.values)} · П ${valuesText(fact.sides.right.values)}`;
  return [fact.values, ...fact.drops].map(valuesText).join(" → ");
}

export const statusLabels: Readonly<Record<WorkoutStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", MISSED: "Пропущена", CANCELLED: "Отменена",
};
export const statusKinds: Readonly<Record<WorkoutStatus, StatusKind>> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", COMPLETED: "success", MISSED: "warning", CANCELLED: "warning",
};

const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

/** Подход одной строкой: «1. 80 кг × 8 повт. · RPE 8», разминка — «Р.», с пометками «отказ», «дроп-сет», «не засчитан». */
export function setLabel(fact: SetFact, ordinal: number): string {
  const marks = [fact.setType === "FAILURE" ? "отказ" : null, fact.setType === "DROP" ? "дроп-сет" : null,
    fact.rpe === null ? null : `RPE ${number(fact.rpe)}`, fact.confirmed ? null : "не засчитан"].filter((mark) => mark !== null);
  return `${fact.setType === "WARMUP" ? "Р" : ordinal}. ${factText(fact)}${marks.length > 0 ? ` · ${marks.join(" · ")}` : ""}`;
}

/** «Программа (архив / исходный план удалён) · Мезоцикл · Неделя N» — происхождение занятия. */
export function originText(entry: Pick<TrainingHistoryEntry, "programTitle" | "planDeleted" | "archived" | "mesocycleTitle" | "weekIndex">): string {
  const program = entry.planDeleted ? `${entry.programTitle} (исходный план удалён)` : entry.archived ? `${entry.programTitle} (архив)` : entry.programTitle;
  return [program, entry.mesocycleTitle, `Неделя ${entry.weekIndex}`].filter((part): part is string => part !== null).join(" · ");
}
