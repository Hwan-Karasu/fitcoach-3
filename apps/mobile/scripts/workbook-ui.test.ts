import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { createElement, useEffect, type ComponentType, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import type { PickedWorkbook } from "../src/features/import/domain/WorkbookFilesPort.ts";
import { builderWorkbookImport } from "../src/features/import/domain/BuilderWorkbookImport.ts";
import { startWorkbookReview } from "../src/features/import/domain/WorkbookReviewSession.ts";
import { prepareWholeWorkbook } from "../src/features/import/domain/WholeWorkbookImport.ts";
import { aiWorkbookRows } from "../src/features/import/domain/AiWorkbookTemplate.ts";
import { trainingTransferFixture } from "../../../scripts/training-transfer-fixture.ts";
import type { MesocycleBuilderDraft } from "../src/features/training/plans/domain/PeriodizedDraft.ts";
import type { BuilderWorkbookSaveRequest } from "../src/shared/training-transfer/BuilderWorkbook.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Props = Record<string, unknown>;
const control = (name: string) => (props: Props) => createElement(name, props, props.children as ReactNode);
const ui = Object.fromEntries(["AppButton", "AppIconButton", "ConfirmDialog", "FloatingActionButton", "ListSectionHeader", "InlineNotice", "LoadingState", "ScreenHeader", "SegmentedControl", "TextField", "SelectionChip", "StickyEditorFooter", "TrainingEditorLayout", "DateField", "DropdownMenu"].map((name) => [name, control(name)]));
let idSequence = 0;
/** Сколько раз смонтирован редактор недели конструктора (CYCLE-STRIP-3: при переключении цикла не растёт). */
let editorMounts = 0;
const cache = new Map<string, Record<string, unknown>>();
const nav = { actions: [] as unknown[], remove: (event: unknown): void => { void event; }, dispatch(action: unknown) { this.actions.push(action); } };
function loadScreen(file: string): Record<string, unknown> {
  if (cache.has(file)) return cache.get(file)!;
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} }; const nativeRequire = createRequire(file);
  const imports = (specifier: string): unknown => {
    if (specifier === "react/jsx-runtime") {
      const runtime = nativeRequire(specifier) as { jsx: (type: unknown, props: Props, key?: unknown) => ReactNode; jsxs: (type: unknown, props: Props, key?: unknown) => ReactNode };
      const checked = (name: "jsx" | "jsxs") => (type: unknown, props: Props, key?: unknown) => { assert.ok(type, `${file}: missing component with props ${Object.keys(props).join(",")}`); return runtime[name](type, props, key); };
      return { ...runtime, jsx: checked("jsx"), jsxs: checked("jsxs") };
    }
    if (specifier === "react-native-reanimated") { const animated: Props = { ScrollView: control("AnimatedScrollView"), useAnimatedRef: () => ({ current: null }) }; animated.default = animated; return animated; }
    if (specifier === "react-native-sortables") return { default: {} };
    if (specifier === "lucide-react-native") return new Proxy({}, { get: () => control("Icon") });
    if (specifier === "@react-navigation/native") return { useNavigation: () => nav, useIsFocused: () => true, usePreventRemove: (_enabled: boolean, callback: (e: unknown) => void) => { nav.remove = callback; } };
    if (specifier.endsWith("features/training/public.ts")) return { ExerciseCardShell: (p: Props) => createElement("ExerciseCard", p, p.subtitle as ReactNode, p.actions as ReactNode, p.children as ReactNode),
      CYCLE_TYPES: [{ id: "hypertrophy", label: "Гипертрофия", reps: { min: 8, max: 12 } }, { id: "custom", label: "Свой", reps: null }] };
    if (specifier === "react-native") return { Modal: (p: Props) => p.visible ? createElement("NativeModal", p, p.children as ReactNode) : null,
      FlatList: (p: Props) => createElement("FlatList", null, p.ListHeaderComponent as ReactNode,
        ...(p.data as unknown[]).map((item, index) => (p.renderItem as (row: { item: unknown; index: number }) => ReactNode)({ item, index })), p.ListFooterComponent as ReactNode),
      ...Object.fromEntries(["Text", "View", "ScrollView", "Pressable"].map((n) => [n, control(n)])), StyleSheet: { create: (s: unknown) => s }, Keyboard: { addListener: () => ({ remove: () => undefined }), dismiss: () => undefined }, Platform: { OS: "android", select: (p: Props) => p.android ?? p.default } };
    if (specifier === "react-native-safe-area-context") return { SafeAreaView: control("SafeAreaView") };
    if (specifier.endsWith("ui/components/public.ts")) return ui;
    if (specifier.endsWith("PrototypeThemeProvider.tsx")) return { usePrototypeTheme: () => ({ palette: { tokens: new Proxy({}, { get: () => "#445566" }) } }) };
    if (specifier === "./WorkoutsEditor.tsx") return { WorkoutsEditor: (p: Props) => { useEffect(() => { editorMounts += 1; }, []); return createElement("Editor", p, p.children as ReactNode); }, newPlanId: () => `draft:${++idSequence}` };
    if (specifier === "./usePickedExercise.ts") return { usePickedExercise: () => undefined };
    if (specifier === "./useRecoveryDraftSave.ts") return loadScreen(resolve(file, "..", specifier));
    if (["./ScopeMenu.tsx", "./ParticipantAssignments.tsx", "./PlacementRows.tsx"].includes(specifier)) return { [specifier.slice(2, -4)]: control("BuilderPanel") };
    if (specifier.endsWith("features/exercises/public.ts")) return { displayNameOf: (entry: { definition: { name: string } }) => entry.definition.name,
      ExerciseLibraryScreen: control("Catalogue"), CustomExerciseEditorScreen: control("CreateExercise") };
    if (specifier === "./TrainingTransferReviewScreen.tsx") return { TrainingTransferReviewScreen: (p: Props) => createElement("Review", p,
      p.controls as ReactNode, createElement("AppButton", { label: p.actionLabel, disabled: p.busy || p.blocked, onPress: p.onConfirm })) };
    if (specifier === "./WorkbookColumnSettings.tsx") return { WorkbookColumnSettings: control("Columns") };
    if (specifier.endsWith(".tsx")) return loadScreen(resolve(file, "..", specifier));
    return nativeRequire(specifier);
  };
  new Function("require", "module", "exports", output)(imports, module, module.exports);
  cache.set(file, module.exports); return module.exports;
}
const Importer = loadScreen(resolve(import.meta.dirname, "../src/app/navigation/BuilderExcelImport.tsx")).BuilderExcelImport as ComponentType<Props>;
const picked: PickedWorkbook = { kind: "TABLES", sourceId: "ui-workbook", filename: "Книга.xlsx",
  tables: [1, 2, 3].map((n) => ({ name: `Цикл ${n}`, rows: [["Упражнение", "План повторений"], ["Жим", "8-10"]] })) };
