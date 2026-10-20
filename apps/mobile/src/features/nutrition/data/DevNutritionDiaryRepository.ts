import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import { MEAL_SLOTS, type DiaryEntry, type DiaryEntryInput, type MealSlot, type WaterDay } from "../domain/DiaryModel.ts";
import { assertDate, assertQuantity, assertSlot, assertWater, normalizeSnapshot } from "../domain/DiaryRules.ts";
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
  readonly revision: number;
}

const columns = `id, client_id AS clientId, local_date AS localDate, slot, position, source_kind AS sourceKind, source_id AS sourceId, name, brand,
  basis_unit AS unit, basis_amount_x10 AS amountX10, per_kcal_x10 AS kcalX10, per_protein_x10 AS proteinX10, per_fat_x10 AS fatX10,
  per_carbs_x10 AS carbsX10, quantity_x10 AS quantityX10, ingredients_json AS ingredientsJson, revision`;

function toEntry(row: EntryRow): DiaryEntry {
  const perBasis = { kcalX10: row.kcalX10, proteinX10: row.proteinX10, fatX10: row.fatX10, carbsX10: row.carbsX10 };
  const basis = { unit: row.unit, amountX10: row.amountX10 };
  const snapshot: FoodSnapshot = { source: { kind: row.sourceKind, id: row.sourceId }, name: row.name, brand: row.brand, basis, perBasis,
    quantityX10: row.quantityX10, eaten: scaleNutrients({ ...basis, ...perBasis }, row.quantityX10),
    ingredients: JSON.parse(row.ingredientsJson) as FoodSnapshot["ingredients"] };
  return { id: row.id, clientId: row.clientId, localDate: row.localDate, slot: row.slot, position: row.position, snapshot, revision: row.revision };
}

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
  tables: ["dev_food_diary_entries", "dev_water_days"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const entries = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const water = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_water_days WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    return (entries?.n ?? 0) + (water?.n ?? 0);
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM dev_food_diary_entries WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_water_days WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
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

  async addEntry(clientId: string, input: DiaryEntryInput, now: Date = new Date()): Promise<DiaryEntry> {
    assertDate(input.localDate);
    assertSlot(input.slot);
    const snapshot = normalizeSnapshot(input.snapshot);
    const created = await this.ready().writer.write(async (tx) => {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("DIARY_ID_UNAVAILABLE");
      const last = await tx.first<{ position: number | null }>(`SELECT max(position) AS position FROM dev_food_diary_entries
        WHERE workspace_id = ? AND client_id = ? AND local_date = ? AND slot = ?`, [this.workspaceId, clientId, input.localDate, input.slot]);
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO dev_food_diary_entries (id, workspace_id, client_id, local_date, slot, position, source_kind, source_id, name, brand,
          basis_unit, basis_amount_x10, per_kcal_x10, per_protein_x10, per_fat_x10, per_carbs_x10, quantity_x10, ingredients_json, revision,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, this.workspaceId, clientId, input.localDate, input.slot, (last?.position ?? -1) + 1, snapshot.source.kind, snapshot.source.id,
        snapshot.name, snapshot.brand, snapshot.basis.unit, snapshot.basis.amountX10, snapshot.perBasis.kcalX10, snapshot.perBasis.proteinX10,
        snapshot.perBasis.fatX10, snapshot.perBasis.carbsX10, snapshot.quantityX10, JSON.stringify(snapshot.ingredients), stamp, stamp]);
      return byId(tx, this.workspaceId, clientId, id);
    });
    this.publish({ clientId, localDate: created.localDate });
    return created;
  }

  async updateQuantity(clientId: string, id: string, expectedRevision: number, quantityX10: number, now: Date = new Date()): Promise<DiaryEntry> {
    assertQuantity(quantityX10);
    const updated = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_food_diary_entries SET quantity_x10 = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND client_id = ? AND id = ? AND revision = ?`, [quantityX10, now.toISOString(), this.workspaceId, clientId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("DIARY_STALE");
      return byId(tx, this.workspaceId, clientId, id);
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
    this.publish({ clientId, localDate });
    return { localDate, ml };
  }

  async clearWater(clientId: string, localDate: string): Promise<void> {
    assertDate(localDate);
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM dev_water_days WHERE workspace_id = ? AND client_id = ? AND local_date = ?", [this.workspaceId, clientId, localDate]);
    });
    this.publish({ clientId, localDate });
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
