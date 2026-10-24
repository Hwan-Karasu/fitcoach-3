import type { NutritionRaw as Raw } from "../../../../shared/migration/LegacyNutritionSources.ts";
import type { FoodInput, Nutrients } from "../FoodModel.ts";
import { validateFood } from "../FoodRules.ts";
import { parseSourceJson } from "../../../../shared/migration/SourceJson.ts";

export function nutritionFail(code: string): never { throw new Error(`R04_ID_LEDGER_NUTRITION_${code}`); }
export const nutritionObject = (v: unknown): Raw => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Raw : nutritionFail("OBJECT_INVALID");
export const nutritionId = (v: unknown): string => typeof v === "string" && v.trim() ? v : nutritionFail("IDENTITY_INVALID");
export const nutritionMacros = ["calories", "protein", "fat", "carbs"] as const;
const keys = new Set<string>([...nutritionMacros, "grams", "pieceCount", "gramsPerPiece", "servings"]);
/** JSON source tokens remain exact even when JSON.parse would round a number. */
export function nutritionJson(value: unknown): unknown {
  if (typeof value !== "string") return nutritionFail("JSON_INVALID");
  try { return parseSourceJson(value, (key, source) => keys.has(key) ? source : Number(source)); } catch (error) {
    if (error instanceof Error && error.message.startsWith("R04_")) throw error;
    return nutritionFail("JSON_INVALID");
  }
}
export function nutritionX10(value: unknown): number | null {
  if (value == null || value === "") return null;
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim().replace(",", ".") : "";
  if (!/^\d+(?:\.\d+)?$/u.test(raw)) return nutritionFail("VALUE_INVALID");
  const [whole, fraction = ""] = raw.split("."), significant = fraction.replace(/0+$/u, "");
  if (significant.length > 1) return nutritionFail("PRECISION_UNREPRESENTABLE");
  const scaled = BigInt(whole!) * 10n + BigInt(significant || "0");
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scaled) : nutritionFail("VALUE_OVERFLOW");
}
export function nutritionNutrients(row: Raw): Nutrients {
  const [kcalX10, proteinX10, fatX10, carbsX10] = nutritionMacros.map((k) => nutritionX10(row[k]));
  return { kcalX10: kcalX10 ?? null, proteinX10: proteinX10 ?? null, fatX10: fatX10 ?? null, carbsX10: carbsX10 ?? null };
}
export function legacyFoodInput(row: Raw, snapshot = false): FoodInput {
  const rawServing = row[snapshot ? "servingMode" : "serving_mode"];
  // v2 nutritionMealsParse explicitly defaults missing snapshot modes to grams.
  const serving = snapshot && (rawServing == null || rawServing === "") ? "grams" : rawServing;
  if (serving !== "grams" && serving !== "pieces") return nutritionFail("SERVING_MODE_UNSUPPORTED");
  const name = nutritionId(row.name), brand = row.brand === "" || row.brand == null ? null : nutritionId(row.brand);
  const barcode = row.barcode === "" || row.barcode == null ? null : nutritionId(row.barcode);
  const piece = nutritionX10(row[snapshot ? "gramsPerPiece" : "grams_per_piece"]);
  const input: FoodInput = { name, brand, barcode, unit: serving === "grams" ? "G" : "PIECE", amountX10: serving === "grams" ? 1000 : 10,
    ...nutritionNutrients(row), gramsPerPieceX10: piece === 0 ? null : piece, extraNutrients: null };
  try { validateFood(input); } catch (error) {
    if (!(snapshot && error instanceof Error && error.message === "FOOD_NUTRIENTS_EMPTY")) throw error;
  }
  // Do not trim/truncate a source value to make it fit the physical schema.
  if (name.trim().length > 80 || (brand?.trim().length ?? 0) > 80) return nutritionFail("NAME_UNREPRESENTABLE");
  return input;
}
/** Convert to the source snapshot's native basis, without rounding a linked unit. */
export function legacyQuantity(row: Raw, food: FoodInput): number {
  const unit = row.unit;
  if (unit !== "grams" && unit !== "pieces") return nutritionFail("SERVING_MODE_UNSUPPORTED");
  const value = nutritionX10(row[unit === "grams" ? "grams" : "pieceCount"]);
  if (value === null || value <= 0) return nutritionFail("QUANTITY_INVALID");
  if ((unit === "grams" ? "G" : "PIECE") === food.unit) return value;
  const piece = food.gramsPerPieceX10;
  if (piece == null || piece <= 0) return nutritionFail("PIECE_MASS_UNKNOWN");
  const numerator = BigInt(value) * BigInt(unit === "pieces" ? piece : 10), denominator = BigInt(unit === "pieces" ? 10 : piece);
  if (numerator % denominator !== 0n) return nutritionFail("QUANTITY_PRECISION_UNREPRESENTABLE");
  const result = numerator / denominator;
  return result > 0n && result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : nutritionFail("QUANTITY_INVALID");
}
/** Fixed issues only; raw values and original errors stay in the private source receipt. */
export function nutritionAttempt<T>(run: () => T): { value: T; issues: readonly string[] } | { value: null; issues: readonly string[] } {
  try { return { value: run(), issues: [] }; } catch (error) {
    if (error instanceof Error && error.message === "R04_ID_LEDGER_NUTRITION_IDENTITY_COLLISION") throw error;
    if (error instanceof Error && /^(R04_ID_LEDGER_NUTRITION_|FOOD_|RECIPE_|DIARY_|CALC_PROFILE_INVALID$|INVALID_PORTION)/u.test(error.message)
      && /^[A-Z0-9_]+$/u.test(error.message)) return { value: null, issues: [error.message] };
    throw error;
  }
}
