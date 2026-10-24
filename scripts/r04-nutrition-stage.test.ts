import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyMeasurementsSnapshotInSnapshot } from "./r04/LegacyMeasurementSourceReader.ts";
import { readLegacyNutritionInSnapshot } from "./r04/LegacyNutritionSourceReader.ts";
import { nutritionNativeTables, nutritionTargetTables } from "./r04/LegacyNutritionStage.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "./r04/LegacyPlansSourceReader.ts";
import { EXECUTION_SOURCE_TABLES, type LegacyExecutionSource } from "./r04/LegacyExecutionSourceReader.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { DevFoodCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevRecipeCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevRecipeCatalogRepository.ts";
import { DevNutritionDiaryRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { DevNutritionCalcRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { summarizeDay } from "../apps/mobile/src/features/nutrition/domain/DiaryRules.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { createSqliteBackup, prepareBackupForRestore } from "./r06/SqliteBackup.ts";

const context = { sourceSha256: "d".repeat(64), accountScope: "nutrition-synthetic", sourceWorkspaceId: "source-workspace", targetWorkspaceId: "local-trainer" };
const time = "2026-03-01T12:00:00.000Z", imported = "2026-10-24T10:00:00.000Z", day = "2026-03-01";
const options = { clientIdentityRehearsal: { createdAt: imported, profiles: true as const, questionnaires: true as const, workData: true as const,
  exercises: true as const, plans: true as const, templates: true as const, archives: true as const, executions: true as const,
  measurements: { referenceDay: "2026-10-24" }, nutrition: true as const } };
const plans: LegacyPlansSource = { accountScope: context.accountScope, tables: Object.fromEntries(PLAN_SOURCE_TABLES.map((t, i) => [t, i < 5 ? [] : null])) as LegacyPlansSource["tables"] };
const executions: LegacyExecutionSource = { accountScope: context.accountScope, tables: Object.fromEntries(EXECUTION_SOURCE_TABLES.map((t) => [t, t === "training_exercise_history" ? [] : null])) as LegacyExecutionSource["tables"] };
function allocator() { let n = 0; return () => `88888888-8888-4888-8888-${String(++n).padStart(12, "0")}`; }
function snapshot(id = "p", historical = false) { return { id, name: historical ? "Историческое имя" : "Сегодняшнее имя", brand: "", barcode: "", servingMode: "grams", gramsPerPiece: 0,
  calories: historical ? 100 : 300, protein: historical ? 5 : 10, fat: historical ? 1 : 5, carbs: historical ? 10 : 30 }; }
function meal(id: string, historical = true) { return { id, productId: "p", productSnapshot: snapshot("p", historical), grams: historical ? "17.4" : "100", unit: "grams", pieceCount: "",
  calories: historical ? 17 : 300, protein: historical ? 0.9 : 10, fat: historical ? 0.2 : 5, carbs: historical ? 1.7 : 30, createdAt: time }; }
const emptyMeals = () => ({ breakfast: [] as unknown[], lunch: [] as unknown[], dinner: [] as unknown[], snack: [] as unknown[] });
const calcProfile = () => ({ goal: "Похудение", activity: "Очень активный", workouts: "3", workoutDuration: "90", workoutIntensity: "Тяжелая", deficit: "300" });
function seedCalculator(db: DatabaseSync) {
  db.exec("CREATE TABLE client_kbju_state(client_id TEXT PRIMARY KEY,profile_json TEXT,manual_kbju_json TEXT,updated_at TEXT)");
  for (const client of ["a", "b"]) db.prepare("INSERT INTO client_kbju_state VALUES(?,?,?,?)").run(client,
    JSON.stringify(client === "a" ? calcProfile() : { ...calcProfile(), goal: "Поддержание", workouts: "0", deficit: "0" }), '{"protein":"","fat":"","carbs":""}', time);
}
function seedArchives(db: DatabaseSync) {
  db.exec(`CREATE TABLE nutrition_archive_weeks(id TEXT PRIMARY KEY,client_id TEXT,start_date TEXT,end_date TEXT,label TEXT,saved_at TEXT,
    avg_weight REAL,avg_steps REAL,avg_cal REAL,avg_fat_percent REAL,train_days INTEGER,protein REAL,fat REAL,carbs REAL,days_json TEXT)`);
  const days = JSON.stringify([{ dateKey: day, weight: 81.25, steps: 0, calories: 500, fatPercent: null, training: "Нет", protein: null, fat: 0, carbs: 20 }]);
  for (const [id, client, start, end, detail] of [["archive-a", "a", "2026-02-23", day, days],
    ["archive-overlap", "a", "2026-02-24", "2026-03-02", "{}"], ["archive-b", "b", "2026-02-23", day, days]]) {
    db.prepare("INSERT INTO nutrition_archive_weeks VALUES(?,?,?,?,?,?,80.125,1234.5,2222.25,0,0,NULL,0,20,?)").run(id!, client!, start!, end!, `Снимок ${id}`, time, detail!);
  }
}
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT,weight TEXT);
    CREATE TABLE food_products(id TEXT PRIMARY KEY,name TEXT,brand TEXT,barcode TEXT,serving_mode TEXT,grams_per_piece REAL,calories REAL,protein REAL,fat REAL,carbs REAL,favorite INTEGER,created_at TEXT,updated_at TEXT,fiber REAL,sugar REAL,sodium REAL,cholesterol REAL);
    CREATE TABLE nutrition_recipes(id TEXT PRIMARY KEY,name TEXT,description TEXT,servings TEXT,items_json TEXT,calories REAL,protein REAL,fat REAL,carbs REAL,saved_to_cookbook INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE nutrition_days(client_id TEXT,date_key TEXT,meals_json TEXT,water_ml INTEGER,meals_recorded INTEGER,updated_at TEXT,extra_text TEXT,PRIMARY KEY(client_id,date_key));
    CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT,updated_at TEXT,PRIMARY KEY(client_id,date_key));`);
  for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','',?,'80.1')").run(id, context.sourceWorkspaceId, `Синтетический ${id}`, time, time, '{"trainerNotes":"Сохранить рабочую заметку"}');
  db.prepare("INSERT INTO food_products VALUES('p','Сегодняшнее имя','','','grams',0,300,10,5,30,1,?,?,0,0,0,0)").run(time, time);
  const item = { ...meal("unused", false), productId: "p" };
  db.prepare("INSERT INTO nutrition_recipes VALUES('r','Рецепт','Описание','2',?,300,10,5,30,1,?,?)").run(JSON.stringify([item]), time, time);
  const missing = { ...meal("gone-entry", false), productId: "gone", productSnapshot: { ...snapshot("gone"), name: "Удалённый продукт", calories: 20, protein: null, fat: 0, carbs: 1 }, calories: 20, protein: null, fat: 0, carbs: 1 };
  for (const [client, date, meals, water] of [["a", day, { breakfast: [meal("old")], lunch: [meal("from-recipe", false)], dinner: [missing], snack: [] }, 500],
    ["b", day, { ...emptyMeals(), breakfast: [meal("other-client")] }, 0], ["a", "2026-03-02", emptyMeals(), 1200], ["a", "2026-03-03", emptyMeals(), 0]] as const) {
    db.prepare("INSERT INTO nutrition_days VALUES(?,?,?,?,1,?,'source extras preserved')").run(client, date, JSON.stringify(meals), water, time);
  }
  db.prepare("INSERT INTO client_day_facts VALUES('a',?,'80.1','1234','Да',?)").run(day, time);
}
function input(source: DatabaseSync) { return { cards: readLegacyClientCardsInSnapshot(source, context.accountScope, readLegacyClientIdentityInSnapshot(source, context.accountScope)),
  measurements: readLegacyMeasurementsSnapshotInSnapshot(source, context.accountScope), nutrition: readLegacyNutritionInSnapshot(source, context.accountScope) }; }
function stage(source: DatabaseSync, target: DatabaseSync) {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  return { data, ledger, result: ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator()) };
}
async function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void | Promise<void>) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); await run(source, target); } finally { source.close(); target.close(); }
}
function removeFixtureDirectory(dir: string, prefix: string) {
  const resolved = resolve(dir); assert.equal(dirname(resolved), resolve(tmpdir())); assert.ok(basename(resolved).startsWith(prefix));
  rmSync(resolved, { recursive: true, force: true });
}
const receipt = (db: DatabaseSync) => db.prepare("SELECT * FROM r04_nutrition_receipt").get()!;

test("nutrition stages real D01 food/recipe/diary/water/daily fields without catalog rewrites or double-counting recipe ingredients", () => fixture((source, target) => {
  const { result, ledger } = stage(source, target);
  assert.deepEqual([result.nutritionFoodRows, result.nutritionRecipeRows, result.nutritionEntryRows, result.nutritionWaterRows, result.nutritionStepRows, result.nutritionWorkoutMarkRows], [1, 1, 4, 2, 1, 1]);
  assert.equal(result.nutritionReviewRepresentations, 0); assert.equal(result.finalizable, false); assert.equal(ledger.loadNutritionDraftEntries().length, 4);
  const old = target.prepare("SELECT * FROM food_diary_entries WHERE name='Историческое имя' AND client_id=(SELECT id FROM clients WHERE display_name LIKE '% a')").get()!;
  assert.equal(old.per_kcal_x10, 1000); assert.equal(old.override_kcal_x10, 170); assert.equal(old.quantity_x10, 174);
  assert.equal(old.override_base_quantity_x10, 174); assert.equal(old.created_at, time); assert.equal(old.updated_at, imported);
  assert.equal(target.prepare("SELECT kcal_x10 FROM food_products").get()?.kcal_x10, 3000);
  assert.equal(target.prepare("SELECT cooked_mass_x10 FROM recipes").get()?.cooked_mass_x10, null);
  assert.ok(ledger.loadNutritionDraftEntries().every((r) => r.source_kind === "FOOD" && r.ingredients_json === "[]"));
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_execution_facts").get()?.n, 0);
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
  assert.match(receipt(target).source_json as string, /source extras preserved/u);
}));

test("changed recipe ingredient versions and duplicate ingredient rows retain raw/review rather than changing old totals or merging ingredients", async () => {
  for (const mode of ["version", "duplicate", "totals"] as const) await fixture((source, target) => {
    const item = meal("unused", false);
    if (mode === "version") item.productSnapshot.name = "Старое имя ингредиента";
    if (mode === "totals") item.calories = 299;
    source.prepare("UPDATE nutrition_recipes SET items_json=?").run(JSON.stringify(mode === "duplicate" ? [item, item] : [item]));
    const { result } = stage(source, target);
    assert.equal(result.nutritionRecipeRows, 0); assert.equal(result.nutritionEntryRows, 4); assert.equal(result.nutritionReviewRepresentations, 1);
    assert.match(receipt(target).target_json as string, /RECIPE_INGREDIENT_(VERSION_STORAGE_REQUIRED|TOTALS_STORAGE_REQUIRED|INVALID)/u);
    assert.ok((receipt(target).source_json as string).includes("items_json"));
  });
});

test("exact JSON numeric tokens, missing totals and unknown references are not rounded or filled from a current catalog", async () => {
  for (const mode of ["precision", "unknown-total", "snapshot-id", "missing-snapshot"] as const) await fixture((source, target) => {
    const entries = { ...emptyMeals(), breakfast: [meal("changed")] };
    if (mode === "unknown-total") Reflect.deleteProperty(entries.breakfast[0]!, "protein");
    if (mode === "snapshot-id") entries.breakfast[0]!.productSnapshot.id = "other";
    if (mode === "missing-snapshot") Reflect.deleteProperty(entries.breakfast[0]!, "productSnapshot");
    let json = JSON.stringify(entries); if (mode === "precision") json = json.replace('"calories":17', '"calories":17.000000000000001');
    source.prepare("UPDATE nutrition_days SET meals_json=? WHERE client_id='a' AND date_key=?").run(json, day);
    const { result } = stage(source, target); assert.equal(result.nutritionEntryRows, 1); assert.equal(result.nutritionReviewRepresentations, 1);
    if (mode === "precision") assert.match(receipt(target).source_json as string, /17\.000000000000001/u);
  });
});

test("unreadable meals do not become food-free success; water remains independent and the raw day has an explicit issue", () => fixture((source, target) => {
  source.prepare("UPDATE nutrition_days SET meals_json='broken JSON' WHERE client_id='a' AND date_key=?").run(day);
  const { result } = stage(source, target); assert.equal(result.nutritionEntryRows, 1); assert.equal(result.nutritionWaterRows, 2);
  assert.equal(result.nutritionReviewRepresentations, 1); assert.match(receipt(target).source_json as string, /broken JSON/u);
  assert.match(receipt(target).target_json as string, /NUTRITION_JSON_INVALID/u);
}));

test("calculator/weekly aggregates and uncertain extra nutrient units remain explicit pending data without invented days or nutrients", () => fixture((source, target) => {
  source.exec(`CREATE TABLE client_kbju_state(client_id TEXT,profile_json TEXT,manual_kbju_json TEXT,updated_at TEXT);
    INSERT INTO client_kbju_state VALUES('a','{"weight":"99","fatPercent":"12"}','{}','${time}');
    CREATE TABLE nutrition_archive_weeks(id TEXT,client_id TEXT,avg_weight REAL,details_json TEXT);
    INSERT INTO nutrition_archive_weeks VALUES('week','a',80.1,'{"days":[]}'); UPDATE food_products SET sodium=100`);
  const { result } = stage(source, target); assert.equal(result.nutritionReviewRepresentations, 4);
  for (const name of ["nutrition_calc_profiles", "nutrition_target_versions", "nutrition_target_days"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0);
  assert.equal(target.prepare("SELECT count(*) AS n FROM body_measurements").get()?.n, 1);
  assert.match(receipt(target).target_json as string, /EXTRA_NUTRIENT_UNITS_UNPROVEN/u);
}));

test("source identity collisions, foreign owners and mixed-time daily snapshots roll back all owners", async () => {
  for (const mode of ["entry-id", "owner", "daily-snapshot"] as const) await fixture((source, target) => {
    if (mode === "entry-id") source.prepare("UPDATE nutrition_days SET meals_json=? WHERE client_id='b'").run(JSON.stringify({ ...emptyMeals(), breakfast: [meal("old")] }));
    if (mode === "owner") source.exec("UPDATE nutrition_days SET client_id='absent' WHERE client_id='b'");
    const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    if (mode === "daily-snapshot") Object.assign(data.nutrition.tables.client_day_facts![0]!, { steps: "9999" });
    assert.throws(() => ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator()), /ENTRY_ID_DUPLICATE|OWNER_INVALID|DAILY_SOURCE_MISMATCH/u);
    for (const name of ["clients", "body_measurements", "food_products", "food_diary_entries", "r04_measurement_receipt", "r04_execution_receipt"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0);
    assert.equal(target.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()?.n, 0);
  });
});

test("each nutrition write boundary rolls back prior owners, IDs and all nutrition tables, then permits clean retry", async () => {
  const phases = ["after-nutrition-ids", ...nutritionTargetTables.map(() => "after-nutrition-rows"), "after-nutrition-receipt", "before-commit"];
  for (const [index, phase] of phases.entries()) await fixture((source, target) => {
    seedCalculator(source); seedArchives(source);
    const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options), occurrence = phases.slice(0, index + 1).filter((p) => p === phase).length; let seen = 0;
    assert.throws(() => ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator(), (p) => {
      if (p === phase && ++seen === occurrence) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const name of ["clients", "body_measurements", "r04_work_notes", "r04_measurement_ids", "r04_measurement_receipt", "r04_nutrition_ids", "r04_nutrition_receipt", ...nutritionTargetTables]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0, name);
    const retried = ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator());
    assert.equal(retried.nutritionEntryRows, 4); assert.equal(retried.nutritionCalcProfileRows, 2);
    assert.equal(retried.nutritionArchiveWeekRows, 3);
  });
});

test("source freezing, source drift, target drift and guarded nutrition reads preserve committed facts and metadata", () => fixture((source, target) => {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator(), (phase) => {
    if (phase === "after-ids") Object.assign(data.nutrition.tables.nutrition_days![0]!, { meals_json: "injected" });
  });
  assert.equal(ledger.loadNutritionDraftEntries().length, 4); assert.doesNotMatch(receipt(target).source_json as string, /injected/u);
  source.exec("UPDATE food_products SET favorite=0"); const changed = input(source);
  assert.throws(() => ledger.stageClientNutrition(changed.cards, null, [], [], plans, executions, changed.measurements, changed.nutrition, allocator()), /PARITY_MISMATCH/u);
  const row = target.prepare("SELECT * FROM food_diary_entries LIMIT 1").get()!;
  target.prepare("UPDATE food_diary_entries SET name='changed' WHERE id=?").run(row.id!); assert.throws(() => ledger.loadNutritionDraftEntries(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE food_diary_entries SET name=? WHERE id=?").run(row.name!, row.id!);
  target.exec("UPDATE r04_nutrition_receipt SET target_json=json_set(target_json,'$.representations[0].metadata','changed')");
  assert.throws(() => ledger.loadNutritionDraftEntries(), /PARITY_MISMATCH/u);
}));

test("nutrition mode cannot bypass its complete entry point or claim an older measurement job", () => fixture((source, target) => {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  assert.throws(() => ledger.stageClientMeasurements(data.cards, null, [], [], plans, executions, data.measurements), /NUTRITION_MODE_MISMATCH/u);
  assert.throws(() => prepareCandidateIdentityLedger(target, context, { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, nutrition: undefined } }), /FOREIGN_DATABASE/u);
  source.exec("ALTER TABLE food_products DROP COLUMN calories"); assert.throws(() => readLegacyNutritionInSnapshot(source, context.accountScope), /SHAPE_UNSUPPORTED/u);
}));

test("read-only source, reopened target and reordered rows/properties retain byte-identical nutrition and every ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-nutrition-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "target.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex"); let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); seedCalculator(source); seedArchives(source); source.close(); source = null; const before = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const data = input(source), exact = { ...context, sourceSha256: before };
    target = new DatabaseSync(targetPath); const ledger = prepareCandidateIdentityLedger(target, exact, options);
    ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator()); const entries = ledger.loadNutritionDraftEntries();
    const client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!, archives = ledger.loadNutritionDraftArchiveWeeks(client);
    target.close(); target = null; const after = hash(targetPath); target = new DatabaseSync(targetPath);
    for (const rows of Object.values(data.nutrition.tables)) if (rows !== null) (rows as unknown[]).reverse();
    const reordered = { ...data.nutrition, tables: Object.fromEntries(Object.entries(data.nutrition.tables).map(([table, rows]) => [table, rows?.map((r) => Object.fromEntries(Object.entries(r).reverse())) ?? null])) as typeof data.nutrition.tables };
    const reopened = prepareCandidateIdentityLedger(target, exact, options);
    reopened.stageClientNutrition([...data.cards].reverse(), null, [], [], plans, executions, data.measurements, reordered, () => { throw new Error("reuse every ID"); });
    assert.deepEqual(reopened.loadNutritionDraftEntries(), entries); assert.deepEqual(reopened.loadNutritionDraftArchiveWeeks(client), archives);
    target.close(); target = null; assert.equal(hash(targetPath), after);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), before);
  } finally { target?.close(); source?.close(); removeFixtureDirectory(dir, "athlete-r04-nutrition-"); }
});

test("ordinary 3.x backup restores mapped catalog/recipe/food facts; catalog editing preserves historic totals and water-only days remain unaccounted", () => fixture(async (source, target) => {
  seedCalculator(source);
  const { ledger } = stage(source, target), client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
  // This proof covers existing native D01 facts; archive production storage is a separate open requirement.
  assert.equal(target.prepare("SELECT count(*) AS n FROM r04_nutrition_archive_weeks").get()?.n, 0);
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-nutrition-backup-")), live = join(dir, "live.db"), restored = join(dir, "restored.db"), backup = join(dir, "copy.atbackup");
  try {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(live))));
    const db = new DatabaseSync(live);
    try {
      db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      for (const name of ["clients", "body_measurements", ...nutritionNativeTables]) for (const row of target.prepare(`SELECT * FROM ${name}`).all()) {
        const keys = Object.keys(row); db.prepare(`INSERT INTO ${name}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...Object.values(row));
      }
      db.exec("COMMIT"); const original = readFileSync(live);
      await createSqliteBackup(db, join(dir, "private.partial"), backup, { backupId: "99999999-9999-4999-8999-999999999999", createdAt: imported });
      assert.deepEqual(readFileSync(live), original);
    } finally { db.close(); }
    const original = readFileSync(backup); await prepareBackupForRestore(backup, restored); assert.deepEqual(readFileSync(backup), original);
    const candidate = new DatabaseSync(restored, { readOnly: true });
    try {
      for (const name of ["clients", "body_measurements", ...nutritionNativeTables]) {
        const encoded = (db: DatabaseSync) => db.prepare(`SELECT * FROM ${name}`).all().map((row) => JSON.stringify({ ...row })).sort();
        assert.deepEqual(encoded(candidate), encoded(target), name);
      }
    } finally { candidate.close(); }
    const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(restored))), foods = new DevFoodCatalogRepository(shared, context.targetWorkspaceId),
      recipes = new DevRecipeCatalogRepository(shared, context.targetWorkspaceId), diary = new DevNutritionDiaryRepository(shared, context.targetWorkspaceId),
      calculator = new DevNutritionCalcRepository(shared, context.targetWorkspaceId);
    for (const store of [foods, recipes, diary, calculator]) await store.initialize();
    try {
      const entries = await diary.listEntries(client, day, "2026-03-03"), summary = summarizeDay(day, entries);
      assert.equal(entries.length, 3); assert.equal(summary.totals.kcalX10, 3370);
      assert.deepEqual(await diary.listAccountedDates(client, day, "2026-03-03"), [day]); assert.equal((await diary.listWater(client, day, "2026-03-03")).length, 2);
      assert.equal((await recipes.search())[0]!.ingredients.length, 1);
      assert.deepEqual(await calculator.getProfile(client), { revision: 1, profile: { goal: "LOSS", activity: "VERY_ACTIVE", workoutsPerWeek: 3, minutes: 90, intensity: "HEAVY", stepKcal: 300 } });
      const food = (await foods.search())[0]!; await foods.update(food.id, food.revision, { ...food, name: "Переименовано после переноса", kcalX10: 9000 }, new Date(imported));
      assert.equal(summarizeDay(day, await diary.listEntries(client, day, day)).totals.kcalX10, 3370);
      const check = new DatabaseSync(restored, { readOnly: true });
      try { assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'r04_%'").get()?.n, 0); } finally { check.close(); }
    } finally { for (const store of [calculator, diary, recipes, foods]) await store.close(); }
  } finally { removeFixtureDirectory(dir, "athlete-r04-nutrition-backup-"); }
}));

