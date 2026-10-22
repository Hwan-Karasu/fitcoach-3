import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const HASH_READ_BYTES = 256 * 1024;
export interface LocalByteReader {
  readonly size: number | null;
  readBytes(length: number): Uint8Array;
  close(): void;
}
export interface LocalByteFile { openReader(): LocalByteReader }
export class LocalFileHashError extends Error {
  readonly code = "LOCAL_FILE_HASH_FAILED";
  constructor() { super("LOCAL_FILE_HASH_FAILED"); }
}

/** Hash an immutable, closed/private file in bounded chunks. No database-sized JS buffer.
 * Yield periodically so large backups do not monopolize the JS thread.
 */
export async function localFileSha256(file: LocalByteFile,
  yieldTask: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0))): Promise<{ readonly sha256: string; readonly bytes: number }> {
  let reader: LocalByteReader | null = null;
  const hash = sha256.create();
  try {
    reader = file.openReader();
    const size = reader.size;
    if (size === null || !Number.isSafeInteger(size) || size < 0) throw new LocalFileHashError();
    let bytes = 0; let sinceYield = 0;
    while (bytes < size) {
      const expected = Math.min(HASH_READ_BYTES, size - bytes);
      const chunk = reader.readBytes(expected);
      if (!(chunk instanceof Uint8Array) || chunk.length === 0 || chunk.length > expected) throw new LocalFileHashError();
      hash.update(chunk); bytes += chunk.length; sinceYield += chunk.length;
      if (sinceYield >= 4 * 1024 * 1024) { await yieldTask(); sinceYield = 0; }
    }
    if (reader.size !== size || reader.readBytes(1).length !== 0) throw new LocalFileHashError();
    reader.close(); reader = null;
    return { sha256: bytesToHex(hash.digest()), bytes };
  } catch { throw new LocalFileHashError(); }
  finally {
    hash.destroy();
    try { reader?.close(); } catch { /* Preserve content-free error from the operation. */ }
  }
}
