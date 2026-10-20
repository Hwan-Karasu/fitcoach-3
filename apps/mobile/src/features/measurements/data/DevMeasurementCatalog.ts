import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

export const DEV_MEASUREMENT_LEDGER = "measurement_schema_migrations";

const types = "'WEIGHT','BODY_FAT','NECK','SHOULDERS','CHEST','WAIST','HIPS','ARM','THIGH','CALF'";
/** v2: + живот, левая/правая сторона бицепса, предплечья, бедра и голени (UX v1.1; поправка к Product §49.14 готовится). Сторона — часть типа. */
const typesV2 = `${types},'ABDOMEN','ARM_L','ARM_R','FOREARM_L','FOREARM_R','THIGH_L','THIGH_R','CALF_L','CALF_R'`;

/**
 * New-install development schema in the shared dev file; requires the clients catalog first.
 * Not D01 production DDL and not a build120 measurement import.
 */
export const devMeasurementCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "c06-dev-measurements-v1-body-measurements-daily-primary-20261016",
  statements: [
    `CREATE TABLE dev_body_measurements (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN (${types})),
      value_x10 INTEGER NOT NULL CHECK (value_x10 > 0),
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      local_minute INTEGER CHECK (local_minute IS NULL OR local_minute BETWEEN 0 AND 1439),
      method TEXT NOT NULL CHECK (method IN ('MANUAL','NAVY_ESTIMATE')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE UNIQUE INDEX dev_body_measurements_identity
      ON dev_body_measurements(id, workspace_id, client_id, type, local_date)`,
    `CREATE INDEX dev_body_measurements_series
      ON dev_body_measurements(workspace_id, client_id, type, local_date)`,
    // The composite FK makes a primary for another client, type or date impossible (§49.18).
    `CREATE TABLE dev_measurement_daily_primary (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL,
      local_date TEXT NOT NULL,
      measurement_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, type, local_date),
      FOREIGN KEY (measurement_id, workspace_id, client_id, type, local_date)
        REFERENCES dev_body_measurements(id, workspace_id, client_id, type, local_date) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 2,
  checksum: "c06-dev-measurements-v2-abdomen-forearm-sides-20261020",
  statements: [
    // CHECK по типам нельзя изменить ALTER'ом — таблица пересоздаётся; данные и основные значения дня переносятся как есть. Родитель переименовывается после дочерней таблицы (внешний ключ следует за ним).
    `CREATE TABLE dev_body_measurements_v2 (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN (${typesV2})),
      value_x10 INTEGER NOT NULL CHECK (value_x10 > 0),
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      local_minute INTEGER CHECK (local_minute IS NULL OR local_minute BETWEEN 0 AND 1439),
      method TEXT NOT NULL CHECK (method IN ('MANUAL','NAVY_ESTIMATE')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `INSERT INTO dev_body_measurements_v2 (id, workspace_id, client_id, type, value_x10, local_date, local_minute, method, revision, created_at, updated_at)
      SELECT id, workspace_id, client_id, type, value_x10, local_date, local_minute, method, revision, created_at, updated_at FROM dev_body_measurements`,
    `CREATE UNIQUE INDEX dev_body_measurements_identity_v2 ON dev_body_measurements_v2(id, workspace_id, client_id, type, local_date)`,
    `CREATE INDEX dev_body_measurements_series_v2 ON dev_body_measurements_v2(workspace_id, client_id, type, local_date)`,
    `CREATE TABLE dev_measurement_daily_primary_v2 (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL,
      local_date TEXT NOT NULL,
      measurement_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, type, local_date),
      FOREIGN KEY (measurement_id, workspace_id, client_id, type, local_date)
        REFERENCES dev_body_measurements_v2(id, workspace_id, client_id, type, local_date) ON DELETE RESTRICT
    )`,
    `INSERT INTO dev_measurement_daily_primary_v2 (workspace_id, client_id, type, local_date, measurement_id)
      SELECT workspace_id, client_id, type, local_date, measurement_id FROM dev_measurement_daily_primary`,
    `DROP TABLE dev_measurement_daily_primary`,
    `DROP TABLE dev_body_measurements`,
    `ALTER TABLE dev_body_measurements_v2 RENAME TO dev_body_measurements`,
    `ALTER TABLE dev_measurement_daily_primary_v2 RENAME TO dev_measurement_daily_primary`,
  ],
}];
