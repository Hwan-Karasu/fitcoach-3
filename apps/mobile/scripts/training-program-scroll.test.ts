import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { useParticipantScrollRestore } from "../src/features/training/plans/presentation/useParticipantScrollRestore.ts";

// Возврат позиции прокрутки экрана программы при смене участника (react-test-renderer, как у остальных хуков «Тренировок»).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = ReturnType<typeof useParticipantScrollRestore>;

function mount(initial: Readonly<{ currentKey: string; stale: boolean }>) {
  const jumps: number[] = [];
  const handlers: { current: Handlers | null } = { current: null };
  const Probe = (props: Readonly<{ currentKey: string; stale: boolean }>) => {
    handlers.current = useParticipantScrollRestore({ ...props, scrollTo: (y) => { jumps.push(y); } });
    return null;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(createElement(Probe, initial)); });
  return {
    jumps, handlers,
    update: (next: Readonly<{ currentKey: string; stale: boolean }>) => act(() => { renderer.update(createElement(Probe, next)); }),
    unmount: () => act(() => { renderer.unmount(); }),
  };
}

test("пока участник тот же, прокрутка страницы не возвращается", () => {
  const screen = mount({ currentKey: "a:p1", stale: false });
  screen.handlers.current!.onScroll(300);
  screen.handlers.current!.onContentSizeChange(900);
  assert.deepEqual(screen.jumps, []);
  screen.unmount();
});

test("смена участника: позиция 300 возвращается, когда его страница выросла до 900", () => {
  const screen = mount({ currentKey: "a:p1", stale: false });
  screen.handlers.current!.onScroll(300);
  screen.update({ currentKey: "b:p2", stale: true });
  screen.handlers.current!.onContentSizeChange(900);
  assert.deepEqual(screen.jumps, [], "пока данные нового участника не загружены, страница не трогается");
  screen.update({ currentKey: "b:p2", stale: false });
  screen.handlers.current!.onContentSizeChange(900);
  assert.deepEqual(screen.jumps, [300]);
  screen.handlers.current!.onContentSizeChange(950);
  assert.deepEqual(screen.jumps, [300], "после возврата позиция больше не навязывается");
  screen.unmount();
});

test("страница нового участника короче цели — позиция ждёт, пока она не дорастёт", () => {
  const screen = mount({ currentKey: "a:p1", stale: false });
  screen.handlers.current!.onScroll(500);
  screen.update({ currentKey: "b:p2", stale: false });
  screen.handlers.current!.onContentSizeChange(200);
  screen.handlers.current!.onContentSizeChange(700);
  assert.deepEqual(screen.jumps, [500, 500]);
  screen.handlers.current!.onContentSizeChange(800);
  assert.deepEqual(screen.jumps, [500, 500]);
  screen.unmount();
});

test("если размер страницы так и не изменился, ожидание снимается само через 1,2 с", async () => {
  const screen = mount({ currentKey: "a:p1", stale: false });
  screen.handlers.current!.onScroll(300);
  screen.update({ currentKey: "b:p2", stale: false });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1300)); });
  screen.handlers.current!.onContentSizeChange(900);
  assert.deepEqual(screen.jumps, []);
  screen.unmount();
});
