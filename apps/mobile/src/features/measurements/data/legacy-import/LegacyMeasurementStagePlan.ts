import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { legacyStageQuery as query, legacyStageRun as run, type LegacyWritePlan } from "../../../../shared/migration/LegacyWritePlan.ts";
import { measurementsBaseline } from "../MeasurementsBaseline.generated.ts";
import { isLocalDate } from "../../domain/MeasurementRules.ts";
import type { CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacyStageClient, LegacyStageClientIds } from "../../../../shared/migration/LegacyStageExtension.ts";
import { projectLegacyMeasurementSourceRow } from "../../domain/legacy-import/LegacyMeasurementSource.ts";
import type { LegacyMeasurementsSnapshot } from "../../../../shared/migration/LegacyMeasurementSources.ts";
import { projectLegacyMeasurementInputs } from "../../domain/legacy-import/LegacyMeasurementProjection.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import { projectLegacyClientDaySourceRow } from "../../../../shared/migration/LegacyClientDaySource.ts";
import { projectLegacyDailyWeightInputs, reconcileLegacyWeightSources } from "../../domain/legacy-import/LegacyWeightSourceReconciliation.ts";

function fail(code: string): never { throw new Error(`R04_ID_LEDGER_MEASUREMENTS_${code}`); }
const digest = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("PAYLOAD_INVALID");
}
const targetTables = ["body_measurements", "measurement_daily_primary", "r04_measurement_ids"] as const;
const baselineObjects = measurementsBaseline.flatMap((s) => s.statements).map((sql) => {
  const m = /^CREATE (?:UNIQUE )?(TABLE|INDEX)\s+"?([a-z_][a-z0-9_]*)"?/u.exec(sql);
  return m ? [m[2]!, m[1]!.toLowerCase()] : fail("SCHEMA_UNAVAILABLE");
});
export const measurementRehearsalObjects: Readonly<Record<string, string>> = Object.fromEntries([...baselineObjects,
  ["r04_measurement_ids", "table"], ["r04_measurement_receipt", "table"]]);
