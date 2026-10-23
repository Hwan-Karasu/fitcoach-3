import { useEffect } from "react";
import { AppState } from "react-native";
import type { AutomaticBackupPort } from "../../features/backup/public.ts";
import { AutomaticBackupScheduler } from "../runtime/AutomaticBackupScheduler.ts";

/** Foreground best effort only. The service's persisted check time handles long background
 * intervals; unmount cancels the timer, never an already admitted publication. */
export function AutomaticBackupHost({ backup }: Readonly<{ backup: AutomaticBackupPort }>) {
  useEffect(() => {
    if (!backup.state.available) return;
    const scheduler = new AutomaticBackupScheduler(backup);
    scheduler.setActive(AppState.currentState === "active" || AppState.currentState === null);
    const subscription = AppState.addEventListener("change", (state) => scheduler.setActive(state === "active"));
    return () => { scheduler.dispose(); subscription.remove(); };
  }, [backup]);
  return null;
}
