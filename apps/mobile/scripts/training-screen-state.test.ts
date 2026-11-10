import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { useConfirmationMode } from "../src/features/training/execution/presentation/useConfirmationMode.ts";
import type { ConfirmationMode } from "../src/features/training/execution/domain/ExecutionModel.ts";
import { retainHistoryView, useProgramHistoryView } from "../src/features/training/archive/presentation/historyViewState.ts";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function settingsPort() {
  const writes: Array<{ mode: ConfirmationMode; resolve: () => void; reject: (error: Error) => void }> = [];
  let stored: ConfirmationMode = "AUTO";
  const port = { getConfirmationMode: async () => stored, setConfirmationMode: (mode: ConfirmationMode) =>
    new Promise<void>((resolve, reject) => { writes.push({ mode, resolve: () => { stored = mode; resolve(); }, reject }); }) };
  return { port, writes };
}

test("REVIEW-R7: быстрые выборы пишутся по очереди; старый отказ не возвращает режим и ошибку поверх нового выбора", async () => {
  const { port, writes } = settingsPort();
  let state!: ReturnType<typeof useConfirmationMode>;
  function Probe() { state = useConfirmationMode(port, true); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe)); });
    assert.equal(state.mode, "AUTO");
    await act(async () => state.choose("MANUAL"));
    await act(async () => state.choose("AUTO"));
    assert.equal(writes.length, 1);
    await act(async () => writes[0]!.reject(new Error("WRITE_FAILED")));
    assert.equal(state.mode, "AUTO"); assert.equal(state.error, null);
    assert.equal(writes.length, 2);
    await act(async () => writes[1]!.resolve());
    assert.equal(state.mode, "AUTO"); assert.equal(state.error, null);
    assert.equal(await port.getConfirmationMode(), "AUTO");
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("REVIEW-R7: отказ последнего выбора откатывает к успешной предыдущей записи, а не к несохранённому намерению", async () => {
  const { port, writes } = settingsPort();
  let state!: ReturnType<typeof useConfirmationMode>;
  function Probe() { state = useConfirmationMode(port, true); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe)); });
    await act(async () => state.choose("MANUAL"));
    await act(async () => state.choose("AUTO"));
    await act(async () => writes[0]!.resolve());
    await act(async () => writes[1]!.reject(new Error("WRITE_FAILED")));
    assert.equal(state.mode, "MANUAL"); assert.match(state.error!, /Не удалось сохранить/u);
    assert.equal(await port.getConfirmationMode(), "MANUAL");
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("REVIEW-R7: медленное чтение при возврате не отменяет сделанный после него выбор", async () => {
  let finishRead!: (mode: ConfirmationMode) => void;
  let reads = 0;
  const port = { getConfirmationMode: () => ++reads === 1 ? Promise.resolve("AUTO" as const)
    : new Promise<ConfirmationMode>((resolve) => { finishRead = resolve; }), setConfirmationMode: async () => undefined };
  let state!: ReturnType<typeof useConfirmationMode>;
  function Probe({ focused }: { focused: boolean }) { state = useConfirmationMode(port, focused); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { focused: true })); });
    await act(async () => tree.update(createElement(Probe, { focused: false })));
    await act(async () => tree.update(createElement(Probe, { focused: true })));
    await act(async () => state.choose("MANUAL"));
    await act(async () => finishRead("AUTO"));
    assert.equal(state.mode, "MANUAL"); assert.equal(state.error, null);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("REVIEW-R7: возврат во время записи ждёт её результат; отказ чтения не оставляет несохранённый режим", async () => {
  const { port, writes } = settingsPort();
  let reads = 0;
  const source = { ...port, getConfirmationMode: async () => { if (++reads > 1) throw new Error("READ_FAILED"); return port.getConfirmationMode(); } };
  let state!: ReturnType<typeof useConfirmationMode>;
  function Probe({ focused }: { focused: boolean }) { state = useConfirmationMode(source, focused); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { focused: true })); });
    await act(async () => state.choose("MANUAL"));
    await act(async () => tree.update(createElement(Probe, { focused: false })));
    await act(async () => tree.update(createElement(Probe, { focused: true })));
    assert.equal(reads, 1);
    await act(async () => writes[0]!.reject(new Error("WRITE_FAILED")));
    assert.equal(state.mode, "AUTO"); assert.match(state.error!, /Не удалось загрузить/u);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("REVIEW-R7: история восстанавливает выбор и раскрытие своей программы и закрывает чужое меню", async () => {
  let state!: ReturnType<typeof useProgramHistoryView>;
  const releaseA = retainHistoryView("r7-client-a"); const releaseB = retainHistoryView("r7-client-b");
  function Probe({ clientId, programId }: { clientId: string; programId: string }) { state = useProgramHistoryView(clientId, programId); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { clientId: "r7-client-a", programId: "p1" })); });
    await act(async () => { state.choose("cycle-a"); state.toggle("__all__|group"); state.setListOpen(true); });
    await act(async () => tree.update(createElement(Probe, { clientId: "r7-client-a", programId: "p2" })));
    assert.equal(state.selected, undefined); assert.equal(state.expanded.size, 0); assert.equal(state.listOpen, false);
    await act(async () => { state.choose(null); state.toggle("__all__|group"); });
    await act(async () => tree.update(createElement(Probe, { clientId: "r7-client-b", programId: "p1" })));
    assert.equal(state.selected, undefined); assert.equal(state.expanded.size, 0);
    await act(async () => tree.update(createElement(Probe, { clientId: "r7-client-a", programId: "p1" })));
    assert.equal(state.selected, "cycle-a"); assert.deepEqual([...state.expanded], ["__all__|group"]); assert.equal(state.listOpen, false);
  } finally { if (tree) await act(async () => tree.unmount()); releaseA(); releaseB(); }
});
