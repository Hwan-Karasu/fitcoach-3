import assert from "node:assert/strict";
import test from "node:test";
import { createViewRetainer } from "../apps/mobile/src/shared/ui/retainedView.ts";

test("UIX-CLEAN-1: состояние очищается только после последнего экрана; повторная отписка безопасна", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cleared: string[] = [];
  const retain = createViewRetainer((key) => cleared.push(key));
  const first = retain("a"); const second = retain("a"); const other = retain("b");
  first(); first(); t.mock.timers.tick(1);
  assert.deepEqual(cleared, []);
  second(); t.mock.timers.tick(1);
  assert.deepEqual(cleared, ["a"]);
  other(); t.mock.timers.tick(1);
  assert.deepEqual(cleared, ["a", "b"]);
});

test("UIX-CLEAN-1: StrictMode/возврат в том же кадре сохраняет состояние до фактического закрытия", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cleared: string[] = [];
  const retain = createViewRetainer((key) => cleared.push(key));
  retain("a")();
  const release = retain("a");
  t.mock.timers.tick(1);
  assert.deepEqual(cleared, []);
  release(); t.mock.timers.tick(1);
  assert.deepEqual(cleared, ["a"]);
});
