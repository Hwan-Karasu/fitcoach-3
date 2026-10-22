/** D01-2: runtime catalog; the 63-step dev history is archived under scripts/d01/history. */
import { accountingBaseline } from "./AccountingBaseline.generated.ts";
import { accountingIntegrityMigration } from "./AccountingIntegrityMigration.ts";
export const devAccountingCatalog = [...accountingBaseline, accountingIntegrityMigration];
export const DEV_ACCOUNTING_LEDGER = "accounting_schema_migrations";
