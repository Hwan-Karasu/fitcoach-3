import type { DatabaseSync } from "node:sqlite";
import type { LegacyProgramBookSource } from "./LegacyProgramBookSourceReader.ts";
import type { SessionProgramLinkCandidate } from "./SessionProgramLinkCandidates.ts";

export type WorkoutOriginSignalKind = "column-not-observed" | "missing-workout-id" |
  "workout-not-found" | "workout-owner-missing" | "workout-other-client" |
  "workout-same-client";

export interface SessionWorkoutOriginSignal {
  readonly sourceSessionKey: string;
  readonly sourceWorkoutId: string | null;
  readonly workoutClientId: string | null;
  readonly workoutProgramId: string | null;
  readonly kind: WorkoutOriginSignalKind;
  readonly programKeyAgreesWithWorkout: boolean | null;
  readonly workoutProgramOwnedBySessionClient: boolean;
  readonly targetProgramId: null;
}

export interface SessionWorkoutOriginReport {
  readonly status: "requires-semantic-review";
  readonly physicalSessions: number;
  readonly sourceWorkoutColumnObserved: boolean;
  readonly withSourceWorkoutId: number;
  readonly sameClientWorkoutRows: number;
  readonly otherClientWorkoutRows: number;
  readonly missingWorkoutRows: number;
  readonly missingWorkoutOwnerRows: number;
  readonly matchingProgramKeys: number;
  readonly differingProgramKeys: number;
  readonly problemProgramLinkRows: number;
  readonly problemRowsWithSameClientWorkout: number;
  readonly problemRowsWithOwnedWorkoutProgram: number;
  readonly targetMappedSessions: 0;
  readonly targetWrites: 0;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Independent source-workout clue; never rewrites a session's program_key. */
export function triangulateSessionWorkoutOriginsInSnapshot(
  db: DatabaseSync, accountScope: string,
  candidates: readonly SessionProgramLinkCandidate[],
  programs: readonly LegacyProgramBookSource[],
): { readonly signals: readonly SessionWorkoutOriginSignal[];
  readonly report: SessionWorkoutOriginReport } {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const workoutColumns = new Set(db.prepare("PRAGMA table_info('training_workouts')").all()
    .map((row) => String(row.name)));
  if (["id", "client_id", "program_id"].some((column) => !workoutColumns.has(column))) {
    throw new Error("R04_SESSION_WORKOUT_SHAPE_UNSUPPORTED");
  }
  const workouts = db.prepare("SELECT id, client_id, program_id FROM training_workouts").all();
  const workoutCount = db.prepare("SELECT count(*) AS count FROM training_workouts").get() as
    { count: number };
  if (workouts.length !== workoutCount.count) throw new Error("R04_SESSION_WORKOUT_CARDINALITY_MISMATCH");
  const byWorkoutId = new Map<string, { clientId: string | null; programId: string | null }>();
  for (const workout of workouts) {
    const id = textOrNull(workout.id);
    if (id === null) throw new Error("R04_SESSION_WORKOUT_PROVENANCE_INCOMPLETE");
    if (byWorkoutId.has(id)) throw new Error("R04_DUPLICATE_SOURCE_WORKOUT_ID");
    byWorkoutId.set(id, {
      clientId: textOrNull(workout.client_id), programId: textOrNull(workout.program_id),
    });
  }
  const programOwners = new Map<string, string>();
  for (const program of programs) {
    if (program.accountScope !== accountScope) throw new Error("R04_SESSION_WORKOUT_SCOPE_MISMATCH");
    if (programOwners.has(program.sourceProgramId)) throw new Error("R04_DUPLICATE_PROGRAM_SOURCE_ID");
    programOwners.set(program.sourceProgramId, program.clientId);
  }
  const seenSessions = new Set<string>();
  let withSourceWorkoutId = 0;
  let sameClientWorkoutRows = 0;
  let otherClientWorkoutRows = 0;
  let missingWorkoutRows = 0;
  let missingWorkoutOwnerRows = 0;
  let matchingProgramKeys = 0;
  let differingProgramKeys = 0;
  let problemProgramLinkRows = 0;
  let problemRowsWithSameClientWorkout = 0;
  let problemRowsWithOwnedWorkoutProgram = 0;
  const columnObserved = candidates.length === 0 ? false : candidates[0]!.sourceWorkoutColumnObserved;
  const signals: SessionWorkoutOriginSignal[] = [];
  for (const candidate of candidates) {
    if (candidate.accountScope !== accountScope
      || candidate.sourceWorkoutColumnObserved !== columnObserved) {
      throw new Error("R04_SESSION_WORKOUT_SCOPE_OR_SHAPE_MISMATCH");
    }
    if (seenSessions.has(candidate.sourceKey)) throw new Error("R04_DUPLICATE_PROGRAM_SESSION_ID");
    seenSessions.add(candidate.sourceKey);
    const problem = candidate.linkKind !== "direct-same-client";
    if (problem) problemProgramLinkRows += 1;
    let kind: WorkoutOriginSignalKind = "workout-not-found";
    let workoutClientId: string | null = null;
    let workoutProgramId: string | null = null;
    let programKeyAgreesWithWorkout: boolean | null = null;
    let workoutProgramOwnedBySessionClient = false;
    if (!columnObserved) kind = "column-not-observed";
    else if (candidate.sourceWorkoutId === null) kind = "missing-workout-id";
    else {
      withSourceWorkoutId += 1;
      const workout = byWorkoutId.get(candidate.sourceWorkoutId);
      if (!workout) {
        kind = "workout-not-found";
        missingWorkoutRows += 1;
      } else {
        workoutClientId = workout.clientId;
        workoutProgramId = workout.programId;
      }
      if (workout && workout.clientId === null) {
        kind = "workout-owner-missing";
        missingWorkoutOwnerRows += 1;
      } else if (workout && workout.clientId !== candidate.clientId) {
        kind = "workout-other-client";
        otherClientWorkoutRows += 1;
      } else if (workout) {
        kind = "workout-same-client";
        sameClientWorkoutRows += 1;
        workoutProgramOwnedBySessionClient = workoutProgramId !== null
          && programOwners.get(workoutProgramId) === candidate.clientId;
        if (candidate.programKeyRaw !== null && workoutProgramId !== null) {
          programKeyAgreesWithWorkout = candidate.programKeyRaw === workoutProgramId;
          if (programKeyAgreesWithWorkout) matchingProgramKeys += 1;
          else differingProgramKeys += 1;
        }
        if (problem) {
          problemRowsWithSameClientWorkout += 1;
          if (workoutProgramOwnedBySessionClient) problemRowsWithOwnedWorkoutProgram += 1;
        }
      }
    }
    signals.push({
      sourceSessionKey: candidate.sourceKey, sourceWorkoutId: candidate.sourceWorkoutId,
      workoutClientId, workoutProgramId, kind, programKeyAgreesWithWorkout,
      workoutProgramOwnedBySessionClient, targetProgramId: null,
    });
  }
  if (signals.length !== candidates.length
    || withSourceWorkoutId < sameClientWorkoutRows + otherClientWorkoutRows
      + missingWorkoutRows + missingWorkoutOwnerRows
    || matchingProgramKeys + differingProgramKeys > sameClientWorkoutRows
    || problemRowsWithOwnedWorkoutProgram > problemRowsWithSameClientWorkout) {
    throw new Error("R04_SESSION_WORKOUT_CLASSIFICATION_INCOMPLETE");
  }
  return {
    signals,
    report: {
      status: "requires-semantic-review", physicalSessions: candidates.length,
      sourceWorkoutColumnObserved: columnObserved, withSourceWorkoutId,
      sameClientWorkoutRows, otherClientWorkoutRows, missingWorkoutRows,
      missingWorkoutOwnerRows, matchingProgramKeys, differingProgramKeys,
      problemProgramLinkRows, problemRowsWithSameClientWorkout,
      problemRowsWithOwnedWorkoutProgram,
      targetMappedSessions: 0, targetWrites: 0,
    },
  };
}
