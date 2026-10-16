import { runMigrations, type MigrationStep } from "../../shared/db/MigrationRunner.ts";
import type { SqliteConnectionPort } from "../../shared/db/SqlitePort.ts";
import { WriterCoordinator } from "../../shared/db/WriterCoordinator.ts";
import { LocalDiagnostics } from "../../shared/diagnostics/LocalDiagnostics.ts";

export interface F04ProbeCheck { readonly name: string; readonly passed: boolean }
export interface F04ProbeReport {
  readonly checks: readonly F04ProbeCheck[];
  readonly allPassed: boolean;
  readonly transactions: Readonly<{ committed: number; rolledBack: number; rejected: number }>;
}

const probeCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "f04-probe-v1-only",
  statements: [
    "CREATE TABLE f04_probe_items (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0))",
  ],
}];

/** Dev-only probe. Its connection is supplied by the composition root. */
export async function runF04Probe(openConnection: () => Promise<SqliteConnectionPort>): Promise<F04ProbeReport> {
  const checks: F04ProbeCheck[] = [];
  const diagnostics = new LocalDiagnostics();
  const transactionCounts = () => diagnostics.snapshot().reduce((counts, event) => {
    if (event.outcome === "committed") counts.committed += 1;
    else if (event.outcome === "rolled-back") counts.rolledBack += 1;
    else counts.rejected += 1;
    return counts;
  }, { committed: 0, rolledBack: 0, rejected: 0 });
  let stage = "Открытие базы";
  let connection: SqliteConnectionPort | null = null;
  try {
    connection = await openConnection();
    checks.push({ name: stage, passed: true });
    const writer = new WriterCoordinator(connection, diagnostics);

    stage = "Миграция и повтор";
    await runMigrations(writer, probeCatalog);
    const repeated = await runMigrations(writer, probeCatalog);
    checks.push({ name: stage, passed: repeated.length === 0 });

    const id = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    stage = "Сохранение и чтение";
    await writer.write((tx) => tx.run("INSERT INTO f04_probe_items (id, value, revision) VALUES (?, ?, 0)", [id, "baseline"]));
    const inserted = await connection.first<{ value: string; revision: number }>(
      "SELECT value, revision FROM f04_probe_items WHERE id = ?", [id],
    );
    checks.push({ name: stage, passed: inserted?.value === "baseline" && inserted.revision === 0 });

    stage = "Откат при ошибке";
    let rejected = false;
    try {
      await writer.write(async (tx) => {
        await tx.run("UPDATE f04_probe_items SET value = ? WHERE id = ?", ["must-rollback", id]);
        throw new Error("PROBE_ROLLBACK");
      });
    } catch { rejected = true; }
    const rolledBack = await connection.first<{ value: string }>("SELECT value FROM f04_probe_items WHERE id = ?", [id]);
    checks.push({ name: stage, passed: rejected && rolledBack?.value === "baseline" });

    stage = "Очередь и блокировка записи";
    await Promise.all([1, 2].map(() => writer.write((tx) =>
      tx.run("UPDATE f04_probe_items SET revision = revision + 1 WHERE id = ?", [id]),
    )));
    const resume = await writer.quiesce();
    let blocked = false;
    try { await writer.write(async () => undefined); }
    catch { blocked = true; }
    resume();
    const revision = await connection.first<{ revision: number }>("SELECT revision FROM f04_probe_items WHERE id = ?", [id]);
    checks.push({ name: stage, passed: blocked && revision?.revision === 2 });
    return { checks, allPassed: checks.length === 5 && checks.every((check) => check.passed), transactions: transactionCounts() };
  } catch {
    checks.push({ name: stage, passed: false });
    return { checks, allPassed: false, transactions: transactionCounts() };
  } finally {
    await connection?.close();
  }
}