test("piece quantities and exact unit conversions keep saved totals; unknown macros remain null and explicit zeros remain zero", () => fixture((source, target) => {
  const piece = { id: "piece", name: "Поштучный продукт", brand: "", barcode: "", servingMode: "pieces", gramsPerPiece: 50, calories: 70, protein: null, fat: 0, carbs: 1 };
  const entries = { ...emptyMeals(), breakfast: [{ id: "pieces", productId: "piece", productSnapshot: piece, unit: "pieces", pieceCount: "2", grams: "100", calories: 140, protein: null, fat: 0, carbs: 2, createdAt: time },
    { id: "grams-converted", productId: "piece", productSnapshot: piece, unit: "grams", pieceCount: "2", grams: "100", calories: 140, protein: null, fat: 0, carbs: 2, createdAt: time }] };
  source.prepare("UPDATE nutrition_days SET meals_json=? WHERE client_id='a' AND date_key=?").run(JSON.stringify(entries), day);
  const { result, ledger } = stage(source, target); assert.equal(result.nutritionEntryRows, 3); assert.equal(result.nutritionReviewRepresentations, 0);
  const rows = ledger.loadNutritionDraftEntries().filter((r) => r.name === "Поштучный продукт");
  assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.basis_unit === "PIECE" && r.quantity_x10 === 20 && r.per_protein_x10 === null && r.per_fat_x10 === 0));
  assert.notEqual(rows[0]!.id, rows[1]!.id);
}));

