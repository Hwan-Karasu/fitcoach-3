import type { DatabaseSync } from "node:sqlite";
import { legacyMeasurementsReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacySourceReadPlans.ts";
import { legacyMeasurementFields } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
import { runNodeLegacyReadPlan } from "./NodeLegacySourceReadPlan.ts";

export { legacyMeasurementFields } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";
export type { LegacyMeasurementsSnapshot } from "../../apps/mobile/src/features/legacy-import/domain/LegacySourceSnapshots.ts";

import { projectLegacyMeasurementSourceRow, type LegacyMeasurementSource } from "../../apps/mobile/src/features/measurements/domain/legacy-import/LegacyMeasurementSource.ts";
export * from "../../apps/mobile/src/features/measurements/domain/legacy-import/LegacyMeasurementSource.ts";

export function readLegacyMeasurementsSnapshotInSnapshot(db: DatabaseSync, accountScope: string) {
  return runNodeLegacyReadPlan(db, legacyMeasurementsReadPlan(accountScope));
}

/** Legacy circumference rows are source snapshots, not normalized measurement facts. */
export function readLegacyMeasurementRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyMeasurementSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const columns = new Set(db.prepare("PRAGMA table_info('client_measurements')").all()
    .map((row) => String(row.name)));
  if (["id", "client_id", "date_key", ...legacyMeasurementFields]
    .some((column) => !columns.has(column))) throw new Error("R04_MEASUREMENT_SHAPE_UNSUPPORTED");
  const rows = db.prepare(`SELECT m.id AS sourceRowId, m.client_id AS clientId,
    m.date_key AS dateKey, ${legacyMeasurementFields.map((field) => `m.${field}`).join(", ")},
    c.id AS ownerClientId FROM client_measurements m
    LEFT JOIN clients c ON c.id=m.client_id ORDER BY m.id`).all();
  const count = db.prepare("SELECT count(*) AS count FROM client_measurements").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_MEASUREMENT_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyMeasurementSource => {
    if (typeof row.sourceRowId !== "string" || !row.sourceRowId.trim()
      || typeof row.clientId !== "string" || !row.clientId.trim()
      || typeof row.dateKey !== "string" || !row.dateKey.trim()) {
      throw new Error("R04_MEASUREMENT_PROVENANCE_INCOMPLETE");
    }
    return projectLegacyMeasurementSourceRow(accountScope, { id: row.sourceRowId, client_id: row.clientId,
      date_key: row.dateKey, ...Object.fromEntries(legacyMeasurementFields.map((field) => [field, row[field]])) }, row.ownerClientId === row.clientId);
  });
}
