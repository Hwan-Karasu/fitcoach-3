import { InspectionCopyError, inspectionOperationId, parseInspectionReceipt, type LegacyInspectionReceipt } from "../domain/InspectionCopy.ts";
import { readAdmittedLegacyDomainSnapshots, type NativeLegacySourceDatabase } from "./LegacySqliteSource.ts";

export interface InspectionDigest { readonly sha256: string; readonly bytes: number }
export interface InspectionFileState { readonly digest: InspectionDigest; readonly header: Uint8Array; readonly hasSidecars: boolean }
/** Bound to one external source; all destination paths are implementation-owned.
 * Reserve must fail on existing slots, copy may overwrite only its own reserved
 * zero-byte partial, seal publishes the private file before an atomic receipt.
 */
export interface LegacyInspectionFiles {
  hashSource(): Promise<InspectionDigest>;
  reserve(operationId: string): Promise<void>;
  copyToPartial(operationId: string): Promise<void>;
  inspectPartial(operationId: string): Promise<InspectionFileState>;
  seal(operationId: string, receipt: LegacyInspectionReceipt): Promise<void>;
  inspectReady(operationId: string): Promise<InspectionFileState & { readonly receipt: unknown }>;
}
export interface LegacyInspectionReader extends LegacyInspectionFiles {
  /** Only the private sealed copy; never the external source. */
  openReady(operationId: string): Promise<NativeLegacySourceDatabase>;
}
/** Reading or resuming a sealed copy never needs access to the external source. */
export type LegacyInspectionReadyReader = Pick<LegacyInspectionReader, "inspectReady" | "openReady">;
function fail(code: "SOURCE_COPY_INVALID" | "SOURCE_COPY_CHANGED"): never { throw new InspectionCopyError(code); }
function validDigest(value: InspectionDigest): boolean { return typeof value.sha256 === "string" && /^[0-9a-f]{64}$/u.test(value.sha256) && Number.isSafeInteger(value.bytes) && value.bytes >= 100; }
function equalDigest(a: InspectionDigest, b: InspectionDigest): boolean { return a.bytes === b.bytes && a.sha256 === b.sha256; }
function verifyFile(state: InspectionFileState, expected: InspectionDigest): void {
  if (!validDigest(state.digest) || state.hasSidecars !== false || !(state.header instanceof Uint8Array)
    || ![83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0].every((byte, index) => state.header[index] === byte)) fail("SOURCE_COPY_INVALID");
  if (!equalDigest(state.digest, expected)) fail("SOURCE_COPY_CHANGED");
}
async function io<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof InspectionCopyError) throw error;
    throw new InspectionCopyError("SOURCE_COPY_IO_FAILED");
  }
}
export async function verifyLegacyInspectionCopy(files: Pick<LegacyInspectionFiles, "inspectReady">, expected: LegacyInspectionReceipt): Promise<void> {
  const receipt = parseInspectionReceipt(expected);
  const state = await io(() => files.inspectReady(receipt.operationId));
  const actual = parseInspectionReceipt(state.receipt);
  if (JSON.stringify(actual) !== JSON.stringify(receipt)) fail("SOURCE_COPY_CHANGED");
  verifyFile(state, receipt);
}

/** Byte-copy preparation only: a matching hash/header is not v2 format admission. */
export async function prepareLegacyInspectionCopy(files: LegacyInspectionFiles, operationId: string): Promise<LegacyInspectionReceipt> {
  if (!inspectionOperationId(operationId)) fail("SOURCE_COPY_INVALID");
  const before = await io(() => files.hashSource());
  if (!validDigest(before)) fail("SOURCE_COPY_INVALID");
  await io(() => files.reserve(operationId));
  await io(() => files.copyToPartial(operationId));
  const after = await io(() => files.hashSource());
  if (!validDigest(after) || !equalDigest(before, after)) fail("SOURCE_COPY_CHANGED");
  verifyFile(await io(() => files.inspectPartial(operationId)), before);
  const receipt = parseInspectionReceipt({ kind: "athlete-diary-source-copy", version: 1, operationId, ...before });
  await io(() => files.seal(operationId, receipt));
  await verifyLegacyInspectionCopy(files, receipt);
  return receipt;
}

/** Format/owner admission and collectors share one snapshot. Mapping/parity and
 * cutover gates remain separate. Recheck the closed file before returning data.
 */
export async function readLegacyInspectionCopy(files: LegacyInspectionReadyReader, expected: LegacyInspectionReceipt) {
  const receipt = parseInspectionReceipt(expected);
  await verifyLegacyInspectionCopy(files, receipt);
  const result = await readAdmittedLegacyDomainSnapshots(() => files.openReady(receipt.operationId), receipt.bytes);
  await verifyLegacyInspectionCopy(files, receipt);
  return { receipt, ...result };
}
