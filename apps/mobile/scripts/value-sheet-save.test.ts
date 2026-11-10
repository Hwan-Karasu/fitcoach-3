import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { useValueSheetSave } from "../src/features/nutrition/presentation/useValueSheetSave.ts";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("UIX audit: ошибка ввода не блокирует лист навсегда; двойной submit не пишет дважды; исходный день сохраняется", async () => {
  let state!: ReturnType<typeof useValueSheetSave>;
  let calls = 0; let closes = 0;
  let finish!: (message: string | null) => void;
  const save = async () => { calls += 1; return new Promise<string | null>((resolve) => { finish = resolve; }); };
  function Probe({ visible, currentSave = save }: { visible: boolean; currentSave?: typeof save }) {
    state = useValueSheetSave(visible, "80", currentSave, () => { closes += 1; });
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { visible: true })); });
    await act(async () => { state.change("81"); });
    let pending!: Promise<void>;
    await act(async () => { pending = state.submit(); void state.submit(); });
    assert.equal(calls, 1);
    await act(async () => { finish("Ошибка записи"); await pending; });
    assert.equal(state.busy, false); assert.equal(state.text, "81"); assert.equal(state.error, "Ошибка записи");
    await act(async () => { tree.update(createElement(Probe, { visible: true, currentSave: async () => { throw new Error("OTHER_DAY"); } })); });
    await act(async () => { pending = state.submit(); });
    assert.equal(calls, 2, "при смене даты за открытым листом используется прежний обработчик");
    await act(async () => { tree.update(createElement(Probe, { visible: false })); });
    await act(async () => { tree.update(createElement(Probe, { visible: true })); });
    await act(async () => { finish(null); await pending; });
    assert.equal(closes, 0, "поздний успех не закрывает новое открытие листа");
    assert.equal(state.text, "80");
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("UIX audit: исключение из хранилища показано ошибкой, черновик доступен для повтора", async () => {
  let state!: ReturnType<typeof useValueSheetSave>;
  function Probe() { state = useValueSheetSave(true, "80", async () => { throw new Error("IO"); }, () => undefined); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe)); });
    await act(async () => { state.change("81"); });
    await act(async () => { await state.submit(); });
    assert.equal(state.busy, false); assert.equal(state.text, "81"); assert.match(state.error!, /повторите/u);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
