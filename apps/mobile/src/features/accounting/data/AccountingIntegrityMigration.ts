import type { MigrationStep } from "../../../shared/db/MigrationRunner.ts";
import { guardRows, preflight } from "../../../shared/db/SchemaGuards.ts";

const reservation = (row: string): string => `EXISTS (SELECT 1 FROM calendar_appointments AS appointment
  WHERE appointment.id = ${row}.appointment_id AND appointment.workspace_id = ${row}.workspace_id AND appointment.client_id = ${row}.client_id)`;
// A corrected appointment keeps historical debits of its former client. Those are not reassigned.
const ledger = (row: string): string => `(${row}.appointment_id IS NULL OR EXISTS (SELECT 1 FROM calendar_appointments AS appointment
  WHERE appointment.id = ${row}.appointment_id AND appointment.workspace_id = ${row}.workspace_id))
  AND (${row}.source_entry_id IS NULL OR EXISTS (SELECT 1 FROM credit_ledger AS source
    WHERE source.id = ${row}.source_entry_id AND source.workspace_id = ${row}.workspace_id
      AND source.client_id = ${row}.client_id AND source.pack_id = ${row}.pack_id))`;
const checks = [{ table: "credit_reservations", valid: reservation }, { table: "credit_ledger", valid: ledger }];
export const accountingIntegrityMigration: MigrationStep = {
  version: 2, checksum: "d01-accounting-v2-owner-20261022",
  statements: [...preflight("accounting", checks),
    ...checks.flatMap((check) => guardRows(`${check.table}_owner`, check.table, check.valid, "OWNER_ACCOUNTING_REFERENCE")),
    `CREATE TRIGGER appointment_reserved_owner_fixed BEFORE UPDATE OF id, workspace_id, client_id ON calendar_appointments
      WHEN EXISTS (SELECT 1 FROM credit_reservations AS reservation WHERE reservation.appointment_id = OLD.id
        AND (NEW.id IS NOT OLD.id OR reservation.workspace_id IS NOT NEW.workspace_id OR reservation.client_id IS NOT NEW.client_id))
      BEGIN SELECT RAISE(ABORT, 'OWNER_ACCOUNTING_REFERENCE'); END`,
    `CREATE TRIGGER appointment_ledger_scope_fixed BEFORE UPDATE OF id, workspace_id ON calendar_appointments
      WHEN (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id)
        AND EXISTS (SELECT 1 FROM credit_ledger WHERE appointment_id = OLD.id)
      BEGIN SELECT RAISE(ABORT, 'OWNER_ACCOUNTING_REFERENCE'); END`,
  ],
};
