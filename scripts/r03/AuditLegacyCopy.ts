import { DatabaseSync } from "node:sqlite";
import { inspectLegacyBackup } from "../r02/LegacyBackupInspector.ts";
import { decideLegacyAudit, type LegacyAuditDecision } from "./LegacyAuditDecision.ts";
import { auditLegacyRelations, type LegacyRelationAudit } from "./LegacyRelationAudit.ts";
import { screenLegacySemantics, type LegacySemanticScreen } from "./LegacySemanticScreen.ts";
import { auditSourceFactCollisions, type SourceFactCollisionAudit } from "./SourceFactCollisionAudit.ts";

export type LegacyCopyAuditReport =
  | { readonly status: "blocked"; readonly reasons: readonly string[] }
  | (LegacyAuditDecision & {
      readonly collisions: SourceFactCollisionAudit;
      readonly relations: LegacyRelationAudit;
      readonly semantics: LegacySemanticScreen;
    });

export function hasSingleAuditCopyArgument(args: readonly string[]): boolean {
  return args.length === 1 && args[0]?.toLowerCase().endsWith(".atbackup") === true;
}

/** All failures are aggregate-only and fail closed. The source is never opened for writing. */
export function auditLegacyCopy(path: string): LegacyCopyAuditReport {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const source = inspectLegacyBackup(db);
    if (source.status !== "candidate") return { status: "blocked", reasons: source.reasons };
    const collisions = auditSourceFactCollisions(db);
    const relations = auditLegacyRelations(db);
    const semantics = screenLegacySemantics(db);
    return { ...decideLegacyAudit(collisions, relations, semantics), collisions, relations, semantics };
  } catch {
    return { status: "blocked", reasons: ["SOURCE_AUDIT_FAILED"] };
  } finally { db?.close(); }
}
