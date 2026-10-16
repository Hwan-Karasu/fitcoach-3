import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevCalendarRepository, devCalendarClientDeletionParticipant } from
  "../apps/mobile/src/features/calendar/data/DevCalendarRepository.ts";
import type { AppointmentInput } from "../apps/mobile/src/features/calendar/domain/CalendarModel.ts";
import { addMonths, clipToWindow, columnAtX, dragRange, minuteAtY, monthGridWeeks, moveVerdict, slotAtY,
  yOfMinute } from "../apps/mobile/src/features/calendar/domain/CalendarGeometry.ts";
import { addDays, appointmentEnded, appointmentStarted, buildWeekTemplate, isPendingOutcome, mondayOf, monthRange,
  overlaps, validateAppointment,
  weekdayIndex } from "../apps/mobile/src/features/calendar/domain/CalendarRules.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const MONDAY = "2026-10-19";

async function stores(participants = true) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS,
    participants ? [devCalendarClientDeletionParticipant] : []);
  await clients.initialize();
  const calendar = new DevCalendarRepository(shared, WS);
  await calendar.initialize();
  const types = await calendar.listSessionTypes();
  const personal = types.find((type) => type.name === "Персональная тренировка")!;
  const close = async () => { await calendar.close(); await clients.close(); };
  return { db, clients, calendar, personal, close };
}

function slot(overrides: Partial<AppointmentInput> & Pick<AppointmentInput, "sessionTypeId">): AppointmentInput {
  return { localDate: MONDAY, startMinute: 600, durationMinutes: 60, clientId: null,
    guestName: "Guest", note: null, ...overrides };
}

test("K01 calendar arithmetic is wall-clock, Monday-first and half-open", () => {
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(weekdayIndex("2026-10-19"), 0);
  assert.equal(weekdayIndex("2026-10-25"), 6);
  assert.equal(mondayOf("2026-10-25"), "2026-10-19");
  assert.deepEqual({ ...monthRange("2026-02-11") }, { first: "2026-02-01", last: "2026-02-28" });
  assert.deepEqual({ ...monthRange("2026-12-31") }, { first: "2026-12-01", last: "2026-12-31" });
  assert.equal(overlaps(600, 660, 660, 720), false);
  assert.equal(overlaps(600, 690, 660, 720), true);
  const settings = { dayStartMinute: 420, dayEndMinute: 1380, visibleWeekdays: Array(7).fill(true),
    defaultSessionTypeId: null, copyPolicy: { appointments: true, duty: true, blocked: true },
    clearPolicy: { appointments: true, duty: true, blocked: true }, undoCancelPrompt: true };
  assert.equal(validateAppointment(slot({ sessionTypeId: "t", startMinute: 1320 }), settings, true)
    .startMinute, 1320);
  assert.throws(() => validateAppointment(slot({ sessionTypeId: "t", startMinute: 1350 }), settings, true),
    { message: "CALENDAR_OUTSIDE_DAY_RANGE" });
  assert.throws(() => validateAppointment(slot({ sessionTypeId: "t", startMinute: 615 }), settings, true),
    { message: "CALENDAR_TIME_INVALID" });
  assert.throws(() => validateAppointment(slot({ sessionTypeId: "t", guestName: "  ", note: "only note" }),
    settings, true), { message: "CALENDAR_PARTICIPANT_REQUIRED" });
});

