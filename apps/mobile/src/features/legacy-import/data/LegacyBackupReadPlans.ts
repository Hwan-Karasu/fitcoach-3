import { LegacySourceAdmissionError, type LegacyBackupAdmission, type LegacyBackupInventory } from "../domain/LegacyBackupInventory.ts";
import { parseSourceJson } from "../domain/SourceJson.ts";
import type { LegacySourceRow } from "../domain/LegacySourceSnapshots.ts";
import type { LegacySourceReadPlan } from "./LegacySourceReadPlans.ts";

const required: Readonly<Record<string, readonly string[]>> = { account_database_binding: ["scope_key"], athlete_backup_manifest: ["json"],
  clients: ["id", "workspace_id"], schema_migrations: ["version"], training_sessions: ["id", "client_id"] };
const canonical25Tables = ["clients", "training_workspaces", "training_programs", "training_weeks", "training_workouts", "training_exercises",
  "training_set_logs", "app_settings", "training_sessions", "training_session_exercises", "training_session_sets", "training_library_programs",
  "training_library_preferences", "training_program_view_state", "coaching_program_permissions"] as const;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const q = (sql: string) => ({ sql, bindings: [] });
// SQLite trim() defaults to ASCII space; source identity validation uses JS trim().
const trimmedWorkspace = "trim(workspace_id,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))";

/** Compare normalized decimal digits, never the rounded Number alone. */
function exactInteger(source: string): number | null {
  const n = Number(source); if (!Number.isSafeInteger(n)) return null;
  const [mantissa, power = "0"] = source.toLowerCase().split("e"), unsigned = mantissa!.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split("."), digits = (whole! + fraction).replace(/^0+/, "");
  if (!digits) return n;
  if (n === 0) return null;
  const sourceDigits = digits.replace(/0+$/, ""), target = String(Math.abs(n)), targetDigits = target.replace(/0+$/, "");
  const exponent = Number(power) - fraction.length + digits.length - sourceDigits.length;
  return Number.isSafeInteger(exponent) && sourceDigits === targetDigits && exponent === target.length - targetDigits.length ? n : null;
}
function manifest(raw: unknown): LegacySourceRow | null {
  if (typeof raw !== "string" || raw.length > 16384 || !raw.trimStart().startsWith("{")) return null;
  try {
    const value = parseSourceJson(raw, (_key, source) => exactInteger(source) ?? { unrepresentableNumber: source });
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as LegacySourceRow : null;
  } catch { return null; }
}
const numberField = (record: LegacySourceRow | null, name: string): number | null => typeof record?.[name] === "number" && Number.isSafeInteger(record[name]) ? record[name] as number : null;
function count(rows: readonly LegacySourceRow[]): number {
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.n) || (rows[0]!.n as number) < 0) throw new Error("R04_SOURCE_COUNT_INVALID");
  return rows[0]!.n as number;
}
function* columns(table: string): LegacySourceReadPlan<Set<string>> {
  const rows = yield { sql: "SELECT name,hidden FROM pragma_table_xinfo(?)", bindings: [table] };
  return new Set(rows.filter((row) => row.hidden === 0 && typeof row.name === "string").map((row) => row.name as string));
}

/** Explicit namespace fields from pinned migrations 018/027, never labels,
 * actor IDs or JSON payloads. An unused questionnaire can outlive all clients.
 * Aggregate inventory still reports client counts; this resolves private scope.
 */
function* sourceWorkspacePlan(tables: ReadonlySet<string>, clientWorkspace: string | null): LegacySourceReadPlan<{
  sourceWorkspaceId: string | null; ambiguous: boolean; missing: string[];
}> {
  const observed = new Set(clientWorkspace === null ? [] : [clientWorkspace]), missing: string[] = [];
  let ambiguous = false;
  for (const [table, field, where] of [
    ["questionnaire_templates", "workspace_id", ""],
    ["questionnaire_revisions", "workspace_id", ""],
    ["training_programs", "template_workspace_id", " WHERE is_template=1"],
  ] as const) {
    if (!tables.has(table)) continue;
    const names = yield* columns(table);
    // template_workspace_id did not exist before migration 027. The owner
    // projector separately checks representability when templates are present.
    if (!names.has(field)) { if (!where) missing.push(`${table}.${field}`); continue; }
    if (where && !names.has("is_template")) { missing.push(`${table}.is_template`); continue; }
    // Shield non-text storage before crossing the native bridge. BINARY avoids
    // source NOCASE collations merging different owners; JS validates whitespace.
    const rows = yield q(`SELECT DISTINCT CASE WHEN typeof(${field})='text' THEN ${field} ELSE NULL END COLLATE BINARY AS workspace_id FROM ${table}${where} LIMIT 2`);
    for (const row of rows) {
      if (!text(row.workspace_id)) ambiguous = true;
      else observed.add(row.workspace_id);
    }
  }
  return { sourceWorkspaceId: observed.size === 1 ? [...observed][0]! : null, ambiguous: ambiguous || observed.size > 1, missing };
}

