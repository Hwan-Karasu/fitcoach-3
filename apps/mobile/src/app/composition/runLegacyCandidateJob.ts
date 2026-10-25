import { LegacyCandidateJobError, parseLegacyCandidateJob } from "../../features/legacy-import/public.ts";
import type { LegacyCandidateJobStore } from "../../features/legacy-import/data/LegacyCandidateJobStore.ts";
import type { LegacyInspectionReadyReader } from "../../features/legacy-import/data/LegacyInspectionCopy.ts";
import { stageLegacyInspectionCandidate } from "./stageLegacyInspectionCandidate.ts";

/** Request metadata authorizes retry parameters, never a claim that writes completed. */
export async function runLegacyCandidateJob(jobs: LegacyCandidateJobStore, inspection: LegacyInspectionReadyReader,
  jobId: string, allocate: () => string, checkpoint?: Parameters<typeof stageLegacyInspectionCandidate>[1]) {
  const read = jobs.read.bind(jobs), open = jobs.openCandidate.bind(jobs);
  const source: LegacyInspectionReadyReader = Object.freeze({ inspectReady: inspection.inspectReady.bind(inspection), openReady: inspection.openReady.bind(inspection) });
  async function jobIo<Result>(run: () => Promise<Result>): Promise<Result> {
    try { return await run(); } catch (error) {
      if (error instanceof LegacyCandidateJobError) throw error;
      throw new LegacyCandidateJobError("LEGACY_JOB_IO_FAILED");
    }
  }
  const job = parseLegacyCandidateJob(await jobIo(() => read(jobId)));
  if (job.jobId !== jobId) throw new LegacyCandidateJobError("LEGACY_JOB_CHANGED");
  let jobFailure: LegacyCandidateJobError | undefined;
  async function verifiedRequest() {
    try {
      if (JSON.stringify(parseLegacyCandidateJob(await jobIo(() => read(jobId)))) !== JSON.stringify(job)) throw new LegacyCandidateJobError("LEGACY_JOB_CHANGED");
    } catch (error) { if (error instanceof LegacyCandidateJobError) jobFailure = error; throw error; }
  }
  let result: Awaited<ReturnType<typeof stageLegacyInspectionCandidate>>;
  try {
    result = await stageLegacyInspectionCandidate({ inspection: source, receipt: job.source,
      openStaging: async () => { await verifiedRequest(); try { return await jobIo(() => open(job)); } catch (error) { if (error instanceof LegacyCandidateJobError) jobFailure = error; throw error; } },
      targetWorkspaceId: job.targetWorkspaceId, importedAt: job.importedAt, referenceDay: job.referenceDay, allocate }, async (phase) => {
      await checkpoint?.(phase);
      if (phase === "before-commit") await verifiedRequest();
    });
  } catch (error) { throw jobFailure ?? error; }
  await verifiedRequest();
  return { job, ...result, finalizable: false as const };
}
