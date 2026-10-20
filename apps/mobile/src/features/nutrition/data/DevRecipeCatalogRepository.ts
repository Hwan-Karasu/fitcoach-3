import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { FoodProduct } from "../domain/FoodModel.ts";
import type { Recipe, RecipeInput } from "../domain/RecipeModel.ts";
import type { RecipeCatalogCommittedChange, RecipeCatalogFilter, RecipeCatalogPort } from "../domain/RecipeCatalogPort.ts";
import { validateRecipe } from "../domain/RecipeRules.ts";
import { DEV_NUTRITION_LEDGER, devNutritionCatalog } from "./DevNutritionCatalog.ts";

interface RecipeRow {
  readonly id: string;
  readonly name: string;
  readonly servingsX10: number;
  readonly cookedMassX10: number | null;
  readonly description: string | null;
  readonly favorite: number;
  readonly inCookbook: number;
  readonly revision: number;
  readonly archivedAt: string | null;
}
type IngredientRow = FoodProduct & { readonly recipeId: string; readonly quantityX10: number };

const recipeColumns = `id, name, servings_x10 AS servingsX10, cooked_mass_x10 AS cookedMassX10, description, favorite, in_cookbook AS inCookbook, revision, archived_at AS archivedAt`;
const ingredientColumns = `i.recipe_id AS recipeId, i.quantity_x10 AS quantityX10, f.id AS id, f.name AS name, f.brand AS brand,
  f.basis_unit AS unit, f.basis_amount_x10 AS amountX10, f.kcal_x10 AS kcalX10, f.protein_x10 AS proteinX10, f.fat_x10 AS fatX10,
  f.carbs_x10 AS carbsX10, f.revision AS revision, f.archived_at AS archivedAt`;

async function load(reader: SqliteStatementPort, workspaceId: string, where: string, bindings: readonly (string | number)[]): Promise<readonly Recipe[]> {
  const rows = await reader.all<RecipeRow>(`SELECT ${recipeColumns} FROM dev_recipes WHERE workspace_id = ? ${where}`, [workspaceId, ...bindings]);
  if (rows.length === 0) return [];
  const lines = await reader.all<IngredientRow>(`SELECT ${ingredientColumns} FROM dev_recipe_ingredients i
    JOIN dev_food_products f ON f.id = i.food_id AND f.workspace_id = i.workspace_id
    WHERE i.workspace_id = ? AND i.recipe_id IN (${rows.map(() => "?").join(", ")}) ORDER BY i.recipe_id, i.position`,
  [workspaceId, ...rows.map((row) => row.id)]);
  return rows.map((row) => ({ ...row, favorite: row.favorite === 1, inCookbook: row.inCookbook === 1, ingredients: lines.filter((line) => line.recipeId === row.id).map((line) => ({
    quantityX10: line.quantityX10,
    food: { id: line.id, name: line.name, brand: line.brand, unit: line.unit, amountX10: line.amountX10, kcalX10: line.kcalX10,
      proteinX10: line.proteinX10, fatX10: line.fatX10, carbsX10: line.carbsX10, revision: line.revision, archivedAt: line.archivedAt },
  })) }));
}

