import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventTarget, resolveTimerTarget, targetOfPayload, timerTarget } from "../src/app/navigation/notificationTarget.ts";
import { exerciseFocusAction } from "../src/app/navigation/exerciseFocusAction.ts";

test("timer focus reaches the nested current workout and repeated presses get a fresh request without replacing the screen", () => {
  const state = { key: "root", index: 1, routes: [{ key: "clients" }, { key: "client", state: {
    key: "tabs", index: 1, routes: [{ key: "home" }, { key: "training", state: {
      key: "training-stack", index: 1, routes: [{ key: "program" }, { key: "workout" }],
    } }],
  } }] };
  for (const request of [1, 2]) assert.deepEqual(exerciseFocusAction(state, "workout", "second-exercise", request), {
    type: "SET_PARAMS", source: "workout", target: "training-stack",
    payload: { params: { focusExerciseId: "second-exercise", focusExerciseRequest: request } },
  });
  assert.equal(exerciseFocusAction(state, "removed-workout", "second-exercise", 3), null);
});

test("нажатие на строку центра: дежурство и гость — Календарь, запись клиента — его «Тренировки», исход — Календарь", () => {
  assert.deepEqual(calendarEventTarget({ sourceType: "DUTY", eventKind: "REMINDER", clientId: null }), { kind: "CALENDAR" });
  assert.deepEqual(calendarEventTarget({ sourceType: "APPOINTMENT", eventKind: "REMINDER", clientId: "c1" }), { kind: "CLIENT_TRAINING", clientId: "c1" });
  assert.deepEqual(calendarEventTarget({ sourceType: "APPOINTMENT", eventKind: "REMINDER", clientId: null }), { kind: "CALENDAR" }, "гость");
  assert.deepEqual(calendarEventTarget({ sourceType: "APPOINTMENT", eventKind: "OUTCOME_DUE", clientId: "c1" }), { kind: "CALENDAR" });
  assert.deepEqual(calendarEventTarget({ sourceType: "BACKUP", eventKind: "BACKUP_FAILED", clientId: null }), { kind: "CALENDAR" });
});

test("системное уведомление календаря: нагрузка с идентификаторами даёт ту же цель; мусор — null", () => {
  assert.deepEqual(targetOfPayload({ kind: "calendar-reminder", sourceType: "APPOINTMENT", eventKind: "REMINDER", clientId: "c1" }), { kind: "CLIENT_TRAINING", clientId: "c1" });
  assert.deepEqual(targetOfPayload({ kind: "calendar-reminder", sourceType: "DUTY", eventKind: "REMINDER", clientId: null }), { kind: "CALENDAR" });
  for (const bad of [null, undefined, 5, "x", {}, { kind: "other" }, { kind: "calendar-reminder" }, { kind: "rest-timer" }, { kind: "rest-timer", clientId: "" }]) {
    assert.equal(targetOfPayload(bad), null);
  }
});

test("уведомление таймера отдыха ведёт в свою тренировку, при неполной нагрузке — в «Тренировки» клиента", () => {
  const full = { kind: "rest-timer", clientId: "c1", programId: "p1", weekIndex: 3, plannedWorkoutId: "w1", exerciseKey: "pe-1" };
  assert.deepEqual(targetOfPayload(full), { kind: "WORKOUT", clientId: "c1", programId: "p1", weekIndex: 3, plannedWorkoutId: "w1", exerciseKey: "pe-1" });
  assert.deepEqual(targetOfPayload({ ...full, weekIndex: "3" }), { kind: "CLIENT_TRAINING", clientId: "c1" }, "неверный тип недели");
  assert.deepEqual(targetOfPayload({ kind: "rest-timer", clientId: "c1" }), { kind: "CLIENT_TRAINING", clientId: "c1" });
  assert.deepEqual(targetOfPayload({ ...full, weekIndex: 0 }), { kind: "WORKOUT", clientId: "c1", programId: "p1", weekIndex: 0, plannedWorkoutId: "w1", exerciseKey: "pe-1" }, "нулевая неделя допустима");
});

test("панель таймера: таймер с происхождением возвращает в тренировку, старый таймер — в «Тренировки» клиента", () => {
  const base = { clientId: "c1", exerciseKey: "pe-1" };
  assert.deepEqual(timerTarget({ ...base, programId: "p1", weekIndex: 2, plannedWorkoutId: "w1" }),
    { kind: "WORKOUT", clientId: "c1", programId: "p1", weekIndex: 2, plannedWorkoutId: "w1", exerciseKey: "pe-1" });
  assert.deepEqual(timerTarget({ ...base, programId: null, weekIndex: null, plannedWorkoutId: null }), { kind: "CLIENT_TRAINING", clientId: "c1" });
});

test("REST-NAV-1 нажатие на таймер: цель разрешается при нажатии — мезоцикл тренировки, архив и удалённая программа", () => {
  const target = { kind: "WORKOUT", clientId: "c1", programId: "p1", weekIndex: 3, plannedWorkoutId: "w1", exerciseKey: "pe-1" } as const;
  assert.deepEqual(resolveTimerTarget(target, { active: true, archived: false, workoutFound: true, mesocycleId: "m2" }),
    { open: { ...target, mesocycleId: "m2" }, notice: null }, "программа под дневником — на мезоцикле тренировки");
  const archived = resolveTimerTarget(target, { active: false, archived: true, workoutFound: true, mesocycleId: "m2" });
  assert.deepEqual(archived.open, { kind: "CLIENT_TRAINING", clientId: "c1" });
  assert.match(archived.notice ?? "", /архиве/);
  const gone = resolveTimerTarget(target, { active: true, archived: false, workoutFound: false, mesocycleId: null });
  assert.equal(gone.open, null, "удалённая тренировка — без перехода");
  assert.match(gone.notice ?? "", /недоступна/);
  assert.equal(resolveTimerTarget(target, { active: false, archived: false, workoutFound: false, mesocycleId: null }).open, null);
});
