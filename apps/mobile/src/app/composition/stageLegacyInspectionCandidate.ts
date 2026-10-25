import { InspectionCopyError, parseInspectionReceipt, type LegacyInspectionReceipt } from "../../features/legacy-import/public.ts";
import { readLegacyInspectionCopy, verifyLegacyInspectionCopy, type LegacyInspectionReadyReader } from "../../features/legacy-import/data/LegacyInspectionCopy.ts";
import type { LegacyClientCheckpoint } from "../../shared/migration/LegacyWritePlan.ts";
import { stageLegacyImportCandidate, type LegacyImportCandidateInput } from "./stageLegacyImportCandidate.ts";

export interface LegacyInspectionCandidateInput {
  readonly inspection: LegacyInspectionReadyReader;
  readonly receipt: LegacyInspectionReceipt;
  readonly openStaging: LegacyImportCandidateInput["openStaging"];
  readonly targetWorkspaceId: string;
  readonly importedAt: string;
  readonly referenceDay: string;
  readonly allocate: () => string;
}

/** Private R04 workflow only: source context comes from the admitted sealed copy.
 * No external source access, file routing, UI or production database publication.
 */
export async function stageLegacyInspectionCandidate(input: LegacyInspectionCandidateInput,
  checkpoint: (phase: Exclude<LegacyClientCheckpoint, "after-clients">) => void | Promise<void> = () => undefined) {
  const { openStaging, targetWorkspaceId, importedAt, referenceDay, allocate } = input;
  const receipt = parseInspectionReceipt(input.receipt);
  const inspection: LegacyInspectionReadyReader = Object.freeze({
    inspectReady: input.inspection.inspectReady.bind(input.inspection),
    openReady: input.inspection.openReady.bind(input.inspection),
  });
  const { admission, snapshots } = await readLegacyInspectionCopy(inspection, receipt);
  let verificationFailure: InspectionCopyError | undefined;
  let candidate: Awaited<ReturnType<typeof stageLegacyImportCandidate>>;
  try {
    candidate = await stageLegacyImportCandidate({ openStaging, importedAt, referenceDay, allocate, source: snapshots,
      context: { sourceSha256: receipt.sha256, accountScope: admission.accountScope, sourceWorkspaceId: admission.sourceWorkspaceId, targetWorkspaceId } }, async (phase) => {
      await checkpoint(phase);
      if (phase === "before-commit") {
        try { await verifyLegacyInspectionCopy(inspection, receipt); }
        catch (error) { if (error instanceof InspectionCopyError) verificationFailure = error; throw error; }
      }
    });
  } catch (error) { throw verificationFailure ?? error; }
  // A late change is an error even if COMMIT already succeeded. The retained
  // private candidate is never activated; verified replay can reuse its IDs.
  await verifyLegacyInspectionCopy(inspection, receipt);
  return { receipt, admission, candidate, finalizable: false as const };
}
