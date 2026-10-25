import { navigationPerformance, type NavigationSample } from "./NavigationPerformance.ts";

type Controller = { week: number; available: readonly number[]; ready: boolean; select: (week: number) => void };
let current: Controller | null = null;
let busy = false;

/** Developer-only replay of the same handler used by the week cards; never creates or edits workout data. */
export const workoutNavigationProbe = {
  update(controller: Controller) { current = controller; },
  clear() { current = null; },
  async run(label: string, count = 30) {
    if (busy) throw new Error("PROFILE_ALREADY_RUNNING");
    if (current === null || !current.ready || ![1, 2, 3].every((week) => current!.available.includes(week))) throw new Error("OPEN_WORKOUT_WITH_THREE_WEEKS");
    busy = true;
    const original = current.week;
    const samples: NavigationSample[] = [];
    navigationPerformance.enable();
    try {
      for (let i = 0; i < count; i += 1) {
        const next = current!.week === 1 ? 2 : current!.week === 2 ? 3 : 1;
        const sample = await new Promise<NavigationSample>((resolve, reject) => {
          const timeout = setTimeout(() => { off(); reject(new Error("PROFILE_TRANSITION_TIMEOUT")); }, 10_000);
          const off = navigationPerformance.subscribe((sample) => {
            if (sample.kind !== "workout-week") return;
            clearTimeout(timeout); off(); resolve(sample);
          });
          current!.select(next);
        });
        samples.push(sample);
        console.info("[nav-profile-sample]", JSON.stringify({ label, iteration: i, ...sample }));
        // Give layout/scroll effects the same quiet interval in both runs, outside the measured transition.
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const sorted = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
      console.info("[nav-profile-summary]", JSON.stringify({ label, environment: "physical-android-expo-dev", count: samples.length,
        medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] }));
      await fetch("http://127.0.0.1:8099/capture", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, environment: "physical-android-expo-dev", samples }) });
    } finally {
      navigationPerformance.enable(false); busy = false;
      if (current?.ready && current.week !== original) current.select(original);
    }
  },
};