test("K01 seeds session types and enforces overlap, Blocked and Duty layers", async () => {
  const { calendar, personal, clients, close } = await stores();
  try {
    assert.deepEqual((await calendar.listSessionTypes()).map((type) => type.name),
      ["Персональная тренировка", "Первичный инструктаж", "Консультация", "Гостевой визит"]);
    const settings = await calendar.getSettings();
    assert.equal(settings.defaultSessionTypeId, personal.id);
    assert.equal(settings.dayStartMinute, 420);
    assert.equal(settings.dayEndMinute, 1380);
    const client = await clients.create({ displayName: "Alpha" });
    const first = await calendar.createAppointment(slot({ sessionTypeId: personal.id,
      clientId: client.id, guestName: "ignored for client" }));
    assert.equal(first.lifecycle, "SCHEDULED");
    assert.equal(first.guestName, null);
    assert.equal(first.sessionTypeName, "Персональная тренировка");
    await assert.rejects(calendar.createAppointment(slot({ sessionTypeId: personal.id, startMinute: 630 })),
      { message: "CALENDAR_TIME_OVERLAP" });
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, startMinute: 660 }));
    await assert.rejects(calendar.createAppointment(slot({ sessionTypeId: personal.id,
      clientId: "missing-client", startMinute: 900 })), /FOREIGN KEY/u);
    await calendar.createInterval({ kind: "DUTY", localDate: MONDAY, startMinute: 540, endMinute: 900 });
    await assert.rejects(calendar.createInterval({ kind: "BLOCKED", localDate: MONDAY,
      startMinute: 600, endMinute: 630 }), { message: "CALENDAR_BLOCKED_OVER_APPOINTMENT" });
    await calendar.createInterval({ kind: "BLOCKED", localDate: MONDAY, startMinute: 780, endMinute: 840 });
    await assert.rejects(calendar.createAppointment(slot({ sessionTypeId: personal.id, startMinute: 810 })),
      { message: "CALENDAR_BLOCKED_TIME" });
    await assert.rejects(calendar.createInterval({ kind: "DUTY", localDate: MONDAY,
      startMinute: 600, endMinute: 660 }), { message: "CALENDAR_TIME_OVERLAP" });
    const range = await calendar.listRange(MONDAY, MONDAY);
    assert.equal(range.appointments.length, 2);
    assert.equal(range.intervals.length, 2);
  } finally { await close(); }
});

test("K01 reschedule keeps the stable ID, refuses stale revisions and leaves neighbours alone", async () => {
  const { calendar, personal, close } = await stores();
  try {
    const a = await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "A" }));
    const b = await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "B",
      startMinute: 720 }));
    const moved = await calendar.updateAppointment(a.id, a.revision, slot({ sessionTypeId: personal.id,
      guestName: "A", localDate: addDays(MONDAY, 1), startMinute: 540, durationMinutes: 90 }));
    assert.equal(moved.id, a.id);
    assert.equal(moved.revision, 2);
    assert.equal(moved.localDate, addDays(MONDAY, 1));
    await assert.rejects(calendar.updateAppointment(a.id, a.revision, slot({ sessionTypeId: personal.id })),
      { message: "CALENDAR_STALE_APPOINTMENT" });
    assert.deepEqual({ ...(await calendar.getAppointment(b.id)) }, { ...b });
    await assert.rejects(calendar.updateAppointment(b.id, b.revision, slot({ sessionTypeId: personal.id,
      guestName: "B", localDate: addDays(MONDAY, 1), startMinute: 570 })),
    { message: "CALENDAR_TIME_OVERLAP" });
    await calendar.cancelAppointment(moved.id, moved.revision);
    assert.equal((await calendar.getAppointment(a.id))?.lifecycle, "CANCELLED");
    await assert.rejects(calendar.cancelAppointment(moved.id, moved.revision + 1),
      { message: "CALENDAR_STALE_APPOINTMENT" });
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "C",
      localDate: addDays(MONDAY, 1), startMinute: 540 }));
    assert.deepEqual((await calendar.summarize(MONDAY, addDays(MONDAY, 6))).map((row) => ({ ...row })), [
      { localDate: MONDAY, appointments: 1 }, { localDate: addDays(MONDAY, 1), appointments: 1 },
    ]);
  } finally { await close(); }
});