const catalogue = [{ definition: { id: "sys:press", name: "Жим" }, overlay: { hidden: false } }];
const nodes = (r: ReactTestRenderer, type: string) => r.root.findAll((n) => n.type === type);
async function press(r: ReactTestRenderer, label: string): Promise<void> {
  const button = nodes(r, "AppButton").find((n) => n.props.label === label); assert.ok(button, label); assert.ok(!button.props.disabled, `${label} must be enabled`);
  await act(async () => { button.props.onPress(); await new Promise((resolve) => setTimeout(resolve, 10)); });
}
async function until(r: ReactTestRenderer, test: () => boolean): Promise<void> {
  for (let n = 0; n < 100 && !test(); n++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.ok(test(), nodes(r, "AppButton").map((n) => String(n.props.label)).join(", "));
}

test("I07 ten consecutive imports with and without history keep a single modal and save all three selected sheets", async () => {
  const saved: number[] = []; let withHistory = true;
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Importer, { files: { pick: async (options: { onReading: () => Promise<void> }) => { await options.onReading(); return picked; } },
    exercises: { list: async () => catalogue }, memory: { getExerciseMatches: async () => withHistory ? [{ sourceName: "Жим", targetId: "sys:press", available: true }] : [] },
    target: { kind: "PROGRAM", save: async (value: { programs: { mesocycles: unknown[] }[] }) => saved.push(value.programs[0]!.mesocycles.length) } })); });
  for (let n = 0; n < 10; n++) {
    withHistory = n % 2 === 0; await press(renderer, "Импортировать из Excel");
    await until(renderer, () => withHistory ? nodes(renderer, "AppButton").some((n) => n.props.label === "Применить выбранные") : nodes(renderer, "Review").length > 0);
    assert.equal(nodes(renderer, "NativeModal").length, 1, "history uses the import host, not a second native window");
    if (withHistory) await press(renderer, "Применить выбранные");
    await until(renderer, () => nodes(renderer, "AppButton").some((n) => n.props.label === "Продолжить импорт выбранных листов" && !n.props.disabled));
    await press(renderer, "Продолжить импорт выбранных листов"); await press(renderer, "Импортировать выбранные листы");
    await until(renderer, () => nodes(renderer, "NativeModal").length === 0);
  }
  assert.deepEqual(saved, Array(10).fill(3)); await act(async () => renderer.unmount());
});

