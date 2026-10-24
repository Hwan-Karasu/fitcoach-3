import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { nutritionBaseline } from "../../apps/mobile/src/features/nutrition/data/NutritionBaseline.generated.ts";
import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import { NUTRITION_SOURCE_TABLES, type LegacyNutritionSource } from "./LegacyNutritionSourceReader.ts";
import { composeLegacyNutrition, type NutritionIdentityKind } from "./LegacyNutritionProjection.ts";
import { nutritionFail as fail } from "./LegacyNutritionValues.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("PAYLOAD_INVALID");
}
const objects = nutritionBaseline.flatMap((s) => s.statements).map((sql) => {
  const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER)\s+"?([a-z_][a-z0-9_]*)"?/u.exec(sql);
  return match ? [match[2]!, match[1]!.toLowerCase()] as const : fail("SCHEMA_UNAVAILABLE");
});
export const nutritionTargetTables = objects.filter(([, type]) => type === "table").map(([name]) => name);
export const nutritionRehearsalObjects: Readonly<Record<string, string>> = Object.fromEntries([...objects, ["r04_nutrition_ids", "table"], ["r04_nutrition_receipt", "table"]]);
export function createNutritionRehearsalSchema(db: DatabaseSync): void {
  if (!db.isTransaction) return fail("TRANSACTION_REQUIRED");
  for (const step of nutritionBaseline) for (const sql of step.statements) db.exec(sql);
  db.exec(`CREATE TABLE r04_nutrition_ids(kind TEXT NOT NULL CHECK(kind IN ('FOOD','RECIPE','ENTRY')),source_key TEXT NOT NULL,target_id TEXT NOT NULL UNIQUE,PRIMARY KEY(kind,source_key));
    CREATE TABLE r04_nutrition_receipt(id INTEGER PRIMARY KEY CHECK(id=1),source_json TEXT NOT NULL CHECK(json_valid(source_json)),
      target_json TEXT NOT NULL CHECK(json_valid(target_json)),target_sha256 TEXT NOT NULL CHECK(length(target_sha256)=64));`);
}
export type NutritionStageCheckpoint = "after-nutrition-ids" | "after-nutrition-rows" | "after-nutrition-receipt";
export function stageLegacyNutritionInTransaction(db: DatabaseSync, context: CandidateIdentityContext, importedAt: string,
  cards: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, source: LegacyNutritionSource, allocate: () => string,
  checkpoint: (stage: NutritionStageCheckpoint) => void) {
  if (!db.isTransaction || !isExplicitTimestamp(importedAt)) return fail("CONTEXT_INVALID");
  if (source.accountScope !== context.accountScope || Object.keys(source.tables).length !== NUTRITION_SOURCE_TABLES.length
    || NUTRITION_SOURCE_TABLES.some((t) => source.tables[t] !== null && !Array.isArray(source.tables[t]))) return fail("SOURCE_INVALID");
  const measurementReceipt = db.prepare("SELECT source_json FROM r04_measurement_receipt WHERE id=1").get();
  if (!measurementReceipt) return fail("MEASUREMENTS_NOT_STAGED");
  const prior = JSON.parse(measurementReceipt.source_json as string) as Record<string, unknown>;
  const days = source.tables.client_day_facts === null ? null : source.tables.client_day_facts.map(canonical).sort(compare);
  if (canonical(prior.clientDays) !== canonical(days)) return fail("DAILY_SOURCE_MISMATCH");
  const clients = new Map<string, string>();
  for (const card of cards) {
    const id = ids.clients.get(card.identity.sourceIdentityKey);
    if (!id || card.identity.accountScope !== context.accountScope || card.identity.sourceWorkspaceId !== context.sourceWorkspaceId) return fail("OWNER_INVALID");
    clients.set(card.identity.sourceClientId, id);
  }
  const known = new Map<string, string>(), targetIds = new Set<string>(), used = new Set<string>();
  for (const row of db.prepare("SELECT * FROM r04_nutrition_ids").all()) {
    const parts = JSON.parse(row.source_key as string) as unknown;
    if (!["FOOD", "RECIPE", "ENTRY"].includes(row.kind as string) || !Array.isArray(parts) || parts[0] !== context.accountScope || canonical(parts) !== row.source_key
      || typeof row.target_id !== "string" || !uuid.test(row.target_id) || targetIds.has(row.target_id)) return fail("IDENTITY_INVALID");
    known.set(JSON.stringify([row.kind, row.source_key]), row.target_id); targetIds.add(row.target_id);
  }
  const identity = (kind: NutritionIdentityKind, sourceKey: string) => {
    const key = JSON.stringify([kind, sourceKey]); used.add(key); const existing = known.get(key); if (existing) return existing;
    const target = allocate();
    if (!uuid.test(target) || targetIds.has(target) || ["r04_candidate_ids", "r04_work_ids", "r04_plan_ids", "r04_execution_ids", "r04_measurement_ids"]
      .some((table) => db.prepare(`SELECT 1 FROM ${table} WHERE target_id=?`).get(target))) return fail("IDENTITY_COLLISION");
    db.prepare("INSERT INTO r04_nutrition_ids VALUES(?,?,?)").run(kind, sourceKey, target); known.set(key, target); targetIds.add(target); return target;
  };
  const projected = composeLegacyNutrition(context, importedAt, source, clients, identity);
  if (known.size !== used.size) return fail("IDENTITY_INVALID"); checkpoint("after-nutrition-ids");
  const sourceJson = canonical({ accountScope: source.accountScope, tables: Object.fromEntries(NUTRITION_SOURCE_TABLES.map((t) => [t,
    source.tables[t] === null ? null : source.tables[t].map(canonical).sort(compare)])) });
  const tables = [...nutritionTargetTables.map((name) => ({ name,
    rows: (projected.tables[name as keyof typeof projected.tables] ?? []).map(canonical).sort(compare) })),
    { name: "r04_nutrition_ids", rows: db.prepare("SELECT * FROM r04_nutrition_ids").all().map((r) => canonical({ ...r })).sort(compare) }];
  const targetJson = canonical({ projectionVersion: 1, importedAt, tables, representations: projected.representations,
    sourceSha256: createHash("sha256").update(sourceJson).digest("hex") });
  const receipts = db.prepare("SELECT * FROM r04_nutrition_receipt").all();
  if (receipts.length > 1 || receipts.length === 1 && (receipts[0]?.id !== 1 || receipts[0]?.source_json !== sourceJson || receipts[0]?.target_json !== targetJson)) return fail("PARITY_MISMATCH");
  for (const table of tables.filter((t) => t.name !== "r04_nutrition_ids")) {
    if (!receipts.length) {
      if (db.prepare(`SELECT count(*) AS n FROM ${table.name}`).get()?.n !== 0) return fail("FOREIGN_TARGET");
      for (const raw of table.rows) {
        const row = JSON.parse(raw) as Record<string, string | number | null>, columns = Object.keys(row);
        db.prepare(`INSERT INTO ${table.name}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      }
    }
    checkpoint("after-nutrition-rows");
  }
  if (!receipts.length) db.prepare("INSERT INTO r04_nutrition_receipt VALUES(1,?,?,?)").run(sourceJson, targetJson, createHash("sha256").update(targetJson).digest("hex"));
  loadStagedNutrition(db); checkpoint("after-nutrition-receipt");
  return { nutritionFoodRows: projected.tables.food_products.length, nutritionRecipeRows: projected.tables.recipes.length,
    nutritionEntryRows: projected.tables.food_diary_entries.length, nutritionWaterRows: projected.tables.water_days.length,
    nutritionStepRows: projected.tables.nutrition_daily_steps.length, nutritionWorkoutMarkRows: projected.tables.nutrition_daily_workout_marks.length,
    nutritionReviewRepresentations: projected.representations.filter((r) => r.issues.length > 0).length, finalizable: false as const };
}
export function loadStagedNutrition(db: DatabaseSync) {
  const receipts = db.prepare("SELECT * FROM r04_nutrition_receipt").all();
  if (receipts.length !== 1 || receipts[0]?.id !== 1) return fail("NOT_STAGED");
  if (receipts[0].target_sha256 !== createHash("sha256").update(receipts[0].target_json as string).digest("hex")) return fail("PARITY_MISMATCH");
  let parsed: unknown; try { parsed = JSON.parse(receipts[0].target_json as string) as unknown; } catch { return fail("PARITY_MISMATCH"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("PARITY_MISMATCH");
  const manifest = parsed as Record<string, unknown>, seen = new Set<string>();
  const expected = [...nutritionTargetTables, "r04_nutrition_ids"];
  if (manifest.projectionVersion !== 1 || manifest.sourceSha256 !== createHash("sha256").update(receipts[0].source_json as string).digest("hex")
    || !Array.isArray(manifest.tables) || manifest.tables.length !== expected.length) return fail("PARITY_MISMATCH");
  for (const raw of manifest.tables) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("PARITY_MISMATCH");
    const table = raw as Record<string, unknown>;
    if (typeof table.name !== "string" || !expected.includes(table.name) || seen.has(table.name) || !Array.isArray(table.rows)) return fail("PARITY_MISMATCH"); seen.add(table.name);
    if (canonical(db.prepare(`SELECT * FROM ${table.name}`).all().map((r) => canonical({ ...r })).sort(compare)) !== canonical(table.rows)) return fail("PARITY_MISMATCH");
  }
  return db.prepare("SELECT * FROM food_diary_entries ORDER BY client_id,local_date,slot,position,id").all();
}
