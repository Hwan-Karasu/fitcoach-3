import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

export const DEV_NUTRITION_LEDGER = "nutrition_schema_migrations";

const METRICS = ["kcal", "protein", "fat", "carbs"];
const SEPARATOR = ", ";
/** Колонки коридоров: границы неотрицательны, max ≥ min. */
const corridorColumns = METRICS.map((metric) => `${metric}_min_x10 INTEGER CHECK (${metric}_min_x10 IS NULL OR ${metric}_min_x10 >= 0),
      ${metric}_max_x10 INTEGER CHECK (${metric}_max_x10 IS NULL OR ${metric}_max_x10 >= ${metric}_min_x10)`).join(SEPARATOR);
/** Обе границы показателя заданы или обе пусты (иначе проверка max ≥ min пропустила бы NULL). */
const corridorPairs = METRICS.map((metric) => `CHECK ((${metric}_min_x10 IS NULL) = (${metric}_max_x10 IS NULL))`).join(SEPARATOR);

/**
 * New-install development schema in the shared dev file. Каталог — общий для рабочего пространства, без привязки к клиенту.
 * Not D01 production DDL and not a build120 nutrition import.
 */
export const devNutritionCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "n01-dev-nutrition-v1-own-food-products-20261020",
  statements: [
    `CREATE TABLE dev_food_products (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
      brand TEXT CHECK (brand IS NULL OR length(trim(brand)) BETWEEN 1 AND 80),
      basis_unit TEXT NOT NULL CHECK (basis_unit IN ('G','ML','PORTION')),
      basis_amount_x10 INTEGER NOT NULL CHECK (basis_amount_x10 > 0),
      kcal_x10 INTEGER CHECK (kcal_x10 IS NULL OR kcal_x10 >= 0),
      protein_x10 INTEGER CHECK (protein_x10 IS NULL OR protein_x10 >= 0),
      fat_x10 INTEGER CHECK (fat_x10 IS NULL OR fat_x10 >= 0),
      carbs_x10 INTEGER CHECK (carbs_x10 IS NULL OR carbs_x10 >= 0),
      revision INTEGER NOT NULL CHECK (revision > 0),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kcal_x10 IS NOT NULL OR protein_x10 IS NOT NULL OR fat_x10 IS NOT NULL OR carbs_x10 IS NOT NULL)
    )`,
    `CREATE INDEX dev_food_products_active ON dev_food_products(workspace_id, archived_at, name)`,
  ],
}, {
  version: 2,
  checksum: "n01-dev-nutrition-v2-recipes-20261020",
  statements: [
    // Нужен составному FK ингредиентов: ингредиент другого пространства невозможен. Не в v1: та миграция уже применена.
    `CREATE UNIQUE INDEX dev_food_products_identity ON dev_food_products(id, workspace_id)`,
    `CREATE TABLE dev_recipes (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
      servings_x10 INTEGER NOT NULL CHECK (servings_x10 > 0),
      cooked_mass_x10 INTEGER CHECK (cooked_mass_x10 IS NULL OR cooked_mass_x10 > 0),
      revision INTEGER NOT NULL CHECK (revision > 0),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX dev_recipes_identity ON dev_recipes(id, workspace_id)`,
    `CREATE INDEX dev_recipes_active ON dev_recipes(workspace_id, archived_at, name)`,
    // Состав заменяется целиком при правке рецепта; история хранит снимок, а не эти строки (§49.4.5).
    `CREATE TABLE dev_recipe_ingredients (
      recipe_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      food_id TEXT NOT NULL,
      quantity_x10 INTEGER NOT NULL CHECK (quantity_x10 > 0),
      PRIMARY KEY (recipe_id, position),
      UNIQUE (recipe_id, food_id),
      FOREIGN KEY (recipe_id, workspace_id) REFERENCES dev_recipes(id, workspace_id) ON DELETE CASCADE,
      FOREIGN KEY (food_id, workspace_id) REFERENCES dev_food_products(id, workspace_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 3,
  checksum: "n02-dev-nutrition-v3-food-diary-water-20261020",
  statements: [
    // Пищевая запись хранит снимок (название, основа, значения на основу, количество); «съедено» считается из них, а не хранится второй раз.
    `CREATE TABLE dev_food_diary_entries (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      slot TEXT NOT NULL CHECK (slot IN ('BREAKFAST','LUNCH','DINNER','SNACK')),
      position INTEGER NOT NULL CHECK (position >= 0),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('FOOD','RECIPE')),
      source_id TEXT NOT NULL CHECK (length(source_id) > 0),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      brand TEXT,
      basis_unit TEXT NOT NULL CHECK (basis_unit IN ('G','ML','PORTION')),
      basis_amount_x10 INTEGER NOT NULL CHECK (basis_amount_x10 > 0),
      per_kcal_x10 INTEGER CHECK (per_kcal_x10 IS NULL OR per_kcal_x10 >= 0),
      per_protein_x10 INTEGER CHECK (per_protein_x10 IS NULL OR per_protein_x10 >= 0),
      per_fat_x10 INTEGER CHECK (per_fat_x10 IS NULL OR per_fat_x10 >= 0),
      per_carbs_x10 INTEGER CHECK (per_carbs_x10 IS NULL OR per_carbs_x10 >= 0),
      quantity_x10 INTEGER NOT NULL CHECK (quantity_x10 > 0),
      ingredients_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE INDEX dev_food_diary_entries_day ON dev_food_diary_entries(workspace_id, client_id, local_date, slot, position)`,
    // Вода — отдельный факт: одна сумма за день клиента, не пищевая запись и не критерий «дня с учётом».
    `CREATE TABLE dev_water_days (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      ml INTEGER NOT NULL CHECK (ml > 0 AND ml <= 20000),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, local_date),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 4,
  checksum: "n03-dev-nutrition-v4-targets-versions-exceptions-20261020",
  statements: [
    // Датированные версии расписания целей; две версии на одну дату клиента невозможны (§49.11.5).
    `CREATE TABLE dev_nutrition_target_versions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      effective_from TEXT NOT NULL CHECK (date(effective_from) IS effective_from),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, client_id, effective_from),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE dev_nutrition_target_days (
      version_id TEXT NOT NULL,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      ${corridorColumns},
      PRIMARY KEY (version_id, weekday),
      ${corridorPairs},
      FOREIGN KEY (version_id) REFERENCES dev_nutrition_target_versions(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE dev_nutrition_target_exceptions (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      ${corridorColumns},
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, local_date),
      ${corridorPairs},
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 5,
  checksum: "n05-dev-nutrition-v5-catalog-favorites-cookbook-barcode-piece-20261020",
  statements: [
    // Штрихкод — локальный ключ поиска (§49.6); масса штуки NULL = не задана (не 0). Избранное и книга — флаги каталога, историю дневника не затрагивают.
    `ALTER TABLE dev_food_products ADD COLUMN barcode TEXT CHECK (barcode IS NULL OR length(barcode) BETWEEN 4 AND 32)`,
    `ALTER TABLE dev_food_products ADD COLUMN grams_per_piece_x10 INTEGER CHECK (grams_per_piece_x10 IS NULL OR grams_per_piece_x10 > 0)`,
    `ALTER TABLE dev_food_products ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1))`,
    `ALTER TABLE dev_recipes ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 500)`,
    `ALTER TABLE dev_recipes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1))`,
    `ALTER TABLE dev_recipes ADD COLUMN in_cookbook INTEGER NOT NULL DEFAULT 0 CHECK (in_cookbook IN (0, 1))`,
  ],
}, {
  version: 6,
  checksum: "n06-dev-nutrition-v6-calc-profile-daily-steps-20261020",
  statements: [
    // Профиль расчёта КБЖУ клиента (§49.10): вес и % жира не дублируются, их источник — Measurements. NULL = не введено.
    `CREATE TABLE dev_nutrition_calc_profiles (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      sex TEXT CHECK (sex IS NULL OR sex IN ('MALE','FEMALE')),
      age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
      height_x10 INTEGER CHECK (height_x10 IS NULL OR height_x10 BETWEEN 500 AND 3000),
      goal TEXT NOT NULL CHECK (goal IN ('LOSS','MAINTENANCE','GAIN')),
      activity TEXT NOT NULL CHECK (activity IN ('SEDENTARY','MODERATE','ACTIVE','VERY_ACTIVE')),
      workouts_per_week INTEGER NOT NULL CHECK (workouts_per_week BETWEEN 0 AND 21),
      workout_minutes INTEGER NOT NULL CHECK (workout_minutes BETWEEN 1 AND 600),
      intensity TEXT NOT NULL CHECK (intensity IN ('LIGHT','MEDIUM','HEAVY')),
      step_kcal INTEGER NOT NULL CHECK (step_kcal BETWEEN 0 AND 1000),
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    // Шаги за день: одно значение на дату клиента; день без записи — неизвестно, а не 0.
    `CREATE TABLE dev_nutrition_daily_steps (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      steps INTEGER NOT NULL CHECK (steps BETWEEN 1 AND 100000),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, local_date),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 7,
  checksum: "n07-dev-nutrition-v7-calc-profile-without-body-fields-20261020",
  statements: [
    // Пол, возраст и рост теперь берутся из карточки клиента (единый источник); профиль расчёта хранит только параметры расчёта.
    // DROP COLUMN, а не пересоздание таблицы: RENAME проверяет внешние ключи на dev_clients, которой может не быть при частичной инициализации.
    `ALTER TABLE dev_nutrition_calc_profiles DROP COLUMN sex`,
    `ALTER TABLE dev_nutrition_calc_profiles DROP COLUMN age`,
    `ALTER TABLE dev_nutrition_calc_profiles DROP COLUMN height_x10`,
  ],
}, {
  version: 8,
  checksum: "n08-dev-nutrition-v8-diary-entry-nutrient-override-20261020",
  statements: [
    // Ручная правка К/Б/Ж/У только этой дневной записи (UX v1.1 NUT-FS-27…34, решение владельца; поправка к Product §49.5.2 готовится). Каталог и снимок продукта не меняются.
    // NULL = показатель не правился (берётся из снимка); база — количество, на которое введены значения: при смене массы правка масштабируется пропорционально.
    `ALTER TABLE dev_food_diary_entries ADD COLUMN override_base_quantity_x10 INTEGER CHECK (override_base_quantity_x10 IS NULL OR override_base_quantity_x10 > 0)`,
    `ALTER TABLE dev_food_diary_entries ADD COLUMN override_kcal_x10 INTEGER CHECK (override_kcal_x10 IS NULL OR override_kcal_x10 >= 0)`,
    `ALTER TABLE dev_food_diary_entries ADD COLUMN override_protein_x10 INTEGER CHECK (override_protein_x10 IS NULL OR override_protein_x10 >= 0)`,
    `ALTER TABLE dev_food_diary_entries ADD COLUMN override_fat_x10 INTEGER CHECK (override_fat_x10 IS NULL OR override_fat_x10 >= 0)`,
    `ALTER TABLE dev_food_diary_entries ADD COLUMN override_carbs_x10 INTEGER CHECK (override_carbs_x10 IS NULL OR override_carbs_x10 >= 0)`,
    // Согласованность: база задана тогда и только тогда, когда правится хотя бы один показатель (CASE: NULL в WHEN не срабатывает).
    `CREATE TRIGGER dev_food_diary_override_insert BEFORE INSERT ON dev_food_diary_entries
      WHEN CASE WHEN NEW.override_base_quantity_x10 IS NULL THEN (NEW.override_kcal_x10 IS NOT NULL OR NEW.override_protein_x10 IS NOT NULL OR NEW.override_fat_x10 IS NOT NULL OR NEW.override_carbs_x10 IS NOT NULL)
        ELSE (NEW.override_kcal_x10 IS NULL AND NEW.override_protein_x10 IS NULL AND NEW.override_fat_x10 IS NULL AND NEW.override_carbs_x10 IS NULL) END
      BEGIN SELECT RAISE(ABORT, 'DIARY_OVERRIDE_INVALID'); END`,
    `CREATE TRIGGER dev_food_diary_override_update BEFORE UPDATE ON dev_food_diary_entries
      WHEN CASE WHEN NEW.override_base_quantity_x10 IS NULL THEN (NEW.override_kcal_x10 IS NOT NULL OR NEW.override_protein_x10 IS NOT NULL OR NEW.override_fat_x10 IS NOT NULL OR NEW.override_carbs_x10 IS NOT NULL)
        ELSE (NEW.override_kcal_x10 IS NULL AND NEW.override_protein_x10 IS NULL AND NEW.override_fat_x10 IS NULL AND NEW.override_carbs_x10 IS NULL) END
      BEGIN SELECT RAISE(ABORT, 'DIARY_OVERRIDE_INVALID'); END`,
  ],
}];
