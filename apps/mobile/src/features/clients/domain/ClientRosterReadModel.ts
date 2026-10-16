import type { ArchiveSortMode, ClientLifecycleCounts } from "./ClientArchivePort.ts";
import type { BirthdayDismissal, ClientRosterRow, RosterBirthdaySettings,
  RosterSortMode } from "./ClientRosterPort.ts";

export interface ClientListModel {
  readonly rows: readonly ClientRosterRow[];
  readonly sort: RosterSortMode;
  readonly archiveSort: ArchiveSortMode;
  readonly birthday: RosterBirthdaySettings;
  readonly dismissals: readonly BirthdayDismissal[];
}

export type ClientListSnapshot =
  | Readonly<{ status: "loading" | "error"; revision: 0 }>
  | Readonly<{ status: "ready"; revision: number; data: ClientListModel;
    refreshing: boolean; refreshFailed: boolean }>;

/** Structural read-only port so the feature UI never imports app read-model infrastructure. */
export interface ClientListQueryPort {
  getSnapshot(): ClientListSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
}

export type ClientCountsSnapshot =
  | Readonly<{ status: "loading" | "error"; revision: 0 }>
  | Readonly<{ status: "ready"; revision: number; data: ClientLifecycleCounts;
    refreshing: boolean; refreshFailed: boolean }>;

export interface ClientCountsQueryPort {
  getSnapshot(): ClientCountsSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
}
