import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { act, createElement, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { RestTimerService } from "../src/features/training/execution/application/RestTimerService.ts";
import type { RestTimer, RestTimerStart } from "../src/features/training/execution/domain/RestTimerRules.ts";
import type { RestTimersPort } from "../src/features/training/execution/domain/RestTimerPorts.ts";
import { nativePanelBoundary, FocusProvider } from "./support/native-panel-boundary.ts";

// Node исполняет TSX через тот же TypeScript, заменяется только внешняя граница устройства.
const boundary = new URL("./support/native-panel-boundary.ts", import.meta.url).href;
const nativeModules = new Set(["react-native", "react-native-reanimated", "react-native-gesture-handler", "react-native-worklets", "lucide-react-native", "expo-haptics", "@react-navigation/native"]);
const hooks = registerHooks({
  resolve(specifier, context, next) { return nativeModules.has(specifier) ? { url: boundary, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, fileName: fileURLToPath(url),
    }).outputText };
  },
});
const { RestTimerDock } = await import("../src/features/training/execution/presentation/RestTimerDock.tsx");
const { PrototypeThemeProvider } = await import("../src/shared/ui/theme/PrototypeThemeProvider.tsx");
const { BottomPanelProvider, useBottomPanelContent, usePublishBottomPanel } = await import("../src/shared/ui/components/BottomPanel.tsx");
hooks.deregister();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const start: RestTimerStart = { clientId: "synthetic-a", clientName: "Synthetic A", exerciseKey: "row", exerciseName: "Row", durationSec: 60,
  programId: "p1", weekIndex: 1, plannedWorkoutId: "w1" };

test("REST-DOCK-2 UI: один контроллер, свёрнутый режим сохраняется при запуске/окончании и переходе; очистка подписок", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const stored = new Map<string, RestTimer>();
  let id = 0; let subscriptions = 0; let avatarReads = 0; let renders = 0;
  const service = new RestTimerService({ listTimers: async () => [...stored.values()],
    putTimer: async (timer, replaced) => { for (const key of replaced) stored.delete(key); stored.set(timer.id, timer); },
    removeTimer: async (key) => { stored.delete(key); } }, { schedule: async () => null, cancel: async () => undefined }, Date.now, () => `t${++id}`);
  const port = new Proxy(service, { get(target, key) {
    if (key === "subscribe") return (listener: () => void) => {
      subscriptions += 1; const off = target.subscribe(listener);
      return () => { subscriptions -= 1; off(); };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }) as RestTimersPort;
  await service.start(start); await service.idle();
  const loadAvatars = async () => { avatarReads += 1; return new Map<string, string | null>(); };
  const panel = () => createElement(PrototypeThemeProvider, null, createElement(RestTimerDock, {
    timers: port, onOpen: () => undefined, loadAvatars,
    renderContainer: (area: ReactNode, hasTimers: boolean) => { renders += 1; return createElement("Panel", { hasTimers }, area); },
  }));
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(panel()); });
    assert.equal(subscriptions, 1); assert.equal(nativePanelBoundary.listenerCount(), 1);
    const settledRenders = renders;
    await act(async () => { t.mock.timers.tick(1000); });
    assert.equal(renders, settledRenders, "секундный ход времени до deadline не перерисовывает React-панель");
    const buttons = () => tree.root.findAll((node) => typeof node.type === "string" && String(node.type) === "Pressable");
    const click = async (label: string) => act(async () => { buttons().find((node) => node.props.accessibilityLabel === label)!.props.onPress(); });
    await click("Свернуть таймеры отдыха");
    await act(async () => { await service.start({ ...start, clientId: "synthetic-b", exerciseKey: "press", durationSec: 90 }); await service.idle(); });
    assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Развернуть таймеры отдыха"));
    await act(async () => { tree.update(panel()); });
    assert.equal(subscriptions, 1, "смена callback оболочки не создаёт новую подписку");
    const reads = avatarReads;
    await act(async () => { t.mock.timers.tick(60_000); });
    assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Развернуть таймеры отдыха"));
    assert.ok(tree.root.findAll((node) => typeof node.type === "string" && String(node.type) === "Text").some((node) => node.props.children === "Отдых окончен"));
    assert.equal(avatarReads, reads, "окончание не перечитывает аватары");
    await act(async () => { t.mock.timers.tick(4000); await service.idle(); });
    assert.equal(service.list().length, 1);
    await act(async () => { await service.skip(service.list()[0]!.id); });
    assert.equal(tree.root.find((node) => String(node.type) === "Panel").props.hasTimers, false);
    await act(async () => { await service.start(start); await service.idle(); });
    assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Развернуть таймеры отдыха"), "выбор сохраняется после пустого списка");
  } finally {
    if (tree) await act(async () => tree.unmount());
    assert.equal(subscriptions, 0); assert.equal(nativePanelBoundary.listenerCount(), 0);
    t.mock.timers.reset();
  }
});

test("REST-DOCK-2 UI: активная регистрация панели меняется по фокусу и переживает очистку прежнего владельца", async () => {
  const tokens = { navigation: "test" } as Parameters<typeof usePublishBottomPanel>[1]["tokens"];
  function Registration({ owner, title }: { owner: string; title: string }) {
    usePublishBottomPanel(owner, { navigation: title, participants: null, tokens });
    return null;
  }
  function Outlet() { return createElement("Outlet", { value: useBottomPanelContent()?.navigation ?? null }); }
  const scene = (workspace: boolean) => createElement(BottomPanelProvider, null,
    createElement(FocusProvider, { value: !workspace }, createElement(Registration, { owner: "root", title: "clients" })),
    createElement(FocusProvider, { value: workspace }, createElement(Registration, { owner: "workspace", title: "training" })),
    createElement(Outlet));
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(scene(false)); });
    assert.equal(tree.root.find((node) => String(node.type) === "Outlet").props.value, "clients");
    await act(async () => { tree.update(scene(true)); });
    assert.equal(tree.root.find((node) => String(node.type) === "Outlet").props.value, "training");
    await act(async () => { tree.update(scene(false)); });
    assert.equal(tree.root.find((node) => String(node.type) === "Outlet").props.value, "clients");
  } finally { if (tree) await act(async () => tree.unmount()); }
});
