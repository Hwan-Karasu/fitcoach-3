import { DatabaseSync } from "node:sqlite";
import { inspectLegacyBackup } from "./r02/LegacyBackupInspector.ts";

if (process.argv.length !== 3 || !process.argv[2]?.toLowerCase().endsWith(".atbackup")) {
  process.stderr.write("USAGE: npm run r02:inspect -- <temporary-copy.atbackup>\n");
  process.exitCode = 2;
} else {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(process.argv[2], { readOnly: true });
    const inventory = inspectLegacyBackup(db);
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    if (inventory.status === "blocked") process.exitCode = 1;
  } catch {
    // Do not echo a path, SQLite payload, or parser exception from a personal backup.
    process.stderr.write("INSPECTION_FAILED\n");
    process.exitCode = 1;
  } finally { db?.close(); }
}
