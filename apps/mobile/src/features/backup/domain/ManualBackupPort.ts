import { classifyPrepareFailure, type PrepareFailureKind, type PrepareStage } from "./BackupFailure.ts";
import type { BackupProgress, BackupRunTiming } from "./BackupProgress.ts";
import type { BackupDestination, BackupStorageErrorCode } from "./BackupPublication.ts";

/** BACKUP_SOURCE_UNAVAILABLE — неизвестная причина подготовки; известные — свои коды (BKP-DIAG-1). */
export type ManualBackupErrorCode = BackupStorageErrorCode | "BACKUP_BUSY" | "BACKUP_NOT_READY"
  | "BACKUP_SOURCE_UNAVAILABLE" | "BACKUP_MEDIA_UNAVAILABLE" | "BACKUP_FOLDER_UNAVAILABLE"
  | "BACKUP_SPACE_LOW" | "BACKUP_SNAPSHOT_FAILED" | "BACKUP_ARCHIVE_INVALID" | "BACKUP_WRITE_FAILED";
export class ManualBackupError extends Error {
  readonly code: ManualBackupErrorCode;
  readonly stage: PrepareStage | null;
  constructor(code: ManualBackupErrorCode, stage: PrepareStage | null = null) { super(code); this.code = code; this.stage = stage; }
}
const PREPARE_CODES: Readonly<Record<PrepareFailureKind, ManualBackupErrorCode>> = { SPACE_LOW: "BACKUP_SPACE_LOW",
  MEDIA_UNAVAILABLE: "BACKUP_MEDIA_UNAVAILABLE", SNAPSHOT_FAILED: "BACKUP_SNAPSHOT_FAILED", ARCHIVE_INVALID: "BACKUP_ARCHIVE_INVALID",
  WRITE_FAILED: "BACKUP_WRITE_FAILED", UNKNOWN: "BACKUP_SOURCE_UNAVAILABLE" };
export function manualPrepareError(stage: PrepareStage, error: unknown): ManualBackupError {
  return new ManualBackupError(PREPARE_CODES[classifyPrepareFailure(stage, error)], stage);
}
export interface BackupLocationStore {
  read(): Promise<BackupDestination>;
  write(destination: BackupDestination): Promise<void>;
}
export interface SavedBackupSummary {
  readonly filename: string;
  readonly createdAt: string;
  readonly bytes: number;
  readonly location: BackupDestination["kind"];
}
export interface ManualBackupState {
  readonly available: boolean;
  /** WAITING — ждём завершения идущей автокопии (BKP-LOCK-1). */
  readonly phase: "IDLE" | "LOADING" | "CHOOSING" | "WAITING" | "CREATING" | "PUBLISHING";
  /** Этап и честный прогресс текущей копии (BKP-STAGE-1); null вне CREATING/PUBLISHING. */
  readonly progress: BackupProgress | null;
  readonly location: BackupDestination["kind"] | "UNKNOWN";
  readonly lastSaved: SavedBackupSummary | null;
  readonly error: ManualBackupErrorCode | null;
  readonly errorStage: PrepareStage | null;
  /** Время последней сохранённой копии по этапам. */
  readonly lastRun: BackupRunTiming | null;
}
export type ManualBackupOutcome = Readonly<{ kind: "SAVED"; backup: SavedBackupSummary }>
  | Readonly<{ kind: "UPDATED" | "CANCELLED" }> | Readonly<{ kind: "FAILED"; code: ManualBackupErrorCode }>;
export interface ManualBackupPort {
  readonly state: ManualBackupState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<ManualBackupOutcome>;
  createNow(): Promise<ManualBackupOutcome>;
  exportElsewhere(): Promise<ManualBackupOutcome>;
  chooseFolder(): Promise<ManualBackupOutcome>;
  useDefaultFolder(): Promise<ManualBackupOutcome>;
  /** Повторить последнюю неудачную копию (в выбранную папку или экспорт в тот же каталог). */
  retry(): Promise<ManualBackupOutcome>;
}
/** A present malformed preference must not silently redirect subsequent backups to Downloads. */
export function parseBackupLocation(value: unknown): BackupDestination {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entry = value as { version?: unknown; kind?: unknown; uri?: unknown };
    if (entry.version === 1 && entry.kind === "DOWNLOADS" && Object.keys(entry).sort().join(",") === "kind,version") return { kind: "DOWNLOADS" };
    if (entry.version === 1 && entry.kind === "DIRECTORY" && typeof entry.uri === "string" && entry.uri.length <= 8192 &&
      /^content:\/\/[a-zA-Z0-9._-]+\//u.test(entry.uri) && Object.keys(entry).sort().join(",") === "kind,uri,version") return { kind: "DIRECTORY", uri: entry.uri };
  }
  throw new ManualBackupError("BACKUP_FOLDER_UNAVAILABLE");
}
