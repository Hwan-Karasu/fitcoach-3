import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLegacyCandidateJob } from "../apps/mobile/src/features/legacy-import/domain/LegacyCandidateJob.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { fixture as nutritionFixture } from "./support/legacy-nutrition-staging.ts";
import { digest, inspect } from "./support/legacy-training-staging.ts";
import { runLegacyJobWorker } from "./support/legacy-job-worker.ts";

const jobId = "22222222-2222-4222-8222-222222222222", copyId = "11111111-1111-4111-8111-111111111111";
const descriptor = { kind: "athlete-diary-legacy-candidate", version: 1, jobId,
  source: { kind: "athlete-diary-source-copy", version: 1, operationId: copyId, sha256: "a".repeat(64), bytes: 4096 },
  targetWorkspaceId: "local-trainer", importedAt: "2026-10-24T12:00:00.000Z", referenceDay: "2026-10-24" };
const fixture = (run: Parameters<typeof nutritionFixture>[0]) => nutritionFixture(run, (db) => seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }));
const rows = (file: string) => inspect(file, (db) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all().map((row) => [row.name, db.prepare(`SELECT * FROM ${row.name as string}`).all()]));
function rolledBack(file: string) { inspect(file, (db) => {
  for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_'").all()) if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
}); }

test("immutable candidate requests validate exact fields, IDs, clocks and nested copy identity without filesystem paths", () => {
  const job = parseLegacyCandidateJob(descriptor); assert.equal(Object.isFrozen(job), true); assert.equal(Object.isFrozen(job.source), true);
  for (const value of [{ ...descriptor, extra: true }, { ...descriptor, jobId: "../source" }, { ...descriptor, version: 2 }, { ...descriptor, source: { ...descriptor.source, bytes: 1 } }, { ...descriptor, targetWorkspaceId: "../live.db" }, { ...descriptor, referenceDay: "2026-02-30" }, { ...descriptor, importedAt: "not-time" }]) assert.throws(() => parseLegacyCandidateJob(value), { message: "LEGACY_JOB_INVALID" });
});

test("actual Expo job/file/SQLite runtime persists a full candidate and a new runtime replays from disk without allocating IDs", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), started = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start" });
  assert.equal(started.ok, true, started.code); assert.deepEqual(started.counts, [6, 12, 4, 4]); assert.equal(started.jobs.length, 1); assert.equal(started.handles, 0);
  const job = started.jobs[0]!, target = join(root, "legacy-import-jobs", job.jobId, "candidate.sqlite"), before = rows(target);
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, clock: "2050-01-01T12:00:00Z", forbidSource: true, forbidAllocation: true });
  assert.equal(resumed.ok, true, resumed.code); assert.equal(resumed.issued, 0); assert.equal(resumed.importedAt, job.importedAt); assert.equal(resumed.referenceDay, job.referenceDay); assert.deepEqual(resumed.counts, [6, 12, 4, 4]); assert.deepEqual(rows(target), before);
  const allowed = new Set([target, join(root, "legacy-source-copies", copyId, "source.sqlite")]); assert.ok([...started.paths, ...resumed.paths].every((path) => allowed.has(path))); assert.equal(resumed.handles, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("a published job request alone is discoverable after restart and never claims that SQLite staging completed", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), created = await runLegacyJobWorker({ root, source: f.sourcePath, action: "create", jobId });
  assert.equal(created.ok, true, created.code); assert.equal(created.jobs.length, 1); assert.equal(created.paths.length, 0); assert.equal(existsSync(join(root, "legacy-import-jobs", jobId, "candidate.sqlite")), false);
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true }); assert.equal(resumed.ok, true, resumed.code); assert.deepEqual(resumed.counts, [6, 12, 4, 4]); assert.equal(resumed.handles, 0);
}));

test("partial request writes are not resumed or overwritten and another job can reuse the sealed copy", async () => {
  for (const fault of ["before-request-write", "after-request-write"] as const) await fixture(async (f) => {
    const root = join(f.dir, "documents"), failed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "create", jobId, fault });
    assert.equal(failed.ok, false); assert.equal(failed.code, "LEGACY_JOB_IO_FAILED"); assert.deepEqual(failed.issues, [{ jobId, reason: "INCOMPLETE" }]); assert.equal(failed.paths.length, 0);
    const partial = join(root, "legacy-import-jobs", jobId, "request.partial"), before = readFileSync(partial);
    const resume = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true }); assert.equal(resume.code, "LEGACY_JOB_INCOMPLETE"); assert.equal(resume.paths.length, 0);
    const duplicate = await runLegacyJobWorker({ root, source: f.sourcePath, action: "create", jobId, reuseCopy: true, forbidSource: true }); assert.equal(duplicate.code, "LEGACY_JOB_EXISTS"); assert.deepEqual(readFileSync(partial), before);
    const fresh = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", reuseCopy: true, forbidSource: true }); assert.equal(fresh.ok, true, fresh.code); assert.deepEqual(fresh.counts, [6, 12, 4, 4]); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("request rename acknowledgement loss leaves a valid discoverable request which resumes without overwriting it", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), lost = await runLegacyJobWorker({ root, source: f.sourcePath, action: "create", jobId, fault: "after-request-rename" });
  assert.equal(lost.code, "LEGACY_JOB_IO_FAILED"); assert.equal(lost.jobs.length, 1); assert.equal(lost.paths.length, 0);
  const file = join(root, "legacy-import-jobs", jobId, "request.json"), before = readFileSync(file);
  const result = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true }); assert.equal(result.ok, true, result.code); assert.deepEqual(result.counts, [6, 12, 4, 4]); assert.deepEqual(readFileSync(file), before);
}));

