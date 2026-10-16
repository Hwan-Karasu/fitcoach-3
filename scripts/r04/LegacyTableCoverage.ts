import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { summarizeLegacyRowInventory, type LegacyRowInventorySummary } from "./LegacyRowInventory.ts";
import { summarizeLegacySourceIdentity, type LegacySourceIdentitySummary } from "./LegacySourceIdentity.ts";

/** Fingerprint of column metadata in the one observed build120 backup, not a target schema. */
export const observedBuild120ColumnShapeDigest = "0c4b6ee5c994e7dc462f55a4bbdabf4865ad51e60638a3e9d1b0482c8624fd9a";
/** DDL fingerprint from the same backup; it does not establish data semantics. */
export const observedBuild120SchemaDigest = "96c2a8a6aaa944cb7034406067a8f429855c7aafb2e4bb557adf2c67ad94cb9e";

/** Names observed in the one provided build120 backup, not a universal legacy schema. */
export const observedBuild120Tables = {
  sourceGateInspected: [
    "account_database_binding", "athlete_backup_manifest", "calendar_appointments", "client_day_facts", "client_measurements", "clients", "schema_migrations",
    "nutrition_days", "training_archive_entries", "training_exercise_history", "training_exercises", "training_session_exercises",
    "training_session_sets", "training_sessions", "training_set_logs", "training_workout_logs",
    "training_workouts",
  ],
  mappingPending: [
    "app_settings", "backup_state", "client_kbju_state",
    "client_questionnaire_answers", "coaching_program_permissions",
    "exercise_catalog", "exercise_identity_unresolved", "food_products", "import_jobs", "inbox_events",
    "nutrition_archive_weeks", "nutrition_recipes", "program_change_requests",
    "questionnaire_change_sets", "questionnaire_revisions", "questionnaire_templates", "sync_cursors",
    "sync_operations", "sync_revisions",
    "training_library_preferences", "training_library_programs", "training_program_view_state",
    "training_programs", "training_set_segments", "training_weeks",
    "training_workspaces",
  ],
  columnShapeDigest: observedBuild120ColumnShapeDigest,
  schemaDigest: observedBuild120SchemaDigest,
} as const;

export interface LegacyTableCoverage extends LegacyRowInventorySummary, LegacySourceIdentitySummary {
  readonly status: "requires-mapping" | "blocked-source-shape" | "blocked-source-identity";
  readonly observedTableCount: number;
  readonly registeredTableCount: number;
  readonly missingRegisteredTables: number;
  readonly unregisteredTables: number;
  readonly sourceGateInspectedTables: number;
  readonly mappingPendingTables: number;
  /** null means no shape baseline was supplied for a synthetic/custom registry. */
  readonly columnShapeMatchesObservedBaseline: boolean | null;
  /** Includes table, index, view and trigger DDL; not a source→target proof. */
  readonly schemaMatchesObservedBaseline: boolean | null;
  readonly targetMappedTables: 0;
}

export type CoverageRegistry = Readonly<{
  sourceGateInspected: readonly string[];
  mappingPending: readonly string[];
  columnShapeDigest?: string;
  schemaDigest?: string;
}>;

/** Stable digest of schema metadata only; no row values or source IDs are read. */
export function computeLegacyColumnShapeDigest(db: DatabaseSync, tableNames: readonly string[]): string {
  const hash = createHash("sha256");
  for (const name of [...tableNames].sort()) {
    const columns = db.prepare("SELECT name, type, \"notnull\", dflt_value, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid")
      .all(name).map((row) => [
        String(row.name), String(row.type ?? ""), Number(row.notnull),
        row.dflt_value === null ? null : String(row.dflt_value), Number(row.pk), Number(row.hidden),
      ]);
    hash.update(JSON.stringify([name, columns]));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/** Hashes DDL metadata only, including index/FK definitions; never reads table rows. */
export function computeLegacySchemaDigest(db: DatabaseSync): string {
  const rows = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE substr(name,1,7)<>'sqlite_' AND type IN ('table','index','view','trigger')
    ORDER BY type, name`).all();
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(JSON.stringify([row.type, row.name, row.tbl_name, row.sql]));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/** Aggregate-only shape coverage. Exact names do not establish semantic mapping. */
export function auditLegacyTableCoverage(
  db: DatabaseSync,
  registry: CoverageRegistry = observedBuild120Tables,
  accountScope?: string,
): LegacyTableCoverage {
  const registeredNames = [...registry.sourceGateInspected, ...registry.mappingPending];
  const registered = new Set(registeredNames);
  if (registered.size !== registeredNames.length || registeredNames.some((name) => !name.trim())) {
    throw new Error("R04_COVERAGE_REGISTRY_INVALID");
  }
  db.exec("PRAGMA query_only = ON");
  const observed = new Set(db.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND substr(name,1,7)<>'sqlite_'`).all().map((row) => String(row.name)));
  const missingRegisteredTables = registeredNames.filter((name) => !observed.has(name)).length;
  const unregisteredTables = [...observed].filter((name) => !registered.has(name)).length;
  const columnShapeMatchesObservedBaseline = registry.columnShapeDigest === undefined
    ? null
    : missingRegisteredTables === 0 && unregisteredTables === 0
      && computeLegacyColumnShapeDigest(db, registeredNames) === registry.columnShapeDigest;
  const schemaMatchesObservedBaseline = registry.schemaDigest === undefined
    ? null : computeLegacySchemaDigest(db) === registry.schemaDigest;
  const rowInventory = summarizeLegacyRowInventory(db, [...observed]);
  const identity = summarizeLegacySourceIdentity(db, [...observed], rowInventory.totalPhysicalRows, accountScope);
  const sourceShapeMatches = missingRegisteredTables === 0 && unregisteredTables === 0
    && columnShapeMatchesObservedBaseline !== false && schemaMatchesObservedBaseline !== false;
  return {
    status: !sourceShapeMatches ? "blocked-source-shape"
      : identity.unkeyedTables > 0 || identity.rowsWithoutCompleteKey > 0
        ? "blocked-source-identity" : "requires-mapping",
    observedTableCount: observed.size,
    registeredTableCount: registered.size,
    missingRegisteredTables,
    unregisteredTables,
    sourceGateInspectedTables: registry.sourceGateInspected.filter((name) => observed.has(name)).length,
    mappingPendingTables: registry.mappingPending.filter((name) => observed.has(name)).length,
    columnShapeMatchesObservedBaseline,
    schemaMatchesObservedBaseline,
    ...rowInventory,
    ...identity,
    targetMappedTables: 0,
  };
}
