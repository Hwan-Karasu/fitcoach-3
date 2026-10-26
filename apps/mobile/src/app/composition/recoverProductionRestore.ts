import { Directory, File, FileMode, Paths } from "expo-file-system";
import { ExpoRestoreStorage } from "../../features/backup/data/ExpoRestoreStorage.ts";
import type { RuntimeMaintenance } from "../runtime/RuntimeMaintenance.ts";
import { recoverRuntimeRestore } from "../bootstrap/recoverRuntimeRestore.ts";
import { inspectProductionDatabase, PRODUCTION_IDENTITY } from "./productionDatabase.ts";
import { productionLiveFile } from "./productionFiles.ts";
import { ExpoRuntimeRestoreJournal } from "./ExpoRuntimeRestoreJournal.ts";
import { ExpoReturnPointStore } from "../../features/backup/data/ExpoReturnPointStore.ts";
import { ReturnPointCompletion } from "../../features/backup/public.ts";
import { SCHEMA_OWNERS } from "./schema.ts";

/** No journal = no directory creation and no SQLite open before the normal production gate.
 * The next file-restore controller will publish pending.json after explicit confirmation.
 * External/legacy source files never supply the live path or a job directory name. */
export async function recoverProductionRestore(maintenance: RuntimeMaintenance): Promise<void> {
  const root = new Directory(Paths.document, "runtime-restore", "production");
  if (!new File(root, "pending.json").exists) return;
  const live = productionLiveFile();
  await recoverLocalRestore(maintenance, root, live);
}

/** Composition supplies trusted private paths. The isolated Android rehearsal uses this
 * same reader/header/adapter with its own namespace, never the production database. */
export function recoverLocalRestore(maintenance: Pick<RuntimeMaintenance, "withClosedDatabase">, root: Directory, live: File): Promise<void> {
  const journal = new ExpoRuntimeRestoreJournal(root);
  return recoverRuntimeRestore(() => journal.readPending(), (plan) => {
    const directory = new Directory(root, "jobs", plan.operationId);
    if (!directory.exists) throw new Error("RESTORE_JOB_MISSING");
    return new ExpoRestoreStorage({ live, directory,
      withClosedDatabase: (task) => maintenance.withClosedDatabase(task), inspectDatabase: inspectProductionDatabase });
  }, async () => {
    // A completed receipt permits a later WAL, but never authorizes claiming an empty
    // replacement file. Check presence/ownership header without opening SQLite first.
    if (!live.exists || live.size < 100) return false;
    const reader = live.open(FileMode.ReadOnly);
    try {
      const bytes = reader.readBytes(100);
      const magic = [83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0];
      return bytes.length === 100 && magic.every((byte, index) => bytes[index] === byte) &&
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(68, false) === PRODUCTION_IDENTITY.applicationId;
    } finally { reader.close(); }
  }, new ReturnPointCompletion(new ExpoReturnPointStore(root, { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS })));
}