test("job discovery separates corrupt and incomplete slots while leaving foreign paths untouched", () => fixture(async (f) => {
  const root = join(f.dir, "documents"); await runLegacyJobWorker({ root, source: f.sourcePath, action: "create", jobId });
  const base = join(root, "legacy-import-jobs"), missing = "33333333-3333-4333-8333-333333333333", bad = "44444444-4444-4444-8444-444444444444";
  mkdirSync(join(base, missing)); mkdirSync(join(base, bad)); writeFileSync(join(base, bad, "request.json"), "broken request"); mkdirSync(join(base, "foreign-dir")); writeFileSync(join(base, "foreign.txt"), "untouched");
  const result = await runLegacyJobWorker({ root, source: f.sourcePath, action: "list" }); assert.equal(result.jobs.length, 1); assert.deepEqual(result.issues, [{ jobId: missing, reason: "INCOMPLETE" }, { jobId: bad, reason: "INVALID" }]); assert.equal(result.paths.length, 0); assert.equal(readFileSync(join(base, "foreign.txt"), "utf8"), "untouched");
}));

test("malformed request bytes and mismatched slot IDs cannot authorize a target open", () => fixture(async (f) => {
  const root = join(f.dir, "documents"); await runLegacyJobWorker({ root, source: f.sourcePath, action: "create", jobId });
  const file = join(root, "legacy-import-jobs", jobId, "request.json"), original = readFileSync(file, "utf8"), value = JSON.parse(original) as Record<string, unknown>;
  for (const bytes of [JSON.stringify({ ...value, jobId: "33333333-3333-4333-8333-333333333333" }), original + "\n", "{".repeat(8193)]) {
    writeFileSync(file, bytes); const result = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true }); assert.equal(result.code, "LEGACY_JOB_INVALID"); assert.equal(result.paths.length, 0);
  }
  writeFileSync(file, original); const result = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId, forbidSource: true }); assert.equal(result.ok, true, result.code);
}));

test("canonical parameter drift cannot claim an existing candidate or enable WAL before binding rejection", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), first = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start" }); assert.equal(first.ok, true, first.code);
  const job = first.jobs[0]!, directory = join(root, "legacy-import-jobs", job.jobId), file = join(directory, "request.json"), original = readFileSync(file, "utf8"), target = join(directory, "candidate.sqlite"), before = rows(target);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(original) as Record<string, unknown>, importedAt: "2027-01-01T12:00:00Z" }));
  const drifted = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true, forbidAllocation: true });
  assert.equal(drifted.ok, false); assert.equal(drifted.code, "R04_ID_LEDGER_CONTEXT_MISMATCH"); assert.equal(drifted.walWrites, 0); assert.deepEqual(rows(target), before); assert.equal(drifted.handles, 0);
  assert.ok(first.walWrites > 0); writeFileSync(file, original);
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true, forbidAllocation: true }); assert.equal(resumed.ok, true, resumed.code); assert.deepEqual(rows(target), before);
}));

test("request drift before commit rolls back all owners and drift after commit returns only an unverified private candidate", async () => {
  for (const mutateRequest of ["before-commit", "after-commit"] as const) await fixture(async (f) => {
    const root = join(f.dir, "documents"), result = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", mutateRequest });
    assert.equal(result.ok, false); assert.equal(result.code, "LEGACY_JOB_CHANGED"); assert.ok(result.originalRequest);
    const job = parseLegacyCandidateJob(JSON.parse(result.originalRequest)), target = join(root, "legacy-import-jobs", job.jobId, "candidate.sqlite");
    if (mutateRequest === "before-commit") rolledBack(target); else inspect(target, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM calendar_appointments").get()!.n, 4));
    writeFileSync(join(root, "legacy-import-jobs", job.jobId, "request.json"), result.originalRequest);
    const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true, forbidAllocation: mutateRequest === "after-commit" }); assert.equal(resumed.ok, true, resumed.code); assert.deepEqual(resumed.counts, [6, 12, 4, 4]); assert.equal(digest(f.sourcePath), f.sha);
  });
});

test("actual host Worker termination before commit rolls SQLite back and a fresh runtime completes then replays stable IDs", () => fixture(async (f) => {
  const root = join(f.dir, "documents"), killed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "start", killAt: "before-commit" });
  assert.equal(killed.terminated, true); assert.equal(killed.phase, "paused"); assert.equal(killed.jobs.length, 1); const job = killed.jobs[0]!, target = join(root, "legacy-import-jobs", job.jobId, "candidate.sqlite"); rolledBack(target);
  const resumed = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, clock: "2050-01-01T12:00:00Z", forbidSource: true }); assert.equal(resumed.ok, true, resumed.code); assert.deepEqual(resumed.counts, [6, 12, 4, 4]); const before = rows(target);
  const replay = await runLegacyJobWorker({ root, source: f.sourcePath, action: "resume", jobId: job.jobId, forbidSource: true, forbidAllocation: true }); assert.equal(replay.ok, true, replay.code); assert.equal(replay.issued, 0); assert.deepEqual(rows(target), before); assert.equal(replay.handles, 0); assert.equal(digest(f.sourcePath), f.sha);
}));

test("one runtime rejects a simultaneous resume of its live job and releases the guard after completion", () => fixture(async (f) => {
  const result = await runLegacyJobWorker({ root: join(f.dir, "documents"), source: f.sourcePath, action: "busy" });
  assert.equal(result.ok, true, result.code); assert.equal(result.busyCode, "LEGACY_JOB_BUSY"); assert.deepEqual(result.counts, [6, 12, 4, 4]); assert.equal(result.handles, 0); assert.equal(digest(f.sourcePath), f.sha);
}));
