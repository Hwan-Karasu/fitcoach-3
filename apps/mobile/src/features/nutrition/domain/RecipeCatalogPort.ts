import type { Recipe, RecipeInput } from "./RecipeModel.ts";

export interface RecipeCatalogCommittedChange {
  readonly recipeId: string;
}

/**
 * Локальный каталог рецептов (§49.4). Ошибки: RecipeRuleError, RECIPE_STALE (нет записи или устарела revision),
 * FOOD_SOURCE_UNAVAILABLE (ингредиент отсутствует или скрыт и не был в рецепте).
 */
export interface RecipeCatalogPort {
  /** Активные рецепты с составом; `query` — подстрока названия без учёта регистра. */
  search(query?: string): Promise<readonly Recipe[]>;
  /** Рецепт по id, в том числе скрытый. */
  get(id: string): Promise<Recipe | null>;
  create(input: RecipeInput, now?: Date): Promise<Recipe>;
  /** Заменяет состав целиком; меняет только будущие использования (§49.4.5). */
  update(id: string, expectedRevision: number, input: RecipeInput, now?: Date): Promise<Recipe>;
  archive(id: string, expectedRevision: number, now?: Date): Promise<Recipe>;
  subscribeCommittedChanges(listener: (change: RecipeCatalogCommittedChange) => void): () => void;
}
