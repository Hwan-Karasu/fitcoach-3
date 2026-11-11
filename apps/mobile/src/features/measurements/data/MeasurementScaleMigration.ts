import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

const TYPES = "'WEIGHT','BODY_FAT','NECK','SHOULDERS','CHEST','WAIST','HIPS','ARM','THIGH','CALF','ABDOMEN','ARM_L','ARM_R','FOREARM_L','FOREARM_R','THIGH_L','THIGH_R','CALF_L','CALF_R'";

/**
 * Масса тела до сотых (UIX-FIT-10, решение владельца 2026-11-11): значения замеров хранятся в сотых (`value_x100`), а не в десятых.
 * У всех типов существующие значения умножаются на 10 (88,4 остаётся 88,4 = 8840); точность 0,01 разрешена только массе тела —
 * остальные типы (обхваты, % жира) остаются с шагом 0,1, что гарантирует CHECK (`value_x100 % 10 = 0`, для массы тела — без требования).
 * CHECK через ALTER не меняется, поэтому таблицы пересоздаются тем же порядком, что в v2 (без `RENAME`, см. `DatabaseIdentity`): данные уходят
 * во временные копии, обе таблицы (сначала дочерняя) удаляются и создаются заново под прежними именами и индексами, данные возвращаются,
 * копии удаляются. Идентификаторы, ревизии, методы и основные значения дня переносятся как есть — факты не теряются.
 * CHECK написан через CASE: сравнение с NULL в CHECK не срабатывает, а `value_x100` и `type` — NOT NULL.
 */
export const measurementScaleMigration: MigrationStep = {
  version: 3,
  checksum: "measurements-v3-value-x100-20261111",
  statements: [
    "CREATE TABLE measurement_scale_copy_body AS SELECT * FROM body_measurements",
    "CREATE TABLE measurement_scale_copy_primary AS SELECT * FROM measurement_daily_primary",
    "DROP TABLE measurement_daily_primary",
    "DROP TABLE body_measurements",
    `CREATE TABLE "body_measurements" (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN (${TYPES})),
      value_x100 INTEGER NOT NULL CHECK (typeof(value_x100) = 'integer' AND value_x100 > 0
        AND CASE WHEN type = 'WEIGHT' THEN 1 ELSE value_x100 % 10 = 0 END),
      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),
      local_minute INTEGER CHECK (local_minute IS NULL OR local_minute BETWEEN 0 AND 1439),
      method TEXT NOT NULL CHECK (method IN ('MANUAL','NAVY_ESTIMATE','VISUAL_ESTIMATE')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `INSERT INTO body_measurements (id, workspace_id, client_id, type, value_x100, local_date, local_minute, method, revision, created_at, updated_at)
      SELECT id, workspace_id, client_id, type, value_x10 * 10, local_date, local_minute, method, revision, created_at, updated_at FROM measurement_scale_copy_body`,
    "CREATE UNIQUE INDEX body_measurements_identity_v2 ON \"body_measurements\"(id, workspace_id, client_id, type, local_date)",
    "CREATE INDEX body_measurements_series_v2 ON \"body_measurements\"(workspace_id, client_id, type, local_date)",
    `CREATE TABLE "measurement_daily_primary" (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL,
      local_date TEXT NOT NULL,
      measurement_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id, type, local_date),
      FOREIGN KEY (measurement_id, workspace_id, client_id, type, local_date)
        REFERENCES "body_measurements"(id, workspace_id, client_id, type, local_date) ON DELETE RESTRICT
    )`,
    `INSERT INTO measurement_daily_primary (workspace_id, client_id, type, local_date, measurement_id)
      SELECT workspace_id, client_id, type, local_date, measurement_id FROM measurement_scale_copy_primary`,
    "DROP TABLE measurement_scale_copy_primary",
    "DROP TABLE measurement_scale_copy_body",
  ],
};