test("empty optional stores stay explicit; zero steps and unsupported flags stay review instead of false missing-success", () => fixture((source, target) => {
  source.exec("UPDATE client_day_facts SET steps='0',training='maybe'; DROP TABLE food_products; DROP TABLE nutrition_recipes; DROP TABLE nutrition_days");
  const { data, result } = stage(source, target); assert.equal(data.nutrition.tables.food_products, null);
  assert.equal(result.nutritionFoodRows, 0); assert.equal(result.nutritionEntryRows, 0); assert.equal(result.nutritionReviewRepresentations, 2);
  assert.equal(target.prepare("SELECT count(*) AS n FROM nutrition_daily_steps").get()?.n, 0);
  const saved = JSON.parse(receipt(target).source_json as string) as { tables: { client_day_facts: string[] } };
  assert.equal((JSON.parse(saved.tables.client_day_facts[0]!) as { steps: string }).steps, "0");
}));

test("missing legacy diary units use the proved v2 grams fallback; an unknown explicit unit never becomes grams silently", async () => {
  for (const unknown of [false, true]) await fixture((source, target) => {
    const entry = meal("old-shape");
    Reflect.deleteProperty(entry.productSnapshot, "servingMode"); Reflect.deleteProperty(entry, "unit");
    if (unknown) Object.assign(entry, { unit: "unrecognized" });
    source.prepare("UPDATE nutrition_days SET meals_json=? WHERE client_id='a' AND date_key=?").run(JSON.stringify({ ...emptyMeals(), breakfast: [entry] }), day);
    const { result, ledger } = stage(source, target);
    assert.equal(result.nutritionEntryRows, unknown ? 1 : 2); assert.equal(result.nutritionReviewRepresentations, unknown ? 1 : 0);
    if (!unknown) assert.ok(ledger.loadNutritionDraftEntries().every((r) => r.basis_unit === "G" && r.quantity_x10 === 174));
  });
});