test("I07 active unselected tab does not constrain checked sheets, and failed writes can be retried", async () => {
  let calls = 0; const saved: string[][] = []; let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Importer, { files: { pick: async () => picked }, exercises: { list: async () => catalogue },
    target: { kind: "PROGRAM", save: async (value: { programs: { mesocycles: { title: string }[] }[] }) => {
      calls++; if (calls === 1) throw new Error("WRITE_FAILED"); saved.push(value.programs[0]!.mesocycles.map((c) => c.title));
    } } })); });
  await press(renderer, "Импортировать из Excel"); await until(renderer, () => nodes(renderer, "AppButton").some((n) => n.props.label === "Листы для импорта: 3 из 3" && !n.props.disabled));
  await press(renderer, "Листы для импорта: 3 из 3"); await press(renderer, "Снять выбор");
  const second = nodes(renderer, "Pressable")[1]!;
  await act(async () => second.props.onPress());
  await press(renderer, "Готово");
  const tabs = nodes(renderer, "SegmentedControl")[0]!; await act(async () => tabs.props.onSelect("0"));
  await press(renderer, "Продолжить импорт выбранных листов"); await press(renderer, "Импортировать выбранные листы");
  assert.equal(nodes(renderer, "NativeModal").length, 1); assert.ok(nodes(renderer, "InlineNotice").some((n) => n.props.children === "WRITE_FAILED"));
  await press(renderer, "Импортировать выбранные листы"); assert.deepEqual(saved, [["Цикл 2"]]);
  await act(async () => renderer.unmount());
});

test("I07 cancellation and late history responses cannot lock or resurrect a closed import", async () => {
  let resolveHistory!: (matches: unknown[]) => void; let attempt = 0; let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Importer, { files: { pick: async () => ++attempt === 1 ? null : picked }, exercises: { list: async () => catalogue },
    memory: { getExerciseMatches: () => new Promise((resolve) => { resolveHistory = resolve; }) }, target: { kind: "PROGRAM", save: async () => undefined } })); });
  await press(renderer, "Импортировать из Excel"); await until(renderer, () => !nodes(renderer, "AppButton")[0]!.props.disabled);
  await press(renderer, "Импортировать из Excel"); await until(renderer, () => typeof resolveHistory === "function");
  await act(async () => nodes(renderer, "ScreenHeader")[0]!.props.onBack());
  await act(async () => resolveHistory([{ sourceName: "Жим", targetId: "sys:press", available: true }]));
  assert.equal(nodes(renderer, "NativeModal").length, 0); assert.ok(!nodes(renderer, "AppButton")[0]!.props.disabled);
  await act(async () => renderer.unmount());
});

