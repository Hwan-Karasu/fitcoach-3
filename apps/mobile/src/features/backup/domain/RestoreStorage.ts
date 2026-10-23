export type RestoreSlot = "LIVE" | "INCOMING" | "SAFETY" | "PREVIOUS" | "REJECTED" | "ROLLBACK";
export type RestorePhase = "PREPARED" | "COMMITTED" | "COMPLETED" | "ROLLED_BACK";
export type RestoreOutcome = "COMMITTED" | "ROLLED_BACK" | "NO_OPERATION";
export interface RestorePlan {
  readonly operationId: string;
  readonly incomingSha256: string;
  readonly currentSha256: string;
}
export interface RestoreGuard extends RestorePlan { readonly version: 1; readonly phase: RestorePhase }

/** Fixed private slots, never paths taken from an external backup or guard.
 * withClosedDatabase drains readers/writers, closes every SQLite handle, pauses scheduler
 * and prevents acquisition for the callback's entire lifetime. copy/move never overwrite;
 * move is atomic in one filesystem. saveGuard resolves only for a complete durable guard.
 * SAFETY is independent; the protocol never moves/deletes it.
 */
export interface RestoreStorage {
  withClosedDatabase<T>(task: () => Promise<T>): Promise<T>;
  loadGuard(): Promise<unknown | null>;
  saveGuard(guard: RestoreGuard): Promise<void>;
  sha256(slot: RestoreSlot): Promise<string | null>;
  validateDatabase(slot: RestoreSlot): Promise<void>;
  copyExclusive(from: RestoreSlot, to: RestoreSlot): Promise<void>;
  moveExclusive(from: RestoreSlot, to: RestoreSlot): Promise<void>;
}
