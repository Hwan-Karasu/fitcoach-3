import assert from "node:assert/strict";
import test from "node:test";
import { ATHLETE_FACETS } from "../apps/mobile/src/app/bootstrap/athleteFacets.ts";
import { canExitLaunch, facetReflection, facetReveal, LAUNCH_DURATION_MS, smoothProgress } from
  "../apps/mobile/src/app/bootstrap/launchTimeline.ts";
import { StartupDiagnostics } from "../apps/mobile/src/app/bootstrap/StartupDiagnostics.ts";

test("splash: every face assembles monotonically by 1050 ms and stays assembled during a slow boot", () => {
  for (const face of ATHLETE_FACETS) {
    assert.equal(facetReveal(450, face.order), 0);
    assert.equal(facetReveal(1050, face.order), 1);
    assert.equal(facetReveal(10_000, face.order), 1);
    let before = 0;
    for (let t = 0; t <= LAUNCH_DURATION_MS; t += 1000 / 60) {
      const value = facetReveal(t, face.order);
      assert.ok(value >= before && value <= 1);
      assert.ok(value - before < 0.07, "a 60 Hz sample must not jump between fixed reference frames");
      before = value;
    }
  }
});

test("splash: the light reaches the left arm before the right and fades without lighting the whole figure", () => {
  const peakAt = (x: number) => {
    let best = 0; let peak = 0;
    for (let t = 1000; t <= 1700; t++) {
      const value = facetReflection(t, x, 35, 0.8);
      if (value > peak) { peak = value; best = t; }
    }
    return best;
  };
  assert.ok(peakAt(10) < peakAt(90));
  for (const time of [0, 450, 1050, 1650, 2000, 10_000]) {
    for (const face of ATHLETE_FACETS) assert.equal(facetReflection(time, face.x, face.y, face.reflection), 0);
  }
  for (let time = 1050; time <= 1650; time += 1000 / 60) {
    const bright = ATHLETE_FACETS.filter((face) => facetReflection(time, face.x, face.y, face.reflection) > 0.2);
    assert.ok(bright.length < ATHLETE_FACETS.length / 2);
  }
});

test("splash: completed art waits for the actual screen and foreground; readiness never restarts the sequence", () => {
  assert.equal(canExitLaunch(false, true, true), false);
  assert.equal(canExitLaunch(true, false, true), false);
  assert.equal(canExitLaunch(true, true, false), false, "fast boot still shows the full requested animation");
  assert.equal(canExitLaunch(true, true, true), true);
  assert.equal(smoothProgress(0, 0, 450), 0);
  assert.equal(smoothProgress(450, 0, 450), 1);
});

test("splash: local numeric diagnostics measure async stages, preserve failures and bound memory", async () => {
  let now = 100;
  const trace = new StartupDiagnostics(() => now);
  now = 120; trace.mark("react.layout");
  assert.equal(await trace.measure("database.prepare", async () => { now = 150; return 42; }), 42);
  const failure = new Error("synthetic failure");
  await assert.rejects(trace.measure("repositories.initialize", async () => { now = 170; throw failure; }), (error) => error === failure);
  assert.deepEqual(trace.snapshot(), [{ stage: "react.layout", atMs: 20 },
    { stage: "database.prepare", atMs: 50, durationMs: 30 }, { stage: "repositories.initialize", atMs: 70, durationMs: 20 }]);
  const snapshot = trace.snapshot();
  Reflect.set(snapshot[0]!, "atMs", -1);
  assert.equal(trace.snapshot()[0]!.atMs, 20);
  for (let i = 0; i < 100; i++) trace.mark("navigation.ready");
  assert.equal(trace.snapshot().length, 32);
});
