import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";

export const DEV_ACCOUNTING_LEDGER = "accounting_schema_migrations";

/**
 * New-install development schema in the shared dev file; requires the clients and calendar
 * catalogs first. Not D01 production DDL and not a legacy pack/payment import.
 */
export const devAccountingCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "l01-dev-accounting-v1-packs-ledger-reservations-payments-20261016",
  statements: [
    `CREATE TABLE dev_accounting_settings (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES dev_workspaces(id) ON DELETE RESTRICT,
      default_mode TEXT NOT NULL DEFAULT 'UNTRACKED'
        CHECK (default_mode IN ('FITCOACH','EXTERNAL','UNTRACKED'))
    )`,
    `CREATE TABLE dev_client_accounting (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('FITCOACH','EXTERNAL','UNTRACKED')),
      PRIMARY KEY (workspace_id, client_id),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE dev_session_packs (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      credit_scope TEXT NOT NULL CHECK (credit_scope IN ('GENERAL','SESSION_TYPE')),
      session_type_id TEXT,
      session_type_name TEXT,
      granted_count INTEGER NOT NULL CHECK (granted_count > 0),
      total_kopeks INTEGER NOT NULL CHECK (total_kopeks >= 0),
      expires_on TEXT CHECK (expires_on IS NULL OR date(expires_on) IS expires_on),
      created_at TEXT NOT NULL,
      CHECK ((credit_scope = 'GENERAL' AND session_type_id IS NULL AND session_type_name IS NULL)
        OR (credit_scope = 'SESSION_TYPE' AND session_type_id IS NOT NULL AND session_type_name IS NOT NULL)),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT,
      FOREIGN KEY (session_type_id, workspace_id)
        REFERENCES dev_session_types(id, workspace_id) ON DELETE RESTRICT
    )`,
    "CREATE UNIQUE INDEX dev_session_packs_owner ON dev_session_packs(id, workspace_id, client_id)",
    "CREATE INDEX dev_session_packs_client ON dev_session_packs(workspace_id, client_id, created_at)",
    `CREATE TABLE dev_credit_ledger (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      appointment_id TEXT REFERENCES dev_calendar_appointments(id) ON DELETE RESTRICT,
      source_entry_id TEXT REFERENCES dev_credit_ledger(id) ON DELETE RESTRICT,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('ISSUED','USED','RETURNED','ADJUSTMENT')),
      delta INTEGER NOT NULL CHECK (delta <> 0),
      reason TEXT,
      operation_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      CHECK ((entry_type = 'ISSUED' AND delta > 0 AND appointment_id IS NULL)
        OR (entry_type = 'USED' AND delta = -1 AND appointment_id IS NOT NULL)
        OR (entry_type = 'RETURNED' AND delta = 1 AND source_entry_id IS NOT NULL)
        OR (entry_type = 'ADJUSTMENT' AND reason IS NOT NULL AND length(trim(reason)) > 0)),
      FOREIGN KEY (pack_id, workspace_id, client_id)
        REFERENCES dev_session_packs(id, workspace_id, client_id) ON DELETE RESTRICT
    )`,
    "CREATE INDEX dev_credit_ledger_pack ON dev_credit_ledger(workspace_id, pack_id)",
    "CREATE INDEX dev_credit_ledger_appointment ON dev_credit_ledger(appointment_id) WHERE appointment_id IS NOT NULL",
    // Rows are physically removed only by a permanent client delete inside its own transaction (§15.7).
    `CREATE TABLE dev_accounting_purge (
      client_id TEXT PRIMARY KEY NOT NULL
    )`,
    `CREATE TRIGGER dev_credit_ledger_no_update BEFORE UPDATE ON dev_credit_ledger
      BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_LEDGER_APPEND_ONLY'); END`,
    `CREATE TRIGGER dev_credit_ledger_no_delete BEFORE DELETE ON dev_credit_ledger
      WHEN NOT EXISTS (SELECT 1 FROM dev_accounting_purge WHERE client_id = OLD.client_id)
      BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_LEDGER_APPEND_ONLY'); END`,
    `CREATE TABLE dev_credit_reservations (
      appointment_id TEXT PRIMARY KEY NOT NULL REFERENCES dev_calendar_appointments(id) ON DELETE RESTRICT,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      ends_on TEXT NOT NULL CHECK (date(ends_on) IS ends_on),
      ends_minute INTEGER NOT NULL CHECK (ends_minute BETWEEN 1 AND 1440),
      created_at TEXT NOT NULL,
      FOREIGN KEY (pack_id, workspace_id, client_id)
        REFERENCES dev_session_packs(id, workspace_id, client_id) ON DELETE RESTRICT
    )`,
    "CREATE INDEX dev_credit_reservations_due ON dev_credit_reservations(workspace_id, ends_on, ends_minute)",
    "CREATE INDEX dev_credit_reservations_pack ON dev_credit_reservations(workspace_id, pack_id)",
    `CREATE TABLE dev_payment_records (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      pack_id TEXT,
      amount_kopeks INTEGER NOT NULL CHECK (amount_kopeks > 0),
      paid_on TEXT NOT NULL CHECK (date(paid_on) IS paid_on),
      method TEXT NOT NULL CHECK (method IN ('transfer','cash','other')),
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT,
      FOREIGN KEY (pack_id, workspace_id, client_id)
        REFERENCES dev_session_packs(id, workspace_id, client_id) ON DELETE RESTRICT
    )`,
    "CREATE INDEX dev_payment_records_client ON dev_payment_records(workspace_id, client_id, paid_on)",
  ],
}, {
  version: 2,
  checksum: "l01-dev-accounting-v2-preferred-pack-20261020",
  statements: [
    // Только dev-схема: настройка клиента отдельно от режима учёта и фактов Ledger.
    `CREATE TABLE dev_client_preferred_packs (
      workspace_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, client_id),
      FOREIGN KEY (client_id, workspace_id) REFERENCES dev_clients(id, workspace_id) ON DELETE RESTRICT,
      FOREIGN KEY (pack_id, workspace_id, client_id) REFERENCES dev_session_packs(id, workspace_id, client_id) ON DELETE RESTRICT
    )`,
  ],
}, {
  version: 3,
  checksum: "a02-dev-accounting-v3-one-return-per-debit-20261022",
  statements: [
    // Второй возврат того же списания невозможен; возврат ссылается на списание того же пакета и клиента.
    "CREATE UNIQUE INDEX dev_credit_ledger_one_return ON dev_credit_ledger(source_entry_id) WHERE entry_type = 'RETURNED'",
    `CREATE TRIGGER dev_credit_ledger_return_source BEFORE INSERT ON dev_credit_ledger
      WHEN NEW.entry_type = 'RETURNED' AND NOT EXISTS (SELECT 1 FROM dev_credit_ledger AS s
        WHERE s.id = NEW.source_entry_id AND s.pack_id = NEW.pack_id AND s.client_id = NEW.client_id
          AND s.delta = -1 AND s.entry_type IN ('USED','ADJUSTMENT'))
      BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_RETURN_SOURCE_INVALID'); END`,
  ],
}];
