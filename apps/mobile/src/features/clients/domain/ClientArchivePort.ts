export type ArchiveSortMode = "ARCHIVED_AT" | "NAME";

export interface ClientLifecycleCounts {
  readonly active: number;
  readonly archived: number;
}

/** Rows owned by one client in each connected owner; read-only preview before a destructive commit. */
export interface ClientDeletionManifest {
  readonly clientId: string;
  readonly displayName: string;
  readonly revision: number;
  readonly owners: readonly Readonly<{ owner: string; rows: number }>[];
}

export interface ClientArchivePort {
  getArchiveSort(): Promise<ArchiveSortMode>;
  setArchiveSort(mode: ArchiveSortMode): Promise<void>;
  countByLifecycle(): Promise<ClientLifecycleCounts>;
  /** Fails with CLIENT_NOT_ARCHIVED for an active client; never mutates. */
  previewPermanentDelete(clientId: string): Promise<ClientDeletionManifest>;
  /** One transaction over the explicit owner manifest; unknown client references fail closed. */
  deleteArchivedPermanently(clientId: string, expectedRevision: number): Promise<void>;
}
