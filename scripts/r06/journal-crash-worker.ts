import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePendingRuntimeRestore } from "../../apps/mobile/src/app/bootstrap/recoverRuntimeRestore.ts";
import { restoreWithRuntimeJournal } from "../../apps/mobile/src/app/runtime/JournaledRestore.ts";
import { HostRestoreStorage } from "./HostRestoreStorage.ts";

// Only synthetic temporary databases supplied by the host test; no device or user files.
const [directory, event] = process.argv.slice(2);
if (!directory || !event) throw new Error("R06_TEST_ARGUMENTS");
function boundary(current: string): void {
  if (current !== event) return;
  writeFileSync(1, `R06_JOURNAL_KILL:${current}\n`);
  process.kill(process.pid, "SIGKILL");
}
const storage = new HostRestoreStorage(directory, boundary);
const pending = join(directory, "pending.json");
await restoreWithRuntimeJournal(parsePendingRuntimeRestore(JSON.parse(readFileSync(join(directory, "plan.json"), "utf8"))), storage, {
  readPending: async () => existsSync(pending) ? { value: JSON.parse(readFileSync(pending, "utf8")) as unknown } : null,
  readGuard: async () => { throw new Error("UNEXPECTED_PREVIOUS_JOB"); },
  publish: async (plan) => {
    const next = join(directory, "pending.next"); const fd = openSync(next, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(plan)); fsyncSync(fd); } finally { closeSync(fd); }
    boundary("journal:pending");
    renameSync(next, pending);
    boundary("journal:published");
  },
});