test("K01 paste week: existing wins, completed source becomes new SCHEDULED, no settlements copied", async () => {
  const { db, calendar, clients, personal, close } = await stores();
  try {
    const active = await clients.create({ displayName: "Active" });
    const archived = await clients.create({ displayName: "Archived" });
    const target = addDays(MONDAY, 7);
    const thursday = addDays(MONDAY, 3);
    const source = await calendar.createAppointment(slot({ sessionTypeId: personal.id,
      clientId: active.id, localDate: thursday, startMinute: 660, note: "keep note" }));
    db.prepare("UPDATE dev_calendar_appointments SET lifecycle = 'COMPLETED', outcome = 'COMPLETED' WHERE id = ?").run(source.id);
    const cancelled = await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "X" }));
    await calendar.cancelAppointment(cancelled.id, cancelled.revision);
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, clientId: archived.id,
      localDate: addDays(MONDAY, 1) }));
    await calendar.createInterval({ kind: "DUTY", localDate: MONDAY, startMinute: 480, endMinute: 720 });
    await calendar.createInterval({ kind: "BLOCKED", localDate: addDays(MONDAY, 4),
      startMinute: 720, endMinute: 780 });
    const existing = await calendar.createAppointment(slot({ sessionTypeId: personal.id,
      guestName: "Already there", localDate: addDays(target, 3), startMinute: 660 }));
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "Blocks blocked",
      localDate: addDays(target, 4), startMinute: 720 }));
    await clients.setArchived(archived.id, archived.revision, true);
    const template = await calendar.copyWeek(MONDAY);
    assert.equal(template.appointments.length, 2);
    assert.equal(JSON.stringify(template).includes(source.id), false);
    const eligible = new Set([active.id]);
    const first = await calendar.pasteWeek(target, template, eligible);
    assert.deepEqual({ ...first }, { inserted: 1, skippedBusy: 2, skippedUnavailable: 1 });
    const pasted = await calendar.listRange(target, addDays(target, 6));
    assert.ok(pasted.appointments.some((row) => row.id === existing.id && row.guestName === "Already there"));
    assert.equal(pasted.appointments.filter((row) => row.localDate === addDays(target, 3)).length, 1);
    assert.equal(pasted.intervals.filter((row) => row.kind === "BLOCKED").length, 0);
    assert.equal(pasted.intervals.filter((row) => row.kind === "DUTY").length, 1);
    const next = addDays(target, 7);
    const second = await calendar.pasteWeek(next, template, eligible);
    assert.deepEqual({ ...second }, { inserted: 3, skippedBusy: 0, skippedUnavailable: 1 });
    const reused = (await calendar.listRange(addDays(next, 3), addDays(next, 3))).appointments[0]!;
    assert.notEqual(reused.id, source.id);
    assert.equal(reused.lifecycle, "SCHEDULED");
    assert.equal(reused.clientId, active.id);
    assert.equal(reused.note, "keep note");
    assert.equal(reused.revision, 1);
    const built = buildWeekTemplate(MONDAY, [], [], { appointments: true, duty: false, blocked: false });
    assert.equal(built.intervals.length, 0);
  } finally { await close(); }
});

test("K01 clear week cancels future SCHEDULED only, keeps COMPLETED, removes intervals atomically", async () => {
  const { db, calendar, personal, close } = await stores();
  try {
    const done = await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "Done" }));
    db.prepare("UPDATE dev_calendar_appointments SET lifecycle = 'COMPLETED', outcome = 'COMPLETED' WHERE id = ?").run(done.id);
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "Next",
      localDate: addDays(MONDAY, 2) }));
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "Other week",
      localDate: addDays(MONDAY, 7) }));
    await calendar.createInterval({ kind: "DUTY", localDate: MONDAY, startMinute: 480, endMinute: 540 });
    await calendar.createInterval({ kind: "BLOCKED", localDate: addDays(MONDAY, 6),
      startMinute: 480, endMinute: 540 });
    const before = new Date(2026, 9, 18, 12, 0);
    const preview = await calendar.previewClearWeek(MONDAY, before);
    assert.deepEqual({ ...preview }, { scheduledAppointments: 1, pastKept: 1, duty: 1, blocked: 1 });
    assert.equal((await calendar.listRange(MONDAY, addDays(MONDAY, 6))).appointments.length, 2);
    assert.deepEqual({ ...(await calendar.clearWeek(MONDAY, before)) }, { ...preview });
    const left = await calendar.listRange(MONDAY, addDays(MONDAY, 6));
    assert.deepEqual(left.appointments.map((row) => row.id), [done.id]);
    assert.equal(left.intervals.length, 0);
    assert.equal((await calendar.listRange(addDays(MONDAY, 7), addDays(MONDAY, 7))).appointments.length, 1);
  } finally { await close(); }
});

