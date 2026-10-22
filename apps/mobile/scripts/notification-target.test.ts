import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventTarget, targetOfPayload, timerTarget } from "../src/app/navigation/notificationTarget.ts";

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