/** Explicitly dev-only new-install store sharing the clients dev file. */
export class DevRecipeCatalogRepository implements RecipeCatalogPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: RecipeCatalogCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
  }

  initialize(): Promise<void> {
    if (this.connection !== null) return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const opening = this.openAndMigrate();
    this.opening = opening;
    void opening.finally(() => { if (this.opening === opening) this.opening = null; })
      .catch(() => undefined);
    return opening;
  }

  private async openAndMigrate(): Promise<void> {
    if (!this.workspaceId.trim()) throw new Error("NUTRITION_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devNutritionCatalog, DEV_NUTRITION_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("NUTRITION_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: RecipeCatalogCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: RecipeCatalogCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  async search(query = "", filter: RecipeCatalogFilter = "ALL"): Promise<readonly Recipe[]> {
    const flag = filter === "FAVORITES" ? "AND favorite = 1" : filter === "COOKBOOK" ? "AND in_cookbook = 1" : "";
    const recipes = await load(this.ready().connection, this.workspaceId, `AND archived_at IS NULL ${flag}`, []);
    const needle = query.trim().toLocaleLowerCase("ru");
    return recipes.filter((recipe) => needle === "" || recipe.name.toLocaleLowerCase("ru").includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<Recipe | null> {
    return (await load(this.ready().connection, this.workspaceId, "AND id = ?", [id]))[0] ?? null;
  }

  /** Состав пишется целиком в той же транзакции; скрытый продукт допустим, только если он уже был в рецепте. */
  private async writeIngredients(tx: SqliteStatementPort, recipeId: string, input: RecipeInput): Promise<void> {
    const previous = new Set((await tx.all<{ foodId: string }>("SELECT food_id AS foodId FROM dev_recipe_ingredients WHERE recipe_id = ?", [recipeId]))
      .map((row) => row.foodId));
    await tx.run("DELETE FROM dev_recipe_ingredients WHERE recipe_id = ? AND workspace_id = ?", [recipeId, this.workspaceId]);
    for (const [position, item] of input.ingredients.entries()) {
      const food = await tx.first<{ archivedAt: string | null }>("SELECT archived_at AS archivedAt FROM dev_food_products WHERE workspace_id = ? AND id = ?",
        [this.workspaceId, item.foodId]);
      if (food === null || (food.archivedAt !== null && !previous.has(item.foodId))) throw new Error("FOOD_SOURCE_UNAVAILABLE");
      await tx.run("INSERT INTO dev_recipe_ingredients (recipe_id, workspace_id, position, food_id, quantity_x10) VALUES (?, ?, ?, ?, ?)",
        [recipeId, this.workspaceId, position, item.foodId, item.quantityX10]);
    }
  }

  async create(input: RecipeInput, now: Date = new Date()): Promise<Recipe> {
    const valid = validateRecipe(input);
    const created = await this.ready().writer.write(async (tx) => {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("RECIPE_ID_UNAVAILABLE");
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO dev_recipes (id, workspace_id, name, servings_x10, cooked_mass_x10, description, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`, [id, this.workspaceId, valid.name, valid.servingsX10, valid.cookedMassX10, valid.description ?? null, stamp, stamp]);
      await this.writeIngredients(tx, id, valid);
      return (await load(tx, this.workspaceId, "AND id = ?", [id]))[0] as Recipe;
    });
    this.publish({ recipeId: created.id });
    return created;
  }

  async update(id: string, expectedRevision: number, input: RecipeInput, now: Date = new Date()): Promise<Recipe> {
    const valid = validateRecipe(input);
    const updated = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_recipes SET name = ?, servings_x10 = ?, cooked_mass_x10 = ?, description = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND archived_at IS NULL`,
      [valid.name, valid.servingsX10, valid.cookedMassX10, valid.description ?? null, now.toISOString(), this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("RECIPE_STALE");
      await this.writeIngredients(tx, id, valid);
      return (await load(tx, this.workspaceId, "AND id = ?", [id]))[0] as Recipe;
    });
    this.publish({ recipeId: id });
    return updated;
  }

  private async setFlag(column: "favorite" | "in_cookbook", id: string, value: boolean, now: Date): Promise<Recipe> {
    const recipe = await this.ready().writer.write(async (tx) => {
      const current = (await load(tx, this.workspaceId, "AND id = ?", [id]))[0];
      if (current === undefined || current.archivedAt !== null) throw new Error("RECIPE_STALE");
      if ((column === "favorite" ? current.favorite : current.inCookbook) === value) return current;
      await tx.run(`UPDATE dev_recipes SET ${column} = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`, [value ? 1 : 0, now.toISOString(), this.workspaceId, id]);
      return (await load(tx, this.workspaceId, "AND id = ?", [id]))[0] as Recipe;
    });
    this.publish({ recipeId: id });
    return recipe;
  }

  setFavorite(id: string, value: boolean, now: Date = new Date()): Promise<Recipe> { return this.setFlag("favorite", id, value, now); }

  setInCookbook(id: string, value: boolean, now: Date = new Date()): Promise<Recipe> { return this.setFlag("in_cookbook", id, value, now); }

  async archive(id: string, expectedRevision: number, now: Date = new Date()): Promise<Recipe> {
    let changed = false;
    const archived = await this.ready().writer.write(async (tx) => {
      const current = (await load(tx, this.workspaceId, "AND id = ?", [id]))[0];
      if (current === undefined) throw new Error("RECIPE_STALE");
      if (current.archivedAt !== null) return current;
      const result = await tx.run(`UPDATE dev_recipes SET archived_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`, [now.toISOString(), now.toISOString(), this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("RECIPE_STALE");
      changed = true;
      return (await load(tx, this.workspaceId, "AND id = ?", [id]))[0] as Recipe;
    });
    if (changed) this.publish({ recipeId: id });
    return archived;
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
