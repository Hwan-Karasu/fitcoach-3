import { Directory, File, FileMode, Paths } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import { uuid } from "expo-modules-core";
import { Platform } from "react-native";
import { expoFileSha256 } from "../../../shared/files/ExpoFileSha256.ts";
import { SnapshotError } from "../domain/SnapshotManifest.ts";
import { imageMime } from "./SnapshotPhotoRules.ts";
import type { SnapshotMediaExpected, SnapshotMediaPort } from "./SnapshotMediaPort.ts";

/** Only app-created persistent paths. SAF is handled separately by copying into private staging. */
export function assertSnapshotPrivateUri(uri: string): void {
  const root = Paths.document.uri.replace(/\/$/u, "");
  const decoded = decodeURIComponent(uri);
  if (Platform.OS !== "android" || !uri.startsWith(`${root}/`) || /(?:^|\/)\.\.?(?:\/|$)/u.test(decoded) || /[?#\\]/u.test(decoded)) {
    throw new SnapshotError("SNAPSHOT_INVALID");
  }
}
async function verifyFile(file: File, expected: SnapshotMediaExpected): Promise<void> {
  if (!file.exists || file.size !== expected.bytes) throw new SnapshotError("SNAPSHOT_INVALID");
  const modified = file.lastModified;
  const reader = file.open(FileMode.ReadOnly);
  try { if (imageMime(reader.readBytes(12)) !== expected.mime) throw new SnapshotError("SNAPSHOT_INVALID"); }
  finally { reader.close(); }
  const digest = await expoFileSha256(file);
  if (digest.sha256 !== expected.sha256 || digest.bytes !== expected.bytes || file.lastModified !== modified) throw new SnapshotError("SNAPSHOT_INVALID");
}
/** Serialized app-private operation, immutable generated filenames. No imported path is used
 * as a destination, no old image is deleted. Close + readback precede rename publication.
 * Expo exposes no directory fsync: process death proof is distinct from power loss durability. */
export function expoSnapshotMedia(root: Directory): SnapshotMediaPort {
  assertSnapshotPrivateUri(root.uri);
  const prefix = `${root.uri.replace(/\/$/u, "")}/`;
  return {
    async openSource(uri) {
      try {
        assertSnapshotPrivateUri(uri);
        const suffix = decodeURIComponent(uri.slice(prefix.length));
        if (!uri.startsWith(prefix) || !suffix || /[/\\]/u.test(suffix)) throw new Error();
        const file = new File(uri); const modified = file.lastModified;
        if (!file.exists || file.size <= 0 || !Number.isSafeInteger(file.size)) throw new Error();
        const handle = file.open(FileMode.ReadOnly);
        const size = handle.size;
        if (size === null || size !== file.size) { handle.close(); throw new Error(); }
        return {
          size,
          read: async (bytes) => handle.readBytes(bytes),
          async assertUnchanged() {
            if (!file.exists || handle.size !== size || file.size !== size || file.lastModified !== modified) throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA");
          },
          close: () => handle.close(),
        };
      } catch { throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA"); }
    },
    async publishVerified(filename, expected, write) {
      if (!/^restore-[a-f0-9-]{36}-[a-f0-9]{64}\.(?:png|jpg|webp|heic)$/u.test(filename)) throw new SnapshotError("SNAPSHOT_INVALID");
      root.create({ idempotent: true, intermediates: true });
      const target = new File(root, filename);
      if (target.exists) await verifyFile(target, expected);
      else {
        const partial = new File(root, `${filename}.${uuid.v4()}.partial`);
        partial.create(); const handle = partial.open(FileMode.WriteOnly);
        try { await write(async (bytes) => { handle.writeBytes(bytes); }); }
        finally { handle.close(); }
        await verifyFile(partial, expected);
        if (target.exists) throw new SnapshotError("SNAPSHOT_DESTINATION_EXISTS");
        await moveAsync({ from: partial.uri, to: target.uri });
        await verifyFile(target, expected);
      }
      return target.uri;
    },
  };
}
