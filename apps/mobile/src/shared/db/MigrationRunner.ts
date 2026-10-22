import type { SqliteStatementPort } from "./SqlitePort.ts";
import { WriterCoordinator } from "./WriterCoordinator.ts";

export interface MigrationStep {
  readonly version: number;
  readonly checksum: string;
  readonly statements: readonly string[];
}

interface AppliedMigration { readonly version: number; readonly checksum: string }

function validateCatalog(steps: readonly MigrationStep[]): void {
  steps.forEach((step, index) => {
    if (step.version !== index + 1 || !step.checksum.trim() || step.statements.length === 0 ||
      step.statements.some((statement) => !statement.trim())) {
      throw new Error("MIGRATION_CATALOG_INVALID");
    }
  });
}

function validateApplied(rows: readonly AppliedMigration[], catalog: readonly MigrationStep[]): void {
  rows.forEach((row, index) => {
    const expected = catalog[index];
    if (!expected || row.version !== index + 1 || row.checksum !== expected.checksum) {
      throw new Error("MIGRATION_HISTORY_MISMATCH");
    }
  });
}

/**
 * Runs only supplied, forward-only migrations, including the shared D01 runtime catalogs.
 * Each owner sharing one database file keeps its own ledger table.
 */
export async function runMigrations(
  writer: WriterCoordinator, catalog: readonly MigrationStep[], ledger = "schema_migrations",
): Promise<readonly number[]> {
  if (!/^[a-z][a-z0-9_]*$/u.test(ledger)) throw new Error("MIGRATION_LEDGER_INVALID");
  validateCatalog(catalog);
  return writer.write((tx) => runMigrationsInTransaction(tx, catalog, ledger));
}

/** The caller owns the transaction, including cross-owner schema initialization. Never nests commits. */
export async function runMigrationsInTransaction(tx: SqliteStatementPort, catalog: readonly MigrationStep[],
  ledger = "schema_migrations"): Promise<readonly number[]> {
  if (!/^[a-z][a-z0-9_]*$/u.test(ledger)) throw new Error("MIGRATION_LEDGER_INVALID");
  validateCatalog(catalog);
  await tx.run(`CREATE TABLE IF NOT EXISTS ${ledger} (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL)`);
  const applied = await tx.all<AppliedMigration>(`SELECT version, checksum FROM ${ledger} ORDER BY version`);
  validateApplied(applied, catalog);

  const newVersions: number[] = [];
  for (const step of catalog.slice(applied.length)) {
    for (const statement of step.statements) await tx.run(statement);
    await tx.run(`INSERT INTO ${ledger} (version, checksum) VALUES (?, ?)`, [step.version, step.checksum]);
    newVersions.push(step.version);
  }

  const fkViolations = await tx.all<unknown>("PRAGMA foreign_key_check");
  if (fkViolations.length > 0) throw new Error("MIGRATION_FOREIGN_KEY_VIOLATION");
  const integrity = await tx.first<{ integrity_check: string }>("PRAGMA integrity_check");
  if (integrity?.integrity_check !== "ok") throw new Error("MIGRATION_INTEGRITY_FAILED");
  return newVersions;
}
