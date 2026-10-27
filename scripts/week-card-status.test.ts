import assert from "node:assert/strict";
import test from "node:test";
import type { SessionStatus, WorkoutStatus } from "../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import { weekCardStates, weekCardTone } from "../apps/mobile/src/features/training/execution/domain/WeekCardStatus.ts";

const status = (weekIndex: number, plannedWorkoutId: string, value: WorkoutStatus): SessionStatus => ({ weekIndex, plannedWorkoutId, status: value });
const week = (index: number, ...workoutIds: string[]) => ({ index, workoutIds });
const states = (result: ReturnType<typeof weekCardStates>, ...indexes: number[]) => indexes.map((index) => result.states.get(index));

test("an empty week is EMPTY", () => {
  assert.deepEqual(states(weekCardStates([week(1, "a"), week(2)], [status(1, "a", "COMPLETED")]), 2), ["EMPTY"]);
});

test("the first week that is not closed is CURRENT, the others carry their own status", () => {
  const weeks = [week(1, "a", "b"), week(2, "a", "b"), week(3, "a", "b"), week(4, "a", "b")];
  const result = weekCardStates(weeks, [
    status(1, "a", "COMPLETED"), status(1, "b", "COMPLETED"),
    status(2, "a", "MISSED"), status(2, "b", "COMPLETED"),
    status(3, "a", "IN_PROGRESS"),
  ]);
  assert.equal(result.firstOpen, 3);
  assert.deepEqual(states(result, 1, 2, 3, 4), ["COMPLETED", "CLOSED_WITH_DEVIATIONS", "CURRENT", "NOT_STARTED"]);
});

test("a started week that is not the first open one stays IN_PROGRESS", () => {
  const result = weekCardStates([week(1, "a"), week(2, "a")], [status(2, "a", "IN_PROGRESS")]);
  assert.equal(result.firstOpen, 1);
  assert.deepEqual(states(result, 1, 2), ["CURRENT", "IN_PROGRESS"]);
});

test("a workout without a recorded session counts as not started", () => {
  const result = weekCardStates([week(1, "a", "b"), week(2, "a")], [status(1, "a", "COMPLETED")]);
  assert.deepEqual(states(result, 1, 2), ["CURRENT", "NOT_STARTED"], "b has no session, so week 1 is not closed");
});

test("when every week is closed the last one stays the current card (as in the program panel)", () => {
  const result = weekCardStates([week(1, "a"), week(2, "a")], [status(1, "a", "COMPLETED"), status(2, "a", "COMPLETED")]);
  assert.equal(result.firstOpen, 2);
  assert.deepEqual(states(result, 1, 2), ["COMPLETED", "CURRENT"]);
});

test("statuses of another week or another workout do not leak into the week", () => {
  const result = weekCardStates([week(1, "a"), week(2, "a")], [status(1, "a", "COMPLETED"), status(2, "zzz", "COMPLETED")]);
  assert.deepEqual(states(result, 2), ["CURRENT"]);
});

test("цвет состояния недели: зелёный, синий, янтарный, акцент; «не начата» и «пусто» не красятся", () => {
  assert.deepEqual((["COMPLETED", "IN_PROGRESS", "CLOSED_WITH_DEVIATIONS", "CURRENT", "NOT_STARTED", "EMPTY"] as const).map(weekCardTone),
    ["success", "info", "warning", "accent", "neutral", "neutral"]);
});
