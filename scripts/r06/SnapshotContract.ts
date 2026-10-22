export interface SnapshotMediaSummary {
  readonly version: 1;
  readonly entries: number;
  readonly bytes: number;
  readonly sha256: string;
}
export interface SnapshotManifest {
  readonly kind: "athlete-diary-snapshot";
  readonly formatVersion: 3;
  readonly backupId: string;
  readonly createdAt: string;
  readonly product: "athlete_diary";
  readonly workspaceId: string;
  readonly contentSha256: string;
  /** Absent only in the original metadata-only prototype, snapshot owner version 1. */
  readonly media?: SnapshotMediaSummary;
}
export class SnapshotError extends Error {
  readonly code: "SNAPSHOT_INVALID" | "SNAPSHOT_INCOMPLETE_MEDIA" | "SNAPSHOT_DESTINATION_EXISTS" | "SNAPSHOT_IO_FAILED";
  constructor(code: SnapshotError["code"]) { super(code); this.code = code; }
}
