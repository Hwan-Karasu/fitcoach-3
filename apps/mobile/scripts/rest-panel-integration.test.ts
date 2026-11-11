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
    const texts = () => tree.root.findAll((node) => String(node.type) === "Text").map((node) => node.props.children);
    assert.ok(texts().includes("1:00"));
    assert.equal(tree.root.findAll((node) => String(node.type) === "TextInput").length, 0, "цифры — обычный Text");
    await act(async () => { t.mock.timers.tick(1000); });
    assert.ok(texts().includes("0:59"));
    assert.equal(renders, settledRenders, "секундный ход времени до deadline не перерисовывает React-панель");
    // React Native releases synthetic events after dispatch. State updaters may run later.
    // Two queued measurements force a deferred reducer, rather than only React's eager path.
    await act(async () => {
      const area = tree.root.find((node) => String(node.type) === "View" && node.props.testID === "rest-panel-area");
      const measurement = area.find((node) => String(node.type) === "View" && node.props.testID === "rest-panel-width");
      for (const width of [310, 312]) {
        const event: { nativeEvent: { layout: { width: number; height: number } } | null } = { nativeEvent: { layout: { width, height: 180 } } };
        measurement.props.onLayout(event);
        event.nativeEvent = null;
      }
    });
    const buttons = () => tree.root.findAll((node) => typeof node.type === "string" && String(node.type) === "Pressable");
    const click = async (label: string) => act(async () => { buttons().find((node) => node.props.accessibilityLabel === label)!.props.onPress(); });
    const deadline = service.list()[0]!.endAt;
    // Высоты слоёв, как их сообщил бы layout: развёрнутый 130 dp, свёрнутый 44 dp, ход панели 86 dp.
    await act(async () => {
      for (const [testID, height] of [["rest-panel-expanded", 130], ["rest-panel-collapsed", 44]] as const) {
        tree.root.find((node) => String(node.type) === "View" && node.props.testID === testID).props.onLayout({ nativeEvent: { layout: { width: 312, height } } });
      }
    });
    // Жест целиком, как у RNGH: начало → движение → конец.
    const swipe = async (translationY: number) => act(async () => {
      const gesture = tree.root.find((node) => typeof node.type === "string" && String(node.type) === "GestureDetector").props.gesture;
      gesture.begin(); gesture.update({ translationY, velocityY: 0 }); gesture.end({ translationY, velocityY: 0 });
    });
    for (let index = 0; index < 30; index++) {
      await swipe(40);
      assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Развернуть таймеры отдыха"));
      await swipe(-40);
      assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Свернуть таймеры отдыха"));
    }
    assert.equal(service.list()[0]!.endAt, deadline, "gestures never restart or rewrite the timer");
    assert.equal(subscriptions, 1, "gestures keep the same controller subscription");
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

