import type { TrackingMetric, WorkoutExecution, WorkoutSlot } from "./ExecutionModel.ts";

export interface WorkoutCopyMapping {
  readonly source: WorkoutSlot;
  readonly target: WorkoutSlot;
  readonly exercises: readonly Readonly<{
    sourceId: string; targetId: string; exerciseId: string; metrics: readonly TrackingMetric[];
    sets: readonly Readonly<{ sourceId: string; targetId: string }>[];
  }>[];
}
export interface WeekExecutionParticipant<Tx> {
  read(tx: Tx, slots: readonly WorkoutSlot[]): Promise<readonly WorkoutExecution[]>;
  replace(tx: Tx, targets: readonly WorkoutSlot[], mappings: readonly WorkoutCopyMapping[],
    mode: "PLAN" | "PREFILL" | "CONFIRM", now: Date): Promise<void>;
  notify(clientId: string, programId: string): void;
}
