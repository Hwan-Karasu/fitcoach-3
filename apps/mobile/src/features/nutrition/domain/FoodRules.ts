import { NUTRIENT_KEYS, type FoodBasis, type FoodInput, type Nutrients } from "./FoodModel.ts";

export type FoodRuleError =
  | "FOOD_NAME_INVALID"
  | "FOOD_BASIS_INVALID"
  | "FOOD_NUTRIENT_INVALID"
  | "FOOD_NUTRIENTS_EMPTY"
  | "FOOD_BARCODE_INVALID"
  | "FOOD_PIECE_MASS_INVALID"
  | "PIECE_MASS_UNKNOWN"
  | "INVALID_PORTION";

function fail(code: FoodRuleError): never { throw new Error(code); }

const NAME_MAX = 80;
/** Разумная верхняя граница значения в десятых: опечатка «9999999» отклоняется, а не сохраняется. */
const NUTRIENT_MAX_X10 = 1_000_000;
const AMOUNT_MAX_X10 = 1_000_000;

/** «100», «0,5», «12.5» → десятые доли; пусто, отрицательное, больше одного знака или буквы → null (не ноль). */
export function parseDecimalX10(text: string): number | null {
  const normalized = text.trim().replace(/\s+/gu, "").replace(",", ".");
  if (!/^\d{1,6}(\.\d)?$/u.test(normalized)) return null;
  const [whole, fraction = "0"] = normalized.split(".") as [string, string?];
  return Number(whole) * 10 + Number(fraction);
}

export function formatDecimalX10(valueX10: number): string {
  const whole = Math.trunc(valueX10 / 10);
  const tenth = valueX10 % 10;
  return tenth === 0 ? String(whole) : `${whole},${tenth}`;
}

/** Проверяет и нормализует ввод продукта: название обрезается, пустая марка становится `null`, нутриенты — целые десятые ≥ 0. */
export function validateFood(input: FoodInput): FoodInput {
  const name = input.name.trim().replace(/\s+/gu, " ");
  if (name === "" || name.length > NAME_MAX) fail("FOOD_NAME_INVALID");
  const brand = input.brand === null ? null : input.brand.trim().replace(/\s+/gu, " ");
  if (brand !== null && brand.length > NAME_MAX) fail("FOOD_NAME_INVALID");
  if (!["G", "ML", "PORTION"].includes(input.unit) || !Number.isInteger(input.amountX10)
    || input.amountX10 <= 0 || input.amountX10 > AMOUNT_MAX_X10) fail("FOOD_BASIS_INVALID");
  for (const key of NUTRIENT_KEYS) {
    const value = input[key];
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > NUTRIENT_MAX_X10)) fail("FOOD_NUTRIENT_INVALID");
  }
  const barcode = input.barcode === undefined || input.barcode === null ? null : input.barcode.trim();
  if (barcode !== null && barcode !== "" && !/^[0-9A-Za-z-]{4,32}$/u.test(barcode)) fail("FOOD_BARCODE_INVALID");
  const piece = input.gramsPerPieceX10 ?? null;
  if (piece !== null && (!Number.isInteger(piece) || piece <= 0 || piece > AMOUNT_MAX_X10)) fail("FOOD_PIECE_MASS_INVALID");
  // Продукт без единого значения бесполезен для расчёта: не выдумываем калории (§49.3.3).
  if (NUTRIENT_KEYS.every((key) => input[key] === null)) fail("FOOD_NUTRIENTS_EMPTY");
  return { name, brand: brand === "" ? null : brand, unit: input.unit, amountX10: input.amountX10,
    kcalX10: input.kcalX10, proteinX10: input.proteinX10, fatX10: input.fatX10, carbsX10: input.carbsX10,
    // `undefined` — поле не передано (правка сохранит прежнее значение), `null` — очистить.
    barcode: input.barcode === undefined ? undefined : barcode === null || barcode === "" ? null : barcode,
    gramsPerPieceX10: input.gramsPerPieceX10 === undefined ? undefined : piece };
}

/**
 * Значения на фактическое количество (в тех же десятых единицы, что и эталон): пропорция с округлением до десятой.
 * Неизвестный нутриент остаётся `null`; нулевой или нечисловой знаменатель/количество — `INVALID_PORTION` (§49.3.3).
 */
export function scaleNutrients(food: FoodBasis & Nutrients, quantityX10: number): Nutrients {
  if (!Number.isInteger(quantityX10) || quantityX10 <= 0 || quantityX10 > AMOUNT_MAX_X10 * 10
    || !Number.isInteger(food.amountX10) || food.amountX10 <= 0) fail("INVALID_PORTION");
  const scale = (value: number | null) => value === null ? null : Math.round((value * quantityX10) / food.amountX10);
  return { kcalX10: scale(food.kcalX10), proteinX10: scale(food.proteinX10), fatX10: scale(food.fatX10), carbsX10: scale(food.carbsX10) };
}

/** Штуки → граммы (десятые доли): `2 шт × 45 г = 90 г`. Масса штуки не задана — `PIECE_MASS_UNKNOWN`, а не «0 г» и не догадка. */
export function gramsFromPieces(piecesX10: number, gramsPerPieceX10: number | null | undefined): number {
  if (gramsPerPieceX10 === null || gramsPerPieceX10 === undefined) fail("PIECE_MASS_UNKNOWN");
  if (!Number.isInteger(piecesX10) || piecesX10 <= 0) fail("INVALID_PORTION");
  return Math.round((piecesX10 * gramsPerPieceX10) / 10);
}

/** Граммы → штуки (десятые доли); обратное к `gramsFromPieces`. */
export function piecesFromGrams(gramsX10: number, gramsPerPieceX10: number | null | undefined): number {
  if (gramsPerPieceX10 === null || gramsPerPieceX10 === undefined) fail("PIECE_MASS_UNKNOWN");
  if (!Number.isInteger(gramsX10) || gramsX10 <= 0) fail("INVALID_PORTION");
  return Math.round((gramsX10 * 10) / gramsPerPieceX10);
}
