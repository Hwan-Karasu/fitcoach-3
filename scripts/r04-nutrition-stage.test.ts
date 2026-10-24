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
import { nutritionTargetTables } from "./r04/LegacyNutritionStage.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource } from "./r04/LegacyPlansSourceReader.ts";
import { EXECUTION_SOURCE_TABLES, type LegacyExecutionSource } from "./r04/LegacyExecutionSourceReader.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { DevFoodCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevRecipeCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevRecipeCatalogRepository.ts";
import { DevNutritionDiaryRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
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
  const { result } = stage(source, target); assert.equal(result.nutritionReviewRepresentations, 3);
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
    const data = input(source), ledger = prepareCandidateIdentityLedger(target, context, options), occurrence = phases.slice(0, index + 1).filter((p) => p === phase).length; let seen = 0;
    assert.throws(() => ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator(), (p) => {
      if (p === phase && ++seen === occurrence) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const name of ["clients", "body_measurements", "r04_work_notes", "r04_measurement_ids", "r04_measurement_receipt", "r04_nutrition_ids", "r04_nutrition_receipt", ...nutritionTargetTables]) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n, 0, name);
    assert.equal(ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator()).nutritionEntryRows, 4);
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
    source = new DatabaseSync(sourcePath); seed(source); source.close(); source = null; const before = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const data = input(source), exact = { ...context, sourceSha256: before };
    target = new DatabaseSync(targetPath); const ledger = prepareCandidateIdentityLedger(target, exact, options);
    ledger.stageClientNutrition(data.cards, null, [], [], plans, executions, data.measurements, data.nutrition, allocator()); const entries = ledger.loadNutritionDraftEntries();
    target.close(); target = null; const after = hash(targetPath); target = new DatabaseSync(targetPath);
    for (const rows of Object.values(data.nutrition.tables)) if (rows !== null) (rows as unknown[]).reverse();
    const reordered = { ...data.nutrition, tables: Object.fromEntries(Object.entries(data.nutrition.tables).map(([table, rows]) => [table, rows?.map((r) => Object.fromEntries(Object.entries(r).reverse())) ?? null])) as typeof data.nutrition.tables };
    const reopened = prepareCandidateIdentityLedger(target, exact, options);
    reopened.stageClientNutrition([...data.cards].reverse(), null, [], [], plans, executions, data.measurements, reordered, () => { throw new Error("reuse every ID"); });
    assert.deepEqual(reopened.loadNutritionDraftEntries(), entries); target.close(); target = null; assert.equal(hash(targetPath), after);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), before);
  } finally { target?.close(); source?.close(); removeFixtureDirectory(dir, "athlete-r04-nutrition-"); }
});

test("ordinary 3.x backup restores mapped catalog/recipe/food facts; catalog editing preserves historic totals and water-only days remain unaccounted", () => fixture(async (source, target) => {
  const { ledger } = stage(source, target), client = ledger.loadClientDraftIds().clients.get(JSON.stringify([context.accountScope, "a"]))!;
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-nutrition-backup-")), live = join(dir, "live.db"), restored = join(dir, "restored.db"), backup = join(dir, "copy.atbackup");
  try {
    await prepareProductionDatabase(new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(live))));
    const db = new DatabaseSync(live);
    try {
      db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      for (const name of ["clients", "body_measurements", ...nutritionTargetTables]) for (const row of target.prepare(`SELECT * FROM ${name}`).all()) {
        const keys = Object.keys(row); db.prepare(`INSERT INTO ${name}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...Object.values(row));
      }
      db.exec("COMMIT"); const original = readFileSync(live);
      await createSqliteBackup(db, join(dir, "private.partial"), backup, { backupId: "99999999-9999-4999-8999-999999999999", createdAt: imported });
      assert.deepEqual(readFileSync(live), original);
    } finally { db.close(); }
    const original = readFileSync(backup); await prepareBackupForRestore(backup, restored); assert.deepEqual(readFileSync(backup), original);
    const candidate = new DatabaseSync(restored, { readOnly: true });
    try {
      for (const name of ["clients", "body_measurements", ...nutritionTargetTables]) {
        const encoded = (db: DatabaseSync) => db.prepare(`SELECT * FROM ${name}`).all().map((row) => JSON.stringify({ ...row })).sort();
        assert.deepEqual(encoded(candidate), encoded(target), name);
      }
    } finally { candidate.close(); }
    const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(restored))), foods = new DevFoodCatalogRepository(shared, context.targetWorkspaceId),
      recipes = new DevRecipeCatalogRepository(shared, context.targetWorkspaceId), diary = new DevNutritionDiaryRepository(shared, context.targetWorkspaceId);
    for (const store of [foods, recipes, diary]) await store.initialize();
    try {
      const entries = await diary.listEntries(client, day, "2026-03-03"), summary = summarizeDay(day, entries);
      assert.equal(entries.length, 3); assert.equal(summary.totals.kcalX10, 3370);
      assert.deepEqual(await diary.listAccountedDates(client, day, "2026-03-03"), [day]); assert.equal((await diary.listWater(client, day, "2026-03-03")).length, 2);
      assert.equal((await recipes.search())[0]!.ingredients.length, 1);
      const food = (await foods.search())[0]!; await foods.update(food.id, food.revision, { ...food, name: "Переименовано после переноса", kcalX10: 9000 }, new Date(imported));
      assert.equal(summarizeDay(day, await diary.listEntries(client, day, day)).totals.kcalX10, 3370);
      const check = new DatabaseSync(restored, { readOnly: true });
      try { assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'r04_%'").get()?.n, 0); } finally { check.close(); }
    } finally { for (const store of [diary, recipes, foods]) await store.close(); }
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
