import type { NativeSqliteDatabase } from "../../../shared/db/IsolatedSqliteConnection.ts";
import type { LegacyCandidateJob } from "../domain/LegacyCandidateJob.ts";

export interface LegacyCandidateJobListing {
  readonly jobs: readonly LegacyCandidateJob[];
  readonly issues: readonly { readonly jobId: string; readonly reason: "INCOMPLETE" | "INVALID" | "UNAVAILABLE" }[];
}
/** All paths and the fixed candidate SQLite filename belong to the implementation. */
export interface LegacyCandidateJobStore {
  create(job: LegacyCandidateJob): Promise<void>;
  read(jobId: string): Promise<LegacyCandidateJob>;
  list(): Promise<LegacyCandidateJobListing>;
  openCandidate(job: LegacyCandidateJob): Promise<NativeSqliteDatabase>;
}
