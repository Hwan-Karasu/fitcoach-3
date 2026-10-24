import type { DatabaseSync } from "node:sqlite";
import { legacyBackupAdmissionPlan, legacyBackupInspectionPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacyBackupReadPlans.ts";
import type { LegacySourceReadPlan } from "../../apps/mobile/src/features/legacy-import/data/LegacySourceReadPlans.ts";
import { runNodeLegacyReadPlan } from "../r04/NodeLegacySourceReadPlan.ts";
export type { LegacyBackupInventory } from "../../apps/mobile/src/features/legacy-import/domain/LegacyBackupInventory.ts";

/** Historical aggregate inventory, not strict file admission. No private identity
 * leaves this report; mobile uses the same plan plus full manifest/size/revision checks.
 */
export function inspectLegacyBackup(db: DatabaseSync) {
  return inSnapshot(db, legacyBackupInspectionPlan()).inventory;
}

/** Strict private candidate admission, identical to the mobile file path. */
export function admitLegacyBackup(db: DatabaseSync, fileBytes: number) {
  return inSnapshot(db, legacyBackupAdmissionPlan(fileBytes));
}

function inSnapshot<Result>(db: DatabaseSync, plan: LegacySourceReadPlan<Result>): Result {
  db.exec("PRAGMA query_only=ON");
  const ownSnapshot = !db.isTransaction;
  if (ownSnapshot) db.exec("BEGIN");
  try { return runNodeLegacyReadPlan(db, plan); }
  finally { if (ownSnapshot) db.exec("ROLLBACK"); }
}
