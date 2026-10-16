import type { DatabaseSync } from "node:sqlite";
import { exactNonnegativeHundredth, isExplicitTimestamp } from "./ExactScaledHundredth.ts";

const mealSlots = ["breakfast", "lunch", "dinner", "snack"] as const;
type ReferenceKind = "product" | "recipe" | "missing" | "both";

export interface LegacyNutritionEntrySource {
  readonly accountScope: string;
  readonly clientId: string;
  readonly dateKey: string;
  readonly ownerFound: boolean;
  readonly sourceEntryId: string | null;
  readonly slot: typeof mealSlots[number];
  readonly referenceKind: ReferenceKind;
  readonly catalogReference: "found" | "missing" | "not-inspected";
  readonly snapshotReference: "matches" | "missing" | "mismatch";
  readonly snapshotMacros: "numeric" | "numeric-strings" | "missing" | "non-numeric";
  readonly positiveGrams: boolean;
  readonly amountX100Representable: boolean;
  readonly entryTotalsX100Representable: boolean;
  readonly unknownEntryMacroValues: number;
  readonly enteredAtPresent: boolean;
  readonly updatedAtPresent: boolean;
}

export interface LegacyNutritionEntryEvidence {
  readonly physicalDayRows: number;
  readonly unparsedDayRows: number;
  readonly entries: readonly LegacyNutritionEntrySource[];
}

function tableIds(db: DatabaseSync, table: "food_products" | "nutrition_recipes"): Set<string> | null {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return null;
  const columns = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => String(row.name)));
  if (!columns.has("id")) throw new Error("R04_NUTRITION_CATALOG_SHAPE_UNSUPPORTED");
  return new Set(db.prepare(`SELECT id FROM ${table}`).all()
    .filter((row) => typeof row.id === "string").map((row) => row.id as string));
}

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function positiveGrams(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:[.,]\d+)?$/u.test(raw)) return false;
  const number = Number(raw.replace(",", "."));
  return Number.isFinite(number) && number > 0;
}

/** Reads identity/snapshot evidence only; never derives target food facts. */
export function readLegacyNutritionEntryEvidenceInSnapshot(
  db: DatabaseSync, accountScope: string,
): LegacyNutritionEntryEvidence {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required = ["client_id", "date_key", "meals_json"];
  const columns = new Set(db.prepare("PRAGMA table_info('nutrition_days')").all()
    .map((row) => String(row.name)));
  if (required.some((column) => !columns.has(column))) throw new Error("R04_NUTRITION_SHAPE_UNSUPPORTED");
  const products = tableIds(db, "food_products");
  const recipes = tableIds(db, "nutrition_recipes");
  const rows = db.prepare(`SELECT n.client_id AS clientId, n.date_key AS dateKey,
    n.meals_json AS mealsJson, c.id AS ownerClientId FROM nutrition_days n
    LEFT JOIN clients c ON c.id=n.client_id ORDER BY n.client_id,n.date_key`).all();
  const count = db.prepare("SELECT count(*) AS count FROM nutrition_days").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_NUTRITION_CARDINALITY_MISMATCH");
  const entries: LegacyNutritionEntrySource[] = [];
  let unparsedDayRows = 0;
  for (const row of rows) {
    if (typeof row.clientId !== "string" || !row.clientId.trim()
      || typeof row.dateKey !== "string" || !row.dateKey.trim()) {
      throw new Error("R04_NUTRITION_PROVENANCE_INCOMPLETE");
    }
    let parsed: unknown;
    try { parsed = typeof row.mealsJson === "string" ? JSON.parse(row.mealsJson) as unknown : null; }
    catch { unparsedDayRows += 1; continue; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
      || Object.keys(parsed).some((key) => !mealSlots.includes(key as typeof mealSlots[number]))
      || mealSlots.some((slot) => !Array.isArray((parsed as Record<string, unknown>)[slot]))) {
      unparsedDayRows += 1;
      continue;
    }
    for (const slot of mealSlots) for (const entry of (parsed as Record<string, unknown[]>)[slot]!) {
      const value = typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? entry as Record<string, unknown> : {};
      const productId = typeof value.productId === "string" && value.productId.trim()
        ? value.productId : null;
      const recipeId = typeof value.recipeId === "string" && value.recipeId.trim()
        ? value.recipeId : null;
      const referenceKind: ReferenceKind = productId && recipeId ? "both"
        : productId ? "product" : recipeId ? "recipe" : "missing";
      const catalog = referenceKind === "product" ? products : referenceKind === "recipe" ? recipes : null;
      const sourceId = referenceKind === "product" ? productId : referenceKind === "recipe" ? recipeId : null;
      const catalogReference = sourceId === null ? "missing" : catalog === null ? "not-inspected"
        : catalog.has(sourceId) ? "found" : "missing";
      const snapshot = referenceKind === "recipe" ? value.recipeSnapshot : value.productSnapshot;
      const object = typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot)
        ? snapshot as Record<string, unknown> : null;
      const snapshotReference = object === null ? "missing"
        : sourceId !== null && object.id === sourceId ? "matches" : "mismatch";
      const macroValues = ["calories", "protein", "fat", "carbs"].map((key) => object?.[key]);
      const macros = object === null ? "missing"
        : macroValues.every((item) => typeof item === "number" && Number.isFinite(item)
          && item >= 0) ? "numeric"
          : macroValues.every((item) => typeof item === "string"
            && /^\+?\d+(?:[.,]\d+)?$/u.test(item.trim())) ? "numeric-strings" : "non-numeric";
      const entryTotals = ["calories", "protein", "fat", "carbs"].map((key) => value[key]);
      const unknownEntryMacroValues = entryTotals.filter((item) => item === null || item === undefined).length;
      const entryTotalsX100Representable = entryTotals.every((item) =>
        item === null || item === undefined || typeof item === "number"
          && exactNonnegativeHundredth(item) !== null);
      const amountX100 = exactNonnegativeHundredth(value.grams);
      entries.push({
        accountScope, clientId: row.clientId, dateKey: row.dateKey,
        ownerFound: row.ownerClientId === row.clientId && validDay(row.dateKey),
        sourceEntryId: typeof value.id === "string" && value.id.trim() ? value.id : null,
        slot, referenceKind, catalogReference, snapshotReference,
        snapshotMacros: macros, positiveGrams: positiveGrams(value.grams),
        amountX100Representable: amountX100 !== null && amountX100 > 0,
        entryTotalsX100Representable, unknownEntryMacroValues,
        enteredAtPresent: isExplicitTimestamp(value.createdAt),
        updatedAtPresent: isExplicitTimestamp(value.updatedAt),
      });
    }
  }
  return { physicalDayRows: rows.length, unparsedDayRows, entries };
}
