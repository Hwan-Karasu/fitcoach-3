import type { TrainingTransfer, TransferSummary } from "../../../shared/training-transfer/TrainingTransfer.ts";
import type { ExerciseImportMatchesPort, ExerciseImportMatch } from "./ExerciseImportMatches.ts";
export interface TrainingTransferPort extends ExerciseImportMatchesPort {
  exportClient(clientId: string, programIds: readonly string[]): Promise<TrainingTransfer>;
  /** Entire batch commits once; repeated identical batches are skipped, changed batches conflict. */
  importClient(clientId: string, value: TrainingTransfer, exerciseMapping: Readonly<Record<string, string>>,
    options?: Readonly<{ rememberMatches: readonly ExerciseImportMatch[] }>): Promise<TransferSummary>;
}