test("ID allocation collisions abort every owner instead of being converted into recoverable value reviews", () => fixture((source, target) => {
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options), next = allocator(); let injected = false;
  assert.throws(() => ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, () => {
    if (!injected && target.prepare("SELECT count(*) AS n FROM r04_measurement_receipt").get()?.n === 1) {
      injected = true; return target.prepare("SELECT id FROM clients LIMIT 1").get()!.id as string;
    }
    return next();
  }), /IDENTITY_COLLISION/u);
  assert.equal(injected, true);
  for (const name of ["clients", "body_measurements", "food_products", "r04_nutrition_ids"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0);
}));

test("saved calculator parameters map by owner with explicit zero, without creating targets or anthropometric facts", () => fixture((source, target) => {
  seedCalculator(source);
  source.prepare("UPDATE client_kbju_state SET profile_json=? WHERE client_id='a'").run(JSON.stringify({ ...calcProfile(),
    gender: "Женский", age: "39", height: "170", weight: "99.9", fatPercent: "17.3" }));
  const { result, ledger } = stage(source, target);
  assert.equal(result.nutritionCalcProfileRows, 2); assert.equal(result.nutritionReviewRepresentations, 1);
  const clients = ledger.loadClientDraftIds().clients, a = clients.get(JSON.stringify([context.accountScope, "a"]))!, b = clients.get(JSON.stringify([context.accountScope, "b"]))!;
  assert.equal(target.prepare("SELECT goal FROM nutrition_calc_profiles WHERE client_id=?").get(a)?.goal, "LOSS");
  assert.equal(target.prepare("SELECT step_kcal FROM nutrition_calc_profiles WHERE client_id=?").get(b)?.step_kcal, 0);
  assert.equal(target.prepare("SELECT workouts_per_week FROM nutrition_calc_profiles WHERE client_id=?").get(b)?.workouts_per_week, 0);
  assert.equal(target.prepare("SELECT count(*) AS n FROM body_measurements").get()?.n, 1);
  assert.equal(target.prepare("SELECT value_x10 FROM body_measurements").get()?.value_x10, 801);
  for (const name of ["nutrition_target_versions", "nutrition_target_days", "nutrition_target_exceptions"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0);
  const representations = JSON.parse(receipt(target).target_json as string).representations as { issues: string[]; metadata: Record<string, unknown> }[];
  const body = representations.find((r) => r.issues.includes("UNDATED_CALCULATOR_BODY_INPUT_STORAGE_REQUIRED"))!;
  assert.deepEqual(body.metadata.inputs, { gender: "Женский", age: "39", height: "170", weight: "99.9", fatPercent: "17.3" });
  assert.equal(body.metadata.datePrecision, "UNKNOWN"); assert.deepEqual(body.metadata.targetMeasurementIds, []);
}));

test("unknown, blank, missing, fractional and out-of-range calculator parameters stay review instead of receiving defaults or clamping", async () => {
  for (const patch of [{ workouts: "" }, { workouts: null }, { workouts: "3.1" }, { workouts: "22" }, { workoutDuration: "0" },
    { workoutDuration: "601" }, { deficit: "1001" }, { deficit: "-300" }, { activity: "Новая активность" }, { goal: "Рекомпозиция" },
    { workoutIntensity: "Другая" }, { workouts: 3 }, { workouts: "9007199254740993" }]) await fixture((source, target) => {
    seedCalculator(source); source.prepare("UPDATE client_kbju_state SET profile_json=? WHERE client_id='a'").run(JSON.stringify({ ...calcProfile(), ...patch }));
    const { result } = stage(source, target); assert.equal(result.nutritionCalcProfileRows, 1); assert.equal(result.nutritionReviewRepresentations, 1);
    assert.equal(target.prepare("SELECT count(*) AS n FROM food_diary_entries").get()?.n, 4);
    assert.match(receipt(target).source_json as string, /profile_json/u);
  });
});

test("all proved calculator enum values and exact integer decimal forms retain their values", async () => {
  for (const [goal, activity, workoutIntensity, expected] of [
    ["Похудение", "Сидячий", "Легкая", ["LOSS", "SEDENTARY", "LIGHT"]],
    ["Поддержание", "Умеренный", "Средняя", ["MAINTENANCE", "MODERATE", "MEDIUM"]],
    ["Набор", "Активный", "Тяжелая", ["GAIN", "ACTIVE", "HEAVY"]],
  ] as const) await fixture((source, target) => {
    seedCalculator(source); source.prepare("UPDATE client_kbju_state SET profile_json=? WHERE client_id='a'").run(JSON.stringify({ ...calcProfile(),
      goal, activity, workoutIntensity, workouts: "03.00", workoutDuration: "90,0", deficit: "000300" }));
    const { ledger } = stage(source, target), client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
    const row = target.prepare("SELECT * FROM nutrition_calc_profiles WHERE client_id=?").get(client)!;
    assert.deepEqual([row.goal, row.activity, row.intensity], expected); assert.deepEqual([row.workouts_per_week, row.workout_minutes, row.step_kcal], [3, 90, 300]);
    assert.equal(row.updated_at, imported);
  });
});

test("manual macro inputs retain original fractions/zero/partial presence without rounding or inventing effective dates and calories", () => fixture((source, target) => {
  seedCalculator(source);
  const manual = '{"protein":"120.55","fat":"0","other":"retain","carbs":null}';
  source.prepare("UPDATE client_kbju_state SET manual_kbju_json=? WHERE client_id='a'").run(manual);
  const { result } = stage(source, target); assert.equal(result.nutritionCalcProfileRows, 2);
  const manifest = JSON.parse(receipt(target).target_json as string), items = manifest.representations as { issues: string[]; metadata: Record<string, unknown> }[];
  const representation = items.find((r) => r.issues.includes("UNDATED_MANUAL_MACRO_STORAGE_REQUIRED"))!;
  assert.deepEqual(representation.metadata.values, { protein: "120.55", fat: "0", carbs: null });
  assert.deepEqual(representation.metadata.unknownFields, ["other"]); assert.equal(representation.metadata.effectiveFrom, null);
  assert.equal(representation.metadata.targetVersionId, null); assert.ok(representation.issues.includes("MANUAL_MACRO_FIELDS_UNSUPPORTED"));
  const raw = JSON.parse(receipt(target).source_json as string); assert.ok(raw.tables.client_kbju_state.some((r: string) => JSON.parse(r).manual_kbju_json === manual));
  assert.equal(target.prepare("SELECT count(*) AS n FROM nutrition_target_versions").get()?.n, 0);
}));

test("broken calculator JSON and manual JSON are independent and never reset valid saved parameters", async () => {
  for (const brokenProfile of [true, false]) await fixture((source, target) => {
    seedCalculator(source);
    source.prepare(`UPDATE client_kbju_state SET ${brokenProfile ? "profile_json" : "manual_kbju_json"}=? WHERE client_id='a'`).run("{broken");
    if (brokenProfile) source.prepare("UPDATE client_kbju_state SET manual_kbju_json=? WHERE client_id='a'").run('{"protein":"100"}');
    const { result } = stage(source, target); assert.equal(result.nutritionCalcProfileRows, brokenProfile ? 1 : 2);
    assert.match(receipt(target).target_json as string, /NUTRITION_JSON_INVALID/u);
    if (brokenProfile) assert.match(receipt(target).target_json as string, /UNDATED_MANUAL_MACRO_STORAGE_REQUIRED/u);
    assert.equal(target.prepare("SELECT count(*) AS n FROM nutrition_target_versions").get()?.n, 0);
  });
});

test("calculator input is frozen with the owner snapshot and subsequent source/target edits are rejected", () => fixture((source, target) => {
  seedCalculator(source);
  const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator(), (phase) => {
    if (phase === "after-ids") Object.assign(data.nutrition.tables.client_kbju_state![0]!, { profile_json: "injected" });
  });
  assert.doesNotMatch(receipt(target).source_json as string, /injected/u);
  source.prepare("UPDATE client_kbju_state SET manual_kbju_json=? WHERE client_id='a'").run('{"fat":"50"}');
  const changed = input(source);
  assert.throws(() => ledger.stageClientNutrition(changed.cards, null, [], [], plans, executions, changed.measurements, changed.nutrition, allocator()), /PARITY_MISMATCH/u);
  target.exec("UPDATE nutrition_calc_profiles SET step_kcal=123"); assert.throws(() => ledger.loadNutritionDraftEntries(), /PARITY_MISMATCH/u);
}));

