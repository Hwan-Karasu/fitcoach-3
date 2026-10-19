import type { SetFact, SetValues } from "../../execution/public.ts";
import { formatDuration } from "../../plans/public.ts";

/** Подписи истории занятий: дата, подход в величинах профиля (общие для архива и истории упражнения). */
export const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const dateText = (date: string) => {
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
