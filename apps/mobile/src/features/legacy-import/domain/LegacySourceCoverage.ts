import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { PLAN_SOURCE_TABLES, EXECUTION_SOURCE_TABLES, NUTRITION_SOURCE_TABLES, type LegacyImportSourceSnapshots, type LegacySourceRow } from "./LegacySourceSnapshots.ts";

export type { LegacySourceCoverage, LegacySourceCoverageObject } from "./LegacySourceSnapshots.ts";
export const coverageFailure = (): never => { throw new Error("R04_ID_LEDGER_SOURCE_COVERAGE_MISMATCH"); };
export const coverageDigest = (value: string): string => bytesToHex(sha256(utf8ToBytes(value)));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Tags distinguish a BLOB from source JSON/text resembling a BLOB envelope. */
export function coverageRows(rows: readonly LegacySourceRow[]): string {
  const cell = (value: unknown): readonly unknown[] => {
    if (value === null) return ["NULL"];
    if (typeof value === "string") return ["TEXT", value];
    if (value instanceof Uint8Array) return ["BLOB", bytesToHex(value)];
    if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return ["NUMBER", Object.is(value, -0) ? "-0" : String(value)];
    return coverageFailure();
  };
  return JSON.stringify(rows.map((row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => compare(a, b)).map(([key, value]) => [key, cell(value)]))).sort(compare));
}

/** Whole-table collectors only: subset Calendar settings and Q owner reads do
 * not count as coverage when the authoritative full collector is absent. */
export function collectedLegacyTables(source: Omit<LegacyImportSourceSnapshots, "coverage">): ReadonlyMap<string, readonly LegacySourceRow[] | null> {
  const tables = new Map<string, readonly LegacySourceRow[] | null>([
    ["clients", source.clients.rows], ["exercise_catalog", source.exerciseCatalog.rows],
    ["app_settings", source.settings.rows], ["client_measurements", source.measurements.rows],
    ["calendar_appointments", source.calendar.appointments],
    ["questionnaire_templates", source.questionnaire?.templates ?? null], ["questionnaire_revisions", source.questionnaire?.revisions ?? null],
    ["client_questionnaire_answers", source.questionnaire?.answers ?? null], ["questionnaire_change_sets", source.questionnaire?.changes ?? null],
  ]);
  for (const name of PLAN_SOURCE_TABLES) tables.set(name, source.plans.tables[name]);
  for (const name of EXECUTION_SOURCE_TABLES) tables.set(name, source.executions.tables[name]);
  for (const name of NUTRITION_SOURCE_TABLES) tables.set(name, source.nutrition.tables[name]);
  return tables;
}

export const legacyCoverageMetadata = new Set(["athlete_backup_manifest", "account_database_binding", "schema_migrations", "backup_state"]);
