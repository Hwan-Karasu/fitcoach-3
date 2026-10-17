export type { ConfirmationMode, PreviousQuery, PreviousSet, SessionStatus, SetFact, SetType, SetValues, WeekStatus,
  WorkoutExecution, WorkoutOutcome, WorkoutSession, WorkoutSlot, WorkoutStatus } from "./domain/ExecutionModel.ts";
export { hasEnteredData, isComplete, nextOutcome, weekStatus, workoutStatus } from "./domain/ExecutionRules.ts";
export { WorkoutScreen } from "./presentation/WorkoutScreen.tsx";
export { ProgramWeeksPanel } from "./presentation/ProgramWeeksPanel.tsx";
export type { SaveSetInput, SetIdentity, SetSaveResult, TrainingExecutionCommittedChange,
  TrainingExecutionPort } from "./domain/TrainingExecutionPort.ts";