/** Shared historical inventory; this alone is not strict file admission. */
export function* legacyBackupInspectionPlan(): LegacySourceReadPlan<{
  inventory: LegacyBackupInventory; manifest: LegacySourceRow | null; accountScope: string | null;
  sourceWorkspaceId: string | null; tables: Set<string>; physical: Map<string, Set<string>>;
}> {
  const objects = yield q("SELECT name,type FROM sqlite_schema WHERE type IN ('table','view')"), tables = new Set(objects.filter((row) => row.type === "table").map((row) => row.name as string));
  const missing: string[] = [], physical = new Map<string, Set<string>>();
  for (const [table, fields] of Object.entries(required)) {
    if (!tables.has(table)) { missing.push(table); continue; }
    const names = yield* columns(table); physical.set(table, names);
    for (const name of fields) if (!names.has(name)) missing.push(`${table}.${name}`);
  }
  const has = (table: string, name: string) => physical.get(table)?.has(name) === true;
  const integrity = yield q("PRAGMA integrity_check"), foreignKeys = yield q("PRAGMA foreign_key_check");
  const integrityErrors = integrity.length === 1 && integrity[0]!.integrity_check === "ok" ? 0 : Math.max(1, integrity.length);
  const manifestRows = has("athlete_backup_manifest", "json") ? yield q("SELECT CASE WHEN typeof(json)='text' AND length(json)<=16384 THEN json ELSE NULL END AS json FROM athlete_backup_manifest LIMIT 2") : [];
  const parsed = manifestRows.length === 1 ? manifest(manifestRows[0]!.json) : null;
  const formatVersion = numberField(parsed, "formatVersion"), schemaVersion = numberField(parsed, "schemaVersion"), sourceSchemaVersion = numberField(parsed, "sourceSchemaVersion");
  const migrationRows = tables.has("schema_migrations") ? count(yield q("SELECT count(*) AS n FROM schema_migrations")) : 0;
  const versions = has("schema_migrations", "version") ? yield q("SELECT CASE WHEN typeof(version)='integer' AND version BETWEEN 1 AND 25 THEN version ELSE NULL END AS version FROM schema_migrations ORDER BY version LIMIT 26") : [];
  const observedVersions = versions.map((row) => row.version);
  const maximum = has("schema_migrations", "version") ? yield q("SELECT CASE WHEN typeof(max(version))='integer' AND max(version) BETWEEN -9007199254740991 AND 9007199254740991 THEN max(version) ELSE NULL END AS version FROM schema_migrations") : [];
  const migrationMax = typeof maximum[0]?.version === "number" ? maximum[0].version : null;
  const migrationLedgerContiguous = migrationRows === 25 && observedVersions.length === 25 && observedVersions.every((value, index) => value === index + 1);
  const bindingRows = tables.has("account_database_binding") ? count(yield q("SELECT count(*) AS n FROM account_database_binding")) : 0;
  const bindings = has("account_database_binding", "scope_key") ? yield q("SELECT scope_key FROM account_database_binding LIMIT 2") : [];
  const rawScope = parsed?.accountScopeKey, scope = text(rawScope) ? rawScope : null;
  const bindingMatchesManifest = scope !== null && bindingRows === 1 && bindings.length === 1 && bindings[0]!.scope_key === scope;
  const clientRows = tables.has("clients") ? count(yield q("SELECT count(*) AS n FROM clients")) : 0;
  const distinctClientWorkspaces = has("clients", "workspace_id") ? count(yield q(`SELECT count(DISTINCT workspace_id COLLATE BINARY) AS n FROM clients WHERE typeof(workspace_id)='text' AND length(${trimmedWorkspace})>0`)) : 0;
  const missingClientWorkspaceRows = has("clients", "workspace_id") ? count(yield q(`SELECT count(*) AS n FROM clients WHERE typeof(workspace_id)<>'text' OR length(${trimmedWorkspace})=0`)) : 0;
  const workspaces = has("clients", "workspace_id") && clientRows > 0 && distinctClientWorkspaces === 1 && missingClientWorkspaceRows === 0
    ? yield q("SELECT workspace_id FROM clients LIMIT 1") : [];
  const reasons: string[] = [];
  if (missing.length) reasons.push("UNSUPPORTED_SHAPE");
  if (integrityErrors) reasons.push("INTEGRITY_FAILED");
  if (foreignKeys.length) reasons.push("FOREIGN_KEYS_FAILED");
  if (parsed === null || manifestRows.length !== 1) reasons.push("MANIFEST_INVALID");
  if (formatVersion !== 1 || schemaVersion !== 25) reasons.push("UNSUPPORTED_VERSION");
  if (migrationRows !== 25 || migrationMax !== 25 || !migrationLedgerContiguous) reasons.push("MIGRATION_LEDGER_UNEXPECTED");
  if (!bindingMatchesManifest) reasons.push("BINDING_UNVERIFIED");
  if (clientRows > 0 && (distinctClientWorkspaces !== 1 || missingClientWorkspaceRows > 0)) reasons.push("WORKSPACE_AMBIGUOUS");
  return { inventory: { format: "sqlite-atbackup", tableCount: tables.size, integrityErrors, foreignKeyErrors: foreignKeys.length,
    formatVersion, schemaVersion, sourceSchemaVersion, migrationRows, migrationMax, migrationLedgerContiguous, bindingRows, bindingMatchesManifest,
    clientRows, distinctClientWorkspaces, missingClientWorkspaceRows, missingRequiredShape: missing, status: reasons.length ? "blocked" : "candidate", reasons },
    manifest: parsed, accountScope: scope, sourceWorkspaceId: text(workspaces[0]?.workspace_id) ? workspaces[0]!.workspace_id as string : null, tables, physical };
}

