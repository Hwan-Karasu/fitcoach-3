import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReturnPointCompletion } from "../../apps/mobile/src/features/backup/public.ts";
import { parsePendingRuntimeRestore } from "../../apps/mobile/src/app/bootstrap/recoverRuntimeRestore.ts";
import { restoreWithRuntimeJournal } from "../../apps/mobile/src/app/runtime/JournaledRestore.ts";
import { HostManagedRestoreStorage, HostReturnPointStore } from "./HostReturnPointStore.ts";

// Test-only temporary roots. Never points at a phone or an actual user database.
const [root, event, kind, expectedPointOperationId] = process.argv.slice(2);
if (!root || !event || (kind !== "RESTORE" && kind !== "RETURN") || !expectedPointOperationId) throw new Error("R06_TEST_ARGUMENTS");
const boundary = (current: string): void => {
  if (current !== event) return;
  writeFileSync(1, `R06_POINT_KILL:${current}\n`); process.kill(process.pid, "SIGKILL");
};
const plan = parsePendingRuntimeRestore(JSON.parse(readFileSync(join(root, "plan.json"), "utf8")));
const store = new HostReturnPointStore(root, join(root, "images"), boundary);
const storage = new HostManagedRestoreStorage(root, plan.operationId, boundary);
const completion = new ReturnPointCompletion(store, kind === "RESTORE"
  ? { kind: "RESTORE", createPoint: (input) => store.createPoint(input) }
  : { kind: "RETURN", expectedPointOperationId });
await restoreWithRuntimeJournal(plan, storage, store.journal(), completion);