test("nutrition V3 rejects an older nutrition job and unsupported manifest versions", () => fixture((source, target) => {
  seedCalculator(source); const { ledger } = stage(source, target);
  target.exec("UPDATE r04_candidate_identity SET context_json=replace(context_json,'NUTRITION_REHEARSAL_V3','NUTRITION_REHEARSAL_V2')");
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /CONTEXT_MISMATCH/u);
  target.exec("UPDATE r04_candidate_identity SET context_json=replace(context_json,'NUTRITION_REHEARSAL_V2','NUTRITION_REHEARSAL_V3')");
  const manifest = JSON.parse(receipt(target).target_json as string); manifest.projectionVersion = 2; const json = JSON.stringify(manifest);
  target.prepare("UPDATE r04_nutrition_receipt SET target_json=?,target_sha256=?").run(json, createHash("sha256").update(json).digest("hex"));
  assert.throws(() => ledger.loadNutritionDraftEntries(), /PARITY_MISMATCH/u);
}));

test("archive snapshots retain physical versions and overlapping current stores without creating or changing daily facts", () => fixture((source, target) => {
  seedArchives(source); const { result, ledger } = stage(source, target);
  assert.equal(result.nutritionArchiveWeekRows, 3); assert.equal(result.finalizable, false);
  assert.equal(result.nutritionEntryRows, 4); assert.equal(result.weightMeasurementRows, 1); assert.equal(result.nutritionReviewRepresentations, 3);
  const client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!, weeks = ledger.loadNutritionDraftArchiveWeeks(client);
  assert.equal(weeks.length, 2); const detail = weeks.find((w) => w.days.length)!; const summary = weeks.find((w) => !w.days.length)!;
  assert.deepEqual(detail.aggregates.avg_weight, { state: "VALUE", sourceDecimal: "80.125" });
  assert.deepEqual(detail.aggregates.avg_steps, { state: "VALUE", sourceDecimal: "1234.5" });
  assert.deepEqual(detail.aggregates.protein, { state: "UNKNOWN" }); assert.deepEqual(detail.aggregates.fat, { state: "VALUE", sourceDecimal: "0" });
  assert.deepEqual(detail.days[0]!.values.weight, { state: "VALUE", sourceDecimal: "81.25" });
  assert.deepEqual(detail.days[0]!.training, { state: "VALUE", value: "NO" });
  assert.equal(summary.detailShape, "LEGACY_EMPTY_OBJECT"); assert.equal(summary.days.length, 0);
  assert.deepEqual(detail.overlappingArchiveIds, [summary.id]); assert.deepEqual(summary.overlappingArchiveIds, [detail.id]);
  assert.deepEqual(detail.currentSourceOverlap, [{ localDate: day, stores: ["client_day_facts", "nutrition_days"] }]);
  assert.equal(target.prepare("SELECT value_x10 FROM body_measurements").get()?.value_x10, 801);
  assert.equal(target.prepare("SELECT done FROM nutrition_daily_workout_marks").get()?.done, 1);
  assert.ok(weeks.every((w) => w.semantics === "HISTORICAL_SNAPSHOT_NOT_DAILY_FACTS"));
  assert.match(receipt(target).target_json as string, /ARCHIVE_PRODUCTION_STORAGE_REQUIRED/u);
}));

