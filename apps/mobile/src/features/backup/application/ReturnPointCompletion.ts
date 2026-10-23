import { RestoreProtocolError, type RestoreOutcome } from "./GuardedRestore.ts";
import type { RestorePlan } from "../domain/RestoreStorage.ts";
import { completionPlan, emptyReturnPointState, parseRestoreCompletionIntent, parseReturnPoint, parseReturnPointState,
  type RestoreCompletionIntent, type RestoreCompletionProtocol, type ReturnPoint, type ReturnPointState, type ReturnPointStore } from "../domain/RestoreCompletion.ts";

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function required(): never { throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED"); }
type Preparation = {
  readonly kind: "RESTORE";
  /** Must seal the full CURRENT state, including media, before returning metadata. */
  readonly createPoint: (plan: RestorePlan) => Promise<ReturnPoint>;
} | { readonly kind: "RETURN"; readonly expectedPointOperationId: string };
/** Physical database replacement and point publication form one recoverable operation.
 * COMMITTED is never exposed to normal UI until finish publishes this atomic state. */
export class ReturnPointCompletion implements RestoreCompletionProtocol {
  private readonly store: ReturnPointStore;
  private readonly preparation: Preparation | undefined;
  constructor(store: ReturnPointStore, preparation?: Preparation) { this.store = store; this.preparation = preparation; }
  private async state(): Promise<ReturnPointState> {
    const value = await this.store.readState(); return value === null ? emptyReturnPointState() : parseReturnPointState(value);
  }
  private async intent(plan: RestorePlan): Promise<RestoreCompletionIntent> {
    const intent = parseRestoreCompletionIntent(await this.store.readIntent(plan.operationId));
    if (intent.operationId !== plan.operationId || intent.currentSha256 !== plan.currentSha256 || intent.incomingSha256 !== plan.incomingSha256) required();
    return intent;
  }
  async prepare(input: RestorePlan): Promise<void> {
    const plan = completionPlan(input); const preparation = this.preparation;
    if (!preparation || await this.store.readIntent(plan.operationId) !== null) required();
    const previous = await this.state(); let candidate: ReturnPoint | null = null;
    if (preparation.kind === "RESTORE") {
      candidate = parseReturnPoint(await preparation.createPoint(plan));
      await this.store.verifyPoint(candidate);
    } else {
      if (previous.point === null || previous.point.operationId !== preparation.expectedPointOperationId) throw new RestoreProtocolError("RESTORE_STALE_PREVIEW");
      await this.store.verifyPoint(previous.point);
    }
    const intent = parseRestoreCompletionIntent({ version: 1, ...plan, kind: preparation.kind, previous, candidate });
    if (!equal(await this.state(), previous)) throw new RestoreProtocolError("RESTORE_STALE_PREVIEW");
    await this.store.writeIntent(intent);
    if (!equal(await this.intent(plan), intent)) required();
  }
  async assertPrepared(input: RestorePlan, mode: "APPLY" | "RECOVER"): Promise<void> {
    const plan = completionPlan(input); const intent = await this.intent(plan); const state = await this.state();
    if (state.settledOperationId === plan.operationId) return;
    if (!equal(state, intent.previous)) required();
    // A pre-commit cold rollback does not need the new candidate's media to survive.
    // Successful finalization still verifies the candidate before activating it.
    if (mode === "APPLY") await this.store.verifyPoint((intent.kind === "RESTORE" ? intent.candidate : intent.previous.point)!);
  }
  async finish(input: RestorePlan, outcome: RestoreOutcome): Promise<void> {
    const plan = completionPlan(input); const intent = await this.intent(plan); let state = await this.state();
    if (outcome === "NO_OPERATION") required();
    if (state.settledOperationId === plan.operationId) {
      const expected = outcome === "COMMITTED" ? intent.candidate : intent.previous.point;
      if (state.point !== null && !equal(state.point, expected)) required();
    } else {
      if (!equal(state, intent.previous)) required();
      const point = outcome === "COMMITTED" ? intent.candidate : intent.previous.point;
      if (outcome === "COMMITTED" && point !== null) await this.store.verifyPoint(point);
      state = { version: 1, settledOperationId: plan.operationId, point };
      await this.store.writeState(state);
      if (!equal(await this.state(), state)) required();
    }
    // Once state is durable, cleanup failure cannot reactivate an old/consumed point.
    for (const point of [intent.previous.point, intent.candidate]) {
      if (point !== null && point.operationId !== state.point?.operationId) {
        try { await this.store.removePoint(point); } catch { /* Retryable private orphan. */ }
      }
    }
  }
  /** Called only after explicit confirmation, under the same exclusive maintenance lease. */
  async deletePoint(expectedOperationId: string): Promise<void> {
    const state = await this.state();
    if (state.point === null || state.point.operationId !== expectedOperationId) throw new RestoreProtocolError("RESTORE_STALE_PREVIEW");
    const next = { ...state, point: null };
    await this.store.writeState(next);
    if (!equal(await this.state(), next)) required();
    try { await this.store.removePoint(state.point); } catch { /* Availability is already durably retired. */ }
  }
}
