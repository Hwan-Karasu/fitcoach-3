import assert from "node:assert/strict";
import test from "node:test";
import type { PlannedExercise, SimpleProgramDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { applySupersetPress, IDLE_SUPERSET_PICK, pressSuperset, type SupersetPick } from
  "../apps/mobile/src/features/training/plans/domain/SupersetRules.ts";

const exercise = (id: string, supersetId?: string): PlannedExercise => ({ id, exerciseId: `sys:${id}`, sets: [], rir: null, restSec: null,
  instruction: null, ...(supersetId === undefined ? {} : { supersetId }) });

function draftOf(...exercises: PlannedExercise[]): SimpleProgramDraft {
  return { title: "П", plan: { weeks: 4, workouts: [{ id: "w", title: "Т", exercises }] } };
}

/** Последовательность нажатий «Сет»: итоговый черновик и состояние выбора. */
function press(draft: SimpleProgramDraft, ids: readonly string[]): Readonly<{ draft: SimpleProgramDraft; pick: SupersetPick }> {
  let pick: SupersetPick = IDLE_SUPERSET_PICK;
  let current = draft;
  for (const id of ids) {
    const result = pressSuperset(pick, current.plan.workouts[0]!, id);
    pick = result.pick;
    current = applySupersetPress(current, "w", result.action);
  }
  return { draft: current, pick };
}

const shape = (draft: SimpleProgramDraft) => draft.plan.workouts[0]!.exercises.map((item) => [item.id, item.supersetId ?? null]);

test("UI-OWN-028 «Сет» как в 2.0: на одном, на соседнем, повторно — сет собран", () => {
  const { draft, pick } = press(draftOf(exercise("a"), exercise("b"), exercise("c")), ["a", "b", "b"]);
  const group = draft.plan.workouts[0]!.exercises[0]!.supersetId;
  assert.ok(group !== undefined);
  assert.deepEqual(shape(draft), [["a", group], ["b", group], ["c", null]]);
  assert.deepEqual(pick, IDLE_SUPERSET_PICK);
});

test("UI-OWN-028 «Сет»: третье соседнее упражнение входит в тот же выбор; не соседнее — не входит", () => {
  const three = press(draftOf(exercise("a"), exercise("b"), exercise("c")), ["a", "b", "c", "c"]).draft;
  const group = three.plan.workouts[0]!.exercises[0]!.supersetId;
  assert.deepEqual(shape(three), [["a", group], ["b", group], ["c", group]]);
  const gap = press(draftOf(exercise("a"), exercise("b"), exercise("c")), ["a", "c"]);
  assert.deepEqual(gap.pick, { mode: "picking", workoutId: "w", ids: ["a"] }, "через одно — выбор не меняется");
  assert.deepEqual(press(draftOf(exercise("a"), exercise("b")), ["a", "a"]).draft, draftOf(exercise("a"), exercise("b")),
    "одно упражнение — не сет");
});

test("UI-OWN-028 «Сет» на участнике: повторно — вынуть (из середины — встаёт после сета), на другом — расформировать", () => {
  const middle = press(draftOf(exercise("a", "g"), exercise("b", "g"), exercise("c", "g")), ["b", "b"]).draft;
  assert.deepEqual(shape(middle), [["a", "g"], ["c", "g"], ["b", null]]);
  const pair = press(draftOf(exercise("a", "g"), exercise("b", "g"), exercise("c")), ["a", "a"]).draft;
  assert.deepEqual(shape(pair), [["a", null], ["b", null], ["c", null]], "из пары вынуть — сета нет");
  const { pick } = press(draftOf(exercise("a", "g"), exercise("b", "g")), ["a", "b"]);
  assert.deepEqual(pick, IDLE_SUPERSET_PICK);
  const dissolve = pressSuperset({ mode: "leaving", workoutId: "w", id: "a", groupId: "g" },
    draftOf(exercise("a", "g"), exercise("b", "g")).plan.workouts[0]!, "b");
  assert.deepEqual(dissolve.action, { type: "dissolve", groupId: "g" }, "расформирование — после подтверждения на экране");
  assert.deepEqual(shape(applySupersetPress(draftOf(exercise("a", "g"), exercise("b", "g")), "w", dissolve.action)),
    [["a", null], ["b", null]]);
});
