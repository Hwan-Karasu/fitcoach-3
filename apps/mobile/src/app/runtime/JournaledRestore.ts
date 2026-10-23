import { GuardedRestore, RestoreProtocolError, parseRestoreGuard, type RestoreOutcome, type RestoreStorage } from "../../features/backup/public.ts";
import { parsePendingRuntimeRestore, type PendingRuntimeRestore } from "../bootstrap/recoverRuntimeRestore.ts";

export interface RuntimeRestoreJournal {
  readPending(): Promise<{ readonly value: unknown } | null>;
  /** The UUID has already been validated; implementations derive a fixed private path. */
  readGuard(operationId: string): Promise<unknown | null>;
  publish(plan: PendingRuntimeRestore): Promise<void>;
}
const busy = (): never => { throw new RestoreProtocolError("RESTORE_BUSY"); };

/** Confirmation is owned by the application controller. This primitive holds ONE closed
 * database lease across validation, atomic journal publication and the complete protocol.
 * Reopening between publishing pending.json and the swap would allow a legitimate write
 * to invalidate cold recovery. Return-point publication remains a separate controller duty. */
export async function restoreWithRuntimeJournal(input: unknown, storage: RestoreStorage,
  journal: RuntimeRestoreJournal): Promise<RestoreOutcome> {
  const plan = parsePendingRuntimeRestore(input);
  try {
    return await storage.withClosedDatabase(async () => {
      const locked: RestoreStorage = {
        withClosedDatabase: async (task) => task(), loadGuard: () => storage.loadGuard(), saveGuard: (guard) => storage.saveGuard(guard),
        sha256: (slot) => storage.sha256(slot), validateDatabase: (slot) => storage.validateDatabase(slot),
        copyExclusive: (from, to) => storage.copyExclusive(from, to), moveExclusive: (from, to) => storage.moveExclusive(from, to),
      };
      const protocol = new GuardedRestore(locked);
      const pending = await journal.readPending();
      if (pending !== null) {
        const old = parsePendingRuntimeRestore(pending.value);
        if (old.operationId === plan.operationId) {
          if (old.currentSha256 !== plan.currentSha256 || old.incomingSha256 !== plan.incomingSha256) busy();
          const saved = await storage.loadGuard();
          if (saved !== null) {
            const guard = parseRestoreGuard(saved);
            if (guard.phase === "COMPLETED" || guard.phase === "ROLLED_BACK") await storage.validateDatabase("LIVE");
          }
          return protocol.restore(plan); // Receipt replay never republishes or replaces later writes.
        }
        const saved = await journal.readGuard(old.operationId);
        if (saved === null) busy();
        const guard = parseRestoreGuard(saved);
        if (guard.operationId !== old.operationId || guard.currentSha256 !== old.currentSha256 || guard.incomingSha256 !== old.incomingSha256 ||
          (guard.phase !== "COMPLETED" && guard.phase !== "ROLLED_BACK")) busy();
      }
      if (await storage.loadGuard() !== null) busy();
      for (const slot of ["SAFETY", "PREVIOUS", "REJECTED", "ROLLBACK"] as const) if (await storage.sha256(slot) !== null) busy();
      const verifyPinned = async () => {
        if (await storage.sha256("LIVE") !== plan.currentSha256 || await storage.sha256("INCOMING") !== plan.incomingSha256) {
          throw new RestoreProtocolError("RESTORE_STALE_PREVIEW");
        }
      };
      await verifyPinned();
      await storage.validateDatabase("LIVE"); await storage.validateDatabase("INCOMING");
      await verifyPinned();
      await journal.publish(plan);
      const published = await journal.readPending();
      if (published === null) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
      const confirmed = parsePendingRuntimeRestore(published.value);
      if (confirmed.operationId !== plan.operationId || confirmed.currentSha256 !== plan.currentSha256 || confirmed.incomingSha256 !== plan.incomingSha256) {
        throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
      }
      return protocol.restore(plan);
    });
  } catch (error) {
    if (error instanceof RestoreProtocolError) throw error;
    throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
  }
}
