export interface CandidateIdentityContext {
  readonly sourceSha256: string;
  readonly accountScope: string;
  /** null only when the admitted source contains no observed client workspace. */
  readonly sourceWorkspaceId: string | null;
  readonly targetWorkspaceId: string;
}
export const LEGACY_STAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const workspace = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/u;
export const isLegacyTargetWorkspaceId = (value: unknown): value is string => typeof value === "string" && workspace.test(value);
export function legacyIdentityContextJson(context: CandidateIdentityContext): string {
  if (!/^[0-9a-f]{64}$/u.test(context.sourceSha256) || !context.accountScope.trim()
    || context.sourceWorkspaceId !== null && (typeof context.sourceWorkspaceId !== "string" || !context.sourceWorkspaceId.trim())
    || !isLegacyTargetWorkspaceId(context.targetWorkspaceId)) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  return JSON.stringify([2, context.sourceSha256, context.accountScope, context.sourceWorkspaceId, context.targetWorkspaceId]);
}
export function validateLegacyClientKey(key: string, scope: string): void {
  let parts: unknown;
  try { parts = JSON.parse(key) as unknown; } catch { throw new Error("R04_ID_LEDGER_SOURCE_KEY_INVALID"); }
  if (!Array.isArray(parts) || parts.length !== 2 || parts[0] !== scope || typeof parts[1] !== "string"
    || !parts[1].trim() || JSON.stringify(parts) !== key) throw new Error("R04_ID_LEDGER_SOURCE_KEY_INVALID");
}
export interface LegacyIdentityStageBinding {
  readonly context: CandidateIdentityContext;
  readonly contextJson: string;
  readonly expectedObjects: Readonly<Record<string, string>>;
  readonly createdAt: string | undefined;
}
