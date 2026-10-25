import { uuid } from "expo-modules-core";
import { ExpoLegacyCandidateJobs } from "../../features/legacy-import/data/ExpoLegacyCandidateJobs.ts";
import { ExpoLegacyInspectionFiles } from "../../features/legacy-import/data/ExpoLegacyInspectionFiles.ts";
import { LegacyCandidateJobError, parseLegacyCandidateJob, type LegacyInspectionReceipt } from "../../features/legacy-import/public.ts";
import { runLegacyCandidateJob } from "./runLegacyCandidateJob.ts";

/** Internal Android bridge runtime. No current database, picker or cutover API. */
export function createLegacyCandidateRuntime(targetWorkspaceId: string, clock: () => Date = () => new Date()) {
  const jobs = new ExpoLegacyCandidateJobs(), inspection = new ExpoLegacyInspectionFiles(), running = new Set<string>();
  async function resume(jobId: string, checkpoint?: Parameters<typeof runLegacyCandidateJob>[4]) {
    if (running.has(jobId)) throw new LegacyCandidateJobError("LEGACY_JOB_BUSY");
    running.add(jobId);
    try { return await runLegacyCandidateJob(jobs, inspection, jobId, () => uuid.v4(), checkpoint); }
    finally { running.delete(jobId); }
  }
  return {
    list: () => jobs.list(), resume,
    async start(source: LegacyInspectionReceipt, checkpoint?: Parameters<typeof runLegacyCandidateJob>[4]) {
      const at = clock(), job = parseLegacyCandidateJob({ kind: "athlete-diary-legacy-candidate", version: 1, jobId: uuid.v4(), source, targetWorkspaceId,
        importedAt: at.toISOString(), referenceDay: `${String(at.getFullYear()).padStart(4, "0")}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}` });
      await jobs.create(job); return resume(job.jobId, checkpoint);
    },
  };
}
