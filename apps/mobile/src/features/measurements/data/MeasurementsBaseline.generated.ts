import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

/**
 * D01: базовая миграция владельца `measurements` — итоговая схема dev-цепочки без префикса `dev_`.
 * Файл создаётся `npm run d01:baseline` (scripts/d01/generate-baseline.ts); вручную не правится. Дальнейшие изменения схемы — только
 * новые миграции версий 2, 3, … в журнале `measurement_schema_migrations`.
 */
export const measurementsBaseline: readonly MigrationStep[] = [{
  version: 1,
  checksum: "d01-baseline-measurements-7e274bf885dd550d",
  statements: [
    "CREATE TABLE \"body_measurements\" (\n      id TEXT PRIMARY KEY NOT NULL,\n      workspace_id TEXT NOT NULL,\n      client_id TEXT NOT NULL,\n      type TEXT NOT NULL CHECK (type IN ('WEIGHT','BODY_FAT','NECK','SHOULDERS','CHEST','WAIST','HIPS','ARM','THIGH','CALF','ABDOMEN','ARM_L','ARM_R','FOREARM_L','FOREARM_R','THIGH_L','THIGH_R','CALF_L','CALF_R')),\n      value_x10 INTEGER NOT NULL CHECK (value_x10 > 0),\n      local_date TEXT NOT NULL CHECK (date(local_date) IS local_date),\n      local_minute INTEGER CHECK (local_minute IS NULL OR local_minute BETWEEN 0 AND 1439),\n      method TEXT NOT NULL CHECK (method IN ('MANUAL','NAVY_ESTIMATE')),\n      revision INTEGER NOT NULL CHECK (revision > 0),\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL,\n      FOREIGN KEY (client_id, workspace_id) REFERENCES clients(id, workspace_id) ON DELETE RESTRICT\n    )",
    "CREATE TABLE \"measurement_daily_primary\" (\n      workspace_id TEXT NOT NULL,\n      client_id TEXT NOT NULL,\n      type TEXT NOT NULL,\n      local_date TEXT NOT NULL,\n      measurement_id TEXT NOT NULL,\n      PRIMARY KEY (workspace_id, client_id, type, local_date),\n      FOREIGN KEY (measurement_id, workspace_id, client_id, type, local_date)\n        REFERENCES \"body_measurements\"(id, workspace_id, client_id, type, local_date) ON DELETE RESTRICT\n    )",
    "CREATE UNIQUE INDEX body_measurements_identity_v2 ON \"body_measurements\"(id, workspace_id, client_id, type, local_date)",
    "CREATE INDEX body_measurements_series_v2 ON \"body_measurements\"(workspace_id, client_id, type, local_date)",
  ],
}];
