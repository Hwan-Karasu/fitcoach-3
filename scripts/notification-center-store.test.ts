import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevNotificationRepository, devNotificationClientDeletionParticipant } from
  "../apps/mobile/src/features/notifications/data/DevNotificationRepository.ts";
import type { CenterCandidate } from "../apps/mobile/src/features/notifications/domain/CenterModel.ts";
import { candidateFromReminder, outcomeDueCandidates, retentionCutoff } from "../apps/mobile/src/features/notifications/domain/CenterModel.ts";
import { DEFAULT_NOTIFICATION_SETTINGS } from "../apps/mobile/src/features/notifications/domain/NotificationSettings.ts";
import { dueReminders } from "../apps/mobile/src/features/notifications/domain/ReminderPlanner.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 22, 12, 0);

async function stores(db = new DatabaseSync(":memory:"), workspace = WS, participants = true) {
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, workspace, participants ? [devNotificationClientDeletionParticipant] : []);
  await clients.initialize();
  const center = new DevNotificationRepository(shared, workspace);
  await center.initialize();
  const close = async () => { await center.close(); await clients.close(); };
  return { db, clients, center, close };
}

const event = (sourceId: string, occursAt: Date, patch: Partial<CenterCandidate> = {}): CenterCandidate =>
  ({ sourceType: "APPOINTMENT", sourceId, eventKind: "REMINDER", eventVersion: "v1", clientId: null, title: `Запись ${sourceId}`, body: "тест",
    occursAt: occursAt.toISOString(), ...patch });
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

test("U02 повторная материализация и перепланирование не плодят дубли; новая версия события — новая строка", async () => {
  const { center, close } = await stores();
  try {
    assert.equal(await center.materialize([event("a", minutesAgo(10)), event("b", minutesAgo(5))], NOW), 2);
    assert.equal(await center.materialize([event("a", minutesAgo(10)), event("b", minutesAgo(5))], NOW), 0);
    assert.equal((await center.listFeed()).length, 2);
    assert.equal(await center.materialize([event("a", minutesAgo(1), { eventVersion: "v2" })], NOW), 1, "перенос записи — новое событие");
    assert.deepEqual((await center.listFeed()).map((row) => [row.sourceId, row.eventVersion]), [["a", "v2"], ["b", "v1"], ["a", "v1"]]);
  } finally { await close(); }
});

test("U02 счётчик: три непрочитанных → 3; открыть строку → 2; прочитанная не уменьшает повторно; «Отметить всё» → 0", async () => {
  const { center, close } = await stores();
  try {
    await center.materialize(["a", "b", "c"].map((id, index) => event(id, minutesAgo(30 - index))), NOW);
    assert.equal(await center.unreadCount(), 3);
    const feed = await center.listFeed();
    await center.markRead(feed[0]!.id, NOW);
    assert.equal(await center.unreadCount(), 2);
    await center.markRead(feed[0]!.id, new Date(NOW.getTime() + 60_000));
    assert.equal(await center.unreadCount(), 2);
    assert.equal((await center.listFeed()).find((row) => row.id === feed[0]!.id)?.readAt, NOW.toISOString(), "время прочтения не затирается");
    await center.markAllRead(NOW);
    assert.equal(await center.unreadCount(), 0);
    assert.equal((await center.listFeed()).length, 3, "прочитанные остаются в ленте");
  } finally { await close(); }
});

test("U02 свайп убирает строку и счётчик; та же строка не возвращается из источника; «Отменить» возвращает", async () => {
  const { center, close } = await stores();
  try {
    await center.materialize([event("a", minutesAgo(10)), event("b", minutesAgo(5))], NOW);
    const [first] = await center.listFeed();
    await center.dismiss(first!.id, NOW);
    assert.equal(await center.unreadCount(), 1);
    assert.equal((await center.listFeed()).length, 1);
    assert.equal(await center.materialize([event(first!.sourceId, minutesAgo(5))], NOW), 0, "повторная индексация источника");
    assert.equal((await center.listFeed()).length, 1);
    await center.undoDismiss(first!.id);
    assert.equal((await center.listFeed()).length, 2);
    await assert.rejects(center.dismiss("missing", NOW), { message: "NOTIFICATION_EVENT_NOT_FOUND" });
    await assert.rejects(center.markRead("missing", NOW), { message: "NOTIFICATION_EVENT_NOT_FOUND" });
  } finally { await close(); }
});

