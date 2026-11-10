import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { animationBoundary, LaunchArtwork, splashBoundary } from "./support/splash-native-boundary.ts";

const boundary = new URL("./support/splash-native-boundary.ts", import.meta.url).href;
const native = new Set(["react-native", "react-native-reanimated", "react-native-worklets"]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (native.has(specifier) || specifier.endsWith("/LaunchArtwork.tsx")) return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, fileName: fileURLToPath(url),
    }).outputText };
  },
});
const { LaunchAnimation } = await import("../src/app/bootstrap/LaunchAnimation.tsx");
hooks.deregister();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("splash animation: ready UI still shows the complete two-second sequence before fading", async () => {
  animationBoundary.calls.length = 0; let completed = 0;
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(LaunchAnimation, { start: true, ready: true, onComplete: () => { completed++; } })); });
    assert.equal(animationBoundary.calls.length, 0);
    await act(async () => { tree.root.findByType(LaunchArtwork).props.onLoad(); animationBoundary.flush(); });
    assert.deepEqual(animationBoundary.calls.map((call) => call.duration), [2000]);
    await act(async () => { animationBoundary.finish(); animationBoundary.flush(); });
    assert.equal(completed, 0, "completed assembly starts a fade instead of dismissing abruptly");
    assert.deepEqual(animationBoundary.calls.map((call) => call.duration), [2000, 180]);
    await act(async () => { animationBoundary.finish(); animationBoundary.flush(); });
    assert.equal(completed, 1);
    assert.equal(animationBoundary.calls.length, 2, "one assembly and one fade, no replay");
  } finally { if (tree) await act(async () => tree.unmount()); }
  assert.equal(animationBoundary.pending(), 0); assert.equal(animationBoundary.reactions(), 0); assert.equal(splashBoundary.listeners.size, 0);
});

test("splash animation: slow boot settles once; background cancels fade, resume exits without replay; cleanup releases work", async () => {
  animationBoundary.calls.length = 0; let completed = 0;
  const complete = () => { completed++; };
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(LaunchAnimation, { start: true, ready: false, onComplete: complete })); });
    await act(async () => { tree.root.findByType(LaunchArtwork).props.onLoad(); animationBoundary.flush(); });
    assert.deepEqual(animationBoundary.calls.map((call) => call.duration), [2000]);
    await act(async () => { animationBoundary.finish(); animationBoundary.flush(); });
    assert.equal(completed, 0, "an assembled emblem does not imply data/navigation readiness");
    await act(async () => { tree.update(createElement(LaunchAnimation, { start: true, ready: true, onComplete: complete })); });
    await act(async () => { animationBoundary.flush(); });
    assert.equal(animationBoundary.calls.at(-1)!.duration, 180);
    await act(async () => { animationBoundary.emit("background"); animationBoundary.flush(); animationBoundary.finish(); });
    assert.equal(completed, 0, "cancelled fade cannot dismiss the splash");
    await act(async () => { animationBoundary.emit("active"); animationBoundary.flush(); animationBoundary.finish(); });
    assert.equal(completed, 1);
    assert.equal(animationBoundary.calls.filter((call) => call.duration === 2000).length, 1);
  } finally { if (tree) await act(async () => tree.unmount()); }
  assert.equal(animationBoundary.pending(), 0); assert.equal(animationBoundary.reactions(), 0); assert.equal(splashBoundary.listeners.size, 0);
});

test("splash animation: reduced motion shows final artwork and respects readiness without a two-second wait", async () => {
  animationBoundary.calls.length = 0; animationBoundary.reducedMotion = true; let completed = 0;
  const complete = () => { completed++; };
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(LaunchAnimation, { start: true, ready: false, onComplete: complete })); });
    await act(async () => { tree.root.findByType(LaunchArtwork).props.onLoad(); animationBoundary.flush(); });
    assert.equal(tree.root.findByType(LaunchArtwork).props.clock.value, 2000);
    assert.equal(animationBoundary.calls.length, 0);
    await act(async () => { tree.update(createElement(LaunchAnimation, { start: true, ready: true, onComplete: complete })); });
    await act(async () => { animationBoundary.flush(); animationBoundary.finish(); });
    assert.deepEqual(animationBoundary.calls.map((call) => call.duration), [0]); assert.equal(completed, 1);
  } finally { if (tree) await act(async () => tree.unmount()); animationBoundary.reducedMotion = false; }
  assert.equal(animationBoundary.pending(), 0); assert.equal(splashBoundary.listeners.size, 0);
});

test("splash animation: missing image load callback cannot hold a ready application indefinitely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  animationBoundary.calls.length = 0; let completed = 0; let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(LaunchAnimation, { start: true, ready: true, onComplete: () => { completed++; } })); });
    assert.equal(animationBoundary.calls.length, 0);
    await act(async () => { t.mock.timers.tick(250); animationBoundary.flush(); });
    assert.equal(animationBoundary.calls[0]!.duration, 2000);
    await act(async () => { animationBoundary.finish(); animationBoundary.flush(); });
    await act(async () => { animationBoundary.finish(); animationBoundary.flush(); });
    assert.equal(completed, 1);
  } finally { if (tree) await act(async () => tree.unmount()); t.mock.timers.reset(); }
});