test("§15.8 permanent client delete cancels future and anonymizes past appointments only for that client", async () => {
  const { db, calendar, clients, personal, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "Gone" });
    const stays = await clients.create({ displayName: "Stays" });
    const past = await calendar.createAppointment(slot({ sessionTypeId: personal.id, clientId: gone.id,
      localDate: "2020-01-06", note: "private" }));
    db.prepare("UPDATE dev_calendar_appointments SET lifecycle = 'COMPLETED', outcome = 'COMPLETED' WHERE id = ?").run(past.id);
    const future = await calendar.createAppointment(slot({ sessionTypeId: personal.id, clientId: gone.id,
      localDate: "2099-01-05", note: "private" }));
    const other = await calendar.createAppointment(slot({ sessionTypeId: personal.id, clientId: stays.id,
      localDate: "2099-01-05", startMinute: 720 }));
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    const manifest = await clients.previewPermanentDelete(gone.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "calendar.appointments")?.rows, 2);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    const pastRow = await calendar.getAppointment(past.id);
    assert.equal(pastRow?.lifecycle, "COMPLETED");
    assert.equal(pastRow?.clientId, null);
    assert.equal(pastRow?.participantDeleted, true);
    assert.equal(pastRow?.note, null);
    assert.equal(pastRow?.sessionTypeName, "Персональная тренировка");
    const futureRow = await calendar.getAppointment(future.id);
    assert.equal(futureRow?.lifecycle, "CANCELLED");
    assert.equal(futureRow?.participantDeleted, true);
    assert.deepEqual({ ...(await calendar.getAppointment(other.id)) }, { ...other });
    assert.equal(await clients.get(gone.id), null);
  } finally { await close(); }
});

test("§15.7 without the calendar participant the client delete fails closed", async () => {
  const { calendar, clients, personal, close } = await stores(false);
  try {
    const client = await clients.create({ displayName: "Guarded" });
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, clientId: client.id }));
    const archived = await clients.setArchived(client.id, client.revision, true);
    await assert.rejects(clients.deleteArchivedPermanently(client.id, archived.revision),
      { message: "CLIENT_DELETION_BLOCKED" });
    assert.equal((await clients.get(client.id))?.lifecycle, "ARCHIVED");
  } finally { await close(); }
});

test("L02 pending outcome is wall-clock; schema refuses an outcome that contradicts the lifecycle", async () => {
  const row = { localDate: MONDAY, startMinute: 600, durationMinutes: 60 };
  assert.equal(appointmentStarted(row, new Date(2026, 9, 19, 9, 59)), false);
  assert.equal(appointmentStarted(row, new Date(2026, 9, 19, 10, 0)), true);
  assert.equal(appointmentEnded(row, new Date(2026, 9, 19, 10, 59)), false);
  assert.equal(appointmentEnded(row, new Date(2026, 9, 19, 11, 0)), true);
  assert.equal(appointmentEnded(row, new Date(2026, 9, 20, 0, 0)), true);
  const { db, calendar, clients, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Outcome" });
    const booked = await calendar.createAppointment(slot({ sessionTypeId: personal.id, clientId: client.id }));
    assert.equal(isPendingOutcome(booked, new Date(2026, 9, 19, 11, 0)), true);
    assert.throws(() => db.prepare("UPDATE dev_calendar_appointments SET lifecycle = 'COMPLETED' WHERE id = ?")
      .run(booked.id), /CALENDAR_OUTCOME_LIFECYCLE_MISMATCH/u);
    assert.throws(() => db.prepare("UPDATE dev_calendar_appointments SET outcome = 'MISSED' WHERE id = ?")
      .run(booked.id), /CALENDAR_OUTCOME_LIFECYCLE_MISMATCH/u);
    const done = await calendar.resolveOutcome(booked.id, booked.revision, "COMPLETED", new Date(2026, 9, 19, 11, 0));
    assert.equal(isPendingOutcome(done, new Date(2026, 9, 19, 12, 0)), false);
    assert.deepEqual((await calendar.listRange(MONDAY, MONDAY)).appointments.map((item) => item.outcome), ["COMPLETED"]);
    await assert.rejects(calendar.clearOutcome(done.id, booked.revision), { message: "CALENDAR_STALE_APPOINTMENT" });
  } finally { await close(); }
});

test("K02 §13.23: Y → 30-minute slots; 12:00 vs 12:30, 17:00 vs 17:30, 14:30 stays 14:30", () => {
  const window = { startMinute: 420, endMinute: 1380 };
  const height = 640;
  const yAt = (minute: number) => yOfMinute(minute, height, window);
  assert.equal(slotAtY(yAt(720) + 1, height, window), 720);
  assert.equal(slotAtY(yAt(750) + 1, height, window), 750);
  assert.equal(slotAtY(yAt(750) - 1, height, window), 720);
  assert.equal(slotAtY(yAt(1020) + 2, height, window), 1020);
  assert.equal(slotAtY(yAt(1050) + 2, height, window), 1050);
  assert.equal(slotAtY(yAt(870) + 3, height, window), 870);
  assert.equal(slotAtY(-20, height, window), 420);
  assert.equal(slotAtY(height + 50, height, window), 1350);
  assert.deepEqual({ ...dragRange(slotAtY(yAt(510) + 1, height, window), slotAtY(yAt(660) + 1, height, window)) },
    { start: 510, end: 690 });
  assert.deepEqual({ ...dragRange(660, 510) }, { start: 510, end: 690 });
  assert.equal(columnAtX(0, 280, 7), 0);
  assert.equal(columnAtX(279.9, 280, 7), 6);
  assert.equal(columnAtX(280, 280, 7), null);
  assert.deepEqual({ ...clipToWindow(360, 480, window)! }, { start: 420, end: 480 });
  assert.equal(clipToWindow(1380, 1440, window), null);
  assert.equal(Math.round(minuteAtY(yAt(735), height, window)), 735);
});

