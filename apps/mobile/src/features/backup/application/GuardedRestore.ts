/** R06 protocol candidate. Not connected to the live database until native gates pass. */
export type RestoreSlot = "LIVE" | "INCOMING" | "SAFETY" | "PREVIOUS" | "REJECTED" | "ROLLBACK";
export type RestorePhase = "PREPARED" | "COMMITTED" | "COMPLETED" | "ROLLED_BACK";
export interface RestorePlan {
  readonly operationId: string;
  readonly incomingSha256: string;
  readonly currentSha256: string;
}
export interface RestoreGuard extends RestorePlan {
  readonly version: 1;
  readonly phase: RestorePhase;
}

/** All paths are private, fixed slots, never paths taken from a backup/guard.
 * Calls must be under withClosedDatabase: drain writers AND readers, close all SQLite handles,
 * pause notifications and prevent repository acquisition until the callback finishes.
 * copy/move never overwrite; move is atomic within one filesystem. A fulfilled saveGuard must
 * survive process death as either the previous or new complete guard, never truncated JSON.
 * SAFETY is an independent, closed SQLite copy; it is never moved or deleted by this protocol.
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
export type RestoreOutcome = "COMMITTED" | "ROLLED_BACK" | "NO_OPERATION";
export class RestoreProtocolError extends Error {
  readonly code: "RESTORE_INVALID_PLAN" | "RESTORE_STALE_PREVIEW" | "RESTORE_FAILED" | "RESTORE_RECOVERY_REQUIRED" | "RESTORE_BUSY";
  constructor(code: RestoreProtocolError["code"]) { super(code); this.code = code; }
}
const digestPattern = /^[a-f0-9]{64}$/u;
function validPlan(value: unknown): value is RestorePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<RestorePlan>;
  return typeof plan.operationId === "string" && /^[a-zA-Z0-9_-]{1,80}$/u.test(plan.operationId) &&
    typeof plan.currentSha256 === "string" && digestPattern.test(plan.currentSha256) &&
    typeof plan.incomingSha256 === "string" && digestPattern.test(plan.incomingSha256);
}
function parseGuard(value: unknown): RestoreGuard {
  const guard = value as Partial<RestoreGuard> | null;
  if (!validPlan(value) || guard?.version !== 1 ||
    !["PREPARED", "COMMITTED", "COMPLETED", "ROLLED_BACK"].includes(guard.phase ?? "") ||
    Object.keys(value).sort().join(",") !== "currentSha256,incomingSha256,operationId,phase,version") {
    throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
  }
  return value as RestoreGuard;
}

/** Startup must call recover before repositories/UI/scheduler start. This class never opens
 * a writable runtime handle; the normal boot performs its own schema gate afterwards.
 * Completed guards are receipts: later legitimate writes must not be mistaken for corruption.
 */
export class GuardedRestore {
  private readonly storage: RestoreStorage;
  constructor(storage: RestoreStorage) { this.storage = storage; }

  async restore(input: RestorePlan): Promise<RestoreOutcome> {
    if (!validPlan(input)) throw new RestoreProtocolError("RESTORE_INVALID_PLAN");
    const plan: RestorePlan = { operationId: input.operationId, currentSha256: input.currentSha256,
      incomingSha256: input.incomingSha256 };
    return this.closed(async () => {
      const saved = await this.storage.loadGuard();
      if (saved !== null) {
        const guard = parseGuard(saved);
        if (guard.operationId !== plan.operationId || guard.currentSha256 !== plan.currentSha256 ||
          guard.incomingSha256 !== plan.incomingSha256) throw new RestoreProtocolError("RESTORE_BUSY");
        return this.recoverLocked(guard);
      }
      // Preview pins BOTH files. No replacement on a stale preview or changed source.
      if (await this.storage.sha256("LIVE") !== plan.currentSha256 ||
        await this.storage.sha256("INCOMING") !== plan.incomingSha256) {
        throw new RestoreProtocolError("RESTORE_STALE_PREVIEW");
      }
      // A reused operation directory cannot clobber a previous safety/failed copy.
      for (const slot of ["SAFETY", "PREVIOUS", "REJECTED", "ROLLBACK"] as const) {
        if (await this.storage.sha256(slot) !== null) throw new RestoreProtocolError("RESTORE_BUSY");
      }
      try {
        await this.verified("LIVE", plan.currentSha256);
        await this.verified("INCOMING", plan.incomingSha256);
        await this.storage.copyExclusive("LIVE", "SAFETY");
        await this.verified("SAFETY", plan.currentSha256);
        const guard: RestoreGuard = { ...plan, version: 1, phase: "PREPARED" };
        await this.storage.saveGuard(guard);
        await this.storage.moveExclusive("LIVE", "PREVIOUS");
        await this.storage.moveExclusive("INCOMING", "LIVE");
        await this.verified("LIVE", plan.incomingSha256);
        // The durable commit decision precedes success. Until then startup rolls back.
        await this.storage.saveGuard({ ...guard, phase: "COMMITTED" });
        return await this.recoverLocked({ ...guard, phase: "COMMITTED" });
      } catch {
        try {
          const guard = await this.storage.loadGuard();
          if (guard !== null && await this.recoverLocked(parseGuard(guard)) === "COMMITTED") return "COMMITTED";
        } catch { throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED"); }
        throw new RestoreProtocolError("RESTORE_FAILED");
      }
    });
  }

  async recover(): Promise<RestoreOutcome> {
    return this.closed(async () => {
      try {
        const saved = await this.storage.loadGuard();
        return saved === null ? "NO_OPERATION" : await this.recoverLocked(parseGuard(saved));
      } catch { throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED"); }
    });
  }

  private async closed<T>(task: () => Promise<T>): Promise<T> {
    try { return await this.storage.withClosedDatabase(task); }
    catch (error) {
      if (error instanceof RestoreProtocolError) throw error;
      throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    }
  }

  private async verified(slot: RestoreSlot, digest: string): Promise<void> {
    if (await this.storage.sha256(slot) !== digest) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
    await this.storage.validateDatabase(slot);
    if (await this.storage.sha256(slot) !== digest) throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED");
  }

  private async recoverLocked(guard: RestoreGuard): Promise<RestoreOutcome> {
    if (guard.phase === "COMPLETED") return "COMMITTED";
    if (guard.phase === "ROLLED_BACK") return "ROLLED_BACK";
    if (guard.phase === "COMMITTED") {
      await this.verified("LIVE", guard.incomingSha256);
      await this.storage.saveGuard({ ...guard, phase: "COMPLETED" });
      return "COMMITTED";
    }
    if (await this.storage.sha256("LIVE") !== guard.currentSha256) {
      let source: RestoreSlot;
      if (await this.storage.sha256("PREVIOUS") === guard.currentSha256) {
        source = "PREVIOUS";
      } else {
        // Previous may be unavailable; keep SAFETY intact and prepare another verified copy.
        await this.verified("SAFETY", guard.currentSha256);
        const rollback = await this.storage.sha256("ROLLBACK");
        if (rollback === null) await this.storage.copyExclusive("SAFETY", "ROLLBACK");
        source = "ROLLBACK";
      }
      await this.verified(source, guard.currentSha256);
      if (await this.storage.sha256("LIVE") !== null) await this.storage.moveExclusive("LIVE", "REJECTED");
      await this.storage.moveExclusive(source, "LIVE");
    }
    await this.verified("LIVE", guard.currentSha256);
    await this.storage.saveGuard({ ...guard, phase: "ROLLED_BACK" });
    return "ROLLED_BACK";
  }
}