test("archive access is scoped to the mapped client and identical other-client snapshots keep independent IDs", () => fixture((source, target) => {
  seedArchives(source); const { ledger } = stage(source, target), clients = ledger.loadClientDraftIds().clients;
  const a = clients.get(JSON.stringify([context.accountScope, "a"]))!, b = clients.get(JSON.stringify([context.accountScope, "b"]))!;
  const first = ledger.loadNutritionDraftArchiveWeeks(a), second = ledger.loadNutritionDraftArchiveWeeks(b);
  assert.equal(second.length, 1); assert.ok(first.every((w) => w.clientId === a)); assert.equal(second[0]!.clientId, b);
  assert.deepEqual(second[0]!.overlappingArchiveIds, []); assert.notEqual(first[0]!.id, second[0]!.id);
  assert.notEqual(first.find((w) => w.days.length)!.days[0]!.id, second[0]!.days[0]!.id);
  assert.throws(() => ledger.loadNutritionDraftArchiveWeeks("a"), /OWNER_INVALID/u);
  assert.throws(() => ledger.loadNutritionDraftArchiveWeeks("foreign-target"), /OWNER_INVALID/u);
}));

test("archived JSON numbers retain exact source tokens and never accept numeric strings or forged numeric wrappers as numbers", () => fixture((source, target) => {
  seedArchives(source);
  source.prepare("UPDATE nutrition_archive_weeks SET days_json=? WHERE id='archive-a'").run('[{"dateKey":"2026-03-01","weight":80.1234567890123456789,"steps":9007199254740993,"calories":1e-30,"protein":"100","fat":0,"carbs":{"source":"20"},"training":"Да"}]');
  const { ledger } = stage(source, target), client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
  const record = ledger.loadNutritionDraftArchiveWeeks(client).find((w) => w.days.length)!.days[0]!;
  assert.deepEqual(record.values.weight, { state: "VALUE", sourceDecimal: "80.1234567890123456789" });
  assert.deepEqual(record.values.steps, { state: "VALUE", sourceDecimal: "9007199254740993" });
  assert.deepEqual(record.values.calories, { state: "VALUE", sourceDecimal: "1e-30" });
  assert.deepEqual(record.values.protein, { state: "UNSUPPORTED" }); assert.deepEqual(record.values.carbs, { state: "UNSUPPORTED" });
  assert.deepEqual(record.values.fatPercent, { state: "ABSENT" }); assert.deepEqual(record.values.fat, { state: "VALUE", sourceDecimal: "0" });
}));

