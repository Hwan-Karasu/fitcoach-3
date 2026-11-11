import type { DatabaseOwnerCatalog } from "../../../shared/db/DatabaseIdentity.ts";
import { HEALTH_METRICS } from "../domain/HealthModel.ts";

/** Список метрик первой версии схемы — зафиксирован текстом: v1 не переписывается, базы, созданные с ней, остаются сверяемыми. */
const V1_METRICS = "'STEPS','SLEEP_MIN','TOTAL_KCAL','ACTIVE_KCAL','WEIGHT_X10','BODY_FAT_X10'";
/** Текущий список (после v2): вес — сотые, `WEIGHT_X100`. */
const METRICS = HEALTH_METRICS.map((metric) => `'${metric}'`).join(",");

/**
 * Схема владельца `health` (UIX-16): одна привязка к карточке и значения Health Connect по дням. Дни не удаляются при отключении; обе таблицы
 * клиента, поэтому окончательное удаление клиента обязано знать их (участник `devHealthClientDeletionParticipant`).
 * v2 (UIX-FIT-10, вес до сотых): метрика веса `WEIGHT_X10` → `WEIGHT_X100`, значения ×10. Таблица `health_daily` пересоздаётся (CHECK по метрике через ALTER
 * не меняется) тем же порядком, что у замеров: копия → DROP → CREATE → INSERT с преобразованием → DROP копии (без `RENAME`, см. `DatabaseIdentity`). Уже записанные дни веса
 * сохраняются — от них зависит правило «день известен Health Connect, удалённое тренером не возвращается». Список разрешённых метрик в привязке переименовывается так же.
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
        metric TEXT NOT NULL CHECK (metric IN (${V1_METRICS})),
        value INTEGER NOT NULL CHECK (value >= 0),
        synced_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, client_id, local_date, metric),
        FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT
      )`,
    ],
  }, {
    version: 2,
    checksum: "health-connect-v2-weight-x100-20261111",
    statements: [
      "CREATE TABLE health_scale_copy_daily AS SELECT * FROM health_daily",
      "DROP TABLE health_daily",
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
      `INSERT INTO health_daily (workspace_id, client_id, local_date, metric, value, synced_at)
        SELECT workspace_id, client_id, local_date,
          CASE WHEN metric = 'WEIGHT_X10' THEN 'WEIGHT_X100' ELSE metric END,
          CASE WHEN metric = 'WEIGHT_X10' THEN value * 10 ELSE value END,
          synced_at FROM health_scale_copy_daily`,
      "DROP TABLE health_scale_copy_daily",
      "UPDATE health_link SET granted_metrics = replace(granted_metrics, 'WEIGHT_X10', 'WEIGHT_X100')",
    ],
  }],
};
