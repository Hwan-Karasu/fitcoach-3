import type { CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacyNutritionSource } from "../../../../shared/migration/LegacyNutritionSources.ts";
import { nutritionAttempt, nutritionFail as fail, nutritionId as id, nutritionJson, nutritionNutrients, nutritionObject as object,
  nutritionX10, legacyFoodInput, legacyQuantity } from "./LegacyNutritionValues.ts";
import { NUTRIENT_KEYS, type FoodInput, type Nutrients } from "../FoodModel.ts";
import { scaleNutrients } from "../FoodRules.ts";
import { assertDate, assertOverride, assertQuantity, assertWater } from "../DiaryRules.ts";
import { validateRecipe } from "../RecipeRules.ts";
import { sumNutrients } from "../EnergyRules.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import { legacyCalcInputSnapshot, legacyCalcProfile, legacyManualMacroSnapshot } from "./LegacyNutritionCalculator.ts";
import { projectNutritionArchive } from "./LegacyNutritionArchive.ts";
import { isLegacyLocalDate as isLocalDate } from "../../../../shared/migration/LegacyValues.ts";

export type NutritionIdentityKind = "FOOD" | "RECIPE" | "ENTRY" | "ARCHIVE_WEEK" | "ARCHIVE_DAY";
export type NutritionRow = Record<string, string | number | null>;
export const NUTRITION_CORE_TABLES = ["food_products", "recipes", "recipe_ingredients", "food_diary_entries", "water_days", "nutrition_daily_steps", "nutrition_daily_workout_marks", "nutrition_calc_profiles", "r04_nutrition_archive_weeks"] as const;
interface Representation { readonly sourceKey: string; readonly targetIds: readonly string[]; readonly issues: readonly string[]; readonly metadata: unknown }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const flag = (v: unknown) => v === 0 || v === 1 ? v : fail("FLAG_INVALID");
const stamp = (v: unknown) => isExplicitTimestamp(v) ? v : fail("TIMESTAMP_INVALID");
const array = (v: unknown): readonly unknown[] => Array.isArray(v) ? v : fail("ARRAY_INVALID");
const nutrientsEqual = (a: Nutrients, b: Nutrients) => NUTRIENT_KEYS.every((key) => a[key] === b[key]);

/** A source-normalization rehearsal, not permission to publish a partial import.
 * Every unsupported representation remains explicit alongside the full source. */
