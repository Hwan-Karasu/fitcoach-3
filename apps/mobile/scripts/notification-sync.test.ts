import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevCalendarRepository } from "../src/features/calendar/data/DevCalendarRepository.ts";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevNotificationRepository } from "../src/features/notifications/data/DevNotificationRepository.ts";
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "../src/features/notifications/domain/NotificationSettings.ts";
import type { OsPermission, PlatformNotificationPort } from "../src/features/notifications/domain/PlatformNotificationPort.ts";
import { candidateFromReminder, outcomeDueCandidates } from "../src/features/notifications/domain/CenterModel.ts";
import { dueReminders, planReminders } from "../src/features/notifications/domain/ReminderPlanner.ts";
import { REMINDER_PREFIX, SCHEDULE_HORIZON_DAYS, diffSchedule, reminderIdentifier, withinHorizon } from "../src/features/notifications/domain/ReminderReconciler.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createNotificationSync } from "../src/workflows/syncNotifications.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 22, 12, 0);
const TODAY = "2026-10-22";

const rules = { planReminders, dueReminders, candidateFromReminder, outcomeDueCandidates, diffSchedule, reminderIdentifier, withinHorizon, horizonDays: SCHEDULE_HORIZON_DAYS };

/** Внешняя граница — Android: в памяти, с журналом вызовов. */
function fakePlatform(permission: OsPermission = "granted") {
  const scheduled = new Map<string, Date>([["rest-timer:keep", new Date(2030, 0, 1)]]);
  const calls = { schedule: 0, cancel: 0 };
  let failSchedule = false;
  const port: PlatformNotificationPort = {
    permission: async () => permission,
    requestPermission: async () => permission,
    scheduledIds: async () => [...scheduled.keys()],
    schedule: async ({ identifier, fireAt }) => { if (failSchedule) throw new Error("OS_FAILED"); calls.schedule += 1; scheduled.set(identifier, fireAt); },
    cancel: async (ids) => { for (const id of ids) { calls.cancel += 1; scheduled.delete(id); } },
    openSystemSettings: async () => undefined,
  };
  return { port, scheduled, calls, mine: () => [...scheduled.keys()].filter((id) => id.startsWith(REMINDER_PREFIX)),
    failNext: (value: boolean) => { failSchedule = value; } };
}

async function world(permission: OsPermission = "granted", settings: Partial<NotificationSettings> = {}) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const calendar = new DevCalendarRepository(shared, WS);
  await calendar.initialize();
  const center = new DevNotificationRepository(shared, WS);
  await center.initialize();
  await center.saveSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, appointment: { enabled: true, minutesBefore: 60 }, duty: { enabled: true, minutesBefore: 30 }, ...settings });
  const platform = fakePlatform(permission);
  const participants = { listParticipants: async () => (await clients.list("ACTIVE")).map((row) => ({ id: row.id, displayName: row.displayName, emoji: row.emoji, active: true })) };
  const sync = createNotificationSync(rules, { calendar, participants, center, platform: platform.port });
  const type = (await calendar.listSessionTypes()).find((row) => !row.requiresCredit)!;
  const book = (clientId: string | null, startMinute: number, localDate = TODAY) =>
    calendar.createAppointment({ localDate, startMinute, durationMinutes: 60, clientId, guestName: clientId === null ? "Гость" : null, sessionTypeId: type.id, note: null });
  const close = async () => { await center.close(); await calendar.close(); await clients.close(); };
  return { clients, calendar, center, platform, sync, book, close };
}

test("U01 напоминание ставится в ОС за N минут, повтор ничего не меняет, чужие уведомления не трогаются", async () => {
  const w = await world();
  try {
    const client = await w.clients.create({ displayName: "Иван" });
    await w.book(client.id, 15 * 60);
    const first = await w.sync.run(NOW);
    assert.deepEqual({ ...first }, { permission: "granted", scheduled: 1, feedAdded: 0, osError: false });
    assert.equal(w.platform.mine().length, 1);
    const [fireAt] = [...w.platform.scheduled].filter(([id]) => id.startsWith(REMINDER_PREFIX)).map(([, date]) => date);
    assert.equal(fireAt?.getTime(), new Date(2026, 9, 22, 14, 0).getTime());
    await w.sync.run(NOW);
    await w.sync.run(NOW);
    assert.equal(w.platform.calls.schedule, 1, "повторная сверка не планирует заново");
    assert.equal(w.platform.calls.cancel, 0);
    assert.ok(w.platform.scheduled.has("rest-timer:keep"), "таймер отдыха не тронут");
  } finally { await w.close(); }
});

