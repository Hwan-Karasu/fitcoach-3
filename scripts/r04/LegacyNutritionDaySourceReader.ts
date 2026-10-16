import type { DatabaseSync } from "node:sqlite";

export interface LegacyNutritionDaySource {
  readonly accountScope: string;
  readonly clientId: string;
  readonly dateKey: string;
  readonly ownerFound: boolean;
  readonly mealsShape: "slots" | "invalid-json" | "unsupported-shape";
  readonly foodEntryCount: number;
  readonly ambiguousEntryCount: number;
  readonly unknownMacroEntryCount: number;
  readonly recordedFlag: "yes" | "no" | "unsupported";
  readonly waterPresent: boolean;
}

const slots = ["breakfast", "lunch", "dinner", "snack"] as const;

/** Source-shape screen only: a candidate food entry is not a validated target fact. */
export function readLegacyNutritionDayRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyNutritionDaySource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const columns = new Set(db.prepare("PRAGMA table_info('nutrition_days')").all()
    .map((row) => String(row.name)));
  if (["client_id", "date_key", "meals_json", "meals_recorded", "water_ml"]
    .some((column) => !columns.has(column))) throw new Error("R04_NUTRITION_SHAPE_UNSUPPORTED");
  const rows = db.prepare(`SELECT n.client_id AS clientId, n.date_key AS dateKey,
    n.meals_json AS mealsJson, n.meals_recorded AS mealsRecorded,
    n.water_ml AS waterMl, c.id AS ownerClientId
    FROM nutrition_days n LEFT JOIN clients c ON c.id=n.client_id
    ORDER BY n.client_id,n.date_key`).all();
  const count = db.prepare("SELECT count(*) AS count FROM nutrition_days").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_NUTRITION_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyNutritionDaySource => {
    if (typeof row.clientId !== "string" || !row.clientId.trim()
      || typeof row.dateKey !== "string" || !row.dateKey.trim()) {
      throw new Error("R04_NUTRITION_PROVENANCE_INCOMPLETE");
    }
    let parsed: unknown;
    try { parsed = typeof row.mealsJson === "string" ? JSON.parse(row.mealsJson) as unknown : null; }
    catch { return nutritionRow(row, accountScope, "invalid-json", 0, 0, 0); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
      || Object.keys(parsed).some((key) => !slots.includes(key as typeof slots[number]))
      || slots.some((slot) => !Array.isArray((parsed as Record<string, unknown>)[slot]))) {
      return nutritionRow(row, accountScope, "unsupported-shape", 0, 0, 0);
    }
    const meals = parsed as Record<string, unknown[]>;
    let foodEntryCount = 0;
    let ambiguousEntryCount = 0;
    let unknownMacroEntryCount = 0;
    for (const slot of slots) for (const entry of meals[slot]!) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        ambiguousEntryCount += 1;
        continue;
      }
      const value = entry as Record<string, unknown>;
      if (typeof value.id !== "string" || !value.id.trim()
        || ![value.productId, value.recipeId].some((sourceId) =>
          typeof sourceId === "string" && !!sourceId.trim())) {
        ambiguousEntryCount += 1;
        continue;
      }
      foodEntryCount += 1;
      if (["calories", "protein", "fat", "carbs"].some((macro) =>
        typeof value[macro] !== "number" || !Number.isFinite(value[macro]))) {
        unknownMacroEntryCount += 1;
      }
    }
    return nutritionRow(row, accountScope, "slots", foodEntryCount,
      ambiguousEntryCount, unknownMacroEntryCount);
  });
}

function nutritionRow(
  row: Record<string, unknown>, accountScope: string,
  mealsShape: LegacyNutritionDaySource["mealsShape"], foodEntryCount: number,
  ambiguousEntryCount: number, unknownMacroEntryCount: number,
): LegacyNutritionDaySource {
  const flag = row.mealsRecorded === 1 ? "yes" : row.mealsRecorded === 0 ? "no" : "unsupported";
  return {
    accountScope, clientId: row.clientId as string, dateKey: row.dateKey as string,
    ownerFound: row.ownerClientId === row.clientId,
    mealsShape, foodEntryCount, ambiguousEntryCount, unknownMacroEntryCount,
    recordedFlag: flag,
    waterPresent: typeof row.waterMl === "number" && row.waterMl > 0,
  };
}
