import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { act, createElement, useEffect } from "react";
import TestRenderer from "react-test-renderer";
import { BootCoordinator, BootGateError } from "../src/app/bootstrap/BootCoordinator.ts";
import type { ApplicationRuntime } from "../src/app/composition/createServices.ts";
import { splashBoundary, LaunchAnimation, GestureHandlerRootView, PrototypeShell, AutomaticBackupHost, Pressable } from "./support/splash-native-boundary.ts";

const boundary = new URL("./support/splash-native-boundary.ts", import.meta.url).href;
const native = new Set(["react-native", "react-native-safe-area-context", "react-native-gesture-handler", "expo-font", "expo-splash-screen"]);
const replacements = ["/LaunchAnimation.tsx", "/PrototypeShell.tsx", "/AutomaticBackupHost.tsx", "/fontAssets.ts", "/createDevRuntime.ts", "/createProductionRuntime.ts"];
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (native.has(specifier) || replacements.some((name) => specifier.endsWith(name))) return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, fileName: fileURLToPath(url),
    }).outputText };
  },
});
const { default: App } = await import("../App.tsx");
const { ApplicationBootGate } = await import("../src/app/bootstrap/ApplicationBootGate.tsx");
const { NotificationsHost } = await import("../src/app/navigation/NotificationsHost.tsx");
hooks.deregister();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const previousDev = Object.getOwnPropertyDescriptor(globalThis, "__DEV__");
Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: false });
const oldRequest = globalThis.requestAnimationFrame;
const oldCancel = globalThis.cancelAnimationFrame;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = (id) => { if (id != null) frames.delete(id); };
const flushFrames = () => { const current = [...frames.values()]; frames.clear(); for (const callback of current) callback(0); };
after(() => {
  globalThis.requestAnimationFrame = oldRequest; globalThis.cancelAnimationFrame = oldCancel;
  if (previousDev) Object.defineProperty(globalThis, "__DEV__", previousDev); else Reflect.deleteProperty(globalThis, "__DEV__");
});

function runtime(openDatabase: () => Promise<void> = async () => {}) {
  const boot = new BootCoordinator({ fallbackThemeId: "warm-sand", prepareWorkspace: async () => ({ id: "synthetic" }),
    openDatabase, loadThemePreference: async () => ({ themeId: null, accentId: null }) });
  const maintenanceListeners = new Set<(state: string) => void>();
  return { boot, maintenanceListeners, value: { boot, development: false,
    services: { restTimers: {}, trainingExecution: {}, trainingPlans: {} },
    maintenance: { state: "ACTIVE", subscribe: (listener: (state: string) => void) => {
      maintenanceListeners.add(listener); listener("ACTIVE"); return () => { maintenanceListeners.delete(listener); };
    } }, restoreActions: { state: { available: false } }, automaticBackup: {}, manualBackup: {}, trainingTransfer: {},
  } as unknown as ApplicationRuntime };
}

test("splash integration: first React layout releases native splash; fonts and DB run concurrently; navigation gates the fade", async () => {
  const world = runtime(); splashBoundary.runtime = world.value; splashBoundary.fonts = [false, null];
  const hiddenBefore = splashBoundary.hidden;
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(App)); });
    assert.equal(world.boot.state.attempt, 0);
    assert.equal(splashBoundary.hidden, hiddenBefore);
    assert.ok(splashBoundary.prevented > 0);
    const launch = () => tree.root.findByType(LaunchAnimation);
    assert.equal(launch().props.start, false);
    await act(async () => { tree.root.findByType(GestureHandlerRootView).props.onLayout(); });
    assert.equal(splashBoundary.hidden, hiddenBefore, "layout waits for the frame boundary");
    await act(async () => { flushFrames(); });
    assert.equal(splashBoundary.hidden, hiddenBefore + 1);
    assert.deepEqual(splashBoundary.options, { duration: 0, fade: false });
    assert.equal(world.boot.state.kind, "APP_READY", "database initialization is independent of font loading");
    assert.equal(launch().props.start, true); assert.equal(launch().props.ready, false);
    assert.equal(tree.root.findAllByType(PrototypeShell).length, 0);
    splashBoundary.fonts = [true, null];
    await act(async () => { tree.update(createElement(App)); });
    assert.equal(launch().props.ready, false, "APP_READY alone cannot uncover an unmounted navigator");
    await act(async () => { tree.root.findByType(PrototypeShell).props.onReady(); });
    assert.equal(launch().props.ready, false);
    await act(async () => { flushFrames(); });
    assert.equal(launch().props.ready, true);
    assert.equal(tree.root.findAllByType(AutomaticBackupHost).length, 0);
    await act(async () => { launch().props.onComplete(); });
    assert.equal(tree.root.findAllByType(LaunchAnimation).length, 0);
    assert.equal(tree.root.findByType(PrototypeShell).props.launchVisible, false);
    assert.equal(tree.root.findAllByType(AutomaticBackupHost).length, 1);
  } finally { if (tree) await act(async () => tree.unmount()); }
  assert.equal(world.maintenanceListeners.size, 0); assert.equal(frames.size, 0);
});