/** Only reuses existing D01 definitions inside an isolated R04 staging job. */
export function* legacyMeasurementSchemaPlan(): LegacyWritePlan<void> {
  for (const step of measurementsBaseline) for (const sql of step.statements) yield run(sql);
  yield run("CREATE TABLE r04_measurement_ids(source_key TEXT PRIMARY KEY NOT NULL,target_id TEXT NOT NULL UNIQUE)");
  yield run("CREATE TABLE r04_measurement_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),target_json TEXT NOT NULL CHECK(json_valid(target_json)),target_sha256 TEXT NOT NULL CHECK(length(target_sha256)=64))");
}
export type { LegacyMeasurementCheckpoint as MeasurementStageCheckpoint } from "../../../../shared/migration/LegacyWritePlan.ts";
export interface LegacyMeasurementStageResult {
  readonly measurementSourceRows: number; readonly measurementSourceValues: number; readonly measurementRows: number;
  readonly measurementReviewValues: number; readonly dailyWeightSourceRows: number; readonly weightMeasurementRows: number;
  readonly undatedProfileWeightSnapshots: number; readonly finalizable: false;
}
type Row = Record<string, string | number | null>;
export function* legacyMeasurementStagePlan(context: CandidateIdentityContext, importedAt: string, referenceDay: string,
  cards: readonly LegacyStageClient[], ids: LegacyStageClientIds, source: LegacyMeasurementsSnapshot, allocate: () => string): LegacyWritePlan<LegacyMeasurementStageResult> {
  if (!isExplicitTimestamp(importedAt) || !isLocalDate(referenceDay)) return fail("CONTEXT_INVALID");
  if (source.accountScope !== context.accountScope || source.rows !== null && !Array.isArray(source.rows)
    || source.clientDays !== null && !Array.isArray(source.clientDays)) return fail("SOURCE_INVALID");
  const clients = new Map<string, string>();
  for (const card of cards) {
    const id = ids.clients.get(card.identity.sourceIdentityKey);
    if (!id || card.identity.accountScope !== context.accountScope || card.identity.sourceWorkspaceId !== context.sourceWorkspaceId) return fail("OWNER_INVALID");
    clients.set(card.identity.sourceClientId, id);
  }
  const rows = (source.rows ?? []).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.client_id !== "string" || !clients.has(row.client_id)) return fail("OWNER_INVALID");
    return projectLegacyMeasurementSourceRow(context.accountScope, row, true);
  });
  const days = (source.clientDays ?? []).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.client_id !== "string" || !clients.has(row.client_id)) return fail("OWNER_INVALID");
    return projectLegacyClientDaySourceRow(context.accountScope, row, true);
  });
  // Explicit calendar day, reconstructed at local noon only for the existing
  // validator. No host timezone or retry-time clock chooses the cutoff day.
  const referenceTime = new Date(`${referenceDay}T12:00:00`), dailyWeights = projectLegacyDailyWeightInputs(days, referenceTime);
  const candidates = [...projectLegacyMeasurementInputs(rows, referenceTime), ...dailyWeights]
    .sort((a, b) => compare(a.source.sourceAtomKey, b.source.sourceAtomKey));
  const profiles = cards.map((card) => ({ sourceKey: JSON.stringify([context.accountScope, "clients", card.identity.sourceClientId, "weight"]),
    clientId: card.identity.sourceClientId, present: Object.hasOwn(card.raw, "weight"), value: Object.hasOwn(card.raw, "weight") ? card.raw.weight : null }))
    .sort((a, b) => compare(a.sourceKey, b.sourceKey));
  const profileSnapshots = profiles.filter((p) => p.present && !(p.value === null || typeof p.value === "string" && !p.value.trim()))
    .map((p) => ({ sourceKey: p.sourceKey, clientId: clients.get(p.clientId)!, targetId: null, datePrecision: "UNKNOWN",
      issues: ["PROFILE_WEIGHT_HAS_NO_MEASUREMENT_DATE"] }));
  const weightReconciliation = reconcileLegacyWeightSources(profiles.filter((p) => p.present).map((p) => ({ accountScope: context.accountScope, clientId: p.clientId, weightRaw: p.value })),
    dailyWeights.map((c) => c.source));
  const wanted = new Set(candidates.filter((c) => c.input !== null).map((c) => c.source.sourceAtomKey));
  const known = new Map<string, string>(), usedIds = new Set<string>();
  for (const row of (yield query("SELECT * FROM r04_measurement_ids"))) {
    if (typeof row.source_key !== "string" || !wanted.has(row.source_key) || typeof row.target_id !== "string" || !uuid.test(row.target_id) || usedIds.has(row.target_id)) return fail("IDENTITY_INVALID");
    known.set(row.source_key, row.target_id); usedIds.add(row.target_id);
  }
  for (const key of [...wanted].sort(compare)) if (!known.has(key)) {
    const id = allocate();
    if (!uuid.test(id) || usedIds.has(id) || (yield query("SELECT 1 FROM r04_candidate_ids WHERE target_id=?", [id])).length
      || (yield query("SELECT 1 FROM r04_work_ids WHERE target_id=?", [id])).length || (yield query("SELECT 1 FROM r04_plan_ids WHERE target_id=?", [id])).length
      || (yield query("SELECT 1 FROM r04_execution_ids WHERE target_id=?", [id])).length) return fail("IDENTITY_COLLISION");
    known.set(key, id); usedIds.add(id); yield run("INSERT INTO r04_measurement_ids VALUES(?,?)", [key, id]);
  }
  yield { kind: "checkpoint", phase: "after-measurement-ids" };
  const measurements: Row[] = [], provenance = candidates.map((c) => {
    const id = known.get(c.source.sourceAtomKey) ?? null, input = c.input;
    if (input !== null) measurements.push({ id: id!, workspace_id: context.targetWorkspaceId, client_id: clients.get(c.source.clientId)!,
      type: input.type, value_x10: input.valueX10, local_date: input.localDate, local_minute: null, method: "MANUAL", revision: 1,
      created_at: importedAt, updated_at: importedAt });
    return { sourceKey: c.source.sourceAtomKey, clientId: clients.get(c.source.clientId)!, targetId: id,
      input, issues: c.issues, unit: c.unit, createdAtBasis: "IMPORT_TIME", datePrecision: "DATE", primaryChosen: false,
      sourceSemantics: c.unit === "kg" ? "SAVED_DAY_VALUE_PROFILE_PREFILL_POSSIBLE" : "RECORDED_CIRCUMFERENCE" };
  });
  const projected: Readonly<Record<typeof targetTables[number], readonly Row[]>> = { body_measurements: measurements, measurement_daily_primary: [],
    r04_measurement_ids: [...known].map(([source_key, target_id]) => ({ source_key, target_id })) };
  const sourceJson = canonical({ accountScope: source.accountScope, rows: source.rows === null ? null : source.rows.map(canonical).sort(compare),
    clientDays: source.clientDays === null ? null : source.clientDays.map(canonical).sort(compare), profiles });
  const tables = targetTables.map((name) => ({ name, rows: projected[name].map(canonical).sort(compare) }));
  const targetJson = canonical({ projectionVersion: 2, referenceDay, importedAt, provenance, profileSnapshots, weightReconciliation, tables,
    sourceSha256: digest(sourceJson) });
  const receipts = (yield query("SELECT * FROM r04_measurement_receipt"));
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_json !== sourceJson || receipts[0]?.target_json !== targetJson)) return fail("PARITY_MISMATCH");
  for (const name of targetTables.slice(0, 2)) {
    if (!receipts.length) {
      if ((yield query(`SELECT count(*) AS n FROM ${name}`))[0]?.n !== 0) return fail("FOREIGN_TARGET");
      for (const row of projected[name]) {
        const columns = Object.keys(row); yield run(`INSERT INTO ${name}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, Object.values(row));
      }
    }
  }
  yield { kind: "checkpoint", phase: "after-measurement-rows" };
  if (!receipts.length) yield run("INSERT INTO r04_measurement_receipt VALUES(1,?,?,?)", [sourceJson, targetJson, digest(targetJson)]);
  yield* legacyLoadMeasurementsPlan(); yield { kind: "checkpoint", phase: "after-measurement-receipt" };
  return { measurementSourceRows: rows.length, measurementSourceValues: candidates.length, measurementRows: measurements.length,
    measurementReviewValues: candidates.length - measurements.length, dailyWeightSourceRows: days.length,
    weightMeasurementRows: measurements.filter((r) => r.type === "WEIGHT").length, undatedProfileWeightSnapshots: profileSnapshots.length, finalizable: false as const };
}
export function* legacyLoadMeasurementsPlan(): LegacyWritePlan<readonly Readonly<Row>[]> {
  const receipts = (yield query("SELECT * FROM r04_measurement_receipt"));
  if (receipts.length !== 1 || receipts[0]?.id !== 1) return fail("NOT_STAGED");
  if (receipts[0].target_sha256 !== digest(receipts[0].target_json as string)) return fail("PARITY_MISMATCH");
  let saved: unknown; try { saved = JSON.parse(receipts[0].target_json as string) as unknown; } catch { return fail("PARITY_MISMATCH"); }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return fail("PARITY_MISMATCH");
  const value = saved as Record<string, unknown>;
  if (value.projectionVersion !== 2 || !Array.isArray(value.tables) || value.tables.length !== targetTables.length
    || value.sourceSha256 !== digest(receipts[0].source_json as string)) return fail("PARITY_MISMATCH");
  const seen = new Set<string>();
  for (const raw of value.tables) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("PARITY_MISMATCH");
    const table = raw as Record<string, unknown>;
    if (typeof table.name !== "string" || !targetTables.includes(table.name as typeof targetTables[number]) || seen.has(table.name) || !Array.isArray(table.rows)) return fail("PARITY_MISMATCH");
    seen.add(table.name);
    if (canonical((yield query(`SELECT * FROM ${table.name}`)).map((r) => canonical({ ...r })).sort(compare)) !== canonical(table.rows)) return fail("PARITY_MISMATCH");
  }
  return (yield query("SELECT * FROM body_measurements ORDER BY id")) as readonly Readonly<Row>[];
}
