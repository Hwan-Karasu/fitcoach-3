import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GuardedRestore, type RestorePlan } from "../../apps/mobile/src/features/backup/public.ts";
import { HostRestoreStorage } from "./HostRestoreStorage.ts";

// Only spawned by synthetic R06 tests. No actual user files or device are addressed.
const [directory, event, action = "restore"] = process.argv.slice(2);
if (!directory || !event) throw new Error("R06_TEST_ARGUMENTS");
const storage = new HostRestoreStorage(directory, (boundary) => {
  if (boundary === event) process.kill(process.pid, "SIGKILL");
});
const protocol = new GuardedRestore(storage);
if (action === "recover") await protocol.recover();
else await protocol.restore(JSON.parse(readFileSync(join(directory, "plan.json"), "utf8")) as RestorePlan);