test("I07 constructor back offers save/discard/continue and does not publish a draft on cancellation", async () => {
  const useDraft = loadScreen(resolve(import.meta.dirname, "../src/features/training/plans/presentation/useRecoveryDraftSave.ts")).useRecoveryDraftSave as
    (write: (value: number) => Promise<void>, options: { hasDraft: boolean; remove: () => Promise<void> }) => {
      schedule: (value: number) => void; exitVisible: boolean; cancelExit: () => void; saveAndLeave: () => void; discardAndLeave: () => void; exitBusy: boolean;
    };
  let disk: number | null = null; let state!: ReturnType<typeof useDraft>; let renderer!: ReactTestRenderer;
  function Probe() { state = useDraft(async (value) => { disk = value; }, { hasDraft: true, remove: async () => { disk = null; } }); return null; }
  nav.actions = []; await act(async () => { renderer = create(createElement(Probe)); });
  await act(async () => { state.schedule(3); nav.remove({ data: { action: { type: "GO_BACK" } } }); });
  assert.equal(state.exitVisible, true); assert.equal(nav.actions.length, 0);
  await act(async () => state.cancelExit()); assert.equal(state.exitVisible, false); assert.equal(nav.actions.length, 0);
  await act(async () => nav.remove({ data: { action: { type: "GO_BACK" } } }));
  await act(async () => { state.saveAndLeave(); await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.equal(disk, 3); assert.equal(nav.actions.length, 1); await act(async () => renderer.unmount());
  nav.actions = []; await act(async () => { renderer = create(createElement(Probe)); });
  await act(async () => { state.schedule(9); nav.remove({ data: { action: { type: "GO_BACK" } } }); });
  await act(async () => { state.discardAndLeave(); await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.equal(disk, null); assert.equal(nav.actions.length, 1); await act(async () => renderer.unmount()); assert.equal(disk, null);
});

test("I07 creation chooser offers both saved drafts and deletes only the selected type after confirmation", async () => {
  const Chooser = loadScreen(resolve(import.meta.dirname, "../src/features/training/plans/presentation/ProgramLibraryScreen.tsx")).ProgramModeChooserScreen as ComponentType<Props>;
  const chosen: string[] = []; const deleted: string[] = []; let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Chooser, { clientId: "client", repository: {
    getBuilderDraft: async () => ({ draft: { title: "Простой черновик" } }), getMesocycleBuilderDraft: async () => ({ programTitle: "Книга черновик" }),
    clearBuilderDraft: async (_id: string, key: string) => deleted.push(key), clearMesocycleBuilderDraft: async () => deleted.push("new:PERIODIZED") },
    onChoose: (kind: string) => chosen.push(kind) })); });
  await until(renderer, () => nodes(renderer, "AppButton").some((n) => String(n.props.label).startsWith("Продолжить: Книга")));
  const continuing = nodes(renderer, "AppButton").find((n) => String(n.props.label).startsWith("Продолжить: Книга"))!;
  await act(async () => continuing.props.onPress()); assert.deepEqual(chosen, ["PERIODIZED"]); assert.deepEqual(deleted, []);
  await press(renderer, "Начать новую программу");
  const simple = nodes(renderer, "Pressable").find((n) => String(n.props.accessibilityLabel).startsWith("Простая программа"))!;
  assert.ok(simple); await act(async () => simple.props.onPress());
  // Confirmation itself is an existing component; intercept it as a host so no native modules are needed.
  const dialog = renderer.root.findAll((n) => typeof n.type === "function" && n.props.title === "Удалить прежний черновик?")[0];
  assert.ok(dialog); assert.equal(dialog.props.visible, true); assert.deepEqual(deleted, []);
  await act(async () => { dialog.props.onCancel(); }); assert.deepEqual(deleted, []);
  await act(async () => simple.props.onPress());
  const confirmed = renderer.root.findAll((n) => typeof n.type === "function" && n.props.title === "Удалить прежний черновик?")[0]!;
  await act(async () => { confirmed.props.onConfirm(); await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.deepEqual(deleted, ["new:SIMPLE"]); assert.deepEqual(chosen, ["PERIODIZED", "SIMPLE"]); await act(async () => renderer.unmount());
});

test("BUILDER-FACTS конструктор показывает факты импортированного цикла, правка уходит в сохранение, отпечаток листа прежний", async () => {
  const Builder = loadScreen(resolve(import.meta.dirname, "../src/features/training/plans/presentation/PeriodizedBuilderScreen.tsx")).PeriodizedBuilderScreen as ComponentType<Props>;
  // Плоская таблица «строка = подход» (формат образца для ИИ): одна тренировка, один день, два подхода с фактами 8×60 и 6×70.
  const [header] = aiWorkbookRows();
  const flat: PickedWorkbook = { kind: "TABLES", sourceId: "flat-fixture", tables: [{ name: "Тренировки", rows: [header!,
    [1, "ноги", "Жим", 1, "6-8", 60, 8, 60, "", "", "20.10.2026"], [1, "ноги", "Жим", 1, "6-8", 70, 6, 70, "", "", "20.10.2026"]] }] };
  const incoming = builderWorkbookImport(prepareWholeWorkbook(startWorkbookReview(flat, false), [{ id: "sys:press", name: "Жим", available: true }]));
  const writes: BuilderWorkbookSaveRequest[] = [];
  const props = { clientId: "client", repository: { getMesocycleBuilderDraft: async () => null, saveMesocycleBuilderDraft: async () => undefined },
    exercises: { lookup: async () => new Map([["sys:press", { name: "Жим", metrics: ["load", "reps"] }]]), subscribe: () => () => undefined },
    listCandidates: async () => [], picked: null, onPickExercise: () => undefined, onCreated: () => undefined, onCancel: () => undefined,
    renderExcel: (onApply: unknown) => createElement("Excel", { onApply }), workbookSave: { saveBuilderWorkbook: async (request: BuilderWorkbookSaveRequest) => { writes.push(request); return { programId: "saved", mesocycleId: "cycle" }; } } };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Builder, props)); });
  await until(renderer, () => nodes(renderer, "Excel").length > 0);
  await act(async () => nodes(renderer, "Excel")[0]!.props.onApply(incoming));
  type Row = { id: string; reps: number | null; loadGrams: number | null };
  const editor = () => nodes(renderer, "Editor")[0]!.props as { facts: ReadonlyMap<string, readonly Row[]>; onFact: (id: string, patch: object) => boolean };
  const rows = [...editor().facts.values()][0]!;
  assert.deepEqual(rows.map((r) => [r.reps, r.loadGrams]), [[8, 60000], [6, 70000]]);
  assert.equal(editor().onFact(rows[1]!.id, { reps: 0 }), false);
  await act(async () => { assert.equal(editor().onFact(rows[1]!.id, { loadGrams: 72500 }), true); });
  assert.deepEqual([...editor().facts.values()][0]!.map((r) => r.loadGrams), [60000, 72500]);
  await act(async () => { nodes(renderer, "StickyEditorFooter")[0]!.props.onAction(); await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(writes.length, 1);
  const saved = writes[0]!.cycles[0]!;
  assert.deepEqual(saved.imported!.sessions[0]!.facts.map((f) => [f.values.reps, f.values.loadGrams]), [[8, 60000], [6, 72500]]);
  assert.equal(saved.imported!.sourceHash, incoming.cycles![0]!.imported!.sourceHash);
  await act(async () => renderer.unmount());
});

