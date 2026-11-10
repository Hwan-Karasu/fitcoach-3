import type { DatabaseOwnerCatalog } from "../../../shared/db/DatabaseIdentity.ts";
import { HEALTH_METRICS } from "../domain/HealthModel.ts";

const METRICS = HEALTH_METRICS.map((metric) => `'${metric}'`).join(",");

/**
 * Схема владельца `health` (UIX-16): одна привязка к карточке и значения Health Connect по дням. Дни не удаляются при отключении; обе таблицы ссылаются на
 * клиента, поэтому окончательное удаление клиента обязано знать их (участник `devHealthClientDeletionParticipant`).
 */
export const HEALTH_LEDGER = "health_schema_migrations";
export const HEALTH_OWNER: DatabaseOwnerCatalog = {
  owner: "health",
  ledger: HEALTH_LEDGER,
  allowMissingOnUpgrade: true,
  chain: [{
    version: 1,
    checksum: "health-connect-v1-20261110",
    statements: [
      `CREATE TABLE health_link (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        workspace_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        last_sync_at TEXT,
        granted_metrics TEXT NOT NULL,
        FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT
      )`,
      `CREATE TABLE health_daily (
        workspace_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
        metric TEXT NOT NULL CHECK (metric IN (${METRICS})),
        value INTEGER NOT NULL CHECK (value >= 0),
        synced_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, client_id, local_date, metric),
        FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT
      )`,
    ],
  }],
};
