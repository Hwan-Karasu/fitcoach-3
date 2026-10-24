import type { SQLiteDatabase } from "expo-sqlite";
import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { LegacyDomainSnapshots, LegacyImportSourceSnapshots, LegacySourceRow, LegacyTrainingSnapshots } from "../domain/LegacySourceSnapshots.ts";
import { legacyCalendarReadPlan, legacyMeasurementsReadPlan, legacyNutritionReadPlan, type LegacySourceReadPlan } from "./LegacySourceReadPlans.ts";
import { legacyBackupAdmissionPlan } from "./LegacyBackupReadPlans.ts";
import { legacyExecutionReadPlan, legacyPlansReadPlan } from "./LegacyTrainingReadPlans.ts";

export type NativeLegacySourceDatabase = Pick<SQLiteDatabase, "getAllAsync" | "execAsync" | "closeAsync">;

/** Internal adapter: open must return a fresh connection to an inspection copy,
 * never the picker/SAF source or the running app database. Expo has no readonly
 * open flag. File copy, source admission and immutable-copy ownership are the
 * caller's responsibilities; this class performs no migrations or file routing.
 */
export async function readLegacyDomainSnapshots(open: () => Promise<NativeLegacySourceDatabase>, accountScope: string): Promise<LegacyDomainSnapshots> {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  return withLegacySourceSnapshot(open, (reader) => collectLegacyDomainSnapshots(reader, accountScope));
}

export async function readAdmittedLegacyDomainSnapshots(open: () => Promise<NativeLegacySourceDatabase>, fileBytes: number) {
  return withLegacySourceSnapshot(open, async (reader) => {
    const admission = await runLegacyReadPlan(reader, legacyBackupAdmissionPlan(fileBytes));
    const snapshots: LegacyImportSourceSnapshots = { ...await collectLegacyDomainSnapshots(reader, admission.accountScope), ...await collectLegacyTrainingSnapshots(reader, admission.accountScope) };
    return { admission, snapshots };
  });
}

export async function readLegacyTrainingSnapshots(open: () => Promise<NativeLegacySourceDatabase>, accountScope: string): Promise<LegacyTrainingSnapshots> {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  return withLegacySourceSnapshot(open, (reader) => collectLegacyTrainingSnapshots(reader, accountScope));
}
async function collectLegacyTrainingSnapshots(reader: Pick<SqliteStatementPort, "all">, accountScope: string): Promise<LegacyTrainingSnapshots> {
  return { plans: await runLegacyReadPlan(reader, legacyPlansReadPlan(accountScope)), executions: await runLegacyReadPlan(reader, legacyExecutionReadPlan(accountScope)) };
}

async function collectLegacyDomainSnapshots(reader: Pick<SqliteStatementPort, "all">, accountScope: string): Promise<LegacyDomainSnapshots> {
  return { nutrition: await runLegacyReadPlan(reader, legacyNutritionReadPlan(accountScope)),
    measurements: await runLegacyReadPlan(reader, legacyMeasurementsReadPlan(accountScope)),
    calendar: await runLegacyReadPlan(reader, legacyCalendarReadPlan(accountScope)) };
}

async function withLegacySourceSnapshot<Result>(open: () => Promise<NativeLegacySourceDatabase>, task: (reader: Pick<SqliteStatementPort, "all">) => Promise<Result>): Promise<Result> {
  const db = await io(open);
  let begun = false, failure: { error: unknown } | null = null, result: Result | undefined;
  try {
    await io(() => db.execAsync("PRAGMA query_only=ON; PRAGMA foreign_keys=ON; PRAGMA read_uncommitted=OFF; PRAGMA trusted_schema=OFF"));
    for (const [name, expected] of [["query_only", 1], ["foreign_keys", 1], ["read_uncommitted", 0], ["trusted_schema", 0]] as const) {
      const rows = await io(() => db.getAllAsync<Record<string, unknown>>(`PRAGMA ${name}`));
      if (rows.length !== 1 || rows[0]![name] !== expected) throw new Error("R04_SOURCE_CONNECTION_CONFIGURATION_UNAVAILABLE");
    }
    await io(() => db.execAsync("BEGIN")); begun = true;
    // Pin the read snapshot before the first domain and keep it through all reads.
    await io(() => db.getAllAsync("SELECT count(*) AS n FROM sqlite_schema"));
    const reader: Pick<SqliteStatementPort, "all"> = { all: (sql, bindings = []) => io(() => db.getAllAsync(sql, ...bindings)) };
    result = await task(reader);
  } catch (error) { failure = { error }; }
  finally {
    let cleanupFailed = false;
    if (begun) try { await db.execAsync("ROLLBACK"); } catch { cleanupFailed = true; }
    try { await db.closeAsync(); } catch { cleanupFailed = true; }
    if (cleanupFailed && failure === null) failure = { error: new Error("R04_SOURCE_SNAPSHOT_CLOSE_FAILED") };
  }
  if (failure !== null) throw failure.error;
  return result!;
}

async function io<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch { throw new Error("R04_SOURCE_READ_FAILED"); }
}

export async function runLegacyReadPlan<Result>(reader: Pick<SqliteStatementPort, "all">, plan: LegacySourceReadPlan<Result>): Promise<Result> {
  let step = plan.next();
  while (!step.done) { const rows = await reader.all<LegacySourceRow>(step.value.sql, step.value.bindings); step = plan.next(rows); }
  return step.value;
}
