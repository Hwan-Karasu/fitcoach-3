type Kind = "program-week" | "program-participant" | "workout-week" | "workout-participant";
type Sample = { kind: Kind; totalMs: number; reads: number; commits: number; reactMs: number;
  phases: Record<string, number>; ok: boolean };
type Running = { started: number; sample: Sample };
let enabled = false;
let running: Running | null = null;
const samples: Sample[] = [];

/** Opt-in, memory-only navigation diagnostics. No client IDs, SQL, input values or names. */
export const navigationPerformance = {
  enable(value = true) { enabled = value; running = null; samples.length = 0; },
  begin(kind: Kind) {
    if (!enabled) return;
    running = { started: performance.now(), sample: { kind, totalMs: 0, reads: 0, commits: 0, reactMs: 0, phases: {}, ok: true } };
  },
  phase(name: string) {
    const captured = running;
    const started = captured === null ? 0 : performance.now();
    return () => {
      if (captured !== null) captured.sample.phases[name] = (captured.sample.phases[name] ?? 0) + performance.now() - started;
    };
  },
  read() { if (running !== null) running.sample.reads += 1; },
  onRender(_id: string, _phase: string, actualDuration: number) {
    if (running !== null) { running.sample.commits += 1; running.sample.reactMs += actualDuration; }
  },
  ready(screen: "program" | "workout"): () => void {
    const captured = running;
    return () => { if (captured !== null && captured === running) navigationPerformance.finish(screen); };
  },
  finish(screen: "program" | "workout", ok = true) {
    if (running === null || !running.sample.kind.startsWith(screen)) return;
    running.sample.totalMs = performance.now() - running.started;
    running.sample.ok = ok;
    samples.push(running.sample);
    if (samples.length > 300) samples.shift();
    running = null;
  },
  snapshot(): readonly Sample[] { return samples.map((sample) => ({ ...sample, phases: { ...sample.phases } })); },
};

declare const __DEV__: boolean;
if (typeof __DEV__ !== "undefined" && __DEV__) {
  (globalThis as typeof globalThis & { __FITCOACH_NAV_PERF__?: typeof navigationPerformance }).__FITCOACH_NAV_PERF__ = navigationPerformance;
}
