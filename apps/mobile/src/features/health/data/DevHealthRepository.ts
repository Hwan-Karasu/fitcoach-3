import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import { HEALTH_METRICS, isValidHealthValue, type HealthDayValue, type HealthLink, type HealthMetric } from "../domain/HealthModel.ts";
import type { HealthCommittedChange, HealthStorePort } from "../domain/HealthPorts.ts";
import { HEALTH_LEDGER, HEALTH_OWNER } from "./HealthCatalog.ts";

interface LinkRow { clientId: string; linkedAt: string; lastSyncAt: string | null; granted: string }

const linkOf = (row: LinkRow): HealthLink => ({ clientId: row.clientId, linkedAt: row.linkedAt, lastSyncAt: row.lastSyncAt,
  grantedMetrics: (JSON.parse(row.granted) as string[]).filter((metric): metric is HealthMetric => (HEALTH_METRICS as readonly string[]).includes(metric)) });

const LINK_SQL = "SELECT client_id AS clientId, linked_at AS linkedAt, last_sync_at AS lastSyncAt, granted_metrics AS granted FROM health_link WHERE workspace_id = ? AND id = 1";

/** Участник окончательного удаления клиента: привязка и все дни Health Connect этой карточки (AUD26-01: схема не должна блокировать удаление). */
export const devHealthClientDeletionParticipant = {
  owner: "health.connect",
  tables: ["health_link", "health_daily"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const days = await tx.first<{ n: number }>("SELECT count(*) AS n FROM health_daily WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const link = await tx.first<{ n: number }>("SELECT count(*) AS n FROM health_link WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    return (days?.n ?? 0) + (link?.n ?? 0);
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM health_daily WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM health_link WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Хранилище Health Connect в общем файле базы; запись — только через WriterCoordinator, уведомление подписчиков — после коммита. */
export class DevHealthRepository implements HealthStorePort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: HealthCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
  }

  /** Клиенты инициализируются раньше: схема ссылается на их таблицу. */
  initialize(): Promise<void> {
    if (this.connection !== null) return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const opening = this.openAndMigrate();
    this.opening = opening;
    void opening.finally(() => { if (this.opening === opening) this.opening = null; }).catch(() => undefined);
    return opening;
  }

  private async openAndMigrate(): Promise<void> {
    if (!this.workspaceId.trim()) throw new Error("HEALTH_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, HEALTH_OWNER.chain, HEALTH_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("HEALTH_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: HealthCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: HealthCommittedChange): void {
    for (const listener of this.listeners) { try { listener(change); } catch { /* Наблюдатель не превращает коммит в сбой. */ } }
  }

  async getLink(): Promise<HealthLink | null> {
    const row = await this.ready().connection.first<LinkRow>(LINK_SQL, [this.workspaceId]);
    return row === null ? null : linkOf(row);
  }

  async link(clientId: string, now: Date = new Date()): Promise<HealthLink> {
    const created = await this.ready().writer.write(async (tx) => {
      const existing = await tx.first<LinkRow>(LINK_SQL, [this.workspaceId]);
      if (existing !== null) {
        if (existing.clientId !== clientId) throw new Error("HEALTH_ALREADY_LINKED");
        return { link: linkOf(existing), added: false };
      }
      await tx.run("INSERT INTO health_link (id, workspace_id, client_id, linked_at, last_sync_at, granted_metrics) VALUES (1, ?, ?, ?, NULL, '[]')",
        [this.workspaceId, clientId, now.toISOString()]);
      return { link: { clientId, linkedAt: now.toISOString(), lastSyncAt: null, grantedMetrics: [] } as HealthLink, added: true };
    });
    if (created.added) this.publish({ clientId });
    return created.link;
  }

  async unlink(): Promise<void> {
    const removed = await this.ready().writer.write(async (tx) => {
      const existing = await tx.first<LinkRow>(LINK_SQL, [this.workspaceId]);
      if (existing === null) return null;
      await tx.run("DELETE FROM health_link WHERE workspace_id = ? AND id = 1", [this.workspaceId]);
      return existing.clientId;
    });
    if (removed !== null) this.publish({ clientId: removed });
  }

  async listDaily(clientId: string, from: string, to: string): Promise<readonly HealthDayValue[]> {
    return this.ready().connection.all<HealthDayValue>(`SELECT local_date AS localDate, metric, value FROM health_daily
      WHERE workspace_id = ? AND client_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date, metric`, [this.workspaceId, clientId, from, to]);
  }

  async saveSync(clientId: string, values: readonly HealthDayValue[], granted: readonly HealthMetric[], now: Date = new Date()): Promise<void> {
    if (values.some((entry) => !isValidHealthValue(entry.metric, entry.value))) throw new Error("HEALTH_VALUE_INVALID");
    const stamp = now.toISOString();
    await this.ready().writer.write(async (tx) => {
      const link = await tx.first<LinkRow>(LINK_SQL, [this.workspaceId]);
      if (link === null || link.clientId !== clientId) throw new Error("HEALTH_NOT_LINKED");
      for (const entry of values) {
        await tx.run(`INSERT INTO health_daily (workspace_id, client_id, local_date, metric, value, synced_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, client_id, local_date, metric) DO UPDATE SET value = excluded.value, synced_at = excluded.synced_at`,
        [this.workspaceId, clientId, entry.localDate, entry.metric, entry.value, stamp]);
      }
      await tx.run("UPDATE health_link SET last_sync_at = ?, granted_metrics = ? WHERE workspace_id = ? AND id = 1", [stamp, JSON.stringify(granted), this.workspaceId]);
    });
    this.publish({ clientId });
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