test("K02 month grid has 4–6 Monday-first rows; drop preview mirrors overlap and Blocked rules", () => {
  assert.equal(monthGridWeeks("2021-02-10").length, 4);
  assert.equal(monthGridWeeks("2026-02-10").length, 5);
  assert.equal(monthGridWeeks("2026-10-16").length, 5);
  assert.equal(monthGridWeeks("2026-08-01").length, 6);
  assert.equal(monthGridWeeks("2026-10-16")[0]?.[0], "2026-09-28");
  assert.equal(addMonths("2026-12-16", 1), "2027-01-01");
  assert.equal(addMonths("2026-01-31", -1), "2025-12-01");
  const base = { id: "a", localDate: MONDAY, startMinute: 600, durationMinutes: 60, clientId: null, guestName: "A",
    participantDeleted: false, sessionTypeId: "t", sessionTypeName: "T", note: null, creditBypass: false,
    lifecycle: "SCHEDULED" as const, outcome: null, revision: 1 };
  const other = { ...base, id: "b", startMinute: 720 };
  const window = { startMinute: 420, endMinute: 1380 };
  const blocked = [{ id: "x", kind: "BLOCKED" as const, localDate: MONDAY, startMinute: 900, endMinute: 960 },
    { id: "y", kind: "DUTY" as const, localDate: MONDAY, startMinute: 480, endMinute: 1200 }];
  assert.equal(moveVerdict(base, MONDAY, 660, window, [base, other], blocked), "OK");
  assert.equal(moveVerdict(base, MONDAY, 690, window, [base, other], blocked), "OVERLAP");
  assert.equal(moveVerdict(base, MONDAY, 870, window, [base, other], blocked), "BLOCKED");
  assert.equal(moveVerdict(base, MONDAY, 1350, window, [base, other], blocked), "OUTSIDE_WINDOW");
  assert.equal(moveVerdict(base, addDays(MONDAY, 1), 720, window, [base, other], blocked), "OK");
});

test("K02 display settings persist and are validated; they never touch appointments", async () => {
  const { calendar, personal, close } = await stores();
  try {
    const row = await calendar.createAppointment(slot({ sessionTypeId: personal.id, startMinute: 420 }));
    const saved = await calendar.updateDisplaySettings({ visibleWeekdays: [true, true, true, true, true, false, false],
      dayStartMinute: 480, dayEndMinute: 1200 });
    assert.deepEqual({ start: saved.dayStartMinute, end: saved.dayEndMinute }, { start: 480, end: 1200 });
    assert.deepEqual((await calendar.getSettings()).visibleWeekdays, [true, true, true, true, true, false, false]);
    assert.equal((await calendar.getAppointment(row.id))?.startMinute, 420);
    await assert.rejects(calendar.updateDisplaySettings({ visibleWeekdays: Array(7).fill(false),
      dayStartMinute: 480, dayEndMinute: 1200 }), { message: "CALENDAR_SETTINGS_INVALID" });
    await assert.rejects(calendar.updateDisplaySettings({ visibleWeekdays: Array(7).fill(true),
      dayStartMinute: 600, dayEndMinute: 600 }), { message: "CALENDAR_SETTINGS_INVALID" });
    assert.equal((await calendar.getSettings()).dayStartMinute, 480);
  } finally { await close(); }
});

