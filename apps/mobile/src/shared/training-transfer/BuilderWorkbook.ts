import type { TransferCycle, TransferSession, TransferWeek, TransferWorkout } from "./TrainingTransfer.ts";

/** Data-only contract between workbook review, builders and the transaction coordinator. */
export interface BuilderWorkbookCycle {
  readonly key: string; readonly editing?: number; readonly title: string; readonly repsText?: string;
  readonly settings?: Pick<TransferCycle, "cycleType" | "repRange" | "startDate">;
  readonly weeks: readonly Readonly<{ type: TransferWeek["type"]; workouts: readonly TransferWorkout[] }>[];
  readonly imported?: Readonly<{ sourceId: string; sourceHash: string; sessions: readonly TransferSession[];
    matches: readonly Readonly<{ sourceName: string; targetId: string }>[] }>;
}
export interface BuilderWorkbookState { readonly version: 1; readonly cycles: readonly BuilderWorkbookCycle[]; readonly activeKey: string }
export interface BuilderExcelDraft {
  readonly title: string; readonly cycles?: readonly BuilderWorkbookCycle[];
  readonly settings?: BuilderWorkbookCycle["settings"]; readonly weeks: BuilderWorkbookCycle["weeks"];
}
export interface BuilderWorkbookSaveRequest {
  readonly clientId: string;
  readonly scope: Readonly<{ programId: string | null; mesocycleId: string | null }>;
  readonly expectedRevision: number | null; readonly programTitle: string;
  readonly cycles: readonly BuilderWorkbookCycle[]; readonly existingCycleKey: string | null; readonly clientIds: readonly string[];
  readonly placements: readonly Readonly<{ clientId: string; target:
    Readonly<{ kind: "join" }> | Readonly<{ kind: "new" }> | Readonly<{ kind: "program"; programId: string }>
    | Readonly<{ kind: "existing"; programId: string; mesocycleId: string; expectedRevision: number; expectedGroupId: string | null; confirmReassignment?: boolean; label?: string }> }>[];
  readonly resultsAction?: "DELETE" | "KEEP_HISTORY";
}
export interface BuilderWorkbookSavePort {
  saveBuilderWorkbook(request: BuilderWorkbookSaveRequest): Promise<Readonly<{ programId: string; mesocycleId: string }>>;
}
