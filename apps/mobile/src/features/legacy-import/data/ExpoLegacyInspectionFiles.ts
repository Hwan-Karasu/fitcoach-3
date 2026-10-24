import { Directory, File, FileMode, Paths } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import { expoFileSha256 } from "../../../shared/files/ExpoFileSha256.ts";
import { InspectionCopyError, inspectionOperationId, type LegacyInspectionReceipt } from "../domain/InspectionCopy.ts";
import type { InspectionFileState, LegacyInspectionReader } from "./LegacyInspectionCopy.ts";

/** Internal file driver. External source is only hashed/copied; SQLite receives
 * exclusively an operation-owned private path. No cleanup, cutover or UI here.
 */
export class ExpoLegacyInspectionFiles implements LegacyInspectionReader {
  private readonly root: Directory;
  private readonly source: File | null;
  private readonly reserved = new Set<string>();
  constructor(source: File | null = null) {
    if (Platform.OS !== "android" || source !== null && !/^(?:file|content):\/\//u.test(source.uri)) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    this.root = new Directory(Paths.document, "legacy-source-copies");
    this.source = source;
  }
  private directory(operationId: string): Directory {
    if (!inspectionOperationId(operationId)) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    return new Directory(this.root, operationId);
  }
  private file(operationId: string, name: "source.partial" | "source.sqlite" | "receipt.partial" | "receipt.json"): File {
    return new File(this.directory(operationId), name);
  }
  private sidecars(file: File): boolean {
    return ["-wal", "-shm", "-journal"].some((suffix) => new File(`${file.uri}${suffix}`).exists);
  }
  private ownedPartial(operationId: string): File {
    const file = this.file(operationId, "source.partial");
    if (!this.reserved.has(operationId) || !file.exists || this.sidecars(file)) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    return file;
  }
  async hashSource() {
    if (this.source === null) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    return expoFileSha256(this.source);
  }
  async reserve(operationId: string): Promise<void> {
    const directory = this.directory(operationId);
    if (directory.exists) throw new InspectionCopyError("SOURCE_COPY_EXISTS");
    this.root.create({ idempotent: true, intermediates: true });
    directory.create();
    this.file(operationId, "source.partial").create();
    this.reserved.add(operationId);
  }
  async copyToPartial(operationId: string): Promise<void> {
    const partial = this.ownedPartial(operationId);
    if (this.source === null || partial.size !== 0) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    // This exact zero-byte file was reserved by this driver; no other overwrite.
    await this.source.copy(partial, { overwrite: true });
  }
  private async inspect(file: File): Promise<InspectionFileState> {
    if (!file.exists || !Number.isSafeInteger(file.size) || file.size < 100) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    const reader = file.open(FileMode.ReadOnly);
    let header: Uint8Array;
    try { header = reader.readBytes(16); } finally { reader.close(); }
    return { header, digest: await expoFileSha256(file), hasSidecars: this.sidecars(file) };
  }
  inspectPartial(operationId: string) { return this.inspect(this.ownedPartial(operationId)); }
  async seal(operationId: string, receipt: LegacyInspectionReceipt): Promise<void> {
    const partial = this.ownedPartial(operationId), ready = this.file(operationId, "source.sqlite");
    const receiptPartial = this.file(operationId, "receipt.partial"), receiptReady = this.file(operationId, "receipt.json");
    if (ready.exists || receiptPartial.exists || receiptReady.exists) throw new InspectionCopyError("SOURCE_COPY_EXISTS");
    // The installed File.move can fall back to copy+delete. This Android file://
    // legacy path uses renameTo or fails; both destinations are in the same slot.
    await moveAsync({ from: partial.uri, to: ready.uri });
    receiptPartial.create(); receiptPartial.write(JSON.stringify(receipt));
    await moveAsync({ from: receiptPartial.uri, to: receiptReady.uri });
    this.reserved.delete(operationId);
  }
  async inspectReady(operationId: string) {
    const receiptFile = this.file(operationId, "receipt.json");
    if (!receiptFile.exists || receiptFile.size <= 0 || receiptFile.size > 4096) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    let receipt: unknown;
    try { receipt = JSON.parse(await receiptFile.text()) as unknown; } catch { throw new InspectionCopyError("SOURCE_COPY_INVALID"); }
    return { ...await this.inspect(this.file(operationId, "source.sqlite")), receipt };
  }
  async openReady(operationId: string) {
    const file = this.file(operationId, "source.sqlite");
    if (!file.exists || !this.file(operationId, "receipt.json").exists || this.sidecars(file)) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    return SQLite.openDatabaseAsync(file.name, { useNewConnection: true }, this.directory(operationId).uri);
  }
}
