import { GuardedRestore, parseRestoreGuard, type RestoreCompletionProtocol, type RestorePlan, type RestoreStorage } from "../../features/backup/public.ts";

/** v2 requires point finalization before reopening; v1 is the older technical rehearsal. */
export interface PendingRuntimeRestore extends RestorePlan { readonly version: 1 | 2 }
export function parsePendingRuntimeRestore(value: unknown): PendingRuntimeRestore {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RESTORE_JOURNAL_INVALID");
  const entry = value as Partial<PendingRuntimeRestore>;
  if ((entry.version !== 1 && entry.version !== 2) || typeof entry.operationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(entry.operationId) ||
    typeof entry.currentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.currentSha256) ||
    typeof entry.incomingSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.incomingSha256) ||
    Object.keys(entry).sort().join(",") !== "currentSha256,incomingSha256,operationId,version") throw new Error("RESTORE_JOURNAL_INVALID");
  // Capture confirmation before an async maintenance wait; callers may reuse their object.
  return { version: entry.version, operationId: entry.operationId, currentSha256: entry.currentSha256,
    incomingSha256: entry.incomingSha256 };
}
/** A routing journal is recorded only for a confirmed restore, before invoking the protocol.
 * Its files stay in the app's fixed private job directory. A missing guard means replacement
 * has not started: require the exact original live file, never silently create an empty DB.
 * Completed guards remain receipts, so later legitimate writes survive repeated cold starts. */
export async function recoverRuntimeRestore(readPending: () => Promise<{ readonly value: unknown } | null>,
  storageFor: (plan: PendingRuntimeRestore) => RestoreStorage, liveDatabasePresent: () => Promise<boolean>,
  completion?: RestoreCompletionProtocol, receipts?: Readonly<{ readGuard(operationId: string): Promise<unknown | null> }>): Promise<void> {
  const pending = await readPending();
  if (pending === null) return;
  const plan = parsePendingRuntimeRestore(pending.value);
  if (plan.version === 2 && !completion) throw new Error("RESTORE_COMPLETION_REQUIRED");
  if (receipts && await alreadySettled(plan, receipts, liveDatabasePresent, completion)) return;
  const storage = storageFor(plan);
  const load = storage.loadGuard.bind(storage);
  const checked: RestoreStorage = {
    withClosedDatabase: (task) => storage.withClosedDatabase(async () => {
      if (plan.version === 2) await completion!.assertPrepared(plan, "RECOVER");
      const outcome = await task();
      // This lease is used by recover(), whose result is a RestoreOutcome.
      if (plan.version === 2) {
        const result: unknown = outcome;
        if (result !== "COMMITTED" && result !== "ROLLED_BACK" && result !== "NO_OPERATION") throw new Error("RESTORE_COMPLETION_REQUIRED");
        await completion!.finish(plan, result);
      }
      return outcome;
    }),
    loadGuard: async () => {
      const guard = await load();
      if (guard === null) {
        if (await storage.sha256("LIVE") !== plan.currentSha256) throw new Error("RESTORE_JOURNAL_WITHOUT_ORIGINAL");
        for (const slot of ["PREVIOUS", "REJECTED", "ROLLBACK"] as const) {
          if (await storage.sha256(slot) !== null) throw new Error("RESTORE_JOURNAL_WITHOUT_GUARD");
        }
        await storage.validateDatabase("LIVE");
        if (await storage.sha256("LIVE") !== plan.currentSha256) throw new Error("RESTORE_JOURNAL_WITHOUT_ORIGINAL");
        // Retire a confirmed attempt that died before PREPARED. Without a receipt the
        // same journal would reject legitimate writes at the following cold start.
        const receipt = { ...plan, version: 1 as const, phase: "ROLLED_BACK" as const };
        await storage.saveGuard(receipt);
        return receipt;
      } else {
        if (!guard || typeof guard !== "object" || Array.isArray(guard)) throw new Error("RESTORE_JOURNAL_INVALID");
        const saved = guard as Partial<RestorePlan>;
        if (saved.operationId !== plan.operationId || saved.currentSha256 !== plan.currentSha256 || saved.incomingSha256 !== plan.incomingSha256) {
          throw new Error("RESTORE_JOURNAL_GUARD_MISMATCH");
        }
        const phase = (guard as { phase?: unknown }).phase;
        if ((phase === "COMPLETED" || phase === "ROLLED_BACK") && !await liveDatabasePresent()) {
          throw new Error("RESTORE_JOURNAL_LIVE_MISSING");
        }
      }
      return guard;
    },
    saveGuard: (guard) => storage.saveGuard(guard), sha256: (slot) => storage.sha256(slot),
    validateDatabase: (slot) => storage.validateDatabase(slot), copyExclusive: (from, to) => storage.copyExclusive(from, to),
    moveExclusive: (from, to) => storage.moveExclusive(from, to),
  };
  await new GuardedRestore(checked).recover();
}

/**
 * ARCH-HARDEN-1e. Журнал завершённого восстановления остаётся на диске, и раньше каждый холодный старт проходил с ним полный цикл
 * «закрытая база» (пауза команд, снятие сигналов таймеров), чтобы убедиться, что делать нечего. Здесь то же устанавливается чтением:
 * квитанция именно этой операции в окончательной фазе, файл базы на месте, точка возврата учтена. Только чтение квитанции и состояния;
 * любое несовпадение или ошибка — `false`, и запуск идёт прежним строгим путём, который и сообщает настоящую причину.
 */
async function alreadySettled(plan: PendingRuntimeRestore, receipts: Readonly<{ readGuard(operationId: string): Promise<unknown | null> }>,
  liveDatabasePresent: () => Promise<boolean>, completion?: RestoreCompletionProtocol): Promise<boolean> {
  try {
    const saved = await receipts.readGuard(plan.operationId);
    if (saved === null) return false;
    const guard = parseRestoreGuard(saved);
    if (guard.operationId !== plan.operationId || guard.currentSha256 !== plan.currentSha256 || guard.incomingSha256 !== plan.incomingSha256) return false;
    if (guard.phase !== "COMPLETED" && guard.phase !== "ROLLED_BACK") return false;
    if (!await liveDatabasePresent()) return false;
    if (plan.version === 1) return true;
    return await completion?.confirmSettled?.(plan, guard.phase === "COMPLETED" ? "COMMITTED" : "ROLLED_BACK") === true;
  } catch { return false; }
}