export function composeLegacyNutrition(context: CandidateIdentityContext, importedAt: string, source: LegacyNutritionSource,
  clients: ReadonlyMap<string, string>, identity: (kind: NutritionIdentityKind, key: string) => string) {
  const key = (...parts: readonly (string | number)[]) => JSON.stringify([context.accountScope, ...parts]);
  const rows = (table: keyof LegacyNutritionSource["tables"]) => source.tables[table] ?? [];
  const tables = Object.fromEntries(NUTRITION_CORE_TABLES.map((name) => [name, [] as NutritionRow[]])) as Record<typeof NUTRITION_CORE_TABLES[number], NutritionRow[]>;
  const representations: Representation[] = [], foods = new Map<string, FoodInput>(), seen = new Set<string>(), entries = new Set<string>();
  function ordered(table: keyof LegacyNutritionSource["tables"], owner = false) {
    const result = rows(table).map((row) => {
      const sourceKey = owner ? key(table, id(row.client_id), ...(table === "nutrition_days" || table === "client_day_facts" ? [id(row.date_key)] : table === "nutrition_archive_weeks" ? [id(row.id)] : [])) : key(table, id(row.id));
      if (seen.has(sourceKey)) return fail("DUPLICATE_SOURCE_KEY"); seen.add(sourceKey);
      if (owner && !clients.has(id(row.client_id))) return fail("OWNER_INVALID");
      return { row, sourceKey };
    });
    return result.sort((a, b) => compare(a.sourceKey, b.sourceKey));
  }
  function retain<T>(sourceKey: string, run: () => T, commit: (value: T) => readonly string[], metadata: unknown = null) {
    const projected = nutritionAttempt(run);
    const targetIds = projected.value === null ? [] : commit(projected.value);
    representations.push({ sourceKey, targetIds, issues: projected.issues, metadata });
  }
  const foodId = (sourceId: string) => identity("FOOD", key("food_products", sourceId));
  for (const { row, sourceKey } of ordered("food_products")) retain(sourceKey, () => {
    if (row.deleted_at != null || row.archived_at != null) return fail("SOURCE_LIFECYCLE_UNVERIFIED");
    const input = legacyFoodInput(row), targetId = foodId(id(row.id));
    const extras = ["fiber", "sugar", "sodium", "cholesterol"].filter((field) => row[field] != null && row[field] !== 0 && row[field] !== "0" && row[field] !== "");
    return { input, targetId, createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at), favorite: flag(row.favorite), extras };
  }, ({ input, targetId, createdAt, updatedAt, favorite, extras }) => {
    foods.set(id(row.id), input);
    tables.food_products.push({ id: targetId, workspace_id: context.targetWorkspaceId, name: input.name, brand: input.brand, basis_unit: input.unit,
      basis_amount_x10: input.amountX10, kcal_x10: input.kcalX10, protein_x10: input.proteinX10, fat_x10: input.fatX10, carbs_x10: input.carbsX10,
      barcode: input.barcode ?? null, grams_per_piece_x10: input.gramsPerPieceX10 ?? null, extra_nutrients_json: null,
      favorite, revision: 1, archived_at: null, created_at: createdAt, updated_at: updatedAt });
    if (extras.length) representations.push({ sourceKey: key("food_products", id(row.id), "extras"), targetIds: [], issues: ["EXTRA_NUTRIENT_UNITS_UNPROVEN"], metadata: { fields: extras } });
    return [targetId];
  });
  for (const { row, sourceKey } of ordered("nutrition_recipes")) retain(sourceKey, () => {
    if (row.deleted_at != null || row.archived_at != null) return fail("SOURCE_LIFECYCLE_UNVERIFIED");
    const recipeId = identity("RECIPE", sourceKey), parts = array(nutritionJson(row.items_json));
    const ingredients = parts.map((raw) => {
      const item = object(raw), sourceId = id(item.productId), food = foods.get(sourceId);
      if (!food) return fail("RECIPE_FOOD_UNRESOLVED");
      const snapshot = object(item.productSnapshot);
      if (snapshot.id !== sourceId) return fail("SNAPSHOT_REFERENCE_CONFLICT");
      const historical = legacyFoodInput(snapshot, true);
      if (historical.name !== food.name || historical.brand !== food.brand || historical.unit !== food.unit || historical.amountX10 !== food.amountX10
        || historical.gramsPerPieceX10 !== food.gramsPerPieceX10 || !nutrientsEqual(historical, food)) return fail("RECIPE_INGREDIENT_VERSION_STORAGE_REQUIRED");
      const quantityX10 = legacyQuantity(item, historical); assertQuantity(quantityX10);
      const calculated = scaleNutrients(food, quantityX10), saved = nutritionNutrients(item);
      if (!nutrientsEqual(saved, calculated)) return fail("RECIPE_INGREDIENT_TOTALS_STORAGE_REQUIRED");
      return { foodId: foodId(sourceId), quantityX10, nutrients: saved };
    });
    const input = { name: id(row.name), description: row.description === "" || row.description === null ? null : id(row.description),
      servingsX10: nutritionX10(row.servings) ?? 0, cookedMassX10: null, ingredients };
    validateRecipe(input);
    if (input.name.trim().length > 80 || (input.description?.length ?? 0) > 500) return fail("RECIPE_TEXT_UNREPRESENTABLE");
    if (!nutrientsEqual(sumNutrients(ingredients.map((i) => i.nutrients)), nutritionNutrients(row))) return fail("RECIPE_TOTALS_STORAGE_REQUIRED");
    return { recipeId, input, createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at), inCookbook: flag(row.saved_to_cookbook) };
  }, ({ recipeId, input, createdAt, updatedAt, inCookbook }) => {
    tables.recipes.push({ id: recipeId, workspace_id: context.targetWorkspaceId, name: input.name, description: input.description,
      servings_x10: input.servingsX10, cooked_mass_x10: null, revision: 1, archived_at: null, created_at: createdAt, updated_at: updatedAt,
      favorite: 0, in_cookbook: inCookbook, details_json: null });
    input.ingredients.forEach((i, position) => tables.recipe_ingredients.push({ recipe_id: recipeId, workspace_id: context.targetWorkspaceId, position, food_id: i.foodId, quantity_x10: i.quantityX10 }));
    return [recipeId];
  });
  for (const { row, sourceKey } of ordered("nutrition_days", true)) {
    const clientId = clients.get(id(row.client_id))!, date = id(row.date_key);
    retain(key("nutrition_days", id(row.client_id), date, "water"), () => {
      assertDate(date); const water = row.water_ml;
      if (water === null || water === 0) return 0;
      if (typeof water !== "number") return fail("WATER_VALUE_INVALID"); assertWater(water); return water;
    }, (ml) => {
      if (ml > 0) tables.water_days.push({ workspace_id: context.targetWorkspaceId, client_id: clientId, local_date: date, ml, updated_at: importedAt });
      return [];
    }, { sourceUpdatedAt: row.updated_at, targetUpdatedAtBasis: "IMPORT_TIME" });
    const parsed = nutritionAttempt(() => {
      assertDate(date); const meals = object(nutritionJson(row.meals_json));
      if (Object.keys(meals).some((name) => !["breakfast", "lunch", "dinner", "snack"].includes(name))) return fail("MEALS_SHAPE_UNSUPPORTED");
      for (const slot of ["breakfast", "lunch", "dinner", "snack"]) array(meals[slot]);
      return meals;
    });
    representations.push({ sourceKey, targetIds: [], issues: parsed.issues,
      metadata: { sourceUpdatedAt: row.updated_at, mealsRecorded: row.meals_recorded ?? null, accountingBasis: "FOOD_ENTRIES_ONLY" } });
    if (parsed.value === null) continue;
    for (const slot of ["breakfast", "lunch", "dinner", "snack"] as const) for (const [position, raw] of array(parsed.value[slot]).entries()) {
      const entry = object(raw), entryId = id(entry.id);
      if (entries.has(entryId)) return fail("ENTRY_ID_DUPLICATE"); entries.add(entryId);
      const sourceEntryKey = key("nutrition_days", id(row.client_id), date, slot, position);
      retain(sourceEntryKey, () => {
        if (entry.recipeId != null || entry.recipeSnapshot != null) return fail("RECIPE_ENTRY_SHAPE_UNVERIFIED");
        const sourceId = id(entry.productId), snapshot = object(entry.productSnapshot);
        if (snapshot.id !== sourceId) return fail("SNAPSHOT_REFERENCE_CONFLICT");
        const food = legacyFoodInput(snapshot, true), quantity = legacyQuantity({ ...entry, unit: entry.unit == null || entry.unit === "" ? "grams" : entry.unit }, food); assertQuantity(quantity);
        const totals = nutritionNutrients(entry), catalogEaten = scaleNutrients(food, quantity);
        if (Object.keys(totals).some((name) => totals[name as keyof Nutrients] === null && catalogEaten[name as keyof Nutrients] !== null)) return fail("UNKNOWN_TOTAL_STORAGE_REQUIRED");
        const override = nutrientsEqual(totals, catalogEaten) ? null : totals;
        if (override !== null) assertOverride(override);
        return { targetId: identity("ENTRY", key("nutrition_entry", entryId)), sourceId: foodId(sourceId), food, quantity, override,
          createdAt: isExplicitTimestamp(entry.createdAt) ? entry.createdAt : importedAt };
      }, ({ targetId, sourceId, food, quantity, override, createdAt }) => {
        tables.food_diary_entries.push({ id: targetId, workspace_id: context.targetWorkspaceId, client_id: clientId, local_date: date, slot: slot.toUpperCase(), position,
          source_kind: "FOOD", source_id: sourceId, name: food.name, brand: food.brand, basis_unit: food.unit, basis_amount_x10: food.amountX10,
          per_kcal_x10: food.kcalX10, per_protein_x10: food.proteinX10, per_fat_x10: food.fatX10, per_carbs_x10: food.carbsX10,
          quantity_x10: quantity, ingredients_json: "[]", revision: 1, created_at: createdAt, updated_at: importedAt,
          override_base_quantity_x10: override === null ? null : quantity, override_kcal_x10: override?.kcalX10 ?? null,
          override_protein_x10: override?.proteinX10 ?? null, override_fat_x10: override?.fatX10 ?? null, override_carbs_x10: override?.carbsX10 ?? null });
        return [targetId];
      }, { sourceEntryId: entryId, sourceCreatedAt: entry.createdAt ?? null, sourceUpdatedAt: entry.updatedAt ?? null,
        targetCreatedAtBasis: isExplicitTimestamp(entry.createdAt) ? "SOURCE_ENTRY_TIME" : "IMPORT_TIME",
        targetUpdatedAtBasis: "IMPORT_TIME", totalsBasis: "LEGACY_SAVED_ENTRY_TOTALS", portionBasis: "V2_GRAMS_DEFAULT_OR_EXPLICIT_UNIT", rawPortionPreserved: true });
    }
  }
  for (const { row, sourceKey } of ordered("client_day_facts", true)) for (const field of ["steps", "training"] as const) retain(key("day_field", sourceKey, field), () => {
    assertDate(id(row.date_key)); const raw = row[field];
    if (raw === null || typeof raw === "string" && !raw.trim()) return null;
    if (field === "steps") {
      if (typeof raw !== "string" || !/^\+?\d+$/u.test(raw.trim())) return fail("STEPS_INVALID");
      const value = Number(raw.trim()); if (!Number.isSafeInteger(value) || value < 1 || value > 100000) return fail("STEPS_UNREPRESENTABLE"); return value;
    }
    if (typeof raw !== "string" || !["да", "нет"].includes(raw.trim().toLowerCase())) return fail("TRAINING_MARK_UNSUPPORTED");
    return raw.trim().toLowerCase() === "да" ? 1 : 0;
  }, (value) => {
    if (value !== null) tables[field === "steps" ? "nutrition_daily_steps" : "nutrition_daily_workout_marks"].push({ workspace_id: context.targetWorkspaceId,
      client_id: clients.get(id(row.client_id))!, local_date: id(row.date_key), [field === "steps" ? "steps" : "done"]: value, updated_at: importedAt });
    return [];
  }, { targetUpdatedAtBasis: "IMPORT_TIME", workoutSessionCreated: false });
  for (const { row, sourceKey } of ordered("client_kbju_state", true)) {
    const parsed = nutritionAttempt(() => object(nutritionJson(row.profile_json)));
    if (parsed.value === null) representations.push({ sourceKey, targetIds: [], issues: parsed.issues, metadata: null });
    else {
      const profile = parsed.value, input = legacyCalcInputSnapshot(profile);
      retain(sourceKey, () => legacyCalcProfile(profile), (valid) => {
        tables.nutrition_calc_profiles.push({ workspace_id: context.targetWorkspaceId, client_id: clients.get(id(row.client_id))!,
          goal: valid.goal, activity: valid.activity, workouts_per_week: valid.workoutsPerWeek, workout_minutes: valid.minutes,
          intensity: valid.intensity, step_kcal: valid.stepKcal, revision: 1, updated_at: importedAt });
        return [];
      }, { sourceUpdatedAt: row.updated_at, targetUpdatedAtBasis: "IMPORT_TIME", valuesBasis: "SAVED_CALCULATOR_PARAMETERS" });
      representations.push({ sourceKey: key("client_kbju_state", id(row.client_id), "inputs"), targetIds: [],
        issues: [...(input.hasBodyInputs ? ["UNDATED_CALCULATOR_BODY_INPUT_STORAGE_REQUIRED"] : []), ...(input.unknownFields.length ? ["CALCULATOR_FIELDS_UNSUPPORTED"] : [])], metadata: input });
    }
    const manual = nutritionAttempt(() => legacyManualMacroSnapshot(row.manual_kbju_json));
    representations.push({ sourceKey: key("client_kbju_state", id(row.client_id), "manual"), targetIds: [],
      issues: manual.value === null ? manual.issues : [...(manual.value.hasValues ? ["UNDATED_MANUAL_MACRO_STORAGE_REQUIRED"] : []),
        ...(manual.value.unknownFields.length ? ["MANUAL_MACRO_FIELDS_UNSUPPORTED"] : [])], metadata: manual.value });
  }
  const archives = ordered("nutrition_archive_weeks", true).map(({ row, sourceKey }) => projectNutritionArchive(row, sourceKey, clients.get(id(row.client_id))!,
    identity("ARCHIVE_WEEK", sourceKey), (position) => identity("ARCHIVE_DAY", key("archive_day", sourceKey, position))));
  const byClient = new Map<string, typeof archives>(), currentByClient = new Map<string, Map<string, string[]>>();
  for (const archive of archives) { const group = byClient.get(archive.clientId) ?? []; group.push(archive); byClient.set(archive.clientId, group); }
  for (const table of ["nutrition_days", "client_day_facts"] as const) for (const row of rows(table)) {
    const client = clients.get(id(row.client_id)); if (!client || typeof row.date_key !== "string" || !isLocalDate(row.date_key)) continue;
    const dates = currentByClient.get(client) ?? new Map<string, string[]>(), stores = dates.get(row.date_key) ?? [];
    if (!stores.includes(table)) stores.push(table); dates.set(row.date_key, stores); currentByClient.set(client, dates);
  }
  for (const archive of archives) {
    const overlaps = byClient.get(archive.clientId)!.filter((other) => other.id !== archive.id && archive.startDate !== null && archive.endDate !== null
      && other.startDate !== null && other.endDate !== null && archive.startDate <= archive.endDate && other.startDate <= other.endDate
      && archive.startDate <= other.endDate && archive.endDate >= other.startDate).map((other) => other.id).sort(compare);
    const current = [...currentByClient.get(archive.clientId) ?? []].filter(([date]) => archive.startDate !== null && archive.endDate !== null && date >= archive.startDate && date <= archive.endDate);
    const payload = { ...archive, overlappingArchiveIds: overlaps,
      currentSourceOverlap: current.sort(([a], [b]) => compare(a, b)).map(([localDate, stores]) => ({ localDate, stores: [...stores].sort(compare) })) };
    tables.r04_nutrition_archive_weeks.push({ id: archive.id, workspace_id: context.targetWorkspaceId, client_id: archive.clientId, source_key: archive.sourceKey, payload_json: JSON.stringify(payload) });
    representations.push({ sourceKey: archive.sourceKey, targetIds: [archive.id, ...archive.days.map((day) => day.id)],
      issues: ["ARCHIVE_PRODUCTION_STORAGE_REQUIRED", ...archive.issues, ...new Set(archive.days.flatMap((day) => day.issues))],
      metadata: { semantics: archive.semantics, dailyFactsCreated: 0, workoutSessionsCreated: 0, normalizedDaySnapshots: archive.days.length } });
  }
  return { tables, representations: representations.sort((a, b) => compare(a.sourceKey, b.sourceKey)) };
}
