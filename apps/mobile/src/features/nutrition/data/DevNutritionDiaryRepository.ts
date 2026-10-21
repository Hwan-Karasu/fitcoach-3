import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import { validateSavedMeal, type SavedMeal, type SavedMealInput } from "../domain/SavedMeal.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import { MEAL_SLOTS, type CopyEntriesRequest, type CopyEntriesResult, type DiaryEntry, type DiaryEntryInput, type EatenEntry, type MealSlot, type UsageSummary, type WaterDay } from "../domain/DiaryModel.ts";
import { assertDate, assertOverride, assertQuantity, assertSlot, assertWater, effectiveNutrients, normalizeSnapshot } from "../domain/DiaryRules.ts";
import type { Nutrients } from "../domain/FoodModel.ts";
import type { FoodBasisUnit } from "../domain/FoodModel.ts";
import { scaleNutrients } from "../domain/FoodRules.ts";
import type { FoodSnapshot } from "../domain/FoodSnapshot.ts";
import type { DiaryCommittedChange, NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import { DEV_NUTRITION_LEDGER, devNutritionCatalog } from "./DevNutritionCatalog.ts";

interface EntryRow {
  readonly id: string;
  readonly clientId: string;
  readonly localDate: string;
  readonly slot: MealSlot;
  readonly position: number;
  readonly sourceKind: "FOOD" | "RECIPE";
  readonly sourceId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly unit: FoodBasisUnit;
  readonly amountX10: number;
  readonly kcalX10: number | null;
  readonly proteinX10: number | null;
  readonly fatX10: number | null;
  readonly carbsX10: number | null;
  readonly quantityX10: number;
  readonly ingredientsJson: string;
  readonly overrideBase: number | null;
  readonly overrideKcal: number | null;
  readonly overrideProtein: number | null;
  readonly overrideFat: number | null;
  readonly overrideCarbs: number | null;
  readonly revision: number;
}

const columns = `id, client_id AS clientId, local_date AS localDate, slot, position, source_kind AS sourceKind, source_id AS sourceId, name, brand,
  basis_unit AS unit, basis_amount_x10 AS amountX10, per_kcal_x10 AS kcalX10, per_protein_x10 AS proteinX10, per_fat_x10 AS fatX10,
  per_carbs_x10 AS carbsX10, quantity_x10 AS quantityX10, ingredients_json AS ingredientsJson, override_base_quantity_x10 AS overrideBase,
  override_kcal_x10 AS overrideKcal, override_protein_x10 AS overrideProtein, override_fat_x10 AS overrideFat, override_carbs_x10 AS overrideCarbs, revision`;

type NarrowRow = Pick<EntryRow, "localDate" | "slot" | "unit" | "amountX10" | "kcalX10" | "proteinX10" | "fatX10" | "carbsX10" | "quantityX10" | "overrideBase" | "overrideKcal"
  | "overrideProtein" | "overrideFat" | "overrideCarbs">;

/** Единственный расчёт «съедено» записи: по значениям на основу и количеству, с ручной правкой — для полного и узкого чтения. */
function eatenOf(row: NarrowRow) {
  const perBasis = { kcalX10: row.kcalX10, proteinX10: row.proteinX10, fatX10: row.fatX10, carbsX10: row.carbsX10 };
  const basis = { unit: row.unit, amountX10: row.amountX10 };
  const catalogEaten = scaleNutrients({ ...basis, ...perBasis }, row.quantityX10);
  const override = row.overrideBase === null ? null
    : { baseQuantityX10: row.overrideBase, values: { kcalX10: row.overrideKcal, proteinX10: row.overrideProtein, fatX10: row.overrideFat, carbsX10: row.overrideCarbs } };
  return { perBasis, basis, catalogEaten, override, eaten: effectiveNutrients(catalogEaten, override, row.quantityX10) };
}

/** Порядок приёмов в SQL — как `MEAL_SLOTS`. */
const SLOT_RANK_SQL = "CASE slot WHEN 'BREAKFAST' THEN 0 WHEN 'LUNCH' THEN 1 WHEN 'DINNER' THEN 2 ELSE 3 END";

function toEntry(row: EntryRow): DiaryEntry {
  const { perBasis, basis, catalogEaten, override, eaten } = eatenOf(row);
  // Состав есть только у рецептов: для продуктов `[]` не разбирается.
  const snapshot: FoodSnapshot = { source: { kind: row.sourceKind, id: row.sourceId }, name: row.name, brand: row.brand, basis, perBasis,
    quantityX10: row.quantityX10, eaten,
    ingredients: row.ingredientsJson === "[]" ? [] : JSON.parse(row.ingredientsJson) as FoodSnapshot["ingredients"] };
  return { id: row.id, clientId: row.clientId, localDate: row.localDate, slot: row.slot, position: row.position, snapshot, override, catalogEaten, revision: row.revision };
}

/** Сколько последних квитанций пакетной записи хранится на клиента. */
const RECEIPTS_KEPT = 50;

const slotOrder = (slot: MealSlot) => MEAL_SLOTS.indexOf(slot);

async function byId(tx: SqliteStatementPort, workspaceId: string, clientId: string, id: string): Promise<DiaryEntry> {
  const row = await tx.first<EntryRow>(`SELECT ${columns} FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND id = ?`,
    [workspaceId, clientId, id]);
  if (row === null) throw new Error("DIARY_STALE");
  return toEntry(row);
}

/** Nutrition side of PermanentlyDeleteArchivedClient (§15.7): diary entries and water. */
export const devNutritionClientDeletionParticipant = {
  owner: "nutrition.diary",
  tables: ["dev_food_diary_entries", "dev_water_days", "dev_nutrition_saved_meals", "dev_nutrition_search_queries", "dev_nutrition_batch_commands"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const entries = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const water = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_water_days WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const meals = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_nutrition_saved_meals WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const queries = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_nutrition_search_queries WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const commands = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_nutrition_batch_commands WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    return (entries?.n ?? 0) + (water?.n ?? 0) + (meals?.n ?? 0) + (queries?.n ?? 0) + (commands?.n ?? 0);
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_water_days WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_nutrition_saved_meals WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_nutrition_search_queries WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_nutrition_batch_commands WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Explicitly dev-only new-install store sharing the clients dev file; the clients store must initialize first. */
export class DevNutritionDiaryRepository implements NutritionDiaryPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: DiaryCommittedChange) => void>();
  private readonly mealListeners = new Set<(clientId: string) => void>();

  async listSearchQueries(clientId: string): Promise<readonly string[]> {
    const rows = await this.ready().connection.all<{ query: string }>(`SELECT query FROM dev_nutrition_search_queries
      WHERE workspace_id = ? AND client_id = ? ORDER BY last_used DESC LIMIT 12`, [this.workspaceId, clientId]);
    return rows.map((row) => row.query);
  }
  async rememberSearchQuery(clientId: string, query: string): Promise<void> {
    const text = query.trim().replace(/\s+/gu, " ").slice(0, 120);
    if (text === "") return;
    await this.ready().writer.write(async (tx) => {
      const last = await tx.first<{ value: number | null }>("SELECT max(last_used) AS value FROM dev_nutrition_search_queries WHERE workspace_id = ? AND client_id = ?", [this.workspaceId, clientId]);
      await tx.run(`INSERT INTO dev_nutrition_search_queries (workspace_id, client_id, normalized_query, query, last_used) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, client_id, normalized_query) DO UPDATE SET query = excluded.query, last_used = excluded.last_used`,
      [this.workspaceId, clientId, text.toLocaleLowerCase("ru"), text, (last?.value ?? 0) + 1]);
      await tx.run(`DELETE FROM dev_nutrition_search_queries WHERE workspace_id = ? AND client_id = ? AND normalized_query NOT IN
        (SELECT normalized_query FROM dev_nutrition_search_queries WHERE workspace_id = ? AND client_id = ? ORDER BY last_used DESC LIMIT 12)`, [this.workspaceId, clientId, this.workspaceId, clientId]);
    });
  }

  subscribeSavedMealChanges(listener: (clientId: string) => void): () => void {
    this.mealListeners.add(listener);
    return () => { this.mealListeners.delete(listener); };
  }
  private publishMeals(clientId: string): void {
    for (const listener of this.mealListeners) { try { listener(clientId); } catch { /* Commit is final. */ } }
  }
  async listSavedMeals(clientId: string): Promise<readonly SavedMeal[]> {
    const rows = await this.ready().connection.all<{ id: string; name: string; snapshots: string; revision: number }>(
      `SELECT id, name, snapshots_json AS snapshots, revision FROM dev_nutrition_saved_meals WHERE workspace_id = ? AND client_id = ? ORDER BY name, id`, [this.workspaceId, clientId]);
    return rows.map((row) => ({ ...row, snapshots: (JSON.parse(row.snapshots) as FoodSnapshot[]).map(normalizeSnapshot) }));
  }
  async createSavedMeal(clientId: string, input: SavedMealInput): Promise<SavedMeal> {
    const valid = validateSavedMeal(input);
    const meal = await this.ready().writer.write(async (tx) => {
      const client = await tx.first<{ id: string }>("SELECT id FROM dev_clients WHERE workspace_id = ? AND id = ?", [this.workspaceId, clientId]);
      if (client === null) throw new Error("DIARY_STALE");
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("DIARY_ID_UNAVAILABLE");
      await tx.run("INSERT INTO dev_nutrition_saved_meals (id, workspace_id, client_id, name, snapshots_json, revision) VALUES (?, ?, ?, ?, ?, 1)",
        [id, this.workspaceId, clientId, valid.name, JSON.stringify(valid.snapshots)]);
      return { id, ...valid, revision: 1 };
    });
    this.publishMeals(clientId);
    return meal;
  }
  async updateSavedMeal(clientId: string, id: string, expectedRevision: number, input: SavedMealInput): Promise<SavedMeal> {
    const valid = validateSavedMeal(input);
    await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_nutrition_saved_meals SET name = ?, snapshots_json = ?, revision = revision + 1
        WHERE workspace_id = ? AND client_id = ? AND id = ? AND revision = ?`, [valid.name, JSON.stringify(valid.snapshots), this.workspaceId, clientId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("SAVED_MEAL_STALE");
    });
    this.publishMeals(clientId);
    return { id, ...valid, revision: expectedRevision + 1 };
  }
  async removeSavedMeal(clientId: string, id: string, expectedRevision: number): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      const result = await tx.run("DELETE FROM dev_nutrition_saved_meals WHERE workspace_id = ? AND client_id = ? AND id = ? AND revision = ?", [this.workspaceId, clientId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("SAVED_MEAL_STALE");
    });
    this.publishMeals(clientId);
  }

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

  subscribeCommittedChanges(listener: (change: DiaryCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: DiaryCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  async listEntries(clientId: string, fromDate: string, toDate: string): Promise<readonly DiaryEntry[]> {
    assertDate(fromDate);
    assertDate(toDate);
    const rows = await this.ready().connection.all<EntryRow>(`SELECT ${columns} FROM dev_food_diary_entries
      WHERE workspace_id = ? AND client_id = ? AND local_date BETWEEN ? AND ?`, [this.workspaceId, clientId, fromDate, toDate]);
    return rows.map(toEntry).sort((a, b) => a.localDate.localeCompare(b.localDate) || slotOrder(a.slot) - slotOrder(b.slot) || a.position - b.position);
  }

  async listUsageSummaries(clientId: string, slot: MealSlot, toDate: string): Promise<readonly UsageSummary[]> {
    assertDate(toDate);
    assertSlot(slot);
    const { connection } = this.ready();
    // По одной строке на позицию (десятки-сотни), а не на запись дневника: число использований и последняя запись — окном по позиции.
    const latest = await connection.all<EntryRow & { n: number }>(`SELECT * FROM (SELECT ${columns}, COUNT(*) OVER (PARTITION BY source_kind, source_id) AS n,
        ROW_NUMBER() OVER (PARTITION BY source_kind, source_id ORDER BY local_date DESC, ${SLOT_RANK_SQL} DESC, position DESC) AS rn
      FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND local_date <= ?) WHERE rn = 1`, [this.workspaceId, clientId, toDate]);
    const inSlot = await connection.all<EntryRow>(`SELECT * FROM (SELECT ${columns},
        ROW_NUMBER() OVER (PARTITION BY source_kind, source_id ORDER BY local_date DESC, position DESC) AS rn
      FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND local_date <= ? AND slot = ?) WHERE rn = 1`, [this.workspaceId, clientId, toDate, slot]);
    const slotEntries = new Map(inSlot.map((row) => [`${row.sourceKind}:${row.sourceId}`, toEntry(row)]));
    return latest.map((row) => ({ kind: row.sourceKind, id: row.sourceId, count: row.n, latest: toEntry(row), latestInSlot: slotEntries.get(`${row.sourceKind}:${row.sourceId}`) ?? null }));
  }

  async listEatenEntries(clientId: string, fromDate: string, toDate: string): Promise<readonly EatenEntry[]> {
    assertDate(fromDate);
    assertDate(toDate);
    const rows = await this.ready().connection.all<NarrowRow>(`SELECT local_date AS localDate, slot, basis_unit AS unit, basis_amount_x10 AS amountX10, per_kcal_x10 AS kcalX10,
        per_protein_x10 AS proteinX10, per_fat_x10 AS fatX10, per_carbs_x10 AS carbsX10, quantity_x10 AS quantityX10, override_base_quantity_x10 AS overrideBase,
        override_kcal_x10 AS overrideKcal, override_protein_x10 AS overrideProtein, override_fat_x10 AS overrideFat, override_carbs_x10 AS overrideCarbs
      FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND local_date BETWEEN ? AND ?`, [this.workspaceId, clientId, fromDate, toDate]);
    return rows.map((row) => ({ localDate: row.localDate, slot: row.slot, snapshot: { eaten: eatenOf(row).eaten } }));
  }

  async listAccountedDates(clientId: string, fromDate: string, toDate: string): Promise<readonly string[]> {
    assertDate(fromDate);
    assertDate(toDate);
    const rows = await this.ready().connection.all<{ localDate: string }>(`SELECT DISTINCT local_date AS localDate FROM dev_food_diary_entries
      WHERE workspace_id = ? AND client_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date`, [this.workspaceId, clientId, fromDate, toDate]);
    return rows.map((row) => row.localDate);
  }

  async addEntry(clientId: string, input: DiaryEntryInput, now: Date = new Date()): Promise<DiaryEntry> {
    return (await this.addEntries(clientId, [input], now))[0] as DiaryEntry;
  }

  async addEntries(clientId: string, inputs: readonly DiaryEntryInput[], now: Date = new Date(), commandId?: string): Promise<readonly DiaryEntry[]> {
    if (inputs.length === 0) return [];
    const prepared = inputs.map((input) => { assertDate(input.localDate); assertSlot(input.slot); return { input, snapshot: normalizeSnapshot(input.snapshot) }; });
    if (commandId !== undefined && !/^[a-zA-Z0-9:_-]{1,120}$/u.test(commandId)) throw new Error("DIARY_COMMAND_INVALID");
    const payload = JSON.stringify(prepared.map(({ input, snapshot }) => ({ localDate: input.localDate, slot: input.slot, snapshot })));
    let replay = false;
    const created = await this.ready().writer.write(async (tx) => {
      if (commandId !== undefined) {
        const receipt = await tx.first<{ payload: string; result: string }>(`SELECT payload_json AS payload, result_json AS result FROM dev_nutrition_batch_commands
          WHERE workspace_id = ? AND client_id = ? AND command_id = ?`, [this.workspaceId, clientId, commandId]);
        if (receipt !== null) {
          if (receipt.payload !== payload) throw new Error("DIARY_COMMAND_REUSED");
          replay = true;
          return JSON.parse(receipt.result) as readonly DiaryEntry[];
        }
      }
      const result: DiaryEntry[] = [];
      for (const { input, snapshot } of prepared) result.push(await this.insertEntry(tx, clientId, input, snapshot, now));
      if (commandId !== undefined) {
        await tx.run(`INSERT INTO dev_nutrition_batch_commands (workspace_id, client_id, command_id, payload_json, result_json)
          VALUES (?, ?, ?, ?, ?)`, [this.workspaceId, clientId, commandId, payload, JSON.stringify(result)]);
        // Повтор нужен в пределах нескольких секунд: хранятся только последние квитанции клиента (по порядку вставки), иначе JSON росли бы вечно.
        await tx.run(`DELETE FROM dev_nutrition_batch_commands WHERE workspace_id = ? AND client_id = ? AND rowid NOT IN
          (SELECT rowid FROM dev_nutrition_batch_commands WHERE workspace_id = ? AND client_id = ? ORDER BY rowid DESC LIMIT ${RECEIPTS_KEPT})`,
        [this.workspaceId, clientId, this.workspaceId, clientId]);
      }
      return result;
    });
    if (!replay) for (const date of new Set(created.map((entry) => entry.localDate))) this.publish({ clientId, localDate: date });
    return created;
  }

  private async insertEntry(tx: SqliteStatementPort, clientId: string, input: DiaryEntryInput, snapshot: FoodSnapshot, now: Date, override: DiaryEntry["override"] = null): Promise<DiaryEntry> {
    {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("DIARY_ID_UNAVAILABLE");
      const last = await tx.first<{ position: number | null }>(`SELECT max(position) AS position FROM dev_food_diary_entries
        WHERE workspace_id = ? AND client_id = ? AND local_date = ? AND slot = ?`, [this.workspaceId, clientId, input.localDate, input.slot]);
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO dev_food_diary_entries (id, workspace_id, client_id, local_date, slot, position, source_kind, source_id, name, brand,
          basis_unit, basis_amount_x10, per_kcal_x10, per_protein_x10, per_fat_x10, per_carbs_x10, quantity_x10, ingredients_json, revision,
          override_base_quantity_x10, override_kcal_x10, override_protein_x10, override_fat_x10, override_carbs_x10, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.workspaceId, clientId, input.localDate, input.slot, (last?.position ?? -1) + 1, snapshot.source.kind, snapshot.source.id,
        snapshot.name, snapshot.brand, snapshot.basis.unit, snapshot.basis.amountX10, snapshot.perBasis.kcalX10, snapshot.perBasis.proteinX10,
        snapshot.perBasis.fatX10, snapshot.perBasis.carbsX10, snapshot.quantityX10, JSON.stringify(snapshot.ingredients),
        override?.baseQuantityX10 ?? null, override?.values.kcalX10 ?? null, override?.values.proteinX10 ?? null, override?.values.fatX10 ?? null, override?.values.carbsX10 ?? null, stamp, stamp]);
      return byId(tx, this.workspaceId, clientId, id);
    }
  }

  async editEntry(clientId: string, id: string, expectedRevision: number, input: Readonly<{ quantityX10: number; slot: MealSlot; override: Nutrients | "CLEAR" | null; copyToSlots?: readonly MealSlot[] }>, now: Date = new Date()): Promise<DiaryEntry> {
    assertQuantity(input.quantityX10);
    assertSlot(input.slot);
    const copySlots = [...new Set(input.copyToSlots ?? [])].filter((slot) => slot !== input.slot);
    for (const slot of copySlots) assertSlot(slot);
    if (input.override !== null && input.override !== "CLEAR") assertOverride(input.override);
    const updated = await this.ready().writer.write(async (tx) => {
      const current = await byId(tx, this.workspaceId, clientId, id);
      if (current.revision !== expectedRevision) throw new Error("DIARY_STALE");
      let position = current.position;
      if (current.slot !== input.slot) {
        const last = await tx.first<{ position: number | null }>(`SELECT max(position) AS position FROM dev_food_diary_entries
          WHERE workspace_id = ? AND client_id = ? AND local_date = ? AND slot = ?`, [this.workspaceId, clientId, current.localDate, input.slot]);
        position = (last?.position ?? -1) + 1;
      }
      const override = input.override === "CLEAR" ? null : input.override === null ? current.override ?? null
        : { baseQuantityX10: input.quantityX10, values: input.override };
      const result = await tx.run(`UPDATE dev_food_diary_entries SET quantity_x10 = ?, slot = ?, position = ?,
        override_base_quantity_x10 = ?, override_kcal_x10 = ?, override_protein_x10 = ?, override_fat_x10 = ?, override_carbs_x10 = ?,
        revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND client_id = ? AND id = ? AND revision = ?`,
      [input.quantityX10, input.slot, position, override?.baseQuantityX10 ?? null, override?.values.kcalX10 ?? null,
        override?.values.proteinX10 ?? null, override?.values.fatX10 ?? null, override?.values.carbsX10 ?? null,
        now.toISOString(), this.workspaceId, clientId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("DIARY_STALE");
      const edited = await byId(tx, this.workspaceId, clientId, id);
      // Копии — в той же транзакции: сбой любой вставки откатывает и правку самой записи.
      for (const slot of copySlots) await this.insertEntry(tx, clientId, { localDate: edited.localDate, slot, snapshot: edited.snapshot }, normalizeSnapshot({ ...edited.snapshot, quantityX10: edited.snapshot.quantityX10 }), now, edited.override ?? null);
      return edited;
    });
    this.publish({ clientId, localDate: updated.localDate });
    return updated;
  }

  async removeEntry(clientId: string, id: string, expectedRevision: number): Promise<void> {
    let localDate = "";
    await this.ready().writer.write(async (tx) => {
      const current = await byId(tx, this.workspaceId, clientId, id);
      if (current.revision !== expectedRevision) throw new Error("DIARY_STALE");
      localDate = current.localDate;
      await tx.run("DELETE FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND id = ?", [this.workspaceId, clientId, id]);
    });
    this.publish({ clientId, localDate });
  }

  async copyEntries(clientId: string, request: CopyEntriesRequest, now: Date = new Date()): Promise<CopyEntriesResult> {
    assertDate(request.fromDate);
    assertDate(request.toDate);
    if (request.slot !== null) assertSlot(request.slot);
    if (request.targetSlot !== null) { assertSlot(request.targetSlot); if (request.slot === null) throw new Error("DIARY_SLOT_INVALID"); }
    const targetOf = (slot: MealSlot): MealSlot => request.targetSlot ?? slot;
    if (request.fromDate === request.toDate && request.slot !== null && targetOf(request.slot) === request.slot) throw new Error("DIARY_COPY_SAME_TARGET");
    if (request.fromDate === request.toDate && request.slot === null) throw new Error("DIARY_COPY_SAME_TARGET");
    const result = await this.ready().writer.write(async (tx) => {
      const sourceRows = (await tx.all<EntryRow>(`SELECT ${columns} FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND local_date = ?`,
        [this.workspaceId, clientId, request.fromDate])).map(toEntry)
        .filter((entry) => request.slot === null || entry.slot === request.slot)
        .sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot) || a.position - b.position);
      const targetSlots = [...new Set(sourceRows.map((entry) => targetOf(entry.slot)))];
      let replaced = 0;
      const skipped = new Set<MealSlot>();
      for (const slot of targetSlots) {
        const existing = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND local_date = ? AND slot = ?`,
          [this.workspaceId, clientId, request.toDate, slot]);
        if ((existing?.n ?? 0) === 0) continue;
        if (request.mode === "SKIP_FILLED") skipped.add(slot);
        else if (request.mode === "REPLACE") {
          await tx.run(`DELETE FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ? AND local_date = ? AND slot = ?`,
            [this.workspaceId, clientId, request.toDate, slot]);
          replaced += existing?.n ?? 0;
        }
      }
      const next = new Map<MealSlot, number>();
      let copied = 0;
      const stamp = now.toISOString();
      for (const entry of sourceRows) {
        const slot = targetOf(entry.slot);
        if (skipped.has(slot)) continue;
        if (!next.has(slot)) {
          const last = await tx.first<{ position: number | null }>(`SELECT max(position) AS position FROM dev_food_diary_entries
            WHERE workspace_id = ? AND client_id = ? AND local_date = ? AND slot = ?`, [this.workspaceId, clientId, request.toDate, slot]);
          next.set(slot, (last?.position ?? -1) + 1);
        }
        const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
        if (!id) throw new Error("DIARY_ID_UNAVAILABLE");
        const snapshot = entry.snapshot;
        const position = next.get(slot)!;
        next.set(slot, position + 1);
        await tx.run(`INSERT INTO dev_food_diary_entries (id, workspace_id, client_id, local_date, slot, position, source_kind, source_id, name, brand,
            basis_unit, basis_amount_x10, per_kcal_x10, per_protein_x10, per_fat_x10, per_carbs_x10, quantity_x10, ingredients_json,
            override_base_quantity_x10, override_kcal_x10, override_protein_x10, override_fat_x10, override_carbs_x10, revision,
            created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, this.workspaceId, clientId, request.toDate, slot, position, snapshot.source.kind, snapshot.source.id, snapshot.name, snapshot.brand,
          snapshot.basis.unit, snapshot.basis.amountX10, snapshot.perBasis.kcalX10, snapshot.perBasis.proteinX10, snapshot.perBasis.fatX10,
          snapshot.perBasis.carbsX10, snapshot.quantityX10, JSON.stringify(snapshot.ingredients), entry.override?.baseQuantityX10 ?? null, entry.override?.values.kcalX10 ?? null,
          entry.override?.values.proteinX10 ?? null, entry.override?.values.fatX10 ?? null, entry.override?.values.carbsX10 ?? null, stamp, stamp]);
        copied += 1;
      }
      return { copied, replaced };
    });
    if (result.copied > 0 || result.replaced > 0) this.publish({ clientId, localDate: request.toDate });
    return result;
  }

  async previousFoodDate(clientId: string, beforeDate: string, slot: MealSlot | null): Promise<string | null> {
    assertDate(beforeDate);
    if (slot !== null) assertSlot(slot);
    const row = await this.ready().connection.first<{ localDate: string | null }>(`SELECT max(local_date) AS localDate FROM dev_food_diary_entries
      WHERE workspace_id = ? AND client_id = ? AND local_date < ? AND (? IS NULL OR slot = ?)`, [this.workspaceId, clientId, beforeDate, slot, slot]);
    return row?.localDate ?? null;
  }

  async listWater(clientId: string, fromDate: string, toDate: string): Promise<readonly WaterDay[]> {
    assertDate(fromDate);
    assertDate(toDate);
    const rows = await this.ready().connection.all<WaterDay>(`SELECT local_date AS localDate, ml FROM dev_water_days
      WHERE workspace_id = ? AND client_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date`, [this.workspaceId, clientId, fromDate, toDate]);
    return rows.map((row) => ({ localDate: row.localDate, ml: row.ml }));
  }

  async setWater(clientId: string, localDate: string, ml: number, now: Date = new Date()): Promise<WaterDay> {
    assertDate(localDate);
    assertWater(ml);
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO dev_water_days (workspace_id, client_id, local_date, ml, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, client_id, local_date) DO UPDATE SET ml = excluded.ml, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, localDate, ml, now.toISOString()]);
    });
    this.publish({ clientId, localDate, scope: "WATER" });
    return { localDate, ml };
  }

  async clearWater(clientId: string, localDate: string): Promise<void> {
    assertDate(localDate);
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM dev_water_days WHERE workspace_id = ? AND client_id = ? AND local_date = ?", [this.workspaceId, clientId, localDate]);
    });
    this.publish({ clientId, localDate, scope: "WATER" });
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
