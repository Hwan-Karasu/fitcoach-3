import type { DatabaseSync } from "node:sqlite";
import { legacyObjectJson, requireLegacyColumns } from "./LegacyExerciseCatalogSourceReader.ts";
import { convertLegacySetMetrics } from "./LegacySetMetricCandidates.ts";
import type { LegacySetSource } from "./SourceFactPreflight.ts";

type JsonRecord = Readonly<Record<string, unknown>>;
function object(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export interface ArchivePayloadIssue {
  readonly path: string;
  readonly code: "INVALID_JSON" | "INVALID_SNAPSHOT" | "WORKOUTS_NOT_OBSERVED" |
    "INVALID_WORKOUTS" | "INVALID_WORKOUT" | "EXERCISES_NOT_OBSERVED" | "INVALID_EXERCISES" |
    "INVALID_EXERCISE" | "SETS_NOT_OBSERVED" | "INVALID_SETS" | "INVALID_CYCLES" | "INVALID_CYCLE";
}

export interface ArchiveSetOccurrence {
  readonly sourceIdentityKey: string;
  readonly accountScope: string;
  readonly archiveId: string;
  readonly clientId: string;
  readonly path: string;
  readonly representation: "root" | "cycle";
  readonly raw: unknown;
  readonly sourceFactId: string | null;
  readonly identityIssue: "INVALID_SET" | "INVALID_SOURCE_FACT_ID" | "CONFLICTING_SOURCE_FACT_IDS" |
    "INVALID_SET_DATA" | "MISSING_SOURCE_FACT_ID" | null;
  readonly metrics: ReturnType<typeof convertLegacySetMetrics>;
  readonly targetFactId: null;
}

export interface ArchivePayloadInventory {
  readonly accountScope: string;
  readonly archiveId: string;
  readonly clientId: string;
  readonly ownerFound: boolean;
  readonly raw: JsonRecord;
  readonly issues: readonly ArchivePayloadIssue[];
  readonly occurrences: readonly ArchiveSetOccurrence[];
}

/** Inventory physical JSON occurrences, including root/cycle mirrors; never creates performed facts. */
export function readLegacyArchiveSetInventoryInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly ArchivePayloadInventory[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  requireLegacyColumns(db, "training_archive_entries", ["id", "client_id", "data_json"], "R04_ARCHIVE_PAYLOAD_SHAPE_UNSUPPORTED");
  requireLegacyColumns(db, "clients", ["id"], "R04_ARCHIVE_PAYLOAD_SHAPE_UNSUPPORTED");
  const owners = new Set<string>();
  for (const row of db.prepare("SELECT id FROM clients").all()) {
    const id = text(row.id);
    if (id === null || owners.has(id)) throw new Error("R04_ARCHIVE_OWNER_IDENTITY_INVALID");
    owners.add(id);
  }
  const seen = new Set<string>();
  return db.prepare("SELECT * FROM training_archive_entries ORDER BY id").all().map((raw) => {
    const archiveId = text(raw.id), clientId = text(raw.client_id);
    if (archiveId === null || clientId === null || seen.has(archiveId)) {
      throw new Error("R04_ARCHIVE_PAYLOAD_IDENTITY_INVALID");
    }
    seen.add(archiveId);
    const issues: ArchivePayloadIssue[] = [];
    const occurrences: ArchiveSetOccurrence[] = [];
    const root = legacyObjectJson(raw.data_json);
    if (root === null) issues.push({ path: "", code: "INVALID_JSON" });
    const pending: { value: unknown; path: string; representation: "root" | "cycle" }[] = root === null
      ? [] : [{ value: root, path: "", representation: "root" }];
    while (pending.length > 0) {
      const current = pending.pop()!;
      const snapshot = object(current.value);
      if (snapshot === null) { issues.push({ path: current.path, code: "INVALID_SNAPSHOT" }); continue; }
      const workouts = snapshot.workouts;
      if (!Array.isArray(workouts)) issues.push({ path: `${current.path}/workouts`,
        code: workouts === undefined ? "WORKOUTS_NOT_OBSERVED" : "INVALID_WORKOUTS" });
      else workouts.forEach((workoutRaw: unknown, wi: number) => {
        const workoutPath = `${current.path}/workouts/${wi}`, workout = object(workoutRaw);
        if (workout === null) { issues.push({ path: workoutPath, code: "INVALID_WORKOUT" }); return; }
        if (!Array.isArray(workout.exercises)) {
          issues.push({ path: `${workoutPath}/exercises`, code: workout.exercises === undefined ? "EXERCISES_NOT_OBSERVED" : "INVALID_EXERCISES" }); return;
        }
        workout.exercises.forEach((exerciseRaw: unknown, ei: number) => {
          const exercisePath = `${workoutPath}/exercises/${ei}`, exercise = object(exerciseRaw);
          if (exercise === null) { issues.push({ path: exercisePath, code: "INVALID_EXERCISE" }); return; }
          if (!Array.isArray(exercise.sets)) {
            issues.push({ path: `${exercisePath}/sets`, code: exercise.sets === undefined ? "SETS_NOT_OBSERVED" : "INVALID_SETS" }); return;
          }
          exercise.sets.forEach((setRaw: unknown, si: number) => {
            const path = `${exercisePath}/sets/${si}`, set = object(setRaw), data = object(set?.data);
            const explicitId = text(set?.sourceFactId), originId = text(data?.historyOriginId);
            const badId = [set?.sourceFactId, data?.historyOriginId].some((id) => id != null && id !== "" && text(id) === null);
            const identityIssue = set === null ? "INVALID_SET" : badId ? "INVALID_SOURCE_FACT_ID"
              : Object.hasOwn(set, "data") && data === null ? "INVALID_SET_DATA"
                : explicitId !== null && originId !== null && explicitId !== originId ? "CONFLICTING_SOURCE_FACT_IDS"
                  : explicitId === null && originId === null ? "MISSING_SOURCE_FACT_ID" : null;
            occurrences.push({
              sourceIdentityKey: JSON.stringify([accountScope, "training_archive_entries", archiveId, path]),
              accountScope, archiveId, clientId, path, representation: current.representation, raw: setRaw,
              sourceFactId: identityIssue === null ? explicitId ?? originId : null, identityIssue,
              metrics: convertLegacySetMetrics(set?.reps, set?.weight), targetFactId: null,
            });
          });
        });
      });
      if (snapshot.cycles !== undefined) {
        if (!Array.isArray(snapshot.cycles)) issues.push({ path: `${current.path}/cycles`, code: "INVALID_CYCLES" });
        else snapshot.cycles.forEach((cycleRaw: unknown, index: number) => {
          const cyclePath = `${current.path}/cycles/${index}`, cycle = object(cycleRaw);
          if (cycle === null) issues.push({ path: cyclePath, code: "INVALID_CYCLE" });
          else pending.push({ value: cycle.snapshot, path: `${cyclePath}/snapshot`, representation: "cycle" });
        });
      }
    }
    return { accountScope, archiveId, clientId, ownerFound: owners.has(clientId), raw, issues, occurrences };
  });
}

/** Matching ID/metrics is a review signal, not permission to deduplicate or count a performed set. */
export function summarizeLegacyArchiveSets(
  archives: readonly ArchivePayloadInventory[], sessions: readonly LegacySetSource[],
) {
  const scope = archives[0]?.accountScope;
  if (archives.some((row) => row.accountScope !== scope) || scope !== undefined && sessions.some((row) => row.accountScope !== scope)) {
    throw new Error("R04_ARCHIVE_PAYLOAD_SCOPE_MISMATCH");
  }
  const occurrences = archives.flatMap((row) => row.occurrences);
  const byFact = new Map<string, ArchiveSetOccurrence[]>();
  const sessionFacts = new Map<string, LegacySetSource[]>();
  const key = (account: string, client: string, fact: string) => JSON.stringify([account, client, fact]);
  for (const row of sessions) {
    if (!row.sourceFactId?.trim()) continue;
    const id = key(row.accountScope, row.clientId, row.sourceFactId);
    const group = sessionFacts.get(id) ?? []; group.push(row); sessionFacts.set(id, group);
  }
  for (const row of occurrences) {
    if (row.sourceFactId === null) continue;
    const id = key(row.accountScope, row.clientId, row.sourceFactId);
    const group = byFact.get(id) ?? []; group.push(row); byFact.set(id, group);
  }
  let repeatedIdOccurrences = 0, conflictingMetricGroups = 0, rootCycleOverlapGroups = 0;
  let sameClientSessionLinkedOccurrences = 0, sessionMetricConflictOccurrences = 0;
  for (const [id, group] of byFact) {
    if (group.length > 1) repeatedIdOccurrences += group.length;
    const rootArchives = new Set(group.filter((row) => row.representation === "root").map((row) => row.archiveId));
    if (group.some((row) => row.representation === "cycle" && rootArchives.has(row.archiveId))) rootCycleOverlapGroups += 1;
    const exact = group.filter((row) => row.metrics.metricIssues.length === 0);
    if (new Set(exact.map((row) => JSON.stringify(row.metrics.values))).size > 1) conflictingMetricGroups += 1;
    const linked = sessionFacts.get(id) ?? [];
    if (linked.length > 0) {
      sameClientSessionLinkedOccurrences += group.length;
      for (const row of exact) {
        if (linked.some((session) => {
          const metrics = convertLegacySetMetrics(session.repsRaw, session.weightRaw);
          return metrics.metricIssues.length === 0 && JSON.stringify(metrics.values) !== JSON.stringify(row.metrics.values);
        })) sessionMetricConflictOccurrences += 1;
      }
    }
  }
  return {
    status: "requires-semantic-review" as const, archiveRows: archives.length,
    missingOwnerRows: archives.filter((row) => !row.ownerFound).length,
    payloadIssues: archives.reduce((sum, row) => sum + row.issues.length, 0),
    physicalSetOccurrences: occurrences.length,
    rootSetOccurrences: occurrences.filter((row) => row.representation === "root").length,
    cycleSetOccurrences: occurrences.filter((row) => row.representation === "cycle").length,
    unresolvedIdentityOccurrences: occurrences.filter((row) => row.identityIssue !== null).length,
    invalidMetricOccurrences: occurrences.filter((row) => row.metrics.metricIssues.length > 0).length,
    repeatedIdOccurrences, conflictingMetricGroups, rootCycleOverlapGroups,
    sameClientSessionLinkedOccurrences, sessionMetricConflictOccurrences,
    targetFactsCreated: 0 as const, targetWrites: 0 as const,
  };
}
