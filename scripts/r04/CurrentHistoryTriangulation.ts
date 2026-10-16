import type { LegacyHistorySource } from "./HistoryLinkPreflight.ts";
import type { LegacyCurrentSetSource } from "./LegacyCurrentSetSourceReader.ts";
import type { LegacySetSource } from "./SourceFactPreflight.ts";
import type { LegacyWorkoutSnapshotSource } from "./LegacyWorkoutSnapshotSourceReader.ts";

type WorkoutSnapshotContext = Readonly<{
  candidateRows: number;
  noSameClientWorkoutLog: number;
  /** Subset of noSameClientWorkoutLog. */
  onlyOtherClientWorkoutLog: number;
  singleSameClientWorkoutLog: number;
  multipleSameClientWorkoutLogs: number;
  /** Overlapping warnings within singleSameClientWorkoutLog. */
  singleLogDeletionMarker: number;
  singleLogInvalidJson: number;
  singleLogMissingExerciseArray: number;
  singleLogOwnerLinkMismatch: number;
  singleLogLifecycleShapeUnknown: number;
}>;

export interface CurrentHistoryTriangulationReport {
  /** Completed marker, no deletion marker, and no same-client session-set reference. */
  readonly candidateRows: number;
  readonly noSameClientHistory: number;
  /** Subset of noSameClientHistory, never used as an owner substitute. */
  readonly onlyOtherClientHistory: number;
  readonly singleHistoryWithoutDeletionMarker: number;
  readonly singleHistoryWithDeletionMarker: number;
  readonly singleHistoryUnknownLifecycleShape: number;
  readonly multipleSameClientHistory: number;
  /** Workout-level context only; it never proves a nested set is the same fact. */
  readonly workoutSnapshotContext: WorkoutSnapshotContext | null;
  readonly targetWrites: 0;
}

function key(parts: readonly string[]): string { return JSON.stringify(parts); }