test("duplicate archived dates, invalid dates and non-object elements retain positions and IDs instead of becoming merged daily facts", () => fixture((source, target) => {
  seedArchives(source); const raw = [{ dateKey: day, weight: 80 }, { dateKey: day, weight: 81 }, { dateKey: "2026-02-30", calories: 100 }, null,
    { dateKey: "2026-01-01", training: "unknown", newField: "preserve" }];
  source.prepare("UPDATE nutrition_archive_weeks SET days_json=? WHERE id='archive-a'").run(JSON.stringify(raw));
  const { ledger, result } = stage(source, target), client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
  const days = ledger.loadNutritionDraftArchiveWeeks(client).find((w) => w.days.length)!.days;
  assert.equal(days.length, 5); assert.equal(new Set(days.map((d) => d.id)).size, 5); assert.deepEqual(days.map((d) => d.position), [0, 1, 2, 3, 4]);
  assert.ok(days[0]!.issues.includes("DUPLICATE_DAY_DATE")); assert.ok(days[1]!.issues.includes("DUPLICATE_DAY_DATE"));
  assert.equal(days[2]!.localDate, null); assert.ok(days[3]!.issues.includes("DAY_SHAPE_UNSUPPORTED"));
  assert.ok(days[4]!.issues.includes("DAY_OUTSIDE_PERIOD")); assert.ok(days[4]!.issues.includes("TRAINING_FLAG_UNSUPPORTED"));
  assert.deepEqual(days[4]!.unknownFields, ["newField"]); assert.equal(result.weightMeasurementRows, 1); assert.equal(result.nutritionEntryRows, 4);
}));

