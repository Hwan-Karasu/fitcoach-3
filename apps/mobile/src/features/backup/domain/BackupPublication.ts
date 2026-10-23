export type BackupStorageErrorCode = "BACKUP_STORAGE_UNAVAILABLE" | "BACKUP_LOCATION_UNSUPPORTED"
  | "BACKUP_PUBLICATION_INVALID" | "BACKUP_DESTINATION_UNAVAILABLE" | "BACKUP_VERIFICATION_FAILED";
export class BackupStorageError extends Error {
  readonly code: BackupStorageErrorCode;
  constructor(code: BackupStorageErrorCode) { super(code); this.code = code; }
}
export interface VerifiedBackupFile {
  readonly sourceUri: string;
  readonly backupId: string;
  readonly createdAt: string;
  readonly sha256: string;
  readonly bytes: number;
}
export type BackupDestination = Readonly<{ kind: "DOWNLOADS" }> | Readonly<{ kind: "DIRECTORY"; uri: string }>;
/** Expo Directory.uri appends a raw slash; Android's persisted tree grant does not.
 * Keep encoded document IDs intact and let native code require the exact grant. */
export function publicationTreeUri(destination: BackupDestination): string | null {
  return destination.kind === "DIRECTORY" ? destination.uri.replace(/\/+$/u, "") : null;
}
export interface PublishedBackup {
  readonly uri: string;
  readonly filename: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface BackupPublisherPort {
  readonly available: boolean;
  readonly supportsDownloads: boolean;
  publish(source: VerifiedBackupFile, destination: BackupDestination): Promise<PublishedBackup>;
}
export function backupFilename(source: Pick<VerifiedBackupFile, "backupId" | "createdAt">): string {
  try {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(source.backupId) ||
      new Date(source.createdAt).toISOString() !== source.createdAt) throw new Error();
    return `athlete-diary-${source.createdAt.slice(0, 19).replace(/[-:]/gu, "").replace("T", "-")}-${source.backupId}.atbackup`;
  } catch { throw new BackupStorageError("BACKUP_PUBLICATION_INVALID"); }
}
/** The platform must return the exact artifact it was asked to publish. An arbitrary success
 * boolean, a different backup/digest, or content-free platform failure cannot become UI success. */
export function parsePublishedBackup(value: unknown, source: VerifiedBackupFile): PublishedBackup {
  const filename = backupFilename(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BackupStorageError("BACKUP_PUBLICATION_INVALID");
  const result = value as Partial<PublishedBackup> & { ok?: unknown; code?: unknown };
  if (result.ok === false && Object.keys(result).sort().join(",") === "code,ok" && typeof result.code === "string" &&
    ["BACKUP_LOCATION_UNSUPPORTED", "BACKUP_PUBLICATION_INVALID", "BACKUP_DESTINATION_UNAVAILABLE", "BACKUP_VERIFICATION_FAILED"].includes(result.code)) {
    throw new BackupStorageError(result.code as BackupStorageErrorCode);
  }
  if (result.ok !== true || Object.keys(result).sort().join(",") !== "bytes,filename,ok,sha256,uri" ||
    typeof result.uri !== "string" || !/^content:\/\/[a-zA-Z0-9._-]+\//u.test(result.uri) ||
    result.filename !== filename || result.sha256 !== source.sha256 || !/^[a-f0-9]{64}$/u.test(source.sha256) ||
    !Number.isSafeInteger(result.bytes) || result.bytes! < 100 || result.bytes !== source.bytes) {
    throw new BackupStorageError("BACKUP_PUBLICATION_INVALID");
  }
  return { uri: result.uri, filename, sha256: result.sha256, bytes: result.bytes } as PublishedBackup;
}
