import type { DatabaseSync } from "node:sqlite";

import { projectLegacyClientDaySourceRow, type LegacyClientDaySource } from "../../apps/mobile/src/shared/migration/LegacyClientDaySource.ts";
export * from "../../apps/mobile/src/shared/migration/LegacyClientDaySource.ts";

/** Legacy daily training text is not a performed WorkoutSession or credit fact. */
export function readLegacyClientDayRowsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyClientDaySource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required = ["client_id", "date_key", "weight", "steps", "training"];
  const columns = new Set(db.prepare("PRAGMA table_info('client_day_facts')").all()
    .map((row) => String(row.name)));
  if (required.some((column) => !columns.has(column))) throw new Error("R04_CLIENT_DAY_SHAPE_UNSUPPORTED");
  const rows = db.prepare(`SELECT d.client_id AS clientId, d.date_key AS dateKey,
    d.weight AS weight, d.steps AS steps, d.training AS training,
    c.id AS ownerClientId FROM client_day_facts d
    LEFT JOIN clients c ON c.id=d.client_id ORDER BY d.client_id,d.date_key`).all();
  const count = db.prepare("SELECT count(*) AS count FROM client_day_facts").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_CLIENT_DAY_CARDINALITY_MISMATCH");
  return rows.map((row): LegacyClientDaySource => {
    if (typeof row.clientId !== "string" || !row.clientId.trim()
      || typeof row.dateKey !== "string" || !row.dateKey.trim()) {
      throw new Error("R04_CLIENT_DAY_PROVENANCE_INCOMPLETE");
    }
    return projectLegacyClientDaySourceRow(accountScope, { client_id: row.clientId, date_key: row.dateKey,
      weight: row.weight, steps: row.steps, training: row.training }, row.ownerClientId === row.clientId);
  });
}
