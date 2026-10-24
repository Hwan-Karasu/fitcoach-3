import type { DatabaseSync } from "node:sqlite";
import type { LegacyProfileWeightSource } from "../../apps/mobile/src/features/measurements/domain/legacy-import/LegacyWeightSourceReconciliation.ts";
export * from "../../apps/mobile/src/features/measurements/domain/legacy-import/LegacyWeightSourceReconciliation.ts";

/** Profile weight has no trustworthy measurement date and is never a target fact. */
export function readLegacyProfileWeightsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyProfileWeightSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const columns = new Set(db.prepare("PRAGMA table_info('clients')").all()
    .map((row) => String(row.name)));
  if (!columns.has("id") || !columns.has("weight")) throw new Error("R04_PROFILE_WEIGHT_SHAPE_UNSUPPORTED");
  const rows = db.prepare("SELECT id AS clientId, weight AS weightRaw FROM clients ORDER BY id").all();
  const count = db.prepare("SELECT count(*) AS count FROM clients").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_PROFILE_WEIGHT_CARDINALITY_MISMATCH");
  return rows.map((row) => {
    if (typeof row.clientId !== "string" || !row.clientId.trim()) {
      throw new Error("R04_PROFILE_WEIGHT_PROVENANCE_INCOMPLETE");
    }
    return { accountScope, clientId: row.clientId, weightRaw: row.weightRaw };
  });
}