test("I07 actual periodized constructor displays all imported cycles, preserves edits and restores its active cycle/week", async () => {
  const Builder = loadScreen(resolve(import.meta.dirname, "../src/features/training/plans/presentation/PeriodizedBuilderScreen.tsx")).PeriodizedBuilderScreen as ComponentType<Props>;
  const base = trainingTransferFixture(); const cycle = base.programs[0]!.mesocycles[0]!;
  const value = { ...base, sessions: [], programs: [{ ...base.programs[0]!, mesocycles: [1, 2, 3].map((n) => ({ ...cycle, id: `cycle${n}`, title: `Цикл ${n}` })) }] };
  const incoming = builderWorkbookImport(prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value }, false), [{ id: "sys:press", name: base.exercises[0]!.name, available: true }]));
  let stored: MesocycleBuilderDraft | null = null; const writes: BuilderWorkbookSaveRequest[] = [];
  const props = { clientId: "client", repository: { getMesocycleBuilderDraft: async () => stored,
    saveMesocycleBuilderDraft: async (_client: string, _scope: unknown, draft: MesocycleBuilderDraft) => { stored = JSON.parse(JSON.stringify(draft)); } },
    exercises: { lookup: async () => new Map([["sys:press", { name: "Жим", metrics: ["load", "reps"] }]]), subscribe: () => () => undefined },
    listCandidates: async () => [], picked: null, onPickExercise: () => undefined, onCreated: () => undefined, onCancel: () => undefined,
    renderExcel: (onApply: unknown) => createElement("Excel", { onApply }), workbookSave: { saveBuilderWorkbook: async (request: BuilderWorkbookSaveRequest) => { writes.push(request); return { programId: "saved", mesocycleId: "cycle" }; } } };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Builder, props)); });
  await until(renderer, () => nodes(renderer, "Excel").length > 0);
  await act(async () => nodes(renderer, "Excel")[0]!.props.onApply(incoming));
  const cycleTabs = () => nodes(renderer, "SegmentedControl").find((n) => n.props.items?.length === 3 && String(n.props.items[0]?.id).startsWith("workbook:"))!;
  assert.ok(cycleTabs());
  await act(async () => nodes(renderer, "TextField").find((n) => n.props.label === "Название мезоцикла")!.props.onChangeText("Правка первого"));
  await act(async () => cycleTabs().props.onSelect(incoming.cycles![1]!.key));
  const weeks = nodes(renderer, "Pressable").find((n) => String(n.props.accessibilityLabel).includes("Неделя 3"));
  assert.ok(weeks); await act(async () => weeks.props.onPress());
  await act(async () => renderer.unmount());
  assert.ok(stored); const persisted = stored as MesocycleBuilderDraft;
  assert.equal(persisted.workbook!.cycles.length, 3); assert.equal(persisted.workbook!.cycles[0]!.title, "Правка первого");
  assert.equal(persisted.workbook!.activeKey, incoming.cycles![1]!.key);
  assert.equal(persisted.editing, 2);
  await act(async () => { renderer = create(createElement(Builder, props)); });
  await until(renderer, () => !!cycleTabs()); assert.equal(cycleTabs().props.selectedId, incoming.cycles![1]!.key);
  assert.ok(nodes(renderer, "Text").some((n) => n.props.children === "Программа недели 3"));
  await act(async () => { nodes(renderer, "StickyEditorFooter")[0]!.props.onAction(); await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(writes.length, 1); assert.equal(writes[0]!.cycles.length, 3); assert.equal(writes[0]!.cycles[0]!.title, "Правка первого");
  await act(async () => renderer.unmount());
});

