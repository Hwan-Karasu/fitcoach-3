import { Directory, File, Paths } from "expo-file-system";
import { defaultDatabaseDirectory } from "expo-sqlite";
import { AutomaticBackupService, AutomaticBackupError, type AutomaticBackupFiles } from "../../features/backup/public.ts";
import { expoAutomaticBackupStore } from "../../features/backup/data/ExpoAutomaticBackupStore.ts";
import { ExpoAutomaticBackupFiles, nativeAutomaticBackupAvailable } from "../../features/backup/data/ExpoAutomaticBackupFiles.ts";
import { expoBackupLocationStore } from "../../features/backup/data/ExpoBackupLocationStore.ts";
import { sqliteDirectoryUri } from "../../shared/db/SqliteDirectoryUri.ts";
import type { BootCoordinator } from "../bootstrap/BootCoordinator.ts";
import type { RuntimeCommandGate } from "../runtime/RuntimeCommandGate.ts";
import { PRODUCTION_DATABASE, PRODUCTION_IDENTITY } from "./productionDatabase.ts";
import { SCHEMA_OWNERS } from "./schema.ts";

export function createAutomaticBackup(development: boolean, commands: RuntimeCommandGate, boot: BootCoordinator) {
  let store: ReturnType<typeof expoAutomaticBackupStore> | null = null; let jobs: ExpoAutomaticBackupFiles | null = null;
  const root = () => new Directory(Paths.document, "runtime-backup", "production");
  const getStore = () => store ??= expoAutomaticBackupStore(root());
  const getJobs = () => jobs ??= new ExpoAutomaticBackupFiles({ root: root(),
    live: new File(new Directory(sqliteDirectoryUri(defaultDatabaseDirectory)), PRODUCTION_DATABASE),
    schema: { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS }, images: new Directory(Paths.document, "local-images"),
    pendingIds: () => getStore().protectedJobIds() });
  const files: AutomaticBackupFiles = { available: !development && nativeAutomaticBackupAvailable(),
    prepare: (previous) => getJobs().prepare(previous), publish: (pending, destination) => getJobs().publish(pending, destination),
    inspect: (entry) => getJobs().inspect(entry),
    verify: (entry) => getJobs().verify(entry), remove: (entry) => getJobs().remove(entry), cleanup: (id) => getJobs().cleanup(id) };
  return new AutomaticBackupService({ enabled: !development, files,
    store: { read: () => getStore().read(), write: (catalog) => getStore().write(catalog), archive: (catalog) => getStore().archive(catalog),
      readFailure: () => getStore().readFailure(), writeFailure: (failure) => getStore().writeFailure(failure) },
    location: () => expoBackupLocationStore().read(), ready: () => boot.state.kind === "APP_READY",
    run: (task) => commands.run(task).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "RUNTIME_MAINTENANCE") throw new AutomaticBackupError("AUTO_NOT_READY");
      throw error;
    }),
  });
}
