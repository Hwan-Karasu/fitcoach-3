import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { FoodCatalogCommittedChange, FoodCatalogFilter, FoodCatalogPort } from "../domain/FoodCatalogPort.ts";
import type { FoodInput, FoodProduct } from "../domain/FoodModel.ts";
import { validateFood } from "../domain/FoodRules.ts";
import { DEV_NUTRITION_LEDGER, devNutritionCatalog } from "./DevNutritionCatalog.ts";

const columns = `id, name, brand, basis_unit AS unit, basis_amount_x10 AS amountX10, kcal_x10 AS kcalX10,
  protein_x10 AS proteinX10, fat_x10 AS fatX10, carbs_x10 AS carbsX10, barcode, grams_per_piece_x10 AS gramsPerPieceX10, favorite,
  revision, archived_at AS archivedAt`;

type FoodRow = Omit<FoodProduct, "favorite"> & { readonly favorite: number };
const toFood = (row: FoodRow): FoodProduct => ({ ...row, favorite: row.favorite === 1 });

async function byId(tx: SqliteStatementPort, workspaceId: string, id: string): Promise<FoodProduct> {
  const row = await tx.first<FoodRow>(`SELECT ${columns} FROM dev_food_products WHERE workspace_id = ? AND id = ?`, [workspaceId, id]);
  if (row === null) throw new Error("FOOD_STALE");
  return toFood(row);
}

/** Explicitly dev-only new-install store sharing the clients dev file. */
export class DevFoodCatalogRepository implements FoodCatalogPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: FoodCatalogCommittedChange) => void>();

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

  subscribeCommittedChanges(listener: (change: FoodCatalogCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: FoodCatalogCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  async search(query = "", filter: FoodCatalogFilter = "ALL"): Promise<readonly FoodProduct[]> {
    const rows = (await this.ready().connection.all<FoodRow>(`SELECT ${columns} FROM dev_food_products
      WHERE workspace_id = ? AND archived_at IS NULL AND (? = 'ALL' OR favorite = 1)`, [this.workspaceId, filter])).map(toFood);
    // SQLite `lower` не знает кириллицу — фильтр и порядок в JS.
    const needle = query.trim().toLocaleLowerCase("ru");
    return rows
      .filter((row) => needle === "" || row.name.toLocaleLowerCase("ru").includes(needle) || (row.brand ?? "").toLocaleLowerCase("ru").includes(needle)
        || (row.barcode ?? "").toLocaleLowerCase("ru").includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<FoodProduct | null> {
    const row = await this.ready().connection.first<FoodRow>(`SELECT ${columns} FROM dev_food_products WHERE workspace_id = ? AND id = ?`,
      [this.workspaceId, id]);
    return row === null ? null : toFood(row);
  }

  async create(input: FoodInput, now: Date = new Date()): Promise<FoodProduct> {
    const valid = validateFood(input);
    const created = await this.ready().writer.write(async (tx) => {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("FOOD_ID_UNAVAILABLE");
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO dev_food_products (id, workspace_id, name, brand, basis_unit, basis_amount_x10, kcal_x10, protein_x10,
          fat_x10, carbs_x10, barcode, grams_per_piece_x10, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, this.workspaceId, valid.name, valid.brand, valid.unit, valid.amountX10, valid.kcalX10, valid.proteinX10, valid.fatX10,
        valid.carbsX10, valid.barcode ?? null, valid.gramsPerPieceX10 ?? null, stamp, stamp]);
      return byId(tx, this.workspaceId, id);
    });
    this.publish({ foodId: created.id });
    return created;
  }

  async update(id: string, expectedRevision: number, input: FoodInput, now: Date = new Date()): Promise<FoodProduct> {
    const valid = validateFood(input);
    const updated = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_food_products SET name = ?, brand = ?, basis_unit = ?, basis_amount_x10 = ?, kcal_x10 = ?,
          protein_x10 = ?, fat_x10 = ?, carbs_x10 = ?, barcode = ?, grams_per_piece_x10 = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND archived_at IS NULL`,
      [valid.name, valid.brand, valid.unit, valid.amountX10, valid.kcalX10, valid.proteinX10, valid.fatX10, valid.carbsX10,
        valid.barcode ?? null, valid.gramsPerPieceX10 ?? null, now.toISOString(), this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("FOOD_STALE");
      return byId(tx, this.workspaceId, id);
    });
    this.publish({ foodId: id });
    return updated;
  }

  async setFavorite(id: string, value: boolean, now: Date = new Date()): Promise<FoodProduct> {
    let changed = false;
    const food = await this.ready().writer.write(async (tx) => {
      const current = await byId(tx, this.workspaceId, id);
      if (current.archivedAt !== null) throw new Error("FOOD_STALE");
      if (current.favorite === value) return current;
      await tx.run("UPDATE dev_food_products SET favorite = ?, updated_at = ? WHERE workspace_id = ? AND id = ?", [value ? 1 : 0, now.toISOString(), this.workspaceId, id]);
      changed = true;
      return byId(tx, this.workspaceId, id);
    });
    if (changed) this.publish({ foodId: id });
    return food;
  }

  async archive(id: string, expectedRevision: number, now: Date = new Date()): Promise<FoodProduct> {
    let changed = false;
    const archived = await this.ready().writer.write(async (tx) => {
      const current = await byId(tx, this.workspaceId, id);
      if (current.archivedAt !== null) return current;
      const result = await tx.run(`UPDATE dev_food_products SET archived_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`, [now.toISOString(), now.toISOString(), this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("FOOD_STALE");
      changed = true;
      return byId(tx, this.workspaceId, id);
    });
    if (changed) this.publish({ foodId: id });
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
