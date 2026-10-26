export type { TrainingTransferPort } from "./domain/TrainingTransferPort.ts";
export type { WorkbookFilesPort, PickedWorkbook, ImportTable } from "./domain/WorkbookFilesPort.ts";
export { detectLegacyMapping, normalizeLegacyTable, legacyFields, type LegacyMapping } from "./domain/LegacyExcel.ts";
export type { TrainingTransfer, TransferSummary } from "../../shared/training-transfer/TrainingTransfer.ts";
export { transferReviewScopes, type TransferReviewScope } from "./domain/TrainingTransferReview.ts";
export { copyWorkbookPlan, hasRepeatedWorkbookWeeks } from "./domain/BuilderWorkbook.ts";
export { selectTransferCycle } from "./domain/SelectTransferCycle.ts";
export { correctTransferIssue } from "./domain/IssueCorrections.ts";
export { startWorkbookReview, selectWorkbookSheet, updateWorkbookEntry, applyWorkbookColumns, correctWorkbookValue,
  type WorkbookReviewSession, type WorkbookReviewEntry } from "./domain/WorkbookReviewSession.ts";
export { applyWorkbookNameMappings, autoMatchWorkbookEntry, setWorkbookNameMatch, workbookSourceNames, workbookMatchesToRemember, requireWorkbookNameChoices } from "./domain/WorkbookReviewSession.ts";
export type { ExerciseImportMatchesPort, ExerciseImportMatch } from "./domain/ExerciseImportMatches.ts";
export { prepareWholeWorkbook, wholeWorkbookStatus, compileWholeWorkbook } from "./domain/WholeWorkbookImport.ts";