test("CYCLE-STRIP-3 переключение цикла на месте: план не читается повторно, редактор недели не пересоздаётся, загрузки нет; несохранённое спрашивает", async () => {
  const Builder = loadScreen(resolve(import.meta.dirname, "../src/features/training/plans/presentation/PeriodizedBuilderScreen.tsx")).PeriodizedBuilderScreen as ComponentType<Props>;
  const week = (id: string, index: number, type: string) => ({ id, index, type, workouts: [{ id: `${id}-t`, title: "Т", exercises: [] }] });
  const plan = { program: { id: "p1", revision: 3, title: "Прог", memberClientIds: ["client"] }, mesocycles: [
    { id: "a", lineageId: "la", title: "Волна 1", weeks: [week("a0", 1, "heavy"), week("a1", 2, "base")] },
    { id: "b", lineageId: "lb", title: "Волна 2", weeks: [week("b0", 1, "base")] }] };
  let reads = 0; const shown: (string | undefined)[] = [];
  const props = { clientId: "client", programId: "p1", mesocycleId: "a", onCycleShown: (id: string | undefined) => { shown.push(id); },
    repository: { getPeriodizedPlan: async () => { reads += 1; return plan; }, getMesocycleGroup: async () => [], getPlacementOptions: async () => [],
      getMesocycleBuilderDraft: async () => null, saveMesocycleBuilderDraft: async () => undefined, clearMesocycleBuilderDraft: async () => undefined },
    exercises: { lookup: async () => new Map([["sys:press", { name: "Жим", metrics: ["load", "reps"] }]]), subscribe: () => () => undefined },
    listCandidates: async () => [], picked: null, onPickExercise: () => undefined, onCreated: () => undefined, onCancel: () => undefined };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Builder, props)); });
  await until(renderer, () => nodes(renderer, "Editor").length > 0);
  const strip = () => nodes(renderer, "SegmentedControl").find((n) => (n.props.items as { id: string }[] | undefined)?.some((item) => item.id === "b"))!;
  const mesocycleTitle = () => nodes(renderer, "TextField").find((n) => n.props.label === "Название мезоцикла")!.props.value;
  assert.equal(mesocycleTitle(), "Волна 1");
  const mountsBefore = editorMounts;
  await act(async () => strip().props.onSelect("b"));
  assert.equal(mesocycleTitle(), "Волна 2", "цикл B показан");
  assert.equal(reads, 1, "план читается один раз");
  assert.equal(editorMounts, mountsBefore, "редактор недели не пересоздан");
  assert.equal(nodes(renderer, "LoadingState").length, 0, "экран загрузки не показывался");
  assert.equal(shown.at(-1), "b", "навигация знает выбранный цикл");
  await act(async () => nodes(renderer, "TextField").find((n) => n.props.label === "Название мезоцикла")!.props.onChangeText("Волна 2 правка"));
  await act(async () => strip().props.onSelect("a"));
  assert.equal(mesocycleTitle(), "Волна 2 правка", "с несохранённой правкой переключение сначала спрашивает");
  await press(renderer, "Удалить черновик");
  assert.equal(mesocycleTitle(), "Волна 1", "после «Удалить черновик» открыт цикл A без правок цикла B");
  assert.equal(reads, 1); assert.equal(editorMounts, mountsBefore); assert.equal(shown.at(-1), "a");
  await act(async () => renderer.unmount());
});
