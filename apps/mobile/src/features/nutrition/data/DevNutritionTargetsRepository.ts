import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import { assertDate } from "../domain/DiaryRules.ts";
import type { NutritionTargetsPort, TargetsCommittedChange } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type TargetException, type TargetMetric, type TargetRange, type TargetVersion, type TargetVersionInput } from
  "../domain/TargetModel.ts";
import { hasAnyRange, validateCorridors, validateVersion } from "../domain/TargetRules.ts";
import { DEV_NUTRITION_LEDGER, devNutritionCatalog } from "./DevNutritionCatalog.ts";

type CorridorRow = { readonly [K in `${TargetMetric}_min_x10` | `${TargetMetric}_max_x10`]: number | null };

const corridorSelect = TARGET_METRICS.map((metric) => `${metric}_min_x10, ${metric}_max_x10`).join(", ");
const corridorColumnNames = TARGET_METRICS.flatMap((metric) => [`${metric}_min_x10`, `${metric}_max_x10`]);

function toCorridors(row: CorridorRow): Corridors {
  const pick = (metric: TargetMetric): TargetRange | null => {
    const min = row[`${metric}_min_x10`];
    const max = row[`${metric}_max_x10`];
    return min === null || max === null ? null : { minX10: min, maxX10: max };
  };
  return { kcal: pick("kcal"), protein: pick("protein"), fat: pick("fat"), carbs: pick("carbs") };
}

const corridorValues = (corridors: Corridors): SqlValue[] =>
  TARGET_METRICS.flatMap((metric) => [corridors[metric]?.minX10 ?? null, corridors[metric]?.maxX10 ?? null]);

interface VersionRow { readonly id: string; readonly clientId: string; readonly effectiveFrom: string; readonly revision: number }

async function loadVersions(reader: SqliteStatementPort, workspaceId: string, clientId: string): Promise<readonly TargetVersion[]> {
  const versions = await reader.all<VersionRow>(`SELECT id, client_id AS clientId, effective_from AS effectiveFrom, revision FROM dev_nutrition_target_versions
    WHERE workspace_id = ? AND client_id = ? ORDER BY effective_from`, [workspaceId, clientId]);
  if (versions.length === 0) return [];
  const days = await reader.all<CorridorRow & { readonly version_id: string; readonly weekday: number }>(`SELECT d.version_id, d.weekday, ${corridorSelect.replace(/(\w+_(?:min|max)_x10)/gu, "d.$1")}
    FROM dev_nutrition_target_days d JOIN dev_nutrition_target_versions v ON v.id = d.version_id WHERE v.workspace_id = ? AND v.client_id = ?`, [workspaceId, clientId]);
  return versions.map((version) => ({ ...version, days: Array.from({ length: 7 }, (_, weekday) => {
    const row = days.find((item) => item.version_id === version.id && item.weekday === weekday);
    return row === undefined ? null : toCorridors(row);
  }) }));
}

