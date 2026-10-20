import type { DiaryEntry } from "./DiaryModel.ts";
import { effectiveNutrients } from "./DiaryRules.ts";
import { NUTRIENT_KEYS, type NutrientKey, type Nutrients } from "./FoodModel.ts";
import { scaleNutrients } from "./FoodRules.ts";

/** Состояние одного поля редактора записи: тронуто ли оно тренером и введённое значение (десятые; `null` — поле пусто). */
export interface FieldEdit {
  readonly touched: boolean;
  readonly valueX10: number | null;
}
export type FieldEdits = Readonly<Record<NutrientKey, FieldEdit>>;

/**
 * Что записать в правку пищевой ценности записи после редактирования (NUT-FS-29…33): `null` — менять нечего; `"CLEAR"` — правок не осталось (вернуть значения каталога);
 * иначе — полный набор правок (`null` по показателю — не правится). Правятся только тронутые поля; прежняя правка нетронутых сохраняется её действующим значением
 * на новую массу. Тронутое значение, равное каталожному у ещё не правленного показателя, правкой не считается. Пустое тронутое поле снимает правку этого показателя.
 */
export function planOverride(entry: DiaryEntry, quantityX10: number, edits: FieldEdits): Nutrients | "CLEAR" | null {
  if (!NUTRIENT_KEYS.some((key) => edits[key].touched)) return null;
  const { basis, perBasis } = entry.snapshot;
  const catalog = scaleNutrients({ ...basis, ...perBasis }, quantityX10);
  const effective = effectiveNutrients(catalog, entry.override ?? null, quantityX10);
  const next = {} as Record<NutrientKey, number | null>;
  for (const key of NUTRIENT_KEYS) {
    const hadOverride = entry.override != null && entry.override.values[key] !== null;
    const edit = edits[key];
    if (!edit.touched) next[key] = hadOverride ? effective[key] : null;
    else if (edit.valueX10 === null) next[key] = null;
    else next[key] = edit.valueX10 === catalog[key] && !hadOverride ? null : edit.valueX10;
  }
  const values = next as Nutrients;
  const any = NUTRIENT_KEYS.some((key) => next[key] !== null);
  if (!any) return entry.override != null ? "CLEAR" : null;
  const unchanged = entry.override != null && entry.override.baseQuantityX10 === quantityX10 && NUTRIENT_KEYS.every((key) => next[key] === entry.override!.values[key]);
  return unchanged ? null : values;
}
