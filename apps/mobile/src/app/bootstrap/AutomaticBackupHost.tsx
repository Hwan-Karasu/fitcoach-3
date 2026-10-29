import { useEffect } from "react";
import { AppState } from "react-native";
import type { AutomaticBackupPort } from "../../features/backup/public.ts";
import { AutomaticBackupScheduler } from "../runtime/AutomaticBackupScheduler.ts";
import { trackTrainingActivity, type TrainingActivityPorts } from "../runtime/TrainingActivity.ts";

/** Foreground best effort only. The service's persisted check time handles long background
 * intervals; unmount cancels the timer, never an already admitted publication.
 * Во время тренировки (`activity`) автокопия не стартует — ждёт паузы (AUTO-BACKUP-3). */
export function AutomaticBackupHost({ backup, activity }: Readonly<{ backup: AutomaticBackupPort; activity?: TrainingActivityPorts }>) {
  useEffect(() => {
    if (!backup.state.available) return;
    const training = activity === undefined ? null : trackTrainingActivity(activity);
    const scheduler = new AutomaticBackupScheduler(backup, undefined, training?.quiet);
    scheduler.setActive(AppState.currentState === "active" || AppState.currentState === null);
    const subscription = AppState.addEventListener("change", (state) => scheduler.setActive(state === "active"));
    return () => { scheduler.dispose(); subscription.remove(); training?.dispose(); };
  }, [activity, backup]);
  return null;
}
