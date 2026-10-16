import type { ClientRecord } from "./ClientRepositoryPort.ts";

/** UI invalidation hint only; committed SQLite rows remain authoritative. */
export interface ClientCommittedChange {
  readonly clientId: string | null;
  readonly affectedRosters: readonly ClientRecord["lifecycle"][];
}

export interface ClientChangePort {
  subscribeCommittedChanges(listener: (change: ClientCommittedChange) => void): () => void;
}