test("unreadable archive details, unknown shapes and missing fields preserve weekly summaries without pretending they have known empty days", async () => {
  for (const details of ["{broken", '{"days":[]}', "null", "123"]) await fixture((source, target) => {
    seedArchives(source); source.prepare("UPDATE nutrition_archive_weeks SET days_json=?,start_date='invalid',saved_at='' WHERE id='archive-a'").run(details);
    const { ledger } = stage(source, target), client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
    const week = ledger.loadNutritionDraftArchiveWeeks(client).find((w) => w.startDate === null)!;
    assert.equal(week.detailShape, "UNSUPPORTED"); assert.equal(week.sourceSavedAt, null); assert.equal(week.days.length, 0);
    assert.deepEqual(week.aggregates.avg_cal, { state: "VALUE", sourceDecimal: "2222.25" });
    assert.ok(week.issues.includes("SAVED_TIME_UNKNOWN")); assert.match(receipt(target).source_json as string, /days_json/u);
  });
});

test("archive source ownership and duplicate physical keys abort all prior owners", async () => {
  for (const mode of ["owner", "duplicate"]) await fixture((source, target) => {
    seedArchives(source); const data = input(source);
    if (mode === "owner") Object.assign(data.nutrition.tables.nutrition_archive_weeks![0]!, { client_id: "foreign" });
    else (data.nutrition.tables.nutrition_archive_weeks as unknown[]).push(structuredClone(data.nutrition.tables.nutrition_archive_weeks![0]!));
    const ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator()), /OWNER_INVALID|DUPLICATE_SOURCE_KEY/u);
    for (const name of ["clients", "body_measurements", "food_diary_entries", "r04_nutrition_archive_weeks", "r04_nutrition_ids"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0);
  });
});

test("archive snapshots are frozen before owner callbacks and source/target mutations block reuse and guarded reads", () => fixture((source, target) => {
  seedArchives(source); const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator(), (phase) => {
    if (phase === "after-ids") Object.assign(data.nutrition.tables.nutrition_archive_weeks![0]!, { days_json: "injected" });
  });
  assert.doesNotMatch(receipt(target).source_json as string, /injected/u);
  source.exec("UPDATE nutrition_archive_weeks SET label='changed'"); const changed = input(source);
  assert.throws(() => ledger.stageClientNutrition(changed.cards, null, [], [], plans, executions, changed.measurements, changed.nutrition, allocator()), /PARITY_MISMATCH/u);
  const client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
  target.exec("UPDATE r04_nutrition_archive_weeks SET payload_json=json_set(payload_json,'$.label','modified')");
  assert.throws(() => ledger.loadNutritionDraftArchiveWeeks(client), /PARITY_MISMATCH/u);
}));

test("archive day ID collisions escape JSON handling and roll back the full job", () => fixture((source, target) => {
  seedArchives(source); const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options), next = allocator(); let injected = false;
  assert.throws(() => ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, () => {
    const week = target.prepare("SELECT target_id FROM r04_nutrition_ids WHERE kind='ARCHIVE_WEEK' LIMIT 1").get();
    if (week && !injected) { injected = true; return week.target_id as string; } return next();
  }), /IDENTITY_COLLISION/u);
  assert.equal(injected, true);
  for (const name of ["clients", "body_measurements", "food_diary_entries", "r04_nutrition_archive_weeks", "r04_nutrition_ids"]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0);
}));
