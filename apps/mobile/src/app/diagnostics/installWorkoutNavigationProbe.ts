import { DevSettings } from "react-native";
import { workoutNavigationProbe } from "../../shared/diagnostics/WorkoutNavigationProbe.ts";

/** Explicit developer-menu action; no production UI or automatic navigation. */
export function installWorkoutNavigationProbe() {
  if (!__DEV__) return;
  DevSettings.addMenuItem("Profile workout weeks (30)", () => {
    void workoutNavigationProbe.run("device").catch((error: unknown) => console.info("[nav-profile-error]",
      error instanceof Error ? error.message : "PROFILE_FAILED"));
  });
}
