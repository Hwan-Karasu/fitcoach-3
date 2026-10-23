import { Directory, File } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import { uuid } from "expo-modules-core";
import { assertSnapshotPrivateUri } from "../../features/backup/data/ExpoSnapshotMedia.ts";
import { parsePendingRuntimeRestore, type PendingRuntimeRestore } from "../bootstrap/recoverRuntimeRestore.ts";
import type { RuntimeRestoreJournal } from "../runtime/JournaledRestore.ts";

/** Private routing metadata only. An external file never supplies a root or filename.
 * Rename publishes the complete record; no power-loss directory fsync is claimed. */
export class ExpoRuntimeRestoreJournal implements RuntimeRestoreJournal {
  private readonly root: Directory;
  constructor(root: Directory) { assertSnapshotPrivateUri(root.uri); this.root = root; }
  private async read(file: File): Promise<{ readonly value: unknown } | null> {
    if (!file.exists) return null;
    if (file.size > 8192) throw new Error("RESTORE_JOURNAL_INVALID");
    return { value: JSON.parse(await file.text()) as unknown };
  }
  readPending(): Promise<{ readonly value: unknown } | null> { return this.read(new File(this.root, "pending.json")); }
  async readGuard(operationId: string): Promise<unknown | null> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(operationId)) throw new Error("RESTORE_JOURNAL_INVALID");
    const saved = await this.read(new File(this.root, "jobs", operationId, "guard.json"));
    if (saved !== null && saved.value === null) throw new Error("RESTORE_JOURNAL_INVALID");
    return saved?.value ?? null;
  }
  async publish(input: PendingRuntimeRestore): Promise<void> {
    const plan = parsePendingRuntimeRestore(input);
    if (!new Directory(this.root, "jobs", plan.operationId).exists) throw new Error("RESTORE_JOB_MISSING");
    const pending = new File(this.root, `pending-${uuid.v4()}.next`); let created = false;
    try {
      pending.create(); created = true; pending.write(JSON.stringify(plan));
      const readback = parsePendingRuntimeRestore(JSON.parse(await pending.text()) as unknown);
      if (JSON.stringify(readback) !== JSON.stringify(plan)) throw new Error("RESTORE_JOURNAL_INVALID");
      await moveAsync({ from: pending.uri, to: new File(this.root, "pending.json").uri });
    } finally { if (created && pending.exists) pending.delete(); }
  }
}
