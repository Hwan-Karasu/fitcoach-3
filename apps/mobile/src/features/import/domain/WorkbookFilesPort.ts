import type { TrainingTransfer, TransferCycle } from "../../../shared/training-transfer/TrainingTransfer.ts";
/** Original Excel coordinates are one-based, including the original header rows. */
export interface ImportCellOrigin { readonly row: number; readonly column: number }
export interface ImportTable {
  readonly name: string;
  readonly rows: readonly (readonly unknown[])[];
  readonly cellOrigins?: readonly (readonly (ImportCellOrigin | null)[])[];
  /** Present only on an internally flattened matrix; settings must show the original worksheet. */
  readonly matrixSource?: ImportTable;
  /** Таблица из текста заметок (TEXT-LOG-2): без настройки столбцов, адрес значения — строка текста. */
  readonly source?: "text";
  /** Тип цикла и повторения, выбранные при импорте заметок; переходят в мезоцикл. */
  readonly cycle?: Pick<TransferCycle, "cycleType" | "repRange">;
}
export type PickedWorkbook = Readonly<{ filename?: string }> & (Readonly<{ kind: "TRANSFER"; value: TrainingTransfer; planSheets?: readonly { readonly name: string; readonly scopeId: string }[] }> | Readonly<{ kind: "TABLES"; sourceId: string; tables: readonly ImportTable[] }>);
export interface WorkbookFilesPort {
  pick(options?: Readonly<{ onReading?: () => Promise<void>; active?: () => boolean }>): Promise<PickedWorkbook | null>;
  share(value: TrainingTransfer): Promise<void>;
  template(): Promise<void>;
  /** Плоский образец «строка = подход» для переделки чужой таблицы через ИИ (EXCEL-AI). */
  aiTemplate(): Promise<void>;
  /** Текст в буфер обмена (промпт для ИИ). */
  copyText(text: string): Promise<void>;
}
