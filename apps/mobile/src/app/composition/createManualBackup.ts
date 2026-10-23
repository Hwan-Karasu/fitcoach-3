import { Directory, File } from "expo-file-system";
import { defaultDatabaseDirectory } from "expo-sqlite";
import { expoBackupLocationStore } from "../../features/backup/data/ExpoBackupLocationStore.ts";
import { expoManualSnapshotJobs } from "../../features/backup/data/ExpoManualSnapshotJobs.ts";
import { nativeBackupPublisher } from "../../features/backup/data/NativeBackupPublisher.ts";
import { ManualBackupService, ManualBackupError, type ManualBackupPort } from "../../features/backup/public.ts";
import type { RuntimeCommandGate } from "../runtime/RuntimeCommandGate.ts";
import type { BootCoordinator } from "../bootstrap/BootCoordinator.ts";
import { PRODUCTION_DATABASE, PRODUCTION_IDENTITY } from "./productionDatabase.ts";
import { SCHEMA_OWNERS } from "./schema.ts";
import { sqliteDirectoryUri } from "../../shared/db/SqliteDirectoryUri.ts";

export function createManualBackup(development: boolean, commands: RuntimeCommandGate, boot: BootCoordinator): ManualBackupPort {
  let jobs: ReturnType<typeof expoManualSnapshotJobs> | null = null;
  const getJobs = () => jobs ??= expoManualSnapshotJobs(new File(new Directory(sqliteDirectoryUri(defaultDatabaseDirectory)), PRODUCTION_DATABASE),
    { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
  return new ManualBackupService({ enabled: !development, publisher: nativeBackupPublisher(), locations: expoBackupLocationStore(),
    prepare: () => getJobs().prepare(), cleanup: (snapshot) => getJobs().cleanup(snapshot),
    chooseDirectory: async () => {
      try { return { kind: "DIRECTORY", uri: (await Directory.pickDirectoryAsync()).uri }; }
      catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ERR_PICKER_CANCELLED") return null;
        throw new ManualBackupError("BACKUP_FOLDER_UNAVAILABLE");
      }
    },
    run: (task) => commands.run(async () => {
      if (boot.state.kind !== "APP_READY") throw new ManualBackupError("BACKUP_NOT_READY");
      return task();
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "RUNTIME_MAINTENANCE") throw new ManualBackupError("BACKUP_NOT_READY");
      throw error;
    }),
  });
}
