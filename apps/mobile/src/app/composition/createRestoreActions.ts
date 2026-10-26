import { Directory, Paths } from "expo-file-system";
import { RestoreActionsService, RestoreActionError, type RestoreJobsPort } from "../../features/backup/public.ts";
import { nativeBackupPublisher } from "../../features/backup/data/NativeBackupPublisher.ts";
import { productionLiveFile } from "./productionFiles.ts";
import type { BootCoordinator } from "../bootstrap/BootCoordinator.ts";
import type { RuntimeCommandGate } from "../runtime/RuntimeCommandGate.ts";
import type { RuntimeMaintenance } from "../runtime/RuntimeMaintenance.ts";
import { ExpoRestoreJobs } from "./ExpoRestoreJobs.ts";

export function createRestoreActions(development: boolean, commands: RuntimeCommandGate, boot: BootCoordinator, maintenance: RuntimeMaintenance) {
  let jobs: ExpoRestoreJobs | null = null;
  const get = () => jobs ??= new ExpoRestoreJobs({
    root: new Directory(Paths.document, "runtime-restore", "production"),
    live: productionLiveFile(),
    images: new Directory(Paths.document, "local-images"), maintenance,
  });
  const port: RestoreJobsPort = {
    prepareFile: () => get().prepareFile(), prepareReturn: (id) => get().prepareReturn(id), apply: (id) => get().apply(id),
    discard: (id) => get().discard(id), readPoint: () => get().readPoint(), deletePoint: (id) => get().deletePoint(id), recover: () => get().recover(),
  };
  return new RestoreActionsService({ enabled: !development && nativeBackupPublisher().available, jobs: port,
    ready: () => boot.state.kind === "APP_READY" && maintenance.state === "ACTIVE",
    read: (task) => commands.run(task).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "RUNTIME_MAINTENANCE") throw new RestoreActionError("RESTORE_NOT_READY");
      throw error;
    }),
  });
}
