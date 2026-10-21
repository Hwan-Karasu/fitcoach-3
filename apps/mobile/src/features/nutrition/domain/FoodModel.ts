/** Единица, к которой относятся пищевые значения продукта (§49.3.2): `100 г`, `100 мл`, штука (яйцо) или документированная порция. */
export type FoodBasisUnit = "G" | "ML" | "PIECE" | "PORTION";
export const FOOD_BASIS_UNITS: readonly FoodBasisUnit[] = ["G", "ML", "PIECE", "PORTION"];

/**
 * Пищевые значения на эталонное количество, десятые доли (калории — ккал×10, остальное — г×10).
 * `null` — «не введено»: это не явный ноль и в расчётах нулём не становится (§49.3.2, §49.5.4).
 */
export interface Nutrients {
  readonly kcalX10: number | null;
  readonly proteinX10: number | null;
  readonly fatX10: number | null;
  readonly carbsX10: number | null;
}

export const NUTRIENT_KEYS = ["kcalX10", "proteinX10", "fatX10", "carbsX10"] as const;
export type NutrientKey = typeof NUTRIENT_KEYS[number];

export interface FoodBasis {
  readonly unit: FoodBasisUnit;
  /** Эталонное количество, десятые доли единицы: `100 г` → 1000, `1 порция` → 10. */
  readonly amountX10: number;
}

/** Собственный продукт общего локального каталога (§49.3); дневные записи будут хранить снимок, а не ссылку на эти значения. */
/** Необязательные сведения карточки: штрихкод — только локальный ключ поиска (§49.6), масса штуки — для перевода г↔шт; `null` — не задано. */
export interface FoodExtras {
  readonly barcode?: string | null;
  readonly gramsPerPieceX10?: number | null;
  /** Дополнительные нутриенты карточки (насыщенные жиры, сахар, клетчатка…): только справка продукта, в дневник, итоги и рецепты не входят. `undefined` при правке — не менять. */
  readonly extraNutrients?: readonly ExtraNutrient[] | null;
}

export type ExtraNutrientUnit = "G" | "MG";

/** Значение дополнительного нутриента на ту же основу, что и К/Б/Ж/У; десятые доли единицы. */
export interface ExtraNutrient {
  readonly key: string;
  readonly label: string;
  readonly unit: ExtraNutrientUnit;
  readonly valueX10: number;
}

/** Стандартные строки редактора продукта; свои строки получают ключ `custom:<номер>`. */
export const STANDARD_EXTRA_NUTRIENTS: readonly Readonly<{ key: string; label: string; unit: ExtraNutrientUnit; group: "fat" | "carbs" | "other" }>[] = [
  { key: "saturatedFat", label: "Насыщенные жиры", unit: "G", group: "fat" },
  { key: "polyunsaturatedFat", label: "Полиненасыщенные жиры", unit: "G", group: "fat" },
  { key: "monounsaturatedFat", label: "Мононенасыщенные жиры", unit: "G", group: "fat" },
  { key: "sugar", label: "Сахар", unit: "G", group: "carbs" },
  { key: "fiber", label: "Клетчатка", unit: "G", group: "carbs" },
  { key: "sodium", label: "Натрий", unit: "MG", group: "other" },
  { key: "cholesterol", label: "Холестерин", unit: "MG", group: "other" },
  { key: "potassium", label: "Калий", unit: "MG", group: "other" },
];

export interface FoodProduct extends FoodBasis, Nutrients, FoodExtras {
  /** В избранном (флаг каталога, на историю дневника не влияет). */
  readonly favorite?: boolean;
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly revision: number;
  /** Скрытие вместо удаления: история использования не исчезает (§49.3.5, §49.5.2). */
  readonly archivedAt: string | null;
}

export interface FoodInput extends FoodBasis, Nutrients, FoodExtras {
  readonly name: string;
  readonly brand: string | null;
}
