import { isLegacyTargetWorkspaceId } from "../../../shared/migration/LegacyIdentityBinding.ts";
import { isExplicitTimestamp, isLegacyLocalDate } from "../../../shared/migration/LegacyValues.ts";
import { inspectionOperationId, parseInspectionReceipt, type LegacyInspectionReceipt } from "./InspectionCopy.ts";

export type LegacyCandidateJobErrorCode = "LEGACY_JOB_INVALID" | "LEGACY_JOB_EXISTS" | "LEGACY_JOB_INCOMPLETE" | "LEGACY_JOB_IO_FAILED" | "LEGACY_JOB_CHANGED" | "LEGACY_JOB_BUSY";
export class LegacyCandidateJobError extends Error {
  readonly code: LegacyCandidateJobErrorCode;
  constructor(code: LegacyCandidateJobErrorCode) { super(code); this.code = code; }
}
/** Immutable request only. Its existence never proves that staging completed. */
export interface LegacyCandidateJob {
  readonly kind: "athlete-diary-legacy-candidate";
  readonly version: 1;
  readonly jobId: string;
  readonly source: LegacyInspectionReceipt;
  readonly targetWorkspaceId: string;
  readonly importedAt: string;
  readonly referenceDay: string;
}
export function parseLegacyCandidateJob(value: unknown): LegacyCandidateJob {
  const invalid = (): never => { throw new LegacyCandidateJobError("LEGACY_JOB_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Partial<LegacyCandidateJob>;
  if (Object.keys(row).sort().join(",") !== "importedAt,jobId,kind,referenceDay,source,targetWorkspaceId,version"
    || row.kind !== "athlete-diary-legacy-candidate" || row.version !== 1 || !inspectionOperationId(row.jobId)
    || !isLegacyTargetWorkspaceId(row.targetWorkspaceId) || !isExplicitTimestamp(row.importedAt)
    || typeof row.referenceDay !== "string" || !isLegacyLocalDate(row.referenceDay)) return invalid();
  let source: LegacyInspectionReceipt;
  try { source = parseInspectionReceipt(row.source); } catch { return invalid(); }
  return Object.freeze({ kind: row.kind, version: row.version, jobId: row.jobId, source, targetWorkspaceId: row.targetWorkspaceId, importedAt: row.importedAt, referenceDay: row.referenceDay });
}
export const legacyCandidateJobJson = (value: LegacyCandidateJob): string => JSON.stringify(parseLegacyCandidateJob(value));
