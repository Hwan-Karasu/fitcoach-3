import { DevSettings } from "react-native";
import { workoutNavigationProbe } from "../../shared/diagnostics/WorkoutNavigationProbe.ts";
import { restTimerDiagnostics } from "../../shared/diagnostics/RestTimerDiagnostics.ts";
import { inputLatency } from "../../shared/diagnostics/InputLatency.ts";

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
  // INPUT-LAG-1: набрать цифры в нескольких ячейках, затем пункт печатает задержку «ввод → отрисовка» и сбрасывает счётчик.
  DevSettings.addMenuItem("Report cell input latency", () => {
    console.info("[input-latency]", restTimerDiagnostics.label("device"), JSON.stringify(inputLatency.stats()));
    inputLatency.reset();
  });
  DevSettings.addMenuItem("Toggle rest timer clock", () => {
    console.info("[rest-clock]", restTimerDiagnostics.toggleClock() ? "off" : "on");
  });
  DevSettings.addMenuItem("Start rest panel render sample", () => {
    restTimerDiagnostics.startRenders();
    inputLatency.reset();
  });
  DevSettings.addMenuItem("Report rest panel render sample", () => {
    console.info("[rest-panel-profile]", restTimerDiagnostics.label("device"), JSON.stringify({
      renders: restTimerDiagnostics.finishRenders(), latency: inputLatency.stats(),
    }));
  });
}
