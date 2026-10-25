import type { CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacySettingsSource } from "../../../../shared/migration/LegacySettingsSource.ts";
import { legacyStageQuery as query, legacyStageRun as run, type LegacyWritePlan } from "../../../../shared/migration/LegacyWritePlan.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import { settingsBaseline } from "../SettingsBaseline.generated.ts";
import { projectLegacySettings } from "../../domain/legacy-import/LegacySettingsProjection.ts";

const fail = (code: string): never => { throw new Error(`R04_ID_LEDGER_SETTINGS_${code}`); };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (value instanceof Uint8Array) return `{"sqlBlobHex":${JSON.stringify([...value].map((n) => n.toString(16).padStart(2, "0")).join(""))}}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("PAYLOAD_INVALID");
}
export const settingsRehearsalObjects: Readonly<Record<string, string>> = { settings: "table", r04_settings_source: "table", r04_settings_receipt: "table" };
export function* legacySettingsSchemaPlan(): LegacyWritePlan<void> {
  for (const step of settingsBaseline) for (const sql of step.statements) yield run(sql);
  yield run("CREATE TABLE r04_settings_source(source_key TEXT PRIMARY KEY,source_setting_key TEXT NOT NULL UNIQUE,disposition TEXT NOT NULL,target_key TEXT,issues_json TEXT NOT NULL CHECK(json_valid(issues_json)),source_json TEXT NOT NULL CHECK(json_valid(source_json)))");
  yield run("CREATE TABLE r04_settings_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),target_json TEXT NOT NULL CHECK(json_valid(target_json)))");
}
export interface LegacySettingsStageResult {
  readonly settingsRows: number; readonly sourceSettingRows: number; readonly settingsReviewRows: number;
  readonly settingsResetRows: number; readonly delegatedSettingRows: number; readonly finalizable: false;
}
export function* legacySettingsStagePlan(context: CandidateIdentityContext, importedAt: string, source: LegacySettingsSource): LegacyWritePlan<LegacySettingsStageResult> {
  if (source.accountScope !== context.accountScope || !isExplicitTimestamp(importedAt)) return fail("SCOPE_MISMATCH");
  const projection = projectLegacySettings(source);
  const settings = projection.appearance === null ? [] : [{ workspace_id: context.targetWorkspaceId, key: "appearance", value_json: canonical(projection.appearance), revision: 1, updated_at: importedAt }];
  const sources = projection.sourceRows.map((r) => ({ source_key: r.sourceKey, source_setting_key: r.key, disposition: r.disposition,
    target_key: r.targetKey, issues_json: canonical(r.issues), source_json: canonical(r.raw) }));
  const sourceJson = canonical({ accountScope: source.accountScope, rows: source.rows === null ? null : projection.sourceRows.map((r) => r.raw) });
  const targetJson = canonical({ settings, sources });
  const receipt = yield query("SELECT * FROM r04_settings_receipt");
  if (receipt.length > 1 || receipt.length === 1 && (receipt[0]?.id !== 1 || receipt[0]?.source_json !== sourceJson || receipt[0]?.target_json !== targetJson)) return fail("PARITY_MISMATCH");
  for (const [table, rows, phase] of [["settings", settings, "after-settings-rows"], ["r04_settings_source", sources, "after-settings-source"]] as const) {
    const before = yield query(`SELECT * FROM ${table}`);
    if (!receipt.length) {
      if (before.length) return fail("FOREIGN_TARGET");
      for (const row of rows) { const fields = Object.keys(row); yield run(`INSERT INTO ${table}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`, Object.values(row)); }
    }
    const actual = yield query(`SELECT * FROM ${table}`);
    if (canonical(actual.map(canonical).sort(compare)) !== canonical(rows.map(canonical).sort(compare))) return fail("PARITY_MISMATCH");
    yield { kind: "checkpoint", phase };
  }
  if (!receipt.length) yield run("INSERT INTO r04_settings_receipt VALUES(1,?,?)", [sourceJson, targetJson]);
  const saved = (yield query("SELECT * FROM r04_settings_receipt"))[0];
  if (saved?.id !== 1 || saved.source_json !== sourceJson || saved.target_json !== targetJson) return fail("PARITY_MISMATCH");
  yield { kind: "checkpoint", phase: "after-settings-receipt" };
  return { settingsRows: settings.length, sourceSettingRows: sources.length, settingsReviewRows: projection.sourceRows.filter((r) => r.issues.length || r.disposition === "REVIEW_REQUIRED").length,
    settingsResetRows: projection.sourceRows.filter((r) => r.disposition === "TECHNICAL_RESET").length, delegatedSettingRows: projection.sourceRows.filter((r) => r.disposition === "DELEGATED_CALENDAR" || r.disposition === "DELEGATED_TRAINING_DRAFT").length, finalizable: false };
}