test("U02 строка после перезапуска: прочитанное и убранное сохраняются в файле базы", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-notify-"));
  const file = join(dir, "n.db");
  try {
    const first = await stores(new DatabaseSync(file));
    await first.center.materialize([event("a", minutesAgo(10)), event("b", minutesAgo(5)), event("c", minutesAgo(1))], NOW);
    const feed = await first.center.listFeed();
    await first.center.markRead(feed[0]!.id, NOW);
    await first.center.dismiss(feed[1]!.id, NOW);
    await first.close();
    const second = await stores(new DatabaseSync(file));
    assert.equal(await second.center.unreadCount(), 1);
    assert.deepEqual((await second.center.listFeed()).map((row) => row.sourceId), ["c", "a"]);
    assert.equal(await second.center.materialize([event("b", minutesAgo(5))], NOW), 0, "убранная не возвращается после перезапуска");
    await second.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("U02 срок хранения: 90 по умолчанию, выбор 30 сохраняется; старое удаляется и не создаётся заново; «Очистить прочитанные» только убирает", async () => {
  const { center, close } = await stores();
  try {
    assert.equal((await center.getSettings()).retentionDays, 90);
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
    await center.materialize([event("old", daysAgo(60)), event("fresh", daysAgo(2)), event("ancient", daysAgo(100))], NOW);
    assert.deepEqual((await center.listFeed()).map((row) => row.sourceId), ["fresh", "old"], "старше 90 дней не создано");
    await center.saveSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, retentionDays: 30 });
    assert.equal((await center.getSettings()).retentionDays, 30);
    await center.materialize([event("old", daysAgo(60))], NOW);
    assert.deepEqual((await center.listFeed()).map((row) => row.sourceId), ["fresh"], "старая строка удалена и не вернулась");
    const [fresh] = await center.listFeed();
    await center.markRead(fresh!.id, NOW);
    assert.equal(await center.clearRead(NOW), 1);
    assert.equal((await center.listFeed()).length, 0);
    assert.equal(retentionCutoff(30, NOW).toISOString(), new Date(2026, 8, 22, 12, 0).toISOString());
  } finally { await close(); }
});

test("U02 настройки: неверное значение отклонено без записи, исправный выбор читается заново; повреждённый JSON — значения по умолчанию", async () => {
  const { db, center, close } = await stores();
  try {
    await assert.rejects(center.saveSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, appointment: { enabled: true, minutesBefore: 2000 } }), { message: "NOTIFICATION_SETTINGS_INVALID" });
    assert.deepEqual(await center.getSettings(), DEFAULT_NOTIFICATION_SETTINGS);
    const wanted = { ...DEFAULT_NOTIFICATION_SETTINGS, appointment: { enabled: true, minutesBefore: 15 }, quietHours: { enabled: true, startMinute: 1380, endMinute: 420 } };
    await center.saveSettings(wanted);
    assert.deepEqual(await center.getSettings(), wanted);
    db.prepare("UPDATE dev_notification_settings SET settings_json = '{\"retentionDays\":45}'").run();
    assert.deepEqual(await center.getSettings(), DEFAULT_NOTIFICATION_SETTINGS);
    assert.throws(() => db.prepare("UPDATE dev_notification_settings SET settings_json = 'не json'").run());
  } finally { await close(); }
});