test("§13.8 session types: create, edit keeps snapshots, credit locked once used, archive and default rules", async () => {
  const { calendar, personal, close } = await stores();
  try {
    const stretch = await calendar.createSessionType({ name: "  Растяжка   вдвоём ", category: "TRAINING",
      defaultDurationMinutes: 90, requiresCredit: false, color: "violet" });
    assert.equal(stretch.name, "Растяжка вдвоём");
    assert.equal(stretch.inUse, false);
    await assert.rejects(calendar.createSessionType({ name: " ", category: "TRAINING", defaultDurationMinutes: 60,
      requiresCredit: false, color: null }), { message: "CALENDAR_SESSION_TYPE_INVALID" });
    await assert.rejects(calendar.createSessionType({ name: "X", category: "TRAINING", defaultDurationMinutes: 45,
      requiresCredit: false, color: null }), { message: "CALENDAR_SESSION_TYPE_INVALID" });
    const edited = await calendar.updateSessionType(stretch.id, { name: "Растяжка", category: "OTHER",
      defaultDurationMinutes: 60, requiresCredit: true, color: null });
    assert.deepEqual([edited.requiresCredit, edited.color, edited.category], [true, null, "OTHER"]);
    const booked = await calendar.createAppointment(slot({ sessionTypeId: stretch.id, guestName: "Гость" }));
    await assert.rejects(calendar.updateSessionType(stretch.id, { name: "Растяжка", category: "OTHER",
      defaultDurationMinutes: 60, requiresCredit: false, color: null }), { message: "CALENDAR_SESSION_TYPE_CREDIT_LOCKED" });
    await calendar.updateSessionType(stretch.id, { name: "Стретчинг", category: "OTHER", defaultDurationMinutes: 30,
      requiresCredit: true, color: "teal" });
    assert.equal((await calendar.getAppointment(booked.id))?.sessionTypeName, "Растяжка");
    await assert.rejects(calendar.setSessionTypeArchived(personal.id, true), { message: "CALENDAR_DEFAULT_TYPE_ARCHIVE" });
    await calendar.setSessionTypeArchived(stretch.id, true);
    await assert.rejects(calendar.createAppointment(slot({ sessionTypeId: stretch.id, guestName: "Гость", startMinute: 900 })),
      { message: "CALENDAR_SESSION_TYPE_UNAVAILABLE" });
    await assert.rejects(calendar.setDefaultSessionType(stretch.id), { message: "CALENDAR_SESSION_TYPE_UNAVAILABLE" });
    await calendar.setSessionTypeArchived(stretch.id, false);
    await calendar.setDefaultSessionType(stretch.id);
    assert.equal((await calendar.getSettings()).defaultSessionTypeId, stretch.id);
    assert.equal((await calendar.listSessionTypes()).find((type) => type.id === stretch.id)?.inUse, true);
  } finally { await close(); }
});

test("§13.12/§13.17 copy/clear policies drive the week commands; reset restores safe defaults only", async () => {
  const { calendar, personal, close } = await stores();
  try {
    await calendar.createAppointment(slot({ sessionTypeId: personal.id, guestName: "Гость" }));
    await calendar.createInterval({ kind: "DUTY", localDate: MONDAY, startMinute: 480, endMinute: 540 });
    await calendar.updatePolicies({ copyPolicy: { appointments: false, duty: true, blocked: true },
      clearPolicy: { appointments: false, duty: true, blocked: false } });
    const template = await calendar.copyWeek(MONDAY);
    assert.deepEqual([template.appointments.length, template.intervals.length], [0, 1]);
    const before = new Date(2026, 9, 18, 12, 0);
    assert.deepEqual({ ...(await calendar.previewClearWeek(MONDAY, before)) },
      { scheduledAppointments: 0, pastKept: 1, duty: 1, blocked: 0 });
    await calendar.setUndoCancelPrompt(false);
    const other = await calendar.createSessionType({ name: "Другой", category: "OTHER", defaultDurationMinutes: 60,
      requiresCredit: false, color: null });
    await calendar.setDefaultSessionType(other.id);
    await calendar.updateDisplaySettings({ visibleWeekdays: [true, true, true, true, true, false, false],
      dayStartMinute: 480, dayEndMinute: 1200 });
    const reset = await calendar.resetSettings();
    assert.deepEqual({ ...reset.copyPolicy }, { appointments: true, duty: true, blocked: true });
    assert.deepEqual({ ...reset.clearPolicy }, { appointments: true, duty: true, blocked: true });
    assert.equal(reset.undoCancelPrompt, true);
    assert.equal(reset.defaultSessionTypeId, personal.id);
    assert.equal(reset.dayStartMinute, 480);
    assert.equal((await calendar.listRange(MONDAY, MONDAY)).appointments.length, 1);
  } finally { await close(); }
});