/** Nutrition side of PermanentlyDeleteArchivedClient (§15.7): versions (with days) and exceptions. */
export const devNutritionTargetsClientDeletionParticipant = {
  owner: "nutrition.targets",
  tables: ["dev_nutrition_target_days", "dev_nutrition_target_versions", "dev_nutrition_target_exceptions"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const versions = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_nutrition_target_versions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const exceptions = await tx.first<{ n: number }>("SELECT count(*) AS n FROM dev_nutrition_target_exceptions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    return (versions?.n ?? 0) + (exceptions?.n ?? 0);
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run(`DELETE FROM dev_nutrition_target_days WHERE version_id IN
      (SELECT id FROM dev_nutrition_target_versions WHERE workspace_id = ? AND client_id = ?)`, [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_nutrition_target_versions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_nutrition_target_exceptions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Explicitly dev-only new-install store sharing the clients dev file; the clients store must initialize first. */
export class DevNutritionTargetsRepository implements NutritionTargetsPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: TargetsCommittedChange) => void>();

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

  subscribeCommittedChanges(listener: (change: TargetsCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: TargetsCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  listVersions(clientId: string): Promise<readonly TargetVersion[]> {
    return loadVersions(this.ready().connection, this.workspaceId, clientId);
  }

  async saveVersion(clientId: string, input: TargetVersionInput, expectedRevision: number | null, now: Date = new Date()): Promise<TargetVersion> {
    const valid = validateVersion(input);
    const saved = await this.ready().writer.write(async (tx) => {
      const stamp = now.toISOString();
      const existing = await tx.first<{ id: string; revision: number }>(`SELECT id, revision FROM dev_nutrition_target_versions
        WHERE workspace_id = ? AND client_id = ? AND effective_from = ?`, [this.workspaceId, clientId, valid.effectiveFrom]);
      let id: string;
      if (existing === null) {
        if (expectedRevision !== null) throw new Error("TARGET_STALE");
        const generated = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
        if (!generated) throw new Error("TARGET_ID_UNAVAILABLE");
        id = generated;
        await tx.run(`INSERT INTO dev_nutrition_target_versions (id, workspace_id, client_id, effective_from, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)`, [id, this.workspaceId, clientId, valid.effectiveFrom, stamp, stamp]);
      } else {
        // Версия на эту дату уже есть: молча не заменяем (§49.11.5), правка — только с её revision.
        if (expectedRevision === null) throw new Error("TARGET_VERSION_EXISTS");
        const result = await tx.run(`UPDATE dev_nutrition_target_versions SET revision = revision + 1, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND revision = ?`, [stamp, existing.id, this.workspaceId, expectedRevision]);
        if (result.changes !== 1) throw new Error("TARGET_STALE");
        id = existing.id;
        await tx.run("DELETE FROM dev_nutrition_target_days WHERE version_id = ?", [id]);
      }
      for (const [weekday, day] of valid.days.entries()) {
        if (day === null) continue;
        await tx.run(`INSERT INTO dev_nutrition_target_days (version_id, weekday, ${corridorColumnNames.join(", ")})
          VALUES (?, ?, ${corridorColumnNames.map(() => "?").join(", ")})`, [id, weekday, ...corridorValues(day)]);
      }
      return (await loadVersions(tx, this.workspaceId, clientId)).find((version) => version.id === id) as TargetVersion;
    });
    this.publish({ clientId });
    return saved;
  }

  async listExceptions(clientId: string): Promise<readonly TargetException[]> {
    const rows = await this.ready().connection.all<CorridorRow & { readonly local_date: string }>(`SELECT local_date, ${corridorSelect}
      FROM dev_nutrition_target_exceptions WHERE workspace_id = ? AND client_id = ? ORDER BY local_date`, [this.workspaceId, clientId]);
    return rows.map((row) => ({ clientId, localDate: row.local_date, corridors: toCorridors(row) }));
  }

  async setException(clientId: string, localDate: string, corridors: Corridors, now: Date = new Date()): Promise<TargetException> {
    assertDate(localDate);
    const valid = validateCorridors(corridors);
    if (!hasAnyRange(valid)) throw new Error("TARGET_EMPTY");
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO dev_nutrition_target_exceptions (workspace_id, client_id, local_date, ${corridorColumnNames.join(", ")}, updated_at)
        VALUES (?, ?, ?, ${corridorColumnNames.map(() => "?").join(", ")}, ?)
        ON CONFLICT(workspace_id, client_id, local_date) DO UPDATE SET ${corridorColumnNames.map((name) => `${name} = excluded.${name}`).join(", ")},
          updated_at = excluded.updated_at`, [this.workspaceId, clientId, localDate, ...corridorValues(valid), now.toISOString()]);
    });
    this.publish({ clientId });
    return { clientId, localDate, corridors: valid };
  }

  async clearException(clientId: string, localDate: string): Promise<void> {
    assertDate(localDate);
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM dev_nutrition_target_exceptions WHERE workspace_id = ? AND client_id = ? AND local_date = ?", [this.workspaceId, clientId, localDate]);
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
