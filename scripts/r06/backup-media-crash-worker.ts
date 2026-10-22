import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteBackup, prepareBackupForRestore } from "./SqliteBackup.ts";
import type { SnapshotMediaOptions } from "./SqliteBackupMedia.ts";

const [directory, phase] = process.argv.slice(2);
if (!directory || !phase) throw new Error("R06_TEST_ARGUMENTS");
const options: SnapshotMediaOptions = { mediaRoot: join(directory, phase === "EMBEDDED" ? "old-images" : "new-images"),
  onMediaProgress: (event) => { if (event.phase === phase) process.kill(process.pid, "SIGKILL"); } };
if (phase === "EMBEDDED") {
  const source = new DatabaseSync(join(directory, "source.db"));
  try {
    await createSqliteBackup(source, join(directory, "interrupted.partial"), join(directory, "interrupted.atbackup"),
      { backupId: "10000000-0000-4000-8000-000000000001", createdAt: "2026-10-22T10:00:00.000Z" }, options);
  } finally { source.close(); }
} else {
  await prepareBackupForRestore(join(directory, "copy.atbackup"), join(directory, "interrupted.db"), options);
}