test("U02 схема: прочитанное нельзя сделать непрочитанным, содержимое события не правится, чужая identity не дублируется", async () => {
  const { db, center, close } = await stores();
  try {
    await center.materialize([event("a", minutesAgo(10))], NOW);
    const [row] = await center.listFeed();
    await center.markRead(row!.id, NOW);
    assert.throws(() => db.prepare("UPDATE dev_notification_events SET read_at = NULL").run(), /NOTIFICATION_EVENT_IMMUTABLE/u);
    assert.throws(() => db.prepare("UPDATE dev_notification_events SET title = 'другое'").run(), /NOTIFICATION_EVENT_IMMUTABLE/u);
    assert.throws(() => db.prepare("INSERT INTO dev_notification_events (id, workspace_id, source_type, source_id, event_kind, event_version, title, body, occurs_at, created_at) VALUES ('x', ?, 'APPOINTMENT', 'a', 'REMINDER', 'v1', 't', '', 'x', 'x')").run(WS), /UNIQUE/u);
    assert.throws(() => db.prepare("INSERT INTO dev_notification_events (id, workspace_id, source_type, source_id, event_kind, event_version, title, body, occurs_at, created_at) VALUES ('y', ?, 'WATER', 'a', 'REMINDER', 'v1', 't', '', 'x', 'x')").run(WS));
  } finally { await close(); }
});

test("U02 рабочие пространства изолированы; удаление клиента убирает только его события", async () => {
  const db = new DatabaseSync(":memory:");
  const a = await stores(db, WS);
  try {
    const gone = await a.clients.create({ displayName: "SyntheticGone" });
    const stays = await a.clients.create({ displayName: "SyntheticStays" });
    await a.center.materialize([event("g", minutesAgo(5), { clientId: gone.id }), event("s", minutesAgo(4), { clientId: stays.id }), event("guest", minutesAgo(3))], NOW);
    const archived = await a.clients.setArchived(gone.id, gone.revision, true);
    await a.clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.deepEqual((await a.center.listFeed()).map((row) => row.sourceId), ["guest", "s"]);
    assert.equal(await a.center.unreadCount(), 2);
  } finally { await a.close(); }
});

test("U02 центр из календаря: наступившие напоминания и записи без исхода; будущие и разобранные не попадают", () => {
  const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, appointment: { enabled: true, minutesBefore: 60 } };
  const visit = (id: string, startMinute: number, patch = {}) => ({ id, localDate: "2026-10-22", startMinute, lifecycle: "SCHEDULED" as const,
    participantName: "Иван", sessionTypeName: "Персональная", clientId: "c1", ...patch });
  // Сейчас 12:00. Запись в 12:30 → напоминание в 11:30 уже наступило; запись в 14:00 → напоминание в 13:00 ещё впереди; запись в 11:00 уже началась.
  const due = dueReminders({ settings, now: NOW, duties: [], appointments: [visit("soon", 12 * 60 + 30), visit("later", 14 * 60), visit("started", 11 * 60)] });
  assert.deepEqual(due.map((intent) => intent.sourceId), ["soon"]);
  assert.deepEqual(candidateFromReminder(due[0]!), { sourceType: "APPOINTMENT", sourceId: "soon", eventKind: "REMINDER", eventVersion: due[0]!.eventVersion,
    clientId: "c1", title: "Запись 1 ч до начала", body: "12:30 · Иван · Персональная", occursAt: new Date(2026, 9, 22, 11, 30).toISOString() });
  const outcome = (id: string, startMinute: number, patch = {}) => ({ id, localDate: "2026-10-22", startMinute, durationMinutes: 60, lifecycle: "SCHEDULED" as const,
    outcome: null, clientId: null, participantName: null, sessionTypeName: "Консультация", ...patch });
  const pending = outcomeDueCandidates([outcome("over", 10 * 60), outcome("running", 11 * 60 + 30), outcome("done", 9 * 60, { outcome: "COMPLETED" }),
    outcome("cancelled", 8 * 60, { lifecycle: "CANCELLED" })], NOW);
  assert.deepEqual(pending.map((item) => [item.sourceId, item.eventKind, item.eventVersion, item.body]), [["over", "OUTCOME_DUE", "1", "22.10 10:00 · Без имени · Консультация"]]);
  assert.equal(pending[0]?.occursAt, new Date(2026, 9, 22, 11, 0).toISOString());
});
