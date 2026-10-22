import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTIFICATION_SETTINGS, isQuietMinute, validateNotificationSettings, type NotificationSettings }
  from "../apps/mobile/src/features/notifications/domain/NotificationSettings.ts";
import { leadText, planReminders, type PlannerAppointment } from "../apps/mobile/src/features/notifications/domain/ReminderPlanner.ts";

const on = (patch: Partial<NotificationSettings> = {}): NotificationSettings => ({
  ...DEFAULT_NOTIFICATION_SETTINGS, appointment: { enabled: true, minutesBefore: 60 }, duty: { enabled: true, minutesBefore: 30 }, ...patch });
const NOW = new Date(2026, 9, 22, 9, 0);
const visit = (id: string, startMinute: number, patch: Partial<PlannerAppointment> = {}): PlannerAppointment =>
  ({ id, localDate: "2026-10-22", startMinute, lifecycle: "SCHEDULED", participantName: "Иван", sessionTypeName: "Персональная", ...patch });

test("настройки по умолчанию: напоминания и тихие часы выключены, 60 минут, 22:00–08:00, хранение 90 дней", () => {
  assert.deepEqual(DEFAULT_NOTIFICATION_SETTINGS, {
    appointment: { enabled: false, minutesBefore: 60 }, duty: { enabled: false, minutesBefore: 60 },
    quietHours: { enabled: false, startMinute: 1320, endMinute: 480 }, retentionDays: 90 });
  assert.deepEqual(planReminders({ settings: DEFAULT_NOTIFICATION_SETTINGS, appointments: [visit("a", 600)], duties: [], now: NOW }), []);
});

test("границы интервала 1–1440 минут и допустимый срок хранения проверяются; значения не подменяются", () => {
  const withMinutes = (minutes: number) => ({ ...on(), appointment: { enabled: true, minutesBefore: minutes } });
  for (const ok of [1, 60, 1440]) assert.equal(validateNotificationSettings(withMinutes(ok)).appointment.minutesBefore, ok);
  for (const bad of [0, -5, 1441, 1.5, Number.NaN]) assert.throws(() => validateNotificationSettings(withMinutes(bad)), { message: "NOTIFICATION_SETTINGS_INVALID" });
  assert.throws(() => validateNotificationSettings({ ...on(), retentionDays: 45 as never }), { message: "NOTIFICATION_SETTINGS_INVALID" });
  assert.throws(() => validateNotificationSettings({ ...on(), quietHours: { enabled: true, startMinute: 480, endMinute: 480 } }), { message: "NOTIFICATION_SETTINGS_INVALID" });
});

test("тихие часы 22:00–08:00 переходят через полночь; граница конца не входит, начала входит", () => {
  const quiet = { enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 };
  assert.deepEqual([21 * 60 + 59, 22 * 60, 23 * 60 + 59, 0, 7 * 60 + 59, 8 * 60, 12 * 60].map((minute) => isQuietMinute(quiet, minute)),
    [false, true, true, true, true, false, false]);
  assert.equal(isQuietMinute({ ...quiet, enabled: false }, 23 * 60), false);
  assert.equal(isQuietMinute({ enabled: true, startMinute: 13 * 60, endMinute: 14 * 60 }, 13 * 60 + 30), true, "обычный дневной интервал");
});

test("напоминание о записи: за N минут до начала, с именем, временем и типом; не создаётся для отменённых и завершённых", () => {
  const [intent, ...rest] = planReminders({ settings: on(), now: NOW, duties: [],
    appointments: [visit("a", 15 * 60), visit("b", 16 * 60, { lifecycle: "CANCELLED" }), visit("c", 17 * 60, { lifecycle: "COMPLETED" })] });
  assert.equal(rest.length, 0);
  assert.equal(intent?.sourceId, "a");
  assert.equal(intent?.fireAt.getTime(), new Date(2026, 9, 22, 14, 0).getTime());
  assert.equal(intent?.title, "Запись 1 ч до начала");
  assert.equal(intent?.body, "15:00 · Иван · Персональная");
});

test("просроченное напоминание задним числом не создаётся; ровно сейчас — тоже нет", () => {
  const appointments = [visit("past", 9 * 60 + 30), visit("exact", 10 * 60), visit("future", 10 * 60 + 1)];
  assert.deepEqual(planReminders({ settings: on(), appointments, duties: [], now: NOW }).map((item) => item.sourceId), ["future"]);
});

test("напоминание в тихих часах подавляется и не переносится на начало записи", () => {
  const settings = on({ quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 } });
  const tomorrow = { localDate: "2026-10-23" };
  const result = planReminders({ settings, now: NOW, duties: [],
    appointments: [visit("early", 8 * 60 + 30, tomorrow), visit("later", 9 * 60 + 30, tomorrow), visit("late", 22 * 60 + 30, { localDate: "2026-10-22" })] });
  // early: сработало бы в 07:30 — тихие часы; later: в 08:30 — можно; late: в 21:30 — можно (22:30 начало записи уже в тихих часах, но считается время напоминания).
  assert.deepEqual(result.map((item) => item.sourceId), ["late", "later"]);
});

test("дежурство: свой интервал и свой переключатель, независимо от записей", () => {
  const duties = [{ id: "d", localDate: "2026-10-22", startMinute: 12 * 60, endMinute: 16 * 60 }];
  const onlyDuty = planReminders({ settings: on({ appointment: { enabled: false, minutesBefore: 60 } }), appointments: [visit("a", 15 * 60)], duties, now: NOW });
  assert.deepEqual(onlyDuty.map((item) => [item.sourceType, item.sourceId, item.fireAt.getHours() * 60 + item.fireAt.getMinutes()]), [["DUTY", "d", 11 * 60 + 30]]);
  assert.equal(onlyDuty[0]?.body, "12:00–16:00");
  assert.equal(planReminders({ settings: on({ duty: { enabled: false, minutesBefore: 30 } }), appointments: [], duties, now: NOW }).length, 0);
});

test("перепланирование идемпотентно; перенос записи меняет версию события, неизменённая запись — нет", () => {
  const input = { settings: on(), duties: [], now: NOW, appointments: [visit("a", 15 * 60)] };
  const first = planReminders(input);
  assert.deepEqual(planReminders(input), first);
  const moved = planReminders({ ...input, appointments: [visit("a", 16 * 60)] });
  assert.equal(moved[0]?.sourceId, "a");
  assert.notEqual(moved[0]?.eventVersion, first[0]?.eventVersion);
  const renamed = planReminders({ ...input, appointments: [visit("a", 15 * 60, { participantName: "Пётр" })] });
  assert.notEqual(renamed[0]?.eventVersion, first[0]?.eventVersion, "смена участника обновляет содержание (§41.2)");
});

test("текст интервала: минуты, часы и их сочетание", () => {
  assert.deepEqual([1, 45, 60, 90, 1440].map(leadText), ["1 мин", "45 мин", "1 ч", "1 ч 30 мин", "24 ч"]);
});
