import type { BackupDestination, BackupStorageErrorCode } from "./BackupPublication.ts";

export type ManualBackupErrorCode = BackupStorageErrorCode | "BACKUP_BUSY" | "BACKUP_NOT_READY"
  | "BACKUP_SOURCE_UNAVAILABLE" | "BACKUP_MEDIA_UNAVAILABLE" | "BACKUP_FOLDER_UNAVAILABLE";
export class ManualBackupError extends Error {
  readonly code: ManualBackupErrorCode;
  constructor(code: ManualBackupErrorCode) { super(code); this.code = code; }
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
  readonly phase: "IDLE" | "LOADING" | "CHOOSING" | "CREATING" | "PUBLISHING";
  readonly location: BackupDestination["kind"] | "UNKNOWN";
  readonly lastSaved: SavedBackupSummary | null;
  readonly error: ManualBackupErrorCode | null;
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
