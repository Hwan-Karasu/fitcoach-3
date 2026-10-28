export type { TrainingTransferPort } from "./domain/TrainingTransferPort.ts";
export type { WorkbookFilesPort, PickedWorkbook, ImportTable } from "./domain/WorkbookFilesPort.ts";
export { detectLegacyMapping, normalizeLegacyTable, legacyFields, type LegacyMapping } from "./domain/LegacyExcel.ts";
export { AI_WORKBOOK_FILENAME, AI_WORKBOOK_PROMPT } from "./domain/AiWorkbookTemplate.ts";
export type { TrainingTransfer, TransferSummary } from "../../shared/training-transfer/TrainingTransfer.ts";
export { transferReviewScopes, type TransferReviewScope } from "./domain/TrainingTransferReview.ts";
export { copyWorkbookPlan, hasRepeatedWorkbookWeeks } from "./domain/BuilderWorkbook.ts";
export { selectTransferCycle } from "./domain/SelectTransferCycle.ts";
export { correctTransferIssue } from "./domain/IssueCorrections.ts";
export { startWorkbookReview, selectWorkbookSheet, updateWorkbookEntry, applyWorkbookColumns, correctWorkbookValue,
  type WorkbookReviewSession, type WorkbookReviewEntry } from "./domain/WorkbookReviewSession.ts";
export { applyWorkbookNameMappings, autoMatchWorkbookEntry, setWorkbookNameMatch, workbookSourceNames, workbookMatchesToRemember, requireWorkbookNameChoices } from "./domain/WorkbookReviewSession.ts";
export type { ExerciseImportMatchesPort, ExerciseImportMatch } from "./domain/ExerciseImportMatches.ts";
export { prepareWholeWorkbook, prepareWorkbookResponsive, wholeWorkbookStatus, workbookUnmatchedTargets, compileWholeWorkbook } from "./domain/WholeWorkbookImport.ts";
export { selectWorkbookImportSheets, emptyWorkbookSheet } from "./domain/WorkbookReviewSession.ts";
export { builderWorkbookImport } from "./domain/BuilderWorkbookImport.ts";
export { assertValidTransfer } from "./domain/TransferValidation.ts";
export { reidTransfer, transferSourceIds } from "./domain/TransferIds.ts";
export { hasRecord, settleImportedSessions } from "./domain/TransferCompletion.ts";
