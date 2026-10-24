export interface LegacyInspectionReceipt {
  readonly kind: "athlete-diary-source-copy";
  readonly version: 1;
  readonly operationId: string;
  readonly sha256: string;
  readonly bytes: number;
}
export type InspectionCopyErrorCode = "SOURCE_COPY_INVALID" | "SOURCE_COPY_CHANGED" | "SOURCE_COPY_EXISTS" | "SOURCE_COPY_IO_FAILED";
export class InspectionCopyError extends Error {
  readonly code: InspectionCopyErrorCode;
  constructor(code: InspectionCopyErrorCode) { super(code); this.code = code; }
}
export const inspectionOperationId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
export function parseInspectionReceipt(value: unknown): LegacyInspectionReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InspectionCopyError("SOURCE_COPY_INVALID");
  const row = value as Partial<LegacyInspectionReceipt>;
  if (row.kind !== "athlete-diary-source-copy" || row.version !== 1 || !inspectionOperationId(row.operationId)
    || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes! < 100
    || Object.keys(row).sort().join(",") !== "bytes,kind,operationId,sha256,version") throw new InspectionCopyError("SOURCE_COPY_INVALID");
  return Object.freeze({ kind: row.kind, version: row.version, operationId: row.operationId, sha256: row.sha256, bytes: row.bytes! });
}