/** Strict canonical-v25 file candidate checks, on the same pinned transaction
 * used by the collectors. Passing does not establish complete mapping/parity.
 */
export function* legacyBackupAdmissionPlan(fileBytes: number): LegacySourceReadPlan<LegacyBackupAdmission> {
  const inspected = yield* legacyBackupInspectionPlan(), { inventory, manifest: m, tables, physical } = inspected;
  const reasons = [...inventory.reasons], missing = [...inventory.missingRequiredShape];
  for (const table of canonical25Tables) if (!tables.has(table) && !missing.includes(table)) missing.push(table);
  for (const [table, fields] of Object.entries({ athlete_backup_manifest: ["id"], account_database_binding: ["id"], backup_state: ["id", "database_id", "data_revision"] })) {
    if (!tables.has(table)) { if (!missing.includes(table)) missing.push(table); continue; }
    const names = physical.get(table) ?? (yield* columns(table));
    for (const field of fields) if (!names.has(field)) missing.push(`${table}.${field}`);
  }
  if (missing.length && !reasons.includes("UNSUPPORTED_SHAPE")) reasons.push("UNSUPPORTED_SHAPE");
  const dataRevision = numberField(m, "dataRevision"), databaseSize = numberField(m, "databaseSize");
  if (!m || !text(m.appVersion) || !text(m.backupId) || !text(m.databaseId) || !["manual", "auto"].includes(m.type as string)
    || typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt)) || dataRevision === null || dataRevision < 0 || databaseSize === null || databaseSize <= 0
    || Object.hasOwn(m, "sourceSchemaVersion") && (inventory.sourceSchemaVersion === null || inventory.sourceSchemaVersion < 25)) {
    if (!reasons.includes("MANIFEST_INVALID")) reasons.push("MANIFEST_INVALID");
  }
  const pages = yield q("PRAGMA page_count"), size = yield q("PRAGMA page_size");
  const pageCount = pages[0]?.page_count, pageSize = size[0]?.page_size;
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 100 || !Number.isSafeInteger(pageCount) || !Number.isSafeInteger(pageSize)
    || !Number.isSafeInteger((pageCount as number) * (pageSize as number)) || fileBytes !== (pageCount as number) * (pageSize as number) || databaseSize !== fileBytes) reasons.push("MANIFEST_SIZE_MISMATCH");
  if (!missing.length) {
    for (const table of ["athlete_backup_manifest", "account_database_binding"]) {
      const ids = yield q(`SELECT CASE WHEN typeof(id)='integer' AND id=1 THEN 1 ELSE NULL END AS id FROM ${table} LIMIT 2`);
      if (ids.length !== 1 || ids[0]!.id !== 1) reasons.push("METADATA_SINGLETON_INVALID");
    }
    const state = yield q("SELECT CASE WHEN typeof(id)='integer' AND id=1 THEN 1 ELSE NULL END AS id,database_id,CASE WHEN typeof(data_revision)='integer' AND data_revision BETWEEN 0 AND 9007199254740991 THEN data_revision ELSE NULL END AS data_revision FROM backup_state LIMIT 2");
    if (state.length !== 1 || state[0]!.id !== 1 || !text(state[0]!.database_id) || state[0]!.database_id !== m?.databaseId || state[0]!.data_revision !== dataRevision || dataRevision === null) reasons.push("BACKUP_REVISION_MISMATCH");
  }
  let sourceWorkspaceId = inspected.sourceWorkspaceId;
  if (!reasons.length) {
    const scope = yield* sourceWorkspacePlan(tables, sourceWorkspaceId);
    sourceWorkspaceId = scope.sourceWorkspaceId;
    missing.push(...scope.missing);
    if (scope.missing.length) reasons.push("UNSUPPORTED_SHAPE");
    if (scope.ambiguous) reasons.push("WORKSPACE_AMBIGUOUS");
  }
  if (reasons.length || inspected.accountScope === null) throw new LegacySourceAdmissionError({ ...inventory, missingRequiredShape: missing, status: "blocked", reasons: [...new Set(reasons)] });
  return { inventory, accountScope: inspected.accountScope, sourceWorkspaceId,
    sourceDatabaseId: m!.databaseId as string, sourceDataRevision: dataRevision!, sourceBackupId: m!.backupId as string, sourceCreatedAt: m!.createdAt as string };
}
