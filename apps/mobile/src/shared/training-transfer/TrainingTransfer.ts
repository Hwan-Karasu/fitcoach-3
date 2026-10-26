/** Public, database-independent interchange contract shared by the two applications. */
export interface TransferValues { readonly reps: number | null; readonly loadGrams: number | null; readonly durationSec: number | null; readonly distanceM: number | null }
export interface TransferSet extends TransferValues { readonly id: string; readonly repsMax: number | null }
export interface TransferExercise {
  readonly id: string; readonly exerciseId: string; readonly lineageId?: string; readonly supersetId?: string;
  readonly restSec: number | null; readonly instruction: string | null;
  readonly rir: Readonly<{ min: number; max: number | null }> | null; readonly sets: readonly TransferSet[];
}
export interface TransferWorkout { readonly id: string; readonly title: string; readonly lineageId?: string; readonly exercises: readonly TransferExercise[] }
export interface TransferWeek { readonly id: string; readonly index: number; readonly type: "base" | "light" | "medium" | "heavy" | "deload"; readonly workouts: readonly TransferWorkout[] }
export interface TransferCycle {
  readonly id: string; readonly lineageId: string; readonly title: string; readonly weeks: readonly TransferWeek[];
  readonly cycleType?: "hypertrophy" | "strength" | "power" | "endurance" | "recomp" | "custom" | null;
  readonly repRange?: Readonly<{ min: number; max: number | null }> | null; readonly startDate?: string | null;
}
export interface TransferProgram {
  readonly id: string; readonly title: string; readonly kind: "SIMPLE" | "PERIODIZED";
  readonly archivedAt: string | null; readonly createdAt: string;
  readonly simple: Readonly<{ weeks: number; workouts: readonly TransferWorkout[] }> | null;
  readonly simpleWeeks: readonly Readonly<{ index: number; workouts: readonly TransferWorkout[] }>[];
  readonly mesocycles: readonly TransferCycle[];
}
export interface TransferFact {
  readonly id: string; readonly plannedSetId: string; readonly plannedExerciseId: string; readonly exerciseId: string;
  readonly position: number; readonly setType: "NORMAL" | "WARMUP" | "FAILURE" | "DROP";
  readonly values: TransferValues; readonly drops: readonly TransferValues[]; readonly rpe: number | null;
  readonly confirmed: boolean; readonly extra: boolean; readonly origin: "INPUT" | "COPY" | "IMPORT"; readonly revision: number;
  readonly sides: Readonly<{ left: Readonly<{ values: TransferValues; confirmed: boolean }>; right: Readonly<{ values: TransferValues; confirmed: boolean }> }> | null;
}
export interface TransferSession {
  readonly id: string; readonly programId: string; readonly weekIndex: number; readonly plannedWorkoutId: string;
  readonly outcome: "COMPLETED" | "MISSED" | "CANCELLED" | null; readonly actualDate: string | null;
  readonly startedAt: string | null; readonly finishedAt: string | null;
  readonly origin: Readonly<{ programTitle: string; programKind: "SIMPLE" | "PERIODIZED"; mesocycleTitle: string | null; workoutTitle: string | null }> | null;
  readonly facts: readonly TransferFact[]; readonly notes: readonly Readonly<{ plannedExerciseId: string; text: string }>[];
}
export interface TrainingTransfer {
  readonly format: "athlete-training"; readonly version: 1; readonly sourceId: string;
  readonly client: Readonly<{ id: string; name: string }>;
  readonly exercises: readonly Readonly<{ id: string; name: string }>[];
  readonly programs: readonly TransferProgram[]; readonly sessions: readonly TransferSession[];
  readonly planHistory?: readonly TransferPlanHistory[];
  readonly issues?: readonly TransferIssue[];
}
export interface TransferIssue {
  readonly source?: Readonly<{ sheet: string; row: number; column: number }>;
  readonly id: string; readonly programId: string; readonly scope: "PLAN_SET" | "FACT";
  readonly targetId: string; readonly field: keyof TransferValues | "rpe"; readonly raw: string;
  readonly weekIndex?: number; readonly workoutId?: string;
}
export interface TransferPlanHistory {
  readonly id: string; readonly programId: string; readonly validFrom: string; readonly validTo: string;
  readonly simple: Readonly<{ title: string; weeks: readonly Readonly<{ index: number; workouts: readonly TransferWorkout[] }>[] }> | null;
  readonly mesocycle: TransferCycle | null;
}
export interface TransferSummary { readonly programs: number; readonly sessions: number; readonly sets: number }
export function transferSummary(value: TrainingTransfer): TransferSummary {
  return { programs: value.programs.length, sessions: value.sessions.length, sets: value.sessions.reduce((sum, s) => sum + s.facts.length, 0) };
}
