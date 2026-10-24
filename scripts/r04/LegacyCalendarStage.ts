import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { calendarBaseline } from "../../apps/mobile/src/features/calendar/data/CalendarBaseline.generated.ts";
import { accountingBaseline } from "../../apps/mobile/src/features/accounting/data/AccountingBaseline.generated.ts";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyCalendarSnapshot } from "./LegacyCalendarSnapshot.ts";
import { composeLegacyCalendar, type CalendarIdentityKind } from "./LegacyCalendarProjection.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";

const fail = (code: string): never => { throw new Error(`R04_ID_LEDGER_CALENDAR_${code}`); };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("PAYLOAD_INVALID");
}
const statements = [...calendarBaseline, ...accountingBaseline].flatMap((step) => step.statements);
const objects = statements.map((sql) => {
  const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER)\s+"?([a-z_][a-z0-9_]*)"?/u.exec(sql);
  return match ? [match[2]!, match[1]!.toLowerCase()] as const : fail("SCHEMA_UNAVAILABLE");
});
export const calendarTargetTables = objects.filter(([, type]) => type === "table").map(([name]) => name);
export const calendarRehearsalObjects = Object.fromEntries([...objects, ["r04_calendar_ids", "table"], ["r04_calendar_receipt", "table"]]);
export type CalendarStageCheckpoint = "after-calendar-ids" | "after-calendar-rows" | "after-calendar-receipt";
export function createCalendarRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) return fail("TRANSACTION_REQUIRED");
  for (const sql of statements) db.exec(sql);
  db.exec(`CREATE TABLE r04_calendar_ids(kind TEXT NOT NULL CHECK(kind IN ('SESSION_TYPE','APPOINTMENT','INTERVAL')),source_key TEXT NOT NULL,target_id TEXT NOT NULL UNIQUE,PRIMARY KEY(kind,source_key));
    CREATE TABLE r04_calendar_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),
      target_json TEXT NOT NULL CHECK(json_valid(target_json)),target_sha256 TEXT NOT NULL CHECK(length(target_sha256)=64));`);
}
export function stageLegacyCalendarInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, source: LegacyCalendarSnapshot, allocate: () => string,
  checkpoint: (stage: CalendarStageCheckpoint) => void) {
  if (!db.isTransaction || !isExplicitTimestamp(importedAt)) return fail("CONTEXT_INVALID");
  if (source.accountScope !== context.accountScope || Object.keys(source).length !== 4 || source.appointments !== null && !Array.isArray(source.appointments)
    || source.plannerRows !== null && !Array.isArray(source.plannerRows) || !Array.isArray(source.unsupportedAccountingTables)) return fail("SOURCE_INVALID");
  if (source.unsupportedAccountingTables.length) return fail("FINANCIAL_SOURCE_UNSUPPORTED");
  const clients = new Map<string, string>();
  for (const card of cards) {
    const targetId = ids.clients.get(card.identity.sourceIdentityKey);
    if (!targetId || card.identity.accountScope !== context.accountScope || card.identity.sourceWorkspaceId !== context.sourceWorkspaceId) return fail("OWNER_INVALID");
    clients.set(card.identity.sourceClientId, targetId);
  }
  const known = new Map<string, string>(), targets = new Set<string>(), used = new Set<string>();
  for (const row of db.prepare("SELECT * FROM r04_calendar_ids").all()) {
    const parts = JSON.parse(row.source_key as string) as unknown;
    if (!["SESSION_TYPE", "APPOINTMENT", "INTERVAL"].includes(row.kind as string) || !Array.isArray(parts) || parts[0] !== context.accountScope || canonical(parts) !== row.source_key
      || typeof row.target_id !== "string" || !uuid.test(row.target_id) || targets.has(row.target_id)) return fail("IDENTITY_INVALID");
    known.set(JSON.stringify([row.kind, row.source_key]), row.target_id); targets.add(row.target_id);
  }
  const identity = (kind: CalendarIdentityKind, key: string) => {
    const lookup = JSON.stringify([kind, key]); used.add(lookup); const existing = known.get(lookup); if (existing) return existing;
    const target = allocate();
    if (!uuid.test(target) || targets.has(target) || ["r04_candidate_ids", "r04_work_ids", "r04_plan_ids", "r04_execution_ids", "r04_measurement_ids", "r04_nutrition_ids"]
      .some((table) => db.prepare(`SELECT 1 FROM ${table} WHERE target_id=?`).get(target))) return fail("IDENTITY_COLLISION");
    db.prepare("INSERT INTO r04_calendar_ids VALUES(?,?,?)").run(kind, key, target); known.set(lookup, target); targets.add(target); return target;
  };
  const projection = composeLegacyCalendar(context, importedAt, source, clients, identity);
  if (used.size !== known.size) return fail("IDENTITY_INVALID"); checkpoint("after-calendar-ids");
  const sourceJson = canonical({ accountScope: source.accountScope, appointments: source.appointments?.map(canonical).sort(compare) ?? null,
    plannerRows: source.plannerRows?.map(canonical).sort(compare) ?? null, unsupportedAccountingTables: source.unsupportedAccountingTables });
  const tables = [...calendarTargetTables.map((name) => ({ name, rows: (projection.tables[name] ?? []).map(canonical).sort(compare) })),
    { name: "r04_calendar_ids", rows: db.prepare("SELECT * FROM r04_calendar_ids").all().map((row) => canonical({ ...row })).sort(compare) }];
  const targetJson = canonical({ projectionVersion: 1, importedAt, sourceSha256: hash(sourceJson), catalogBasis: "NEW_3X_INITIAL_DEFAULTS", accountingBasis: "NEW_3X_UNTRACKED_NO_SUPPORTED_SOURCE_FINANCE", tables, representations: projection.representations });
  const receipts = db.prepare("SELECT * FROM r04_calendar_receipt").all();
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0].source_json !== sourceJson || receipts[0].target_json !== targetJson)) return fail("PARITY_MISMATCH");
  for (const table of tables.filter((item) => item.name !== "r04_calendar_ids")) {
    if (!receipts.length) {
      if (db.prepare(`SELECT count(*) AS n FROM ${table.name}`).get()?.n !== 0) return fail("FOREIGN_TARGET");
      for (const raw of table.rows) {
        const row = JSON.parse(raw) as Record<string, string | number | null>, fields = Object.keys(row);
        db.prepare(`INSERT INTO ${table.name}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`).run(...Object.values(row));
      }
    }
    checkpoint("after-calendar-rows");
  }
  if (!receipts.length) db.prepare("INSERT INTO r04_calendar_receipt VALUES(1,?,?,?)").run(sourceJson, targetJson, hash(targetJson));
  loadStagedCalendar(db); checkpoint("after-calendar-receipt");
  return { calendarAppointmentRows: projection.tables.calendar_appointments!.length, calendarIntervalRows: projection.tables.calendar_intervals!.length,
    calendarTypeRows: projection.tables.session_types!.length, calendarReviewRepresentations: projection.representations.filter((row) => row.issues.length).length,
    creditSettlementsCreated: 0 as const, paymentFactsCreated: 0 as const, finalizable: false as const };
}
export function loadStagedCalendar(db: DatabaseSync) {
  const receipts = db.prepare("SELECT * FROM r04_calendar_receipt").all();
  if (receipts.length !== 1 || receipts[0]?.id !== 1) return fail("NOT_STAGED");
  if (receipts[0].target_sha256 !== hash(receipts[0].target_json as string)) return fail("PARITY_MISMATCH");
  let parsed: unknown; try { parsed = JSON.parse(receipts[0].target_json as string) as unknown; } catch { return fail("PARITY_MISMATCH"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("PARITY_MISMATCH");
  const manifest = parsed as Record<string, unknown>, seen = new Set<string>(), expected = [...calendarTargetTables, "r04_calendar_ids"];
  if (manifest.projectionVersion !== 1 || manifest.sourceSha256 !== hash(receipts[0].source_json as string) || !Array.isArray(manifest.tables) || manifest.tables.length !== expected.length) return fail("PARITY_MISMATCH");
  for (const raw of manifest.tables) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("PARITY_MISMATCH"); const table = raw as { name: string; rows: unknown };
    if (!expected.includes(table.name) || seen.has(table.name) || !Array.isArray(table.rows)) return fail("PARITY_MISMATCH"); seen.add(table.name);
    if (canonical(db.prepare(`SELECT * FROM ${table.name}`).all().map((row) => canonical({ ...row })).sort(compare)) !== canonical(table.rows)) return fail("PARITY_MISMATCH");
  }
  return db.prepare("SELECT * FROM calendar_appointments ORDER BY local_date,start_minute,id").all();
}
