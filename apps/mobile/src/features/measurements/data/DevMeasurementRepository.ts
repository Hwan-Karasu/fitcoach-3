import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { ClientMeasurements, DailyPrimary, Measurement, MeasurementInput } from "../domain/MeasurementModel.ts";
import type { MeasurementCommittedChange, MeasurementRepositoryPort } from "../domain/MeasurementRepositoryPort.ts";
import { compareJournal, validateMeasurement } from "../domain/MeasurementRules.ts";
import { DEV_MEASUREMENT_LEDGER, devMeasurementCatalog } from "./DevMeasurementCatalog.ts";

const columns = `id, client_id AS clientId, type, value_x10 AS valueX10, local_date AS localDate,
  local_minute AS localMinute, method, revision`;

async function byId(tx: SqliteStatementPort, workspaceId: string, id: string): Promise<Measurement> {
  const row = await tx.first<Measurement>(`SELECT ${columns} FROM dev_body_measurements
    WHERE workspace_id = ? AND id = ?`, [workspaceId, id]);
  if (row === null) throw new Error("MEASUREMENT_STALE");
  return row;
}

/** Measurements side of PermanentlyDeleteArchivedClient (§15.7): the journal and primary marks. */
export const devMeasurementClientDeletionParticipant = {
  owner: "measurements.body",
  tables: ["dev_body_measurements", "dev_measurement_daily_primary"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_body_measurements
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM dev_measurement_daily_primary WHERE workspace_id = ? AND client_id = ?",
      [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_body_measurements WHERE workspace_id = ? AND client_id = ?",
      [workspaceId, clientId]);
  },
};

/** Explicitly dev-only new-install store sharing the clients dev file. */
export class DevMeasurementRepository implements MeasurementRepositoryPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: MeasurementCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
  }

  /** The clients store must initialize first: this schema references its tables. */
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
    if (!this.workspaceId.trim()) throw new Error("MEASUREMENT_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devMeasurementCatalog, DEV_MEASUREMENT_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("MEASUREMENT_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: MeasurementCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: MeasurementCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  async listForClient(clientId: string): Promise<ClientMeasurements> {
    const { connection } = this.ready();
    const [measurements, primaries] = await Promise.all([
      connection.all<Measurement>(`SELECT ${columns} FROM dev_body_measurements
        WHERE workspace_id = ? AND client_id = ?`, [this.workspaceId, clientId]),
      connection.all<DailyPrimary>(`SELECT type, local_date AS localDate, measurement_id AS measurementId
        FROM dev_measurement_daily_primary WHERE workspace_id = ? AND client_id = ?`,
      [this.workspaceId, clientId]),
    ]);
    return { measurements: [...measurements].sort(compareJournal), primaries };
  }

  async record(clientId: string, input: MeasurementInput, now: Date = new Date()): Promise<Measurement> {
    const valid = validateMeasurement(input, now);
    const created = await this.ready().writer.write(async (tx) => {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("MEASUREMENT_ID_UNAVAILABLE");
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO dev_body_measurements (id, workspace_id, client_id, type, value_x10,
          local_date, local_minute, method, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', 1, ?, ?)`,
      [id, this.workspaceId, clientId, valid.type, valid.valueX10, valid.localDate, valid.localMinute,
        stamp, stamp]);
      return byId(tx, this.workspaceId, id);
    });
    this.publish({ clientId });
    return created;
  }

  async correct(id: string, expectedRevision: number, input: MeasurementInput,
    now: Date = new Date()): Promise<Measurement> {
    const valid = validateMeasurement(input, now);
    const corrected = await this.ready().writer.write(async (tx) => {
      const current = await byId(tx, this.workspaceId, id);
      if (current.revision !== expectedRevision) throw new Error("MEASUREMENT_STALE");
      // A primary mark belongs to one `type + date`; moving the fact elsewhere releases it.
      if (current.type !== valid.type || current.localDate !== valid.localDate) {
        await tx.run("DELETE FROM dev_measurement_daily_primary WHERE workspace_id = ? AND measurement_id = ?",
          [this.workspaceId, id]);
      }
      const result = await tx.run(`UPDATE dev_body_measurements SET type = ?, value_x10 = ?, local_date = ?,
          local_minute = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`,
      [valid.type, valid.valueX10, valid.localDate, valid.localMinute, now.toISOString(),
        this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("MEASUREMENT_STALE");
      return byId(tx, this.workspaceId, id);
    });
    this.publish({ clientId: corrected.clientId });
    return corrected;
  }

  async remove(id: string, expectedRevision: number): Promise<void> {
    let clientId = "";
    await this.ready().writer.write(async (tx) => {
      const current = await byId(tx, this.workspaceId, id);
      if (current.revision !== expectedRevision) throw new Error("MEASUREMENT_STALE");
      clientId = current.clientId;
      // Unlink only; another entry of that day is never promoted automatically (§49.18.4).
      await tx.run("DELETE FROM dev_measurement_daily_primary WHERE workspace_id = ? AND measurement_id = ?",
        [this.workspaceId, id]);
      await tx.run("DELETE FROM dev_body_measurements WHERE workspace_id = ? AND id = ?", [this.workspaceId, id]);
    });
    this.publish({ clientId });
  }

  async setPrimary(id: string): Promise<void> {
    let clientId = "";
    await this.ready().writer.write(async (tx) => {
      const current = await byId(tx, this.workspaceId, id);
      clientId = current.clientId;
      await tx.run(`INSERT INTO dev_measurement_daily_primary (workspace_id, client_id, type, local_date, measurement_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, client_id, type, local_date) DO UPDATE SET measurement_id = excluded.measurement_id`,
      [this.workspaceId, current.clientId, current.type, current.localDate, id]);
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
