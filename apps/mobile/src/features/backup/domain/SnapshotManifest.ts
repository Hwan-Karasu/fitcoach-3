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
  /** Absent only in the original snapshot-owner version 1. */
  readonly media?: SnapshotMediaSummary;
}
export class SnapshotError extends Error {
  readonly code: "SNAPSHOT_INVALID" | "SNAPSHOT_INCOMPLETE_MEDIA" | "SNAPSHOT_DESTINATION_EXISTS" | "SNAPSHOT_IO_FAILED";
  constructor(code: SnapshotError["code"]) { super(code); this.code = code; }
}
export function parseSnapshotManifest(json: unknown, workspaceId: string): SnapshotManifest {
  try {
    if (typeof json !== "string" || json.length > 8192) throw new Error();
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const m = value as Partial<SnapshotManifest>;
    if (m.kind !== "athlete-diary-snapshot" || m.formatVersion !== 3 || m.product !== "athlete_diary" ||
      m.workspaceId !== workspaceId || typeof m.backupId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(m.backupId) ||
      typeof m.createdAt !== "string" || new Date(m.createdAt).toISOString() !== m.createdAt ||
      typeof m.contentSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(m.contentSha256) ||
      Object.keys(m).sort().join(",") !== (m.media === undefined
        ? "backupId,contentSha256,createdAt,formatVersion,kind,product,workspaceId"
        : "backupId,contentSha256,createdAt,formatVersion,kind,media,product,workspaceId")) throw new Error();
    if (m.media !== undefined) {
      const media = m.media as Partial<SnapshotMediaSummary>;
      if (!media || typeof media !== "object" || Array.isArray(media) || media.version !== 1 ||
        !Number.isSafeInteger(media.entries) || media.entries! < 0 || !Number.isSafeInteger(media.bytes) || media.bytes! < 0 ||
        typeof media.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(media.sha256) ||
        Object.keys(media).sort().join(",") !== "bytes,entries,sha256,version") throw new Error();
      return { ...m, media: { version: 1, entries: media.entries!, bytes: media.bytes!, sha256: media.sha256 } } as SnapshotManifest;
    }
    return m as SnapshotManifest;
  } catch { throw new SnapshotError("SNAPSHOT_INVALID"); }
}
