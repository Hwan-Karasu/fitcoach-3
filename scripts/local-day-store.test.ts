import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDayStore } from "../apps/mobile/src/features/nutrition/presentation/localDayStore.ts";

test("UIX-CLEAN-1: четыре потребителя даты делят один таймер и обработчик, в полночь обновляются все", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 10, 10, 23, 59, 59).getTime() });
  const scheduled = t.mock.method(globalThis, "setTimeout");
  const active = new Set<() => void>();
  const store = createLocalDayStore((listener) => { active.add(listener); return () => { active.delete(listener); }; });
  const calls = [0, 0, 0, 0];
  const off = calls.map((_, index) => store.subscribe(() => { calls[index] = calls[index]! + 1; }));
  try {
    assert.equal(active.size, 1);
    assert.equal(scheduled.mock.callCount(), 1);
    assert.equal(store.getSnapshot(), "2026-11-10");
    t.mock.timers.tick(3000);
    assert.equal(store.getSnapshot(), "2026-11-11");
    assert.deepEqual(calls, [1, 1, 1, 1]);
    assert.equal(scheduled.mock.callCount(), 2, "следующая полночь тоже запланирована ровно один раз");
    for (const listener of active) listener();
    assert.deepEqual(calls, [1, 1, 1, 1], "возврат в тот же день не перерисовывает экраны");
    off[0]!(); off[0]!();
    assert.equal(active.size, 1, "повторная отписка не снимает других потребителей");
  } finally { off.forEach((release) => release()); }
  assert.equal(active.size, 0);
});

test("UIX-CLEAN-1: после отсутствия экранов и возвращения из фона дата не застревает на вчера", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 10, 10, 12).getTime() });
  let foreground: () => void = () => undefined;
  const store = createLocalDayStore((listener) => { foreground = listener; return () => undefined; });
  const off = store.subscribe(() => undefined);
  off();
  t.mock.timers.tick(24 * 3600_000);
  assert.equal(store.getSnapshot(), "2026-11-11");
  const nextOff = store.subscribe(() => undefined);
  try { foreground(); assert.equal(store.getSnapshot(), "2026-11-11"); } finally { nextOff(); }
});
