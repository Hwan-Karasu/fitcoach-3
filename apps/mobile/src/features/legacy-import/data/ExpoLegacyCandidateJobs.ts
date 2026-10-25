import { Directory, File, Paths } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import { inspectionOperationId } from "../domain/InspectionCopy.ts";
import { LegacyCandidateJobError, legacyCandidateJobJson, parseLegacyCandidateJob, type LegacyCandidateJob } from "../domain/LegacyCandidateJob.ts";
import type { LegacyCandidateJobListing, LegacyCandidateJobStore } from "./LegacyCandidateJobStore.ts";

async function io<Result>(run: () => Result | Promise<Result>): Promise<Result> {
  try { return await run(); } catch (error) {
    if (error instanceof LegacyCandidateJobError) throw error;
    throw new LegacyCandidateJobError("LEGACY_JOB_IO_FAILED");
  }
}
/** Android-only private slots. No source/live paths, overwrite, cleanup or publication. */
export class ExpoLegacyCandidateJobs implements LegacyCandidateJobStore {
  private readonly root: Directory;
  constructor() {
    if (Platform.OS !== "android") throw new LegacyCandidateJobError("LEGACY_JOB_INVALID");
    this.root = new Directory(Paths.document, "legacy-import-jobs");
  }
  private directory(jobId: string): Directory {
    if (!inspectionOperationId(jobId)) throw new LegacyCandidateJobError("LEGACY_JOB_INVALID");
    return new Directory(this.root, jobId);
  }
  async create(value: LegacyCandidateJob): Promise<void> {
    const job = parseLegacyCandidateJob(value), directory = this.directory(job.jobId);
    await io(async () => {
      if (directory.exists) throw new LegacyCandidateJobError("LEGACY_JOB_EXISTS");
      this.root.create({ idempotent: true, intermediates: true }); directory.create();
      const partial = new File(directory, "request.partial"), ready = new File(directory, "request.json");
      partial.create(); partial.write(legacyCandidateJobJson(job));
      // Installed Android legacy file:// move uses renameTo, or fails.
      await moveAsync({ from: partial.uri, to: ready.uri });
      if (legacyCandidateJobJson(await this.read(job.jobId)) !== legacyCandidateJobJson(job)) throw new LegacyCandidateJobError("LEGACY_JOB_CHANGED");
    });
  }
  async read(jobId: string): Promise<LegacyCandidateJob> {
    const directory = this.directory(jobId);
    return io(async () => {
      const file = new File(directory, "request.json");
      if (!directory.exists || !file.exists) throw new LegacyCandidateJobError("LEGACY_JOB_INCOMPLETE");
      const bytes = file.size;
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 8192) throw new LegacyCandidateJobError("LEGACY_JOB_INVALID");
      const text = await file.text(); let raw: unknown;
      try { raw = JSON.parse(text) as unknown; } catch { throw new LegacyCandidateJobError("LEGACY_JOB_INVALID"); }
      const job = parseLegacyCandidateJob(raw);
      if (job.jobId !== jobId || legacyCandidateJobJson(job) !== text) throw new LegacyCandidateJobError("LEGACY_JOB_INVALID");
      return job;
    });
  }
  async list(): Promise<LegacyCandidateJobListing> {
    return io(async () => {
      const jobs: LegacyCandidateJob[] = [], issues: { jobId: string; reason: "INCOMPLETE" | "INVALID" | "UNAVAILABLE" }[] = [];
      if (!this.root.exists) return { jobs, issues };
      const ids = this.root.list().filter((entry): entry is Directory => entry instanceof Directory && inspectionOperationId(entry.name)).map((entry) => entry.name).sort();
      for (const id of ids) {
        try { jobs.push(await this.read(id)); }
        catch (error) { issues.push({ jobId: id, reason: error instanceof LegacyCandidateJobError && error.code === "LEGACY_JOB_INCOMPLETE" ? "INCOMPLETE" : error instanceof LegacyCandidateJobError && error.code === "LEGACY_JOB_INVALID" ? "INVALID" : "UNAVAILABLE" }); }
      }
      return { jobs, issues };
    });
  }
  async openCandidate(value: LegacyCandidateJob) {
    const job = parseLegacyCandidateJob(value);
    return io(async () => {
      if (legacyCandidateJobJson(await this.read(job.jobId)) !== legacyCandidateJobJson(job)) throw new LegacyCandidateJobError("LEGACY_JOB_CHANGED");
      return SQLite.openDatabaseAsync("candidate.sqlite", { useNewConnection: true }, this.directory(job.jobId).uri);
    });
  }
}
