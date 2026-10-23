export class RestoreProtocolError extends Error {
  readonly code: "RESTORE_INVALID_PLAN" | "RESTORE_STALE_PREVIEW" | "RESTORE_FAILED" | "RESTORE_RECOVERY_REQUIRED" | "RESTORE_BUSY";
  constructor(code: RestoreProtocolError["code"]) { super(code); this.code = code; }
}
