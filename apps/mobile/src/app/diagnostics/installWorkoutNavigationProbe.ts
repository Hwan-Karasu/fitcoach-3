import { DevSettings } from "react-native";
import { workoutNavigationProbe } from "../../shared/diagnostics/WorkoutNavigationProbe.ts";
import { restTimerDiagnostics } from "../../shared/diagnostics/RestTimerDiagnostics.ts";

/**
 * Explicit developer-menu action; no production UI or automatic navigation. Метка замера содержит число таймеров отдыха и состояние
 * их отсчёта (REST-PERF-1): одинаковые 30 переключений недель сравниваются при 0/1/2/3 таймерах и с выключенным отсчётом цифр.
 */
export function installWorkoutNavigationProbe() {
  if (!__DEV__) return;
  DevSettings.addMenuItem("Profile workout weeks (30)", () => {
    void workoutNavigationProbe.run(restTimerDiagnostics.label("device")).catch((error: unknown) => console.info("[nav-profile-error]",
      error instanceof Error ? error.message : "PROFILE_FAILED"));
  });
  DevSettings.addMenuItem("Toggle rest timer clock", () => {
    console.info("[rest-clock]", restTimerDiagnostics.toggleClock() ? "off" : "on");
  });
}