test("splash integration: DB failure exposes retry and a successful retry never plays another intro", async () => {
  let fail = true;
  const world = runtime(async () => { if (fail) throw new BootGateError("MIGRATION_INCOMPLETE"); });
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(ApplicationBootGate, { ...world.value, fontsReady: true, firstFrameReady: true })); });
    assert.equal(world.boot.state.kind, "BOOT_FAILED");
    assert.equal(tree.root.findAllByType(LaunchAnimation).length, 0);
    fail = false;
    await act(async () => { tree.root.findByType(Pressable).props.onPress(); });
    assert.equal(world.boot.state.kind, "APP_READY");
    assert.equal(tree.root.findAllByType(LaunchAnimation).length, 0);
    assert.equal(tree.root.findByType(PrototypeShell).props.launchVisible, false);
  } finally { if (tree) await act(async () => tree.unmount()); }
  assert.equal(world.maintenanceListeners.size, 0);
});

test("splash integration: long database initialization remains covered and unmount cancels a queued navigation frame", async () => {
  let release = () => {};
  const world = runtime(() => new Promise<void>((resolve) => { release = resolve; }));
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(ApplicationBootGate, { ...world.value, fontsReady: true, firstFrameReady: true })); });
    assert.equal(tree.root.findByType(LaunchAnimation).props.ready, false);
    assert.equal(tree.root.findAllByType(PrototypeShell).length, 0);
    await act(async () => { release(); });
    assert.equal(tree.root.findByType(LaunchAnimation).props.ready, false);
    await act(async () => { tree.root.findByType(PrototypeShell).props.onReady(); });
    assert.equal(frames.size, 1);
  } finally { if (tree) await act(async () => tree.unmount()); }
  assert.equal(frames.size, 0);
});

test("splash integration: notification reconciliation waits for exit without remounting navigation children", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let runs = 0; let badgeReads = 0; let childMounts = 0;
  const center = { unreadCount: async () => { badgeReads++; return 3; }, subscribeCommittedChanges: () => () => {} };
  const calendar = { subscribeCommittedChanges: () => () => {} };
  const sync = { run: async () => { runs++; } };
  function Child() { useEffect(() => { childMounts++; }, []); return null; }
  const element = (enabled: boolean) => createElement(NotificationsHost, { enabled,
    center: center as unknown as Parameters<typeof NotificationsHost>[0]["center"], calendar,
    sync: sync as unknown as Parameters<typeof NotificationsHost>[0]["sync"], children: createElement(Child) });
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(element(false)); });
    assert.equal(runs, 0); assert.equal(badgeReads, 0);
    await act(async () => { tree.update(element(true)); });
    assert.equal(runs, 1); assert.equal(badgeReads, 1); assert.equal(childMounts, 1);
    await act(async () => { t.mock.timers.tick(60_000); }); assert.equal(runs, 2);
  } finally { if (tree) await act(async () => tree.unmount()); }
  assert.equal(splashBoundary.listeners.size, 0);
  await act(async () => { t.mock.timers.tick(120_000); }); assert.equal(runs, 2);
});
