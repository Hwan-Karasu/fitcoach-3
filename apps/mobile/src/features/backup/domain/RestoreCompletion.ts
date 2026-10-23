import { RestoreProtocolError } from "./RestoreProtocolError.ts";
import type { RestoreOutcome, RestorePlan } from "./RestoreStorage.ts";

export interface ReturnPoint {
  readonly operationId: string;
  readonly backupId: string;
  readonly createdAt: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentSha256: string;
}
/** One atomic record both activates/consumes the point and retires finalization. Keeping
 * settledOperationId after explicit deletion prevents cold boot from resurrecting it. */
export interface ReturnPointState {
  readonly version: 1;
  readonly settledOperationId: string | null;
  readonly point: ReturnPoint | null;
}
export interface RestoreCompletionIntent extends RestorePlan {
  readonly version: 1;
  readonly kind: "RESTORE" | "RETURN";
  readonly previous: ReturnPointState;
  readonly candidate: ReturnPoint | null;
}
export interface RestoreCompletionProtocol {
  prepare(plan: RestorePlan): Promise<void>;
  assertPrepared(plan: RestorePlan, mode: "APPLY" | "RECOVER"): Promise<void>;
  finish(plan: RestorePlan, outcome: RestoreOutcome): Promise<void>;
}
/** Fixed private paths derived from validated UUIDs, never paths supplied by a snapshot.
 * Callers serialize state changes under the same maintenance lease as the file protocol. */
export interface ReturnPointStore {
  readState(): Promise<unknown | null>;
  writeState(state: ReturnPointState): Promise<void>;
  readIntent(operationId: string): Promise<unknown | null>;
  writeIntent(intent: RestoreCompletionIntent): Promise<void>;
  verifyPoint(point: ReturnPoint): Promise<void>;
  removePoint(point: ReturnPoint): Promise<void>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const digest = /^[a-f0-9]{64}$/u;
function invalid(): never { throw new RestoreProtocolError("RESTORE_RECOVERY_REQUIRED"); }
function record(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys) invalid();
  return value as Record<string, unknown>;
}
export function completionPlan(value: RestorePlan): RestorePlan {
  if (!uuid.test(value.operationId) || !digest.test(value.currentSha256) || !digest.test(value.incomingSha256)) invalid();
  return { operationId: value.operationId, currentSha256: value.currentSha256, incomingSha256: value.incomingSha256 };
}
export function parseReturnPoint(value: unknown): ReturnPoint {
  const p = record(value, "backupId,bytes,contentSha256,createdAt,operationId,sha256");
  if (typeof p.operationId !== "string" || !uuid.test(p.operationId) || typeof p.backupId !== "string" || !uuid.test(p.backupId) ||
    typeof p.sha256 !== "string" || !digest.test(p.sha256) || typeof p.contentSha256 !== "string" || !digest.test(p.contentSha256) ||
    typeof p.bytes !== "number" || !Number.isSafeInteger(p.bytes) || p.bytes < 100 || typeof p.createdAt !== "string") invalid();
  try { if (new Date(p.createdAt).toISOString() !== p.createdAt) invalid(); } catch { invalid(); }
  return { operationId: p.operationId, backupId: p.backupId, createdAt: p.createdAt, sha256: p.sha256, bytes: p.bytes, contentSha256: p.contentSha256 };
}
export function parseReturnPointState(value: unknown): ReturnPointState {
  const s = record(value, "point,settledOperationId,version");
  if (s.version !== 1 || (s.settledOperationId !== null && (typeof s.settledOperationId !== "string" || !uuid.test(s.settledOperationId)))) invalid();
  const point = s.point === null ? null : parseReturnPoint(s.point);
  if (point !== null && s.settledOperationId === null) invalid();
  return { version: 1, settledOperationId: s.settledOperationId, point };
}
export const emptyReturnPointState = (): ReturnPointState => ({ version: 1, settledOperationId: null, point: null });
export function parseRestoreCompletionIntent(value: unknown): RestoreCompletionIntent {
  const i = record(value, "candidate,currentSha256,incomingSha256,kind,operationId,previous,version");
  if (i.version !== 1 || (i.kind !== "RESTORE" && i.kind !== "RETURN") ||
    typeof i.operationId !== "string" || typeof i.currentSha256 !== "string" || typeof i.incomingSha256 !== "string") invalid();
  const plan = completionPlan({ operationId: i.operationId, currentSha256: i.currentSha256, incomingSha256: i.incomingSha256 });
  const previous = parseReturnPointState(i.previous); const candidate = i.candidate === null ? null : parseReturnPoint(i.candidate);
  if (previous.settledOperationId === plan.operationId || previous.point?.operationId === plan.operationId ||
    (i.kind === "RESTORE" ? candidate === null || candidate.operationId !== plan.operationId : candidate !== null || previous.point === null)) invalid();
  return { version: 1, ...plan, kind: i.kind, previous, candidate };
}
