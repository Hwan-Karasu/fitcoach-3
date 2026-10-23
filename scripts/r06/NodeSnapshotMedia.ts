import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, openSync, readSync, realpathSync, statSync, unlinkSync, writeSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SnapshotError } from "../../apps/mobile/src/features/backup/domain/SnapshotManifest.ts";
import { MEDIA_CHUNK_BYTES } from "../../apps/mobile/src/features/backup/data/SnapshotCatalog.ts";
import { imageMime } from "../../apps/mobile/src/features/backup/data/SnapshotPhotoRules.ts";
import type { SnapshotMediaExpected, SnapshotMediaPort, SnapshotMediaProgress, SnapshotMediaSettings } from "../../apps/mobile/src/features/backup/data/SnapshotMediaPort.ts";

export interface SnapshotMediaOptions {
  readonly mediaRoot?: string;
  readonly restoreId?: string;
  readonly onMediaProgress?: (progress: SnapshotMediaProgress) => void;
}
const invalid = (): never => { throw new SnapshotError("SNAPSHOT_INVALID"); };
const incomplete = (): never => { throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA"); };
function confined(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}
function rootPath(root: string): string {
  const canonical = realpathSync(root);
  if (!statSync(canonical).isDirectory()) incomplete();
  return canonical;
}
function verifyFile(file: string, expected: SnapshotMediaExpected): void {
  const fd = openSync(file, "r");
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size !== BigInt(expected.bytes)) invalid();
    const hash = createHash("sha256"); const buffer = Buffer.alloc(MEDIA_CHUNK_BYTES); let size = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      const bytes = buffer.subarray(0, read);
      if (size === 0 && imageMime(bytes) !== expected.mime) invalid();
      hash.update(bytes); size += read;
    }
    const after = fstatSync(fd, { bigint: true });
    if (size !== expected.bytes || hash.digest("hex") !== expected.sha256 ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) invalid();
  } finally { closeSync(fd); }
}
/** Filesystem driver only; SQL, layout/coverage and format digests live in mobile. */
export function nodeSnapshotMedia(root: string): SnapshotMediaPort {
  return {
    async openSource(uri) {
      try {
        const canonical = rootPath(root); const file = realpathSync(fileURLToPath(uri));
        if (!confined(canonical, file)) incomplete();
        const fd = openSync(file, "r");
        try {
          const before = fstatSync(fd, { bigint: true });
          if (!before.isFile() || before.size <= 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) incomplete();
          let offset = 0;
          return {
            size: Number(before.size),
            async read(maxBytes) {
              const buffer = Buffer.alloc(maxBytes); let received = 0;
              while (received < maxBytes) {
                const count = readSync(fd, buffer, received, maxBytes - received, offset + received);
                if (count === 0) break;
                received += count;
              }
              offset += received; return buffer.subarray(0, received);
            },
            async assertUnchanged() {
              const after = fstatSync(fd, { bigint: true });
              if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) incomplete();
            },
            close: () => closeSync(fd),
          };
        } catch (error) { closeSync(fd); throw error; }
      } catch { return incomplete(); }
    },
    async publishVerified(filename, expected, write) {
      if (!/^restore-[a-f0-9-]{36}-[a-f0-9]{64}\.(?:png|jpg|webp|heic)$/u.test(filename)) invalid();
      const canonical = rootPath(root); const target = join(canonical, filename);
      if (!confined(canonical, target)) invalid();
      if (existsSync(target)) {
        const file = realpathSync(target);
        if (!confined(canonical, file)) invalid();
        verifyFile(file, expected);
      } else {
        const partial = join(canonical, `${filename}.${randomUUID()}.partial`);
        const fd = openSync(partial, "wx", 0o600);
        try {
          await write(async (bytes) => {
            let written = 0;
            while (written < bytes.length) {
              const count = writeSync(fd, bytes, written, bytes.length - written);
              if (count === 0) throw new SnapshotError("SNAPSHOT_IO_FAILED");
              written += count;
            }
          });
          fsyncSync(fd);
        } finally { closeSync(fd); }
        verifyFile(partial, expected);
        linkSync(partial, target);
        try { unlinkSync(partial); } catch { /* Reclaim private duplicates later. */ }
      }
      return pathToFileURL(target).href;
    },
  };
}
export function nodeSnapshotMediaSettings(options: SnapshotMediaOptions): SnapshotMediaSettings {
  return { files: options.mediaRoot ? nodeSnapshotMedia(options.mediaRoot) : undefined,
    restoreId: options.restoreId ?? randomUUID(), onMediaProgress: options.onMediaProgress };
}
