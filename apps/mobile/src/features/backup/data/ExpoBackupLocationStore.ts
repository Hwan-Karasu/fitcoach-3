import { Directory, File, Paths } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import { uuid } from "expo-modules-core";
import type { BackupDestination } from "../domain/BackupPublication.ts";
import { ManualBackupError, parseBackupLocation, type BackupLocationStore } from "../domain/ManualBackupPort.ts";

/** Device permission/location metadata is separate from the working DB and its snapshots. */
export function expoBackupLocationStore(): BackupLocationStore {
  const root = new Directory(Paths.document, "runtime-backup", "production");
  const file = new File(root, "location.json");
  return {
    async read() {
      try {
        if (!file.exists) return { kind: "DOWNLOADS" };
        if (file.size > 16384) throw new Error();
        return parseBackupLocation(JSON.parse(await file.text()) as unknown);
      } catch { throw new ManualBackupError("BACKUP_FOLDER_UNAVAILABLE"); }
    },
    async write(destination: BackupDestination) {
      try {
        const checked = parseBackupLocation({ version: 1, ...destination });
        root.create({ idempotent: true, intermediates: true });
        const pending = new File(root, `location-${uuid.v4()}.next`);
        pending.create();
        pending.write(JSON.stringify({ version: 1, ...checked }));
        if (JSON.stringify(parseBackupLocation(JSON.parse(await pending.text()) as unknown)) !== JSON.stringify(checked)) throw new Error();
        await moveAsync({ from: pending.uri, to: file.uri });
      } catch { throw new ManualBackupError("BACKUP_FOLDER_UNAVAILABLE"); }
    },
  };
}
