type Kind = "program-week" | "program-participant" | "workout-week" | "workout-participant";
export type NavigationSample = { kind: Kind; totalMs: number; reads: number; commits: number; reactMs: number;
  phases: Record<string, number>; ok: boolean; selectionMs?: number;
  components: Record<string, { commits: number; mounts: number; unmounts: number; renders: number; ms: number }>;
  sql: Record<string, { reads: number; ms: number }>; maxJsFrameGapMs: number };
type Sample = NavigationSample;
type Running = { started: number; sample: Sample };
let enabled = false;
let running: Running | null = null;
const samples: Sample[] = [];
const listeners = new Set<(sample: Sample) => void>();

/** Opt-in, memory-only navigation diagnostics. No client IDs, SQL, input values or names. */
export const navigationPerformance = {
  enable(value = true) { enabled = value; running = null; samples.length = 0; },
  begin(kind: Kind) {
    if (!enabled) return;
    running = { started: performance.now(), sample: { kind, totalMs: 0, reads: 0, commits: 0, reactMs: 0,
      phases: {}, ok: true, components: {}, sql: {}, maxJsFrameGapMs: 0 } };
    if (typeof requestAnimationFrame !== "undefined") {
      const captured = running;
      let last = captured.started;
      const tick = () => {
        if (running !== captured) return;
        const now = performance.now();
        captured.sample.maxJsFrameGapMs = Math.max(captured.sample.maxJsFrameGapMs, now - last); last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  },
  phase(name: string) {
    const captured = running;
    const started = captured === null ? 0 : performance.now();
    return () => {
      if (captured !== null) captured.sample.phases[name] = (captured.sample.phases[name] ?? 0) + performance.now() - started;
    };
  },
  read(sql?: string) {
    const captured = running;
    if (captured === null) return () => undefined;
    captured.sample.reads += 1;
    const table = /\b(?:FROM|JOIN)\s+(training_[a-z_]+|client[a-z_]*|settings[a-z_]*)/iu.exec(sql ?? "")?.[1] ?? "other";
    const item = captured.sample.sql[table] ?? { reads: 0, ms: 0 }; item.reads += 1;
    captured.sample.sql[table] = item;
    const start = performance.now();
    return () => { item.ms += performance.now() - start; };
  },
  onRender(id: string, phase: string, actualDuration: number) {
    if (running !== null) {
      const item = running.sample.components[id] ?? { commits: 0, mounts: 0, unmounts: 0, renders: 0, ms: 0 };
      item.commits += 1; item.mounts += phase === "mount" ? 1 : 0; item.ms += actualDuration;
      running.sample.components[id] = item;
      if (id === "TrainingWorkout" || id === "TrainingProgram") { running.sample.commits += 1; running.sample.reactMs += actualDuration; }
    }
  },
  selection() { if (running !== null && running.sample.selectionMs === undefined) running.sample.selectionMs = performance.now() - running.started; },
  subscribe(listener: (sample: Sample) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  mount(id: string) {
    if (running !== null) {
      const item = running.sample.components[id] ?? { commits: 0, mounts: 0, unmounts: 0, renders: 0, ms: 0 };
      item.mounts += 1; running.sample.components[id] = item;
    }
  },
  render(id: string) {
    if (running === null) return;
    const item = running.sample.components[id] ?? { commits: 0, mounts: 0, unmounts: 0, renders: 0, ms: 0 };
    item.renders += 1; running.sample.components[id] = item;
  },
  unmount(id: string) {
    if (running === null) return;
    const item = running.sample.components[id] ?? { commits: 0, mounts: 0, unmounts: 0, renders: 0, ms: 0 };
    item.unmounts += 1; running.sample.components[id] = item;
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
    const finished = running.sample; running = null;
    for (const listener of listeners) listener(finished);
  },
  snapshot(): readonly Sample[] { return samples.map((sample) => ({ ...sample, phases: { ...sample.phases } })); },
};

declare const __DEV__: boolean;
if (typeof __DEV__ !== "undefined" && __DEV__) {
  (globalThis as typeof globalThis & { __FITCOACH_NAV_PERF__?: typeof navigationPerformance }).__FITCOACH_NAV_PERF__ = navigationPerformance;
}
