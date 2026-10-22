import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

export const DEV_SETTINGS_LEDGER = "settings_schema_migrations";

/** Dev-схема настроек в общем dev-файле; не production DDL (D01). */
export const devSettingsCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "z01-dev-settings-v1-key-value-20261022",
  statements: [
    `CREATE TABLE dev_settings (
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL CHECK (key IN ('appearance','measurement.visibleGroups')),
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, key)
    )`,
  ],
}];