/** Triages one narrow legacy signal; history presence never proves performed-set truth. */
export function triangulateUnpairedCompletedCurrentSets(
  currentRows: readonly LegacyCurrentSetSource[],
  sessionRows: readonly LegacySetSource[],
  historyRows: readonly LegacyHistorySource[],
  snapshotRows: readonly LegacyWorkoutSnapshotSource[] | null = null,
): CurrentHistoryTriangulationReport {
  const sessionLinks = new Set(sessionRows
    .filter((row) => row.sourceFactId?.trim())
    .map((row) => key([row.accountScope, row.clientId, row.sourceFactId!])));
  const historiesByOwnerAndFact = new Map<string, LegacyHistorySource[]>();
  const historyOwnersByFact = new Map<string, Set<string>>();
  for (const row of historyRows) {
    if (!row.sourceFactId?.trim()) continue;
    const ownerKey = key([row.accountScope, row.clientId, row.sourceFactId]);
    const group = historiesByOwnerAndFact.get(ownerKey) ?? [];
    group.push(row);
    historiesByOwnerAndFact.set(ownerKey, group);
    const factKey = key([row.accountScope, row.sourceFactId]);
    const owners = historyOwnersByFact.get(factKey) ?? new Set<string>();
    owners.add(row.clientId);
    historyOwnersByFact.set(factKey, owners);
  }
  const snapshotsByOwnerAndWorkout = new Map<string, LegacyWorkoutSnapshotSource[]>();
  const snapshotOwnersByWorkout = new Map<string, Set<string>>();
  for (const row of snapshotRows ?? []) {
    const ownerKey = key([row.accountScope, row.clientId, row.sourceWorkoutId]);
    const group = snapshotsByOwnerAndWorkout.get(ownerKey) ?? [];
    group.push(row);
    snapshotsByOwnerAndWorkout.set(ownerKey, group);
    const workoutKey = key([row.accountScope, row.sourceWorkoutId]);
    const owners = snapshotOwnersByWorkout.get(workoutKey) ?? new Set<string>();
    owners.add(row.clientId);
    snapshotOwnersByWorkout.set(workoutKey, owners);
  }
  const workoutSnapshotContext = snapshotRows === null ? null : {
    candidateRows: 0,
    noSameClientWorkoutLog: 0,
    onlyOtherClientWorkoutLog: 0,
    singleSameClientWorkoutLog: 0,
    multipleSameClientWorkoutLogs: 0,
    singleLogDeletionMarker: 0,
    singleLogInvalidJson: 0,
    singleLogMissingExerciseArray: 0,
    singleLogOwnerLinkMismatch: 0,
    singleLogLifecycleShapeUnknown: 0,
  };
  const counts = {
    candidateRows: 0,
    noSameClientHistory: 0,
    onlyOtherClientHistory: 0,
    singleHistoryWithoutDeletionMarker: 0,
    singleHistoryWithDeletionMarker: 0,
    singleHistoryUnknownLifecycleShape: 0,
    multipleSameClientHistory: 0,
    workoutSnapshotContext,
    targetWrites: 0 as const,
  };
  for (const row of currentRows) {
    if (!row.lifecycleShapeComplete || row.completedAtRaw === null || row.setDeletedAtRaw !== null
      || row.exerciseDeletedAtRaw !== null || row.workoutDeletedAtRaw !== null
      || !row.effectiveSourceFactId?.trim()) continue;
    const ownerKey = key([row.accountScope, row.clientId, row.effectiveSourceFactId]);
    if (sessionLinks.has(ownerKey)) continue;
    counts.candidateRows += 1;
    const matches = historiesByOwnerAndFact.get(ownerKey) ?? [];
    if (matches.length === 0) {
      counts.noSameClientHistory += 1;
      const owners = historyOwnersByFact.get(key([row.accountScope, row.effectiveSourceFactId]));
      if (owners?.size && !owners.has(row.clientId)) counts.onlyOtherClientHistory += 1;
      if (workoutSnapshotContext !== null) {
        workoutSnapshotContext.candidateRows += 1;
        const logs = snapshotsByOwnerAndWorkout.get(key([row.accountScope, row.clientId, row.sourceWorkoutId])) ?? [];
        if (logs.length === 0) {
          workoutSnapshotContext.noSameClientWorkoutLog += 1;
          const logOwners = snapshotOwnersByWorkout.get(key([row.accountScope, row.sourceWorkoutId]));
          if (logOwners?.size && !logOwners.has(row.clientId)) {
            workoutSnapshotContext.onlyOtherClientWorkoutLog += 1;
          }
        } else if (logs.length > 1) workoutSnapshotContext.multipleSameClientWorkoutLogs += 1;
        else {
          workoutSnapshotContext.singleSameClientWorkoutLog += 1;
          const log = logs[0]!;
          if (log.deletedAtRaw != null) workoutSnapshotContext.singleLogDeletionMarker += 1;
          if (log.dataStatus === "invalid-json") workoutSnapshotContext.singleLogInvalidJson += 1;
          if (log.dataStatus === "missing-exercise-array") {
            workoutSnapshotContext.singleLogMissingExerciseArray += 1;
          }
          if (log.ownerLinkStatus !== "matched") workoutSnapshotContext.singleLogOwnerLinkMismatch += 1;
          if (!log.lifecycleShapeComplete) workoutSnapshotContext.singleLogLifecycleShapeUnknown += 1;
        }
      }
    } else if (matches.length > 1) counts.multipleSameClientHistory += 1;
    else if (matches[0]?.lifecycleShapeComplete !== true) {
      counts.singleHistoryUnknownLifecycleShape += 1;
    } else if (matches[0]?.deletedAtRaw != null) {
      counts.singleHistoryWithDeletionMarker += 1;
    } else counts.singleHistoryWithoutDeletionMarker += 1;
  }
  if (counts.noSameClientHistory + counts.singleHistoryWithoutDeletionMarker
    + counts.singleHistoryWithDeletionMarker + counts.singleHistoryUnknownLifecycleShape
    + counts.multipleSameClientHistory !== counts.candidateRows
    || counts.onlyOtherClientHistory > counts.noSameClientHistory) {
    throw new Error("R04_CURRENT_HISTORY_TRIANGULATION_INCOMPLETE");
  }
  if (workoutSnapshotContext !== null && (
    workoutSnapshotContext.candidateRows !== counts.noSameClientHistory
    || workoutSnapshotContext.noSameClientWorkoutLog + workoutSnapshotContext.singleSameClientWorkoutLog
      + workoutSnapshotContext.multipleSameClientWorkoutLogs !== workoutSnapshotContext.candidateRows
    || workoutSnapshotContext.onlyOtherClientWorkoutLog > workoutSnapshotContext.noSameClientWorkoutLog
  )) throw new Error("R04_CURRENT_SNAPSHOT_CONTEXT_INCOMPLETE");
  return counts;
}
