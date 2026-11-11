import assert from "node:assert/strict";
import test from "node:test";
import { isWorkoutExitPromptSuppressed, runWithoutWorkoutExitPrompt, shouldAskWorkoutExit }
  from "../apps/mobile/src/features/training/execution/domain/WorkoutExitPrompt.ts";

test("UIX-FIT-11: вопрос о завершении тренировки подавлен только внутри программного перехода", () => {
  assert.equal(isWorkoutExitPromptSuppressed(), false);
  assert.equal(shouldAskWorkoutExit(false), true);
  const seen = runWithoutWorkoutExitPrompt(() => [isWorkoutExitPromptSuppressed(), shouldAskWorkoutExit(false)]);
  assert.deepEqual(seen, [true, false]);
  assert.equal(isWorkoutExitPromptSuppressed(), false, "после перехода вопрос снова задаётся");
});

test("UIX-FIT-11: подавление снимается и при исключении, вложенные переходы не снимают его раньше времени", () => {
  assert.throws(() => runWithoutWorkoutExitPrompt(() => { throw new Error("SYNTHETIC"); }), /SYNTHETIC/u);
  assert.equal(isWorkoutExitPromptSuppressed(), false);
  runWithoutWorkoutExitPrompt(() => {
    runWithoutWorkoutExitPrompt(() => undefined);
    assert.equal(isWorkoutExitPromptSuppressed(), true);
  });
  assert.equal(isWorkoutExitPromptSuppressed(), false);
});

test("UIX-FIT-11: настройка «не спрашивать» отключает вопрос и без программного перехода", () => {
  assert.equal(shouldAskWorkoutExit(true), false);
  assert.equal(shouldAskWorkoutExit(false), true);
});
