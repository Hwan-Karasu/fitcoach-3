import { RestoreActionError, RestoreProtocolError, parseRestoreGuard, type RestoreActionErrorCode, type RestoreCompletionProtocol,
  type RestoreStorage } from "../../features/backup/public.ts";
import { parsePendingRuntimeRestore } from "../bootstrap/recoverRuntimeRestore.ts";
import { restoreWithRuntimeJournal, type RuntimeRestoreJournal } from "./JournaledRestore.ts";

export interface PreparedRestoreIdentity {
  readonly id: string;
  /** Непрозрачный пин логического состояния текущих данных на момент предпросмотра (BKP-AUDIT-1 C2: счётчик записей вместо
   * повторного полного хеша; тесты протокола могут подставлять канонический хеш). Сравнивается только на равенство. */
  readonly currentPin: string;
  readonly incomingSha256: string;
}
interface Options {
  readonly storage: RestoreStorage;
  readonly journal: RuntimeRestoreJournal;
  readonly completion: RestoreCompletionProtocol;
  /** Read the same kind of pin only after all runtime handles are closed. */
  readonly currentPin: () => Promise<string>;
  readonly checkSpace: () => Promise<void>;
  /** The same cold protocol, with a delegated already-closed lease for every job. */
  readonly recoverPublished: () => Promise<void>;
}
type Result = { readonly kind: "REJECTED"; readonly code: RestoreActionErrorCode }
  | { readonly kind: "DONE"; readonly outcome: "COMMITTED" | "ROLLED_BACK" };
const rejected = (code: RestoreActionErrorCode): Result => ({ kind: "REJECTED", code });
function required(): never { throw new RestoreActionError("RESTORE_RECOVERY_REQUIRED"); }

/** Logical confirmation survives a harmless WAL checkpoint, but never an intervening
 * business write. Expected preflight rejection returns THROUGH maintenance so it reopens
 * the untouched healthy DB; uncertain file/protocol failures keep runtime closed. */
export async function applyPreparedRestore(input: PreparedRestoreIdentity, options: Options): Promise<"COMMITTED" | "ROLLED_BACK"> {
  const job = { ...input };
  if (typeof job.currentPin !== "string" || job.currentPin.length === 0 || job.currentPin.length > 128) throw new RestoreActionError("RESTORE_STALE_PREVIEW");
  parsePendingRuntimeRestore({ version: 2, operationId: job.id, currentSha256: "0".repeat(64), incomingSha256: job.incomingSha256 });
  const { storage } = options; let result: Result;
  try {
    result = await storage.withClosedDatabase(async (): Promise<Result> => {
      await storage.validateDatabase("LIVE"); // Unhealthy/missing LIVE must never be reopened as a normal rejection.
      try { await storage.validateDatabase("INCOMING"); }
      catch { return rejected("RESTORE_INVALID_BACKUP"); }
      if (await options.currentPin() !== job.currentPin) return rejected("RESTORE_STALE_PREVIEW");
      if (await storage.sha256("INCOMING") !== job.incomingSha256) return rejected("RESTORE_INVALID_BACKUP");
      try { await options.checkSpace(); }
      catch (error) { return rejected(error instanceof RestoreActionError ? error.code : "RESTORE_SOURCE_UNAVAILABLE"); }
      const currentSha256 = await storage.sha256("LIVE"); if (currentSha256 === null) required();
      const plan = { version: 2 as const, operationId: job.id, currentSha256, incomingSha256: job.incomingSha256 };
      const locked: RestoreStorage = {
        withClosedDatabase: async (task) => task(), loadGuard: () => storage.loadGuard(), saveGuard: (guard) => storage.saveGuard(guard),
        sha256: (slot) => storage.sha256(slot), validateDatabase: (slot) => storage.validateDatabase(slot),
        copyExclusive: (from, to) => storage.copyExclusive(from, to), moveExclusive: (from, to) => storage.moveExclusive(from, to),
      };
      try {
        const outcome = await restoreWithRuntimeJournal(plan, locked, options.journal, options.completion);
        if (outcome === "NO_OPERATION") required();
        return { kind: "DONE", outcome };
      } catch (error) {
        // Never report a failed operation as a healthy ordinary screen until the real
        // routing record, guard and point state agree. Transient completion IO can finish.
        await options.recoverPublished();
        const saved = await storage.loadGuard();
        if (saved !== null) {
          const guard = parseRestoreGuard(saved);
          if (guard.operationId !== plan.operationId || guard.currentSha256 !== plan.currentSha256 || guard.incomingSha256 !== plan.incomingSha256) required();
          if (guard.phase === "COMPLETED") return { kind: "DONE", outcome: "COMMITTED" };
          if (guard.phase === "ROLLED_BACK") return { kind: "DONE", outcome: "ROLLED_BACK" };
          required();
        }
        await storage.validateDatabase("LIVE");
        if (await storage.sha256("LIVE") !== currentSha256) required();
        return rejected(error instanceof RestoreProtocolError && error.code === "RESTORE_STALE_PREVIEW" ? "RESTORE_STALE_PREVIEW" : "RESTORE_FAILED");
      }
    });
  } catch { return required(); }
  if (result.kind === "REJECTED") throw new RestoreActionError(result.code);
  return result.outcome;
}
