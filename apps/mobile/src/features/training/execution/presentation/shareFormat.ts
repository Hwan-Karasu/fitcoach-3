import type { SetValues } from "../domain/ExecutionModel.ts";
import type { SetField } from "../domain/ExecutionRules.ts";

/** Единицы для текста вне таблицы (картинка «Поделиться»): там нет заголовков колонок. Время — уже «0:45». */
const units: Readonly<Record<SetField, string>> = { reps: " повт.", loadGrams: " кг", distanceM: " м", durationSec: "" };

/** С подписями единиц: `20 повт. × 20 кг`; мини-сеты дроп-сета через « / ». `raw` — число поля без единиц. */
export function labeledWithDrops(values: SetValues, drops: readonly SetValues[], fields: readonly SetField[],
  raw: (values: SetValues, field: SetField) => string): string {
  return [values, ...drops].map((item) => {
    const parts = fields.flatMap((field) => item[field] === null ? [] : [`${raw(item, field)}${units[field]}`]);
    return parts.length === 0 ? "—" : parts.join(" × ");
  }).join(" / ");
}

/** План подхода с единицами: `8–12 повт.`; `text` — план без единиц. */
export function labeledPlan(text: string, fields: readonly SetField[]): string {
  return text !== "—" && fields.includes("reps") ? `${text}${units.reps}` : text;
}
