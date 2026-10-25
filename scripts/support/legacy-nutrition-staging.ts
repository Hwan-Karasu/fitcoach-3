import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { legacyMeasurementStagingExtension } from "../../apps/mobile/src/features/measurements/data/legacy-import/LegacyMeasurementStaging.ts";
import { legacyNutritionStagingExtension } from "../../apps/mobile/src/features/nutrition/data/legacy-import/LegacyNutritionStaging.ts";
import { nutritionRehearsalObjects } from "../../apps/mobile/src/features/nutrition/data/legacy-import/LegacyNutritionStagePlan.ts";
import { combineLegacyStageExtensions } from "../../apps/mobile/src/shared/migration/LegacyStageExtension.ts";
import type { LegacyImportSourceSnapshots } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
import { seedMeasurementSource } from "./legacy-measurement-source.ts";
import { seedLegacyNutritionSource, seedCalculator, seedArchives } from "./legacy-nutrition-source.ts";
import { extension as training, inspect, records as trainingRecords, empty as trainingEmpty, fixture as trainingFixture } from "./legacy-training-staging.ts";
export const referenceDay = "2026-10-24";
const extraTables = ["body_measurements", "measurement_daily_primary", "r04_measurement_ids", "r04_measurement_receipt", ...Object.entries(nutritionRehearsalObjects).filter(([, kind]) => kind === "table").map(([name]) => name)];
export const beforeNutrition = (s: LegacyImportSourceSnapshots, builders = false) => combineLegacyStageExtensions(training(s, builders), legacyMeasurementStagingExtension(s.measurements, referenceDay));
export const extension = (s: LegacyImportSourceSnapshots, builders = false) => combineLegacyStageExtensions(beforeNutrition(s, builders), legacyNutritionStagingExtension(s.nutrition));
export const records = (path: string) => [...trainingRecords(path), ...inspect(path, (db) => extraTables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]))];
export function empty(path: string) { trainingEmpty(path); inspect(path, (db) => { for (const table of extraTables) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table); }); }
export function seed(db: DatabaseSync) {
  seedMeasurementSource(db); seedLegacyNutritionSource(db, { existingOwners: true, existingDays: true }); seedCalculator(db); seedArchives(db);
  db.prepare("UPDATE client_day_facts SET training=? WHERE client_id='a' AND date_key='2026-03-01'").run("\u0414\u0430");
}
export const fixture = (run: Parameters<typeof trainingFixture>[0], amend: (db: DatabaseSync) => void = () => undefined) => trainingFixture(run, (db) => { seed(db); amend(db); });
