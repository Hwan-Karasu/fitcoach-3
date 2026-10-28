import type { TrainingTransfer } from "../../../shared/training-transfer/TrainingTransfer.ts";
/** Original Excel coordinates are one-based, including the original header rows. */
export interface ImportCellOrigin { readonly row: number; readonly column: number }
export interface ImportTable {
  readonly name: string;
  readonly rows: readonly (readonly unknown[])[];
  readonly cellOrigins?: readonly (readonly (ImportCellOrigin | null)[])[];
  /** Present only on an internally flattened matrix; settings must show the original worksheet. */
  readonly matrixSource?: ImportTable;
}
export type PickedWorkbook = Readonly<{ filename?: string }> & (Readonly<{ kind: "TRANSFER"; value: TrainingTransfer; planSheets?: readonly { readonly name: string; readonly scopeId: string }[] }> | Readonly<{ kind: "TABLES"; sourceId: string; tables: readonly ImportTable[] }>);
export interface WorkbookFilesPort {
  pick(options?: Readonly<{ onReading?: () => Promise<void>; active?: () => boolean }>): Promise<PickedWorkbook | null>;
  share(value: TrainingTransfer): Promise<void>;
  /** Образец файла для импорта в формате 2.0 (матрица по неделям). */
  template(): Promise<void>;
}