test("U01 перенос и отмена записи заменяют напоминание без дублей", async () => {
  const w = await world();
  try {
    const visit = await w.book(null, 15 * 60);
    await w.sync.run(NOW);
    const moved = await w.calendar.updateAppointment(visit.id, visit.revision, { localDate: TODAY, startMinute: 17 * 60, durationMinutes: 60, clientId: null,
      guestName: "Гость", sessionTypeId: visit.sessionTypeId, note: null });
    await w.sync.run(NOW);
    assert.equal(w.platform.mine().length, 1);
    assert.deepEqual([...w.platform.scheduled].filter(([id]) => id.startsWith(REMINDER_PREFIX)).map(([, date]) => date.getTime()), [new Date(2026, 9, 22, 16, 0).getTime()]);
    await w.calendar.cancelAppointment(moved.id, moved.revision);
    const result = await w.sync.run(NOW);
    assert.equal(w.platform.mine().length, 0);
    assert.equal(result.scheduled, 0);
  } finally { await w.close(); }
});

test("U01 выключенная настройка снимает прежние напоминания; дежурство планируется независимо", async () => {
  const w = await world("granted", { duty: { enabled: true, minutesBefore: 30 } });
  try {
    await w.book(null, 15 * 60);
    await w.calendar.createInterval({ kind: "DUTY", localDate: TODAY, startMinute: 18 * 60, endMinute: 20 * 60 });
    assert.equal((await w.sync.run(NOW)).scheduled, 2);
    await w.center.saveSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, appointment: { enabled: false, minutesBefore: 60 }, duty: { enabled: true, minutesBefore: 30 } });
    assert.equal((await w.sync.run(NOW)).scheduled, 1, "осталось только дежурство");
    await w.center.saveSettings(DEFAULT_NOTIFICATION_SETTINGS);
    assert.equal((await w.sync.run(NOW)).scheduled, 0);
    assert.equal(w.platform.mine().length, 0);
  } finally { await w.close(); }
});

test("U01 без разрешения ОС ничего не планируется и не объявляется, но лента центра работает и ошибки нет", async () => {
  const w = await world("denied");
  try {
    await w.book(null, 12 * 60 + 30);
    const result = await w.sync.run(NOW);
    assert.deepEqual({ ...result }, { permission: "denied", scheduled: 0, feedAdded: 1, osError: false });
    assert.equal(w.platform.calls.schedule, 0);
    assert.equal((await w.center.listFeed()).length, 1);
  } finally { await w.close(); }
});

test("U01 сбой ОС не мешает ленте и не роняет сверку; следующий запуск досчитывает недостающее", async () => {
  const w = await world();
  try {
    await w.book(null, 12 * 60 + 30);
    await w.book(null, 15 * 60);
    w.platform.failNext(true);
    const failed = await w.sync.run(NOW);
    assert.equal(failed.osError, true);
    assert.equal(failed.feedAdded, 1);
    w.platform.failNext(false);
    const healed = await w.sync.run(NOW);
    assert.deepEqual([healed.osError, healed.scheduled, healed.feedAdded], [false, 1, 0]);
  } finally { await w.close(); }
});

test("U01 два одновременных запуска не планируют одно и то же дважды", async () => {
  const w = await world();
  try {
    await w.book(null, 15 * 60);
    await Promise.all([w.sync.run(NOW), w.sync.run(NOW), w.sync.run(NOW)]);
    assert.equal(w.platform.calls.schedule, 1);
    assert.equal(w.platform.mine().length, 1);
  } finally { await w.close(); }
});

test("U02 запись без исхода после окончания попадает в ленту один раз; выбор исхода и свайп не возвращают её", async () => {
  const w = await world("denied");
  try {
    const visit = await w.book(null, 10 * 60);
    assert.equal((await w.sync.run(NOW)).feedAdded, 1);
    assert.equal((await w.sync.run(NOW)).feedAdded, 0);
    const [row] = await w.center.listFeed();
    assert.equal(row?.eventKind, "OUTCOME_DUE");
    await w.center.dismiss(row!.id, NOW);
    await w.sync.run(NOW);
    assert.equal((await w.center.listFeed()).length, 0, "убранная строка не вернулась, а исход записи по-прежнему не выбран");
    assert.equal((await w.calendar.getAppointment(visit.id))?.outcome, null);
  } finally { await w.close(); }
});

test("U02 новая запись в тот же день не смешивает клиентов: событие несёт clientId владельца", async () => {
  const w = await world("denied");
  try {
    const a = await w.clients.create({ displayName: "Анна" });
    const b = await w.clients.create({ displayName: "Борис" });
    await w.book(a.id, 9 * 60);
    await w.book(b.id, 10 * 60);
    await w.sync.run(NOW);
    const feed = await w.center.listFeed();
    assert.deepEqual(feed.map((row) => [row.clientId, row.body.includes(row.clientId === a.id ? "Анна" : "Борис")]), [[b.id, true], [a.id, true]]);
  } finally { await w.close(); }
});
