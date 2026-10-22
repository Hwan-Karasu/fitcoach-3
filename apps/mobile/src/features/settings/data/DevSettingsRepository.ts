import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteConnectionPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import { parseAppearance, parseStringList, type AppearanceSetting, type SettingsPort } from "../domain/SettingsPort.ts";
import { DEV_SETTINGS_LEDGER, devSettingsCatalog } from "./DevSettingsCatalog.ts";

type SettingKey = "appearance" | "measurement.visibleGroups";

/** Dev-only хранилище настроек в общем dev-файле. */
export class DevSettingsRepository implements SettingsPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<() => void>();

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
    if (!this.workspaceId.trim()) throw new Error("SETTINGS_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devSettingsCatalog, DEV_SETTINGS_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("SETTINGS_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private async read(key: SettingKey): Promise<string | null> {
    const row = await this.ready().connection.first<{ json: string }>(
      "SELECT value_json AS json FROM settings WHERE workspace_id = ? AND key = ?", [this.workspaceId, key]);
    return row?.json ?? null;
  }

  private async write(key: SettingKey, json: string, now: Date = new Date()): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO settings (workspace_id, key, value_json, revision, updated_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(workspace_id, key) DO UPDATE SET value_json = excluded.value_json,
          revision = revision + 1, updated_at = excluded.updated_at`,
      [this.workspaceId, key, json, now.toISOString()]);
    });
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Наблюдатели не превращают commit в ошибку. */ }
    }
  }

  async readAppearance(): Promise<AppearanceSetting | null> {
    const json = await this.read("appearance");
    return json === null ? null : parseAppearance(json);
  }

  saveAppearance(value: AppearanceSetting): Promise<void> {
    return this.write("appearance", JSON.stringify({ themeId: value.themeId, accentId: value.accentId }));
  }

  async readMeasurementGroups(): Promise<readonly string[] | null> {
    const json = await this.read("measurement.visibleGroups");
    return json === null ? null : parseStringList(json);
  }

  saveMeasurementGroups(ids: readonly string[]): Promise<void> {
    return this.write("measurement.visibleGroups", JSON.stringify([...new Set(ids)].sort()));
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
