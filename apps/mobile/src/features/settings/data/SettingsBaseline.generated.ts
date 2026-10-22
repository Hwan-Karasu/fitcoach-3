import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

/**
 * D01: базовая миграция владельца `settings` — итоговая схема dev-цепочки без префикса `dev_`.
 * Файл создаётся `npm run d01:baseline` (scripts/d01/generate-baseline.ts); вручную не правится. Дальнейшие изменения схемы — только
 * новые миграции версий 2, 3, … в журнале `settings_schema_migrations`.
 */
export const settingsBaseline: readonly MigrationStep[] = [{
  version: 1,
  checksum: "d01-baseline-settings-a5f6404a8639c02f",
  statements: [
    "CREATE TABLE settings (\n      workspace_id TEXT NOT NULL,\n      key TEXT NOT NULL CHECK (key IN ('appearance','measurement.visibleGroups')),\n      value_json TEXT NOT NULL CHECK (json_valid(value_json)),\n      revision INTEGER NOT NULL CHECK (revision > 0),\n      updated_at TEXT NOT NULL,\n      PRIMARY KEY (workspace_id, key)\n    )",
  ],
}];
