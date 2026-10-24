import type { DatabaseSync } from "node:sqlite";

export const time = "2026-03-01T12:00:00.000Z", day = "2026-03-01";
const context = { sourceWorkspaceId: "source-workspace" };
function snapshot(id = "p", historical = false) { return { id, name: historical ? "Историческое имя" : "Сегодняшнее имя", brand: "", barcode: "", servingMode: "grams", gramsPerPiece: 0,
  calories: historical ? 100 : 300, protein: historical ? 5 : 10, fat: historical ? 1 : 5, carbs: historical ? 10 : 30 }; }
export function meal(id: string, historical = true) { return { id, productId: "p", productSnapshot: snapshot("p", historical), grams: historical ? "17.4" : "100", unit: "grams", pieceCount: "",
  calories: historical ? 17 : 300, protein: historical ? 0.9 : 10, fat: historical ? 0.2 : 5, carbs: historical ? 1.7 : 30, createdAt: time }; }
export const emptyMeals = () => ({ breakfast: [] as unknown[], lunch: [] as unknown[], dinner: [] as unknown[], snack: [] as unknown[] });
export const calcProfile = () => ({ goal: "Похудение", activity: "Очень активный", workouts: "3", workoutDuration: "90", workoutIntensity: "Тяжелая", deficit: "300" });
export function seedCalculator(db: DatabaseSync) {
  db.exec("CREATE TABLE client_kbju_state(client_id TEXT PRIMARY KEY,profile_json TEXT,manual_kbju_json TEXT,updated_at TEXT)");
  for (const client of ["a", "b"]) db.prepare("INSERT INTO client_kbju_state VALUES(?,?,?,?)").run(client,
    JSON.stringify(client === "a" ? calcProfile() : { ...calcProfile(), goal: "Поддержание", workouts: "0", deficit: "0" }), '{"protein":"","fat":"","carbs":""}', time);
}
export function seedArchives(db: DatabaseSync) {
  db.exec(`CREATE TABLE nutrition_archive_weeks(id TEXT PRIMARY KEY,client_id TEXT,start_date TEXT,end_date TEXT,label TEXT,saved_at TEXT,
    avg_weight REAL,avg_steps REAL,avg_cal REAL,avg_fat_percent REAL,train_days INTEGER,protein REAL,fat REAL,carbs REAL,days_json TEXT)`);
  const days = JSON.stringify([{ dateKey: day, weight: 81.25, steps: 0, calories: 500, fatPercent: null, training: "Нет", protein: null, fat: 0, carbs: 20 }]);
  for (const [id, client, start, end, detail] of [["archive-a", "a", "2026-02-23", day, days],
    ["archive-overlap", "a", "2026-02-24", "2026-03-02", "{}"], ["archive-b", "b", "2026-02-23", day, days]]) {
    db.prepare("INSERT INTO nutrition_archive_weeks VALUES(?,?,?,?,?,?,80.125,1234.5,2222.25,0,0,NULL,0,20,?)").run(id!, client!, start!, end!, `Снимок ${id}`, time, detail!);
  }
}
export function seedLegacyNutritionSource(db: DatabaseSync, options: { readonly existingOwners?: boolean; readonly existingDays?: boolean } = {}) {
  if (!options.existingOwners) db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT,weight TEXT);`);
  db.exec(`CREATE TABLE food_products(id TEXT PRIMARY KEY,name TEXT,brand TEXT,barcode TEXT,serving_mode TEXT,grams_per_piece REAL,calories REAL,protein REAL,fat REAL,carbs REAL,favorite INTEGER,created_at TEXT,updated_at TEXT,fiber REAL,sugar REAL,sodium REAL,cholesterol REAL);
    CREATE TABLE nutrition_recipes(id TEXT PRIMARY KEY,name TEXT,description TEXT,servings TEXT,items_json TEXT,calories REAL,protein REAL,fat REAL,carbs REAL,saved_to_cookbook INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE nutrition_days(client_id TEXT,date_key TEXT,meals_json TEXT,water_ml INTEGER,meals_recorded INTEGER,updated_at TEXT,extra_text TEXT,PRIMARY KEY(client_id,date_key));`);
  if (!options.existingDays) db.exec(`CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT,updated_at TEXT,PRIMARY KEY(client_id,date_key));`);
  if (!options.existingOwners) for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','',?,'80.1')").run(id, context.sourceWorkspaceId, `Синтетический ${id}`, time, time, '{"trainerNotes":"Сохранить рабочую заметку"}');
  db.prepare("INSERT INTO food_products VALUES('p','Сегодняшнее имя','','','grams',0,300,10,5,30,1,?,?,0,0,0,0)").run(time, time);
  const item = { ...meal("unused", false), productId: "p" };
  db.prepare("INSERT INTO nutrition_recipes VALUES('r','Рецепт','Описание','2',?,300,10,5,30,1,?,?)").run(JSON.stringify([item]), time, time);
  const missing = { ...meal("gone-entry", false), productId: "gone", productSnapshot: { ...snapshot("gone"), name: "Удалённый продукт", calories: 20, protein: null, fat: 0, carbs: 1 }, calories: 20, protein: null, fat: 0, carbs: 1 };
  for (const [client, date, meals, water] of [["a", day, { breakfast: [meal("old")], lunch: [meal("from-recipe", false)], dinner: [missing], snack: [] }, 500],
    ["b", day, { ...emptyMeals(), breakfast: [meal("other-client")] }, 0], ["a", "2026-03-02", emptyMeals(), 1200], ["a", "2026-03-03", emptyMeals(), 0]] as const) {
    db.prepare("INSERT INTO nutrition_days VALUES(?,?,?,?,1,?,'source extras preserved')").run(client, date, JSON.stringify(meals), water, time);
  }
  if (!options.existingDays) db.prepare("INSERT INTO client_day_facts VALUES('a',?,'80.1','1234','Да',?)").run(day, time);
}
