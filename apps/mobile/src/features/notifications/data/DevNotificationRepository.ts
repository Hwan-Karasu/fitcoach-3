import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import { retentionCutoff, type CenterCandidate, type CenterEvent } from "../domain/CenterModel.ts";
import type { NotificationCenterPort, NotificationsCommittedChange } from "../domain/NotificationCenterPort.ts";
import { DEFAULT_NOTIFICATION_SETTINGS, validateNotificationSettings, type NotificationSettings } from "../domain/NotificationSettings.ts";
import { DEV_NOTIFICATION_LEDGER, devNotificationCatalog } from "./DevNotificationCatalog.ts";

const columns = `id, source_type AS sourceType, source_id AS sourceId, event_kind AS eventKind, event_version AS eventVersion,
  client_id AS clientId, title, body, occurs_at AS occursAt, read_at AS readAt`;

function parseSettings(json: string): NotificationSettings {
  try {
    return validateNotificationSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, ...(JSON.parse(json) as Partial<NotificationSettings>) });
  } catch {
    // Повреждённое значение читается как «не сохранено»: запись не теряется молча, а следующий явный выбор её заменит.
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

async function settingsOf(tx: SqliteStatementPort, workspaceId: string): Promise<NotificationSettings> {
  const row = await tx.first<{ json: string }>("SELECT settings_json AS json FROM dev_notification_settings WHERE workspace_id = ?", [workspaceId]);
  return row === null ? DEFAULT_NOTIFICATION_SETTINGS : parseSettings(row.json);
}

/** Участник окончательного удаления клиента (§15.7): события центра, привязанные к нему. */
export const devNotificationClientDeletionParticipant = {
  owner: "notifications.center",
  tables: ["dev_notification_events"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    return (await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_notification_events WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]))?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM dev_notification_events WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Dev-only хранилище настроек и ленты уведомлений в общем dev-файле. */
export class DevNotificationRepository implements NotificationCenterPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: NotificationsCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
  }

  /** Clients должен инициализироваться раньше: схема ссылается на его таблицы. */
  initialize(): Promise<void> {
    if (this.connection !== null) return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const opening = this.openAndMigrate();
    this.opening = opening;
    void opening.finally(() => { if (this.opening === opening) this.opening = null; }).catch(() => undefined);
    return opening;
  }

  private async openAndMigrate(): Promise<void> {
    if (!this.workspaceId.trim()) throw new Error("NOTIFICATIONS_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devNotificationCatalog, DEV_NOTIFICATION_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("NOTIFICATIONS_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: NotificationsCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: NotificationsCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Наблюдатели не превращают commit в ошибку. */ }
    }
  }

  getSettings(): Promise<NotificationSettings> { return settingsOf(this.ready().connection, this.workspaceId); }

  async saveSettings(settings: NotificationSettings): Promise<NotificationSettings> {
    const valid = validateNotificationSettings(settings);
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO dev_notification_settings (workspace_id, settings_json, revision, updated_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET settings_json = excluded.settings_json, revision = revision + 1, updated_at = excluded.updated_at`,
      [this.workspaceId, JSON.stringify(valid), new Date().toISOString()]);
    });
    this.publish({ scope: "SETTINGS" });
    return valid;
  }

  async materialize(candidates: readonly CenterCandidate[], now: Date): Promise<number> {
    const created = await this.ready().writer.write(async (tx) => {
      const cutoff = retentionCutoff((await settingsOf(tx, this.workspaceId)).retentionDays, now).toISOString();
      const removed = await tx.run("DELETE FROM dev_notification_events WHERE workspace_id = ? AND occurs_at < ?", [this.workspaceId, cutoff]);
      let added = 0;
      for (const item of candidates) {
        if (item.occursAt < cutoff) continue;
        const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
        if (!id) throw new Error("NOTIFICATIONS_ID_UNAVAILABLE");
        const result = await tx.run(`INSERT OR IGNORE INTO dev_notification_events (id, workspace_id, source_type, source_id, event_kind,
            event_version, client_id, title, body, occurs_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, this.workspaceId, item.sourceType, item.sourceId, item.eventKind, item.eventVersion, item.clientId, item.title, item.body,
          item.occursAt, now.toISOString()]);
        added += result.changes;
      }
      return { added, removed: removed.changes };
    });
    if (created.added > 0 || created.removed > 0) this.publish({ scope: "EVENTS" });
    return created.added;
  }

  listFeed(): Promise<readonly CenterEvent[]> {
    return this.ready().connection.all<CenterEvent>(`SELECT ${columns} FROM dev_notification_events
      WHERE workspace_id = ? AND dismissed_at IS NULL ORDER BY occurs_at DESC, rowid DESC`, [this.workspaceId]);
  }

  async unreadCount(): Promise<number> {
    return (await this.ready().connection.first<{ n: number }>(`SELECT count(*) AS n FROM dev_notification_events
      WHERE workspace_id = ? AND dismissed_at IS NULL AND read_at IS NULL`, [this.workspaceId]))?.n ?? 0;
  }

  private async changeStatus(sql: string, bindings: readonly (string | number | null)[], requireOne: boolean): Promise<number> {
    const result = await this.ready().writer.write((tx) => tx.run(sql, bindings));
    if (requireOne && result.changes !== 1) throw new Error("NOTIFICATION_EVENT_NOT_FOUND");
    if (result.changes > 0) this.publish({ scope: "EVENTS" });
    return result.changes;
  }

  async markRead(id: string, now: Date = new Date()): Promise<void> {
    const exists = await this.ready().connection.first<{ x: number }>("SELECT 1 AS x FROM dev_notification_events WHERE workspace_id = ? AND id = ?", [this.workspaceId, id]);
    if (exists === null) throw new Error("NOTIFICATION_EVENT_NOT_FOUND");
    // Уже прочитанное остаётся прочитанным с прежней отметкой времени.
    await this.changeStatus("UPDATE dev_notification_events SET read_at = ? WHERE workspace_id = ? AND id = ? AND read_at IS NULL",
      [now.toISOString(), this.workspaceId, id], false);
  }

  async markAllRead(now: Date = new Date()): Promise<void> {
    await this.changeStatus(`UPDATE dev_notification_events SET read_at = ? WHERE workspace_id = ? AND dismissed_at IS NULL AND read_at IS NULL`,
      [now.toISOString(), this.workspaceId], false);
  }

  async dismiss(id: string, now: Date = new Date()): Promise<void> {
    await this.changeStatus("UPDATE dev_notification_events SET dismissed_at = ? WHERE workspace_id = ? AND id = ? AND dismissed_at IS NULL",
      [now.toISOString(), this.workspaceId, id], true);
  }

  async undoDismiss(id: string): Promise<void> {
    await this.changeStatus("UPDATE dev_notification_events SET dismissed_at = NULL WHERE workspace_id = ? AND id = ? AND dismissed_at IS NOT NULL",
      [this.workspaceId, id], true);
  }

  async clearRead(now: Date = new Date()): Promise<number> {
    return this.changeStatus(`UPDATE dev_notification_events SET dismissed_at = ? WHERE workspace_id = ? AND dismissed_at IS NULL AND read_at IS NOT NULL`,
      [now.toISOString(), this.workspaceId], false);
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