test("REST-DOCK-51-RCA UI: delayed ticks, pause, background, return route and finish survive view replacement", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const stored = new Map<string, RestTimer>();
  let id = 0; let writes = 0; let renders = 0; let opened: RestTimer | undefined;
  const service = new RestTimerService({ listTimers: async () => [...stored.values()],
    putTimer: async (timer, replaced) => { writes++; for (const key of replaced) stored.delete(key); stored.set(timer.id, timer); },
    removeTimer: async (key) => { stored.delete(key); } }, { schedule: async () => null, cancel: async () => undefined }, Date.now, () => `t${++id}`);
  await service.start(start); await service.idle();
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(PrototypeThemeProvider, null, createElement(RestTimerDock, {
      timers: service, onOpen: (timer: RestTimer) => { opened = timer; }, loadAvatars: async () => new Map(),
      renderContainer: (area: ReactNode) => { renders++; return createElement("Panel", null, area); },
    }))); });
    const texts = () => tree.root.findAll((node) => String(node.type) === "Text").map((node) => node.props.children);
    const click = async (label: string) => act(async () => {
      tree.root.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === label).props.onPress();
      await service.idle();
    });
    const action = (label: string) => click(`${start.clientName}, ${start.exerciseName}: ${label}`);
    const initialRenders = renders;
    // A blocked JS thread must catch up from the deadline, not subtract one on its next callback.
    await act(async () => { t.mock.timers.setTime(1_010_000); t.mock.timers.tick(1000); });
    assert.ok(texts().includes("0:49"));
    assert.equal(renders, initialRenders);
    assert.equal(writes, 1, "ticks do not persist or mutate training state");
    await action("Пауза");
    await act(async () => { t.mock.timers.tick(8000); });
    assert.ok(texts().includes("0:49"));
    await action("Увеличить отдых на 15 секунд");
    assert.ok(texts().includes("1:04"));
    await action("Продолжить отдых");
    const deadline = service.list()[0]!.endAt;
    await click(`${start.clientName}, ${start.exerciseName}. Идёт отдых. Открыть тренировку`);
    assert.deepEqual([opened?.clientId, opened?.programId, opened?.weekIndex, opened?.plannedWorkoutId, opened?.exerciseKey],
      [start.clientId, start.programId, start.weekIndex, start.plannedWorkoutId, start.exerciseKey]);
    await click("Свернуть таймеры отдыха");
    await act(async () => { nativePanelBoundary.appState("background"); });
    const backgroundRenders = renders; const signals = nativePanelBoundary.signals;
    await act(async () => { t.mock.timers.tick(20_000); });
    assert.equal(renders, backgroundRenders);
    await act(async () => { nativePanelBoundary.appState("active"); });
    assert.ok(texts().includes("0:44"), "foreground immediately catches up");
    assert.equal(service.list()[0]!.endAt, deadline);
    await act(async () => { nativePanelBoundary.appState("background"); });
    await act(async () => { t.mock.timers.tick(50_000); });
    assert.equal(nativePanelBoundary.signals, signals, "background JS does not duplicate the system signal");
    await act(async () => { nativePanelBoundary.appState("active"); });
    assert.ok(texts().includes("Отдых окончен"));
    assert.equal(nativePanelBoundary.signals, signals + 1);
    await click("Развернуть таймеры отдыха");
    assert.equal(nativePanelBoundary.signals, signals + 1, "remounting clocks never finishes twice");
    await action("Увеличить отдых на 15 секунд");
    await act(async () => { t.mock.timers.tick(4000); await service.idle(); });
    assert.equal(service.list().length, 1, "old auto-hide cannot dismiss an extended timer");
    assert.ok(texts().includes("0:11"));
    await action("Пропустить отдых");
    assert.equal(service.list().length, 0);
  } finally {
    if (tree) await act(async () => tree.unmount());
    nativePanelBoundary.appState("active");
    assert.equal(nativePanelBoundary.listenerCount(), 0);
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

test("UIX-FIT-10: в свёрнутой строке имя владельца ведёт к упражнению и не разворачивает панель; ручка разворачивает", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const stored = new Map<string, RestTimer>();
  let id = 0;
  const service = new RestTimerService({ listTimers: async () => [...stored.values()],
    putTimer: async (timer, replaced) => { for (const key of replaced) stored.delete(key); stored.set(timer.id, timer); },
    removeTimer: async (key) => { stored.delete(key); } }, { schedule: async () => null, cancel: async () => undefined }, Date.now, () => `t${++id}`);
  await service.start(start); await service.idle();
  const opened: string[] = [];
  const panel = () => createElement(PrototypeThemeProvider, null, createElement(RestTimerDock, {
    timers: service as RestTimersPort, onOpen: (timer: RestTimer) => { opened.push(timer.exerciseKey); },
    loadAvatars: async () => new Map<string, string | null>(),
    renderContainer: (area: ReactNode) => createElement("Panel", null, area),
  }));
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(panel()); });
    const buttons = () => tree.root.findAll((node) => typeof node.type === "string" && String(node.type) === "Pressable");
    const press = async (label: string) => act(async () => { buttons().find((node) => node.props.accessibilityLabel === label)!.props.onPress(); });
    await press("Свернуть таймеры отдыха");
    assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Развернуть таймеры отдыха"), "панель свёрнута");
    // Имя клиента в свёрнутой строке: «Synthetic A, Row. Открыть упражнение».
    await press("Synthetic A, Row. Открыть упражнение");
    assert.deepEqual(opened, ["row"], "переход к упражнению этого таймера");
    assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Развернуть таймеры отдыха"), "панель осталась свёрнутой");
    // Время в строке разворачивает (как раньше), ручка — тоже.
    await press("Synthetic A, Row. Развернуть таймеры");
    assert.ok(buttons().some((node) => node.props.accessibilityLabel === "Свернуть таймеры отдыха"), "время разворачивает панель");
    assert.deepEqual(opened, ["row"], "разворачивание не открывает упражнение");
  } finally { if (tree) await act(async () => tree.unmount()); t.mock.timers.reset(); }
});
