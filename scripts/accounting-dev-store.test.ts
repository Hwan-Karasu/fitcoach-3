import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevAccountingRepository, devAccountingCalendarHook, devAccountingClientDeletionParticipant } from
  "../apps/mobile/src/features/accounting/data/DevAccountingRepository.ts";
import { choosePack, formatKopeks, parseRublesToKopeks, pricePerSessionKopeks } from
  "../apps/mobile/src/features/accounting/domain/AccountingRules.ts";
import { DevCalendarRepository, devCalendarClientDeletionParticipant } from
  "../apps/mobile/src/features/calendar/data/DevCalendarRepository.ts";
import type { AppointmentInput } from "../apps/mobile/src/features/calendar/domain/CalendarModel.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const FUTURE = "2099-03-02";
const PAST = "2020-03-02";

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS,
    [devAccountingClientDeletionParticipant, devCalendarClientDeletionParticipant]);
  await clients.initialize();
  const calendar = new DevCalendarRepository(shared, WS, devAccountingCalendarHook);
  await calendar.initialize();
  const accounting = new DevAccountingRepository(shared, WS);
  await accounting.initialize();
  const types = await calendar.listSessionTypes();
  const personal = types.find((type) => type.requiresCredit)!;
  const consultation = types.find((type) => type.name === "Консультация")!;
  const close = async () => { await accounting.close(); await calendar.close(); await clients.close(); };
  return { db, clients, calendar, accounting, personal, consultation, close };
}

function slot(clientId: string | null, sessionTypeId: string, overrides: Partial<AppointmentInput> = {}): AppointmentInput {
  return { localDate: FUTURE, startMinute: 600, durationMinutes: 60, clientId,
    guestName: clientId === null ? "Guest" : null, sessionTypeId, note: null, ...overrides };
}

const pack = (count: number, overrides = {}) => ({ title: `Пакет ${count}`, creditScope: "GENERAL" as const,
  sessionTypeId: null, sessionTypeName: null, grantedCount: count, totalKopeks: count * 170_000,
  expiresOn: null, ...overrides });

test("L01 money is exact kopeks and allocation prefers type-specific, then nearest expiry", () => {
  assert.equal(parseRublesToKopeks("8 000"), 800_000);
  assert.equal(parseRublesToKopeks("1700,5"), 170_050);
  assert.equal(parseRublesToKopeks("1700,555"), "invalid");
  assert.equal(parseRublesToKopeks(""), "empty");
  assert.equal(formatKopeks(1_500_000), "15 000 ₽");
  assert.equal(formatKopeks(170_050), "1 700,50 ₽");
  assert.equal(pricePerSessionKopeks(1_500_000, 10), 150_000);
  const base = { createdAt: "2026-01-01", available: 1 };
  const candidates = [
    { ...base, id: "general-late", creditScope: "GENERAL" as const, sessionTypeId: null, expiresOn: "2026-12-31" },
    { ...base, id: "general-soon", creditScope: "GENERAL" as const, sessionTypeId: null, expiresOn: "2026-11-01" },
    { ...base, id: "typed", creditScope: "SESSION_TYPE" as const, sessionTypeId: "t1", expiresOn: null },
    { ...base, id: "expired", creditScope: "SESSION_TYPE" as const, sessionTypeId: "t1", expiresOn: "2026-01-01" },
  ];
  assert.equal(choosePack(candidates, "t1", "2026-10-16")?.id, "typed");
  assert.equal(choosePack(candidates, "t2", "2026-10-16")?.id, "general-soon");
  assert.equal(choosePack(candidates.map((row) => ({ ...row, available: 0 })), "t1", "2026-10-16"), null);
});

test("ACC-01/02/04 reservation is not USED; two reconciles give exactly one USED; EXTERNAL untouched", async () => {
  const { db, clients, calendar, accounting, personal, consultation, close } = await stores();
  try {
    const fit = await clients.create({ displayName: "Fit" });
    const ext = await clients.create({ displayName: "External" });
    await accounting.setClientMode(fit.id, "FITCOACH");
    await accounting.setClientMode(ext.id, "EXTERNAL");
    await assert.rejects(calendar.createAppointment(slot(fit.id, personal.id)),
      { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    assert.equal((await calendar.listRange(FUTURE, FUTURE)).appointments.length, 0);
    const bypass = await calendar.createAppointment(slot(fit.id, personal.id, { creditBypass: true, startMinute: 480 }));
    assert.equal(await accounting.appointmentCredit(bypass.id), "NONE");
    await accounting.createPack(fit.id, pack(5));
    assert.deepEqual({ ...(await accounting.bookingContext(fit.id, personal.id, true)) },
      { kind: "AVAILABLE", available: 5 });
    const booked = await calendar.createAppointment(slot(fit.id, personal.id));
    assert.equal(await accounting.appointmentCredit(booked.id), "RESERVED");
    const free = await calendar.createAppointment(slot(fit.id, consultation.id, { startMinute: 720 }));
    assert.equal(await accounting.appointmentCredit(free.id), "NONE");
    const external = await calendar.createAppointment(slot(ext.id, personal.id, { startMinute: 840 }));
    assert.equal(await accounting.appointmentCredit(external.id), "NONE");
    let snapshot = await accounting.getClientSnapshot(fit.id);
    assert.equal(snapshot.available, 4);
    assert.equal(snapshot.reserved, 1);
    assert.equal(snapshot.ledger.filter((row) => row.entryType === "USED").length, 0);
    const end = new Date(2099, 2, 2, 11, 0);
    assert.deepEqual({ ...(await accounting.reconcileDue(new Date(2099, 2, 2, 10, 59))) }, { settled: 0 });
    assert.deepEqual({ ...(await accounting.reconcileDue(end)) }, { settled: 1 });
    assert.deepEqual({ ...(await accounting.reconcileDue(end)) }, { settled: 0 });
    snapshot = await accounting.getClientSnapshot(fit.id);
    assert.equal(snapshot.ledger.filter((row) => row.entryType === "USED").length, 1);
    assert.equal(snapshot.available, 4);
    assert.equal(snapshot.reserved, 0);
    assert.equal(await accounting.appointmentCredit(booked.id), "USED");
    assert.equal((await calendar.getAppointment(booked.id))?.lifecycle, "SCHEDULED");
    assert.equal((await accounting.getClientSnapshot(ext.id)).ledger.length, 0);
    assert.throws(() => db.exec("UPDATE dev_credit_ledger SET delta = -2"), /ACCOUNTING_LEDGER_APPEND_ONLY/u);
    assert.throws(() => db.exec("DELETE FROM dev_credit_ledger"), /ACCOUNTING_LEDGER_APPEND_ONLY/u);
  } finally { await close(); }
});

test("L01 reschedule keeps the reservation; reassignment and mode changes move it atomically", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const a = await clients.create({ displayName: "A" });
    const b = await clients.create({ displayName: "B" });
    for (const client of [a, b]) {
      await accounting.setClientMode(client.id, "FITCOACH");
      await accounting.createPack(client.id, pack(1));
    }
    const booked = await calendar.createAppointment(slot(a.id, personal.id));
    const moved = await calendar.updateAppointment(booked.id, booked.revision,
      slot(a.id, personal.id, { startMinute: 900, localDate: "2099-03-03" }));
    assert.equal(moved.id, booked.id);
    assert.equal(await accounting.appointmentCredit(booked.id), "RESERVED");
    assert.equal((await accounting.getClientSnapshot(a.id)).ledger.length, 1);
    const reassigned = await calendar.updateAppointment(moved.id, moved.revision,
      slot(b.id, personal.id, { startMinute: 900, localDate: "2099-03-03" }));
    assert.equal((await accounting.getClientSnapshot(a.id)).available, 1);
    assert.equal((await accounting.getClientSnapshot(b.id)).available, 0);
    const c = await clients.create({ displayName: "C" });
    await accounting.setClientMode(c.id, "FITCOACH");
    await assert.rejects(calendar.updateAppointment(reassigned.id, reassigned.revision,
      slot(c.id, personal.id, { startMinute: 900, localDate: "2099-03-03" })),
    { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    assert.equal((await calendar.getAppointment(reassigned.id))?.clientId, b.id);
    assert.equal((await accounting.getClientSnapshot(b.id)).reserved, 1);
    await accounting.setClientMode(b.id, "UNTRACKED");
    assert.equal(await accounting.appointmentCredit(reassigned.id), "NONE");
    assert.equal((await accounting.getClientSnapshot(b.id)).ledger.length, 1);
  } finally { await close(); }
});

test("ACC-05 cancellation settlement: return releases, charge uses once, return after USED compensates", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Settle" });
    await accounting.setClientMode(client.id, "FITCOACH");
    await accounting.createPack(client.id, pack(3));
    const first = await calendar.createAppointment(slot(client.id, personal.id));
    await calendar.cancelAppointment(first.id, first.revision, "RETURN");
    assert.equal(await accounting.appointmentCredit(first.id), "NONE");
    const second = await calendar.createAppointment(slot(client.id, personal.id, { startMinute: 720 }));
    await calendar.cancelAppointment(second.id, second.revision, "CHARGE");
    assert.equal(await accounting.appointmentCredit(second.id), "USED");
    const third = await calendar.createAppointment(slot(client.id, personal.id, { localDate: PAST }));
    await accounting.reconcileDue(new Date(2026, 9, 16, 12, 0));
    assert.equal(await accounting.appointmentCredit(third.id), "USED");
    await assert.rejects(calendar.updateAppointment(third.id, third.revision + 0,
      slot(client.id, personal.id, { localDate: PAST, creditBypass: true })),
    { message: "ACCOUNTING_ALREADY_SETTLED" });
    await calendar.cancelAppointment(third.id, third.revision, "CHARGE");
    let snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.ledger.filter((row) => row.entryType === "USED").length, 2);
    const fourth = await calendar.createAppointment(slot(client.id, personal.id, { localDate: PAST, startMinute: 720 }));
    await accounting.reconcileDue(new Date(2026, 9, 16, 12, 0));
    await calendar.cancelAppointment(fourth.id, fourth.revision, "RETURN");
    assert.equal(await accounting.appointmentCredit(fourth.id), "RETURNED");
    snapshot = await accounting.getClientSnapshot(client.id);
    const returned = snapshot.ledger.find((row) => row.entryType === "RETURNED");
    assert.ok(returned?.sourceEntryId);
    assert.equal(snapshot.ledger.find((row) => row.id === returned.sourceEntryId)?.entryType, "USED");
    assert.equal(snapshot.available, 1);
  } finally { await close(); }
});

test("L01 clear week releases only; paste recalculates credits and never inherits bypass", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Weekly" });
    await accounting.setClientMode(client.id, "FITCOACH");
    await accounting.createPack(client.id, pack(2));
    await calendar.createAppointment(slot(client.id, personal.id));
    await calendar.createAppointment(slot(client.id, personal.id, { startMinute: 720, creditBypass: true }));
    assert.equal((await accounting.getClientSnapshot(client.id)).reserved, 1);
    const monday = "2099-03-02";
    const template = await calendar.copyWeek(monday);
    const result = await calendar.pasteWeek("2099-03-09", template, new Set([client.id]));
    assert.deepEqual({ ...result }, { inserted: 1, skippedBusy: 0, skippedUnavailable: 1 });
    const pasted = (await calendar.listRange("2099-03-09", "2099-03-15")).appointments;
    assert.equal(pasted.length, 1);
    assert.equal(pasted[0]?.creditBypass, false);
    assert.equal((await accounting.getClientSnapshot(client.id)).reserved, 2);
    const summary = await calendar.clearWeek(monday);
    assert.equal(summary.scheduledAppointments, 2);
    const snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.reserved, 1);
    assert.equal(snapshot.ledger.filter((row) => row.entryType === "USED").length, 0);
  } finally { await close(); }
});

test("L01 payments and adjustments are separate append-only facts; no hidden negative balance", async () => {
  const { clients, accounting, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Payer" });
    const created = await accounting.createPack(client.id, pack(10, { totalKopeks: 1_500_000,
      creditScope: "SESSION_TYPE", sessionTypeId: personal.id, sessionTypeName: personal.name }));
    await accounting.recordPayment(client.id, { packId: created.id, amountKopeks: 1_000_000,
      paidOn: "2026-10-16", method: "transfer", note: null });
    await accounting.recordPayment(client.id, { packId: created.id, amountKopeks: 500_000,
      paidOn: "2026-10-17", method: "cash", note: "остаток" });
    await assert.rejects(accounting.recordPayment(client.id, { packId: null, amountKopeks: 0,
      paidOn: "2026-10-16", method: "cash", note: null }), { message: "ACCOUNTING_PAYMENT_INVALID" });
    await assert.rejects(accounting.adjust(client.id, created.id, -11, "ошибка"),
      { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    await accounting.adjust(client.id, created.id, -2, "перенос из старой системы");
    const snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.mode, "UNTRACKED");
    assert.equal(snapshot.inheritedMode, true);
    assert.equal(snapshot.packs[0]?.paidKopeks, 1_500_000);
    assert.equal(snapshot.packs[0]?.available, 8);
    assert.equal(snapshot.payments.length, 2);
    assert.deepEqual(snapshot.ledger.map((row) => row.entryType).sort(), ["ADJUSTMENT", "ISSUED"]);
    await assert.rejects(accounting.createPack(client.id, pack(1, { creditScope: "SESSION_TYPE",
      sessionTypeId: null })), { message: "ACCOUNTING_PACK_SCOPE_INVALID" });
  } finally { await close(); }
});

test("§15.7 permanent client delete purges packs, ledger, reservations and payments only for that client", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "Gone" });
    const stays = await clients.create({ displayName: "Stays" });
    for (const client of [gone, stays]) {
      await accounting.setClientMode(client.id, "FITCOACH");
      const created = await accounting.createPack(client.id, pack(2));
      await accounting.recordPayment(client.id, { packId: created.id, amountKopeks: 100,
        paidOn: "2026-10-16", method: "cash", note: null });
    }
    const past = await calendar.createAppointment(slot(gone.id, personal.id, { localDate: PAST }));
    await accounting.reconcileDue(new Date(2026, 9, 16));
    await calendar.cancelAppointment(past.id, past.revision, "RETURN");
    await calendar.createAppointment(slot(gone.id, personal.id));
    await calendar.createAppointment(slot(stays.id, personal.id, { startMinute: 720 }));
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    const manifest = await clients.previewPermanentDelete(gone.id);
    assert.ok((manifest.owners.find((entry) => entry.owner === "accounting.client")?.rows ?? 0) >= 6);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    const removed = await accounting.getClientSnapshot(gone.id);
    assert.equal(removed.packs.length + removed.ledger.length + removed.payments.length, 0);
    const kept = await accounting.getClientSnapshot(stays.id);
    assert.equal(kept.packs.length, 1);
    assert.equal(kept.reserved, 1);
    assert.equal(kept.payments.length, 1);
  } finally { await close(); }
});

const at = (hour: number, minute = 0) => new Date(2099, 2, 2, hour, minute);
const usedCount = async (accounting: DevAccountingRepository, clientId: string, type = "USED") =>
  (await accounting.getClientSnapshot(clientId)).ledger.filter((row) => row.entryType === type).length;

test("L02 outcome after time settlement: one USED, switching outcomes keeps it, Отменена returns once", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const fit = await clients.create({ displayName: "Fit" });
    await accounting.setClientMode(fit.id, "FITCOACH");
    await accounting.createPack(fit.id, pack(3));
    const booked = await calendar.createAppointment(slot(fit.id, personal.id));
    const guest = await calendar.createAppointment(slot(null, personal.id, { startMinute: 480 }));
    assert.equal((await calendar.listPendingOutcomes(at(8, 59))).length, 0);
    assert.deepEqual((await calendar.listPendingOutcomes(at(11))).map((row) => row.id), [guest.id, booked.id]);
    await accounting.reconcileDue(at(11));
    assert.equal(await usedCount(accounting, fit.id), 1);
    assert.equal((await calendar.getAppointment(booked.id))?.outcome, null);
    const missed = await calendar.resolveOutcome(booked.id, booked.revision, "MISSED", at(11));
    assert.equal(missed.lifecycle, "COMPLETED");
    assert.equal(missed.outcome, "MISSED");
    assert.deepEqual((await calendar.listPendingOutcomes(at(12))).map((row) => row.id), [guest.id]);
    await assert.rejects(calendar.resolveOutcome(booked.id, booked.revision, "COMPLETED", at(11)),
      { message: "CALENDAR_STALE_APPOINTMENT" });
    const done = await calendar.resolveOutcome(booked.id, missed.revision, "COMPLETED", at(11));
    assert.equal(done.outcome, "COMPLETED");
    assert.equal(await usedCount(accounting, fit.id), 1);
    const undone = await calendar.clearOutcome(done.id, done.revision);
    assert.equal(undone.lifecycle, "SCHEDULED");
    assert.equal(undone.outcome, null);
    assert.equal(await usedCount(accounting, fit.id), 1);
    assert.deepEqual((await calendar.listPendingOutcomes(at(12))).map((row) => row.id), [guest.id, booked.id]);
    const cancelled = await calendar.resolveOutcome(undone.id, undone.revision, "CANCELLED", at(12));
    assert.equal(cancelled.lifecycle, "CANCELLED");
    assert.equal(cancelled.outcome, "CANCELLED");
    assert.equal((await calendar.listRange(FUTURE, FUTURE)).appointments.some((row) => row.id === booked.id), false);
    assert.equal(await usedCount(accounting, fit.id, "RETURNED"), 1);
    assert.equal(await accounting.appointmentCredit(booked.id), "RETURNED");
    assert.equal((await accounting.getClientSnapshot(fit.id)).available, 3);
    await assert.rejects(calendar.resolveOutcome(booked.id, cancelled.revision, "CANCELLED", at(12)),
      { message: "CALENDAR_STALE_APPOINTMENT" });
    assert.deepEqual({ ...(await accounting.reconcileDue(at(23))) }, { settled: 0 });
    assert.equal(await usedCount(accounting, fit.id), 1);
  } finally { await close(); }
});

test("L02 early outcome uses the reservation once; early Отменена releases; untracked gets no ledger", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const fit = await clients.create({ displayName: "Fit" });
    const ext = await clients.create({ displayName: "External" });
    await accounting.setClientMode(fit.id, "FITCOACH");
    await accounting.setClientMode(ext.id, "EXTERNAL");
    await accounting.createPack(fit.id, pack(2));
    const first = await calendar.createAppointment(slot(fit.id, personal.id));
    await assert.rejects(calendar.resolveOutcome(first.id, first.revision, "COMPLETED", at(9, 59)),
      { message: "CALENDAR_OUTCOME_TOO_EARLY" });
    await calendar.resolveOutcome(first.id, first.revision, "COMPLETED", at(10, 30));
    assert.equal(await accounting.appointmentCredit(first.id), "USED");
    assert.equal((await accounting.getClientSnapshot(fit.id)).reserved, 0);
    const second = await calendar.createAppointment(slot(fit.id, personal.id, { startMinute: 720 }));
    await calendar.resolveOutcome(second.id, second.revision, "CANCELLED", at(9));
    assert.equal(await accounting.appointmentCredit(second.id), "NONE");
    assert.deepEqual({ ...(await accounting.reconcileDue(at(23))) }, { settled: 0 });
    assert.equal(await usedCount(accounting, fit.id), 1);
    assert.equal((await accounting.getClientSnapshot(fit.id)).available, 1);
    const external = await calendar.createAppointment(slot(ext.id, personal.id, { startMinute: 840 }));
    await calendar.resolveOutcome(external.id, external.revision, "MISSED", at(15));
    assert.equal((await accounting.getClientSnapshot(ext.id)).ledger.length, 0);
  } finally { await close(); }
});

test("ACC-05 Исправить клиента: RETURNED for A and USED for B in one tx; untracked side untouched", async () => {
  const { db, clients, calendar, accounting, personal, close } = await stores();
  try {
    const a = await clients.create({ displayName: "A" });
    const b = await clients.create({ displayName: "B" });
    const untracked = await clients.create({ displayName: "Untracked" });
    const empty = await clients.create({ displayName: "No pack" });
    for (const client of [a, b, empty]) await accounting.setClientMode(client.id, "FITCOACH");
    await accounting.createPack(a.id, pack(2));
    await accounting.createPack(b.id, pack(1));
    const booked = await calendar.createAppointment(slot(a.id, personal.id));
    const future = await calendar.createAppointment(slot(a.id, personal.id, { startMinute: 900 }));
    await accounting.reconcileDue(at(11));
    let row = await calendar.resolveOutcome(booked.id, booked.revision, "COMPLETED", at(11));
    await assert.rejects(calendar.correctClient(future.id, future.revision, b.id, at(11)),
      { message: "CALENDAR_CORRECTION_INVALID" });
    await assert.rejects(calendar.correctClient(row.id, row.revision, a.id, at(11)),
      { message: "CALENDAR_CORRECTION_INVALID" });
    await assert.rejects(calendar.correctClient(row.id, row.revision, empty.id, at(11)),
      { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    assert.equal((await calendar.getAppointment(row.id))?.clientId, a.id);
    assert.equal(await usedCount(accounting, a.id, "RETURNED"), 0);
    row = await calendar.correctClient(row.id, row.revision, b.id, at(12));
    assert.equal(row.clientId, b.id);
    assert.equal(row.outcome, "COMPLETED");
    const aLedger = (await accounting.getClientSnapshot(a.id)).ledger;
    const returned = aLedger.find((entry) => entry.entryType === "RETURNED");
    assert.equal(aLedger.find((entry) => entry.id === returned?.sourceEntryId)?.entryType, "USED");
    assert.equal((await accounting.getClientSnapshot(a.id)).available, 1);
    assert.equal(await usedCount(accounting, b.id), 1);
    assert.equal((await accounting.getClientSnapshot(b.id)).available, 0);
    assert.equal(await accounting.appointmentCredit(row.id), "USED");
    row = await calendar.correctClient(row.id, row.revision, untracked.id, at(12));
    assert.equal(await usedCount(accounting, b.id, "RETURNED"), 1);
    assert.equal((await accounting.getClientSnapshot(untracked.id)).ledger.length, 0);
    assert.equal(await accounting.appointmentCredit(row.id), "RETURNED");
    row = await calendar.correctClient(row.id, row.revision, a.id, at(12));
    assert.equal(await usedCount(accounting, a.id), 2);
    assert.equal((await accounting.getClientSnapshot(a.id)).available, 0);
    const effective = db.prepare("SELECT sum(delta) AS n FROM dev_credit_ledger WHERE appointment_id = ?")
      .get(row.id) as { n: number };
    assert.equal(effective.n, -1);
  } finally { await close(); }
});

test("L02 clear week leaves started rows alone: their outcome and USED stay, only the future is released", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Past week" });
    await accounting.setClientMode(client.id, "FITCOACH");
    await accounting.createPack(client.id, pack(3));
    const done = await calendar.createAppointment(slot(client.id, personal.id));
    const pending = await calendar.createAppointment(slot(client.id, personal.id, { startMinute: 660 }));
    const running = await calendar.createAppointment(slot(null, personal.id, { startMinute: 750 }));
    const future = await calendar.createAppointment(slot(client.id, personal.id, { localDate: "2099-03-04" }));
    await calendar.createInterval({ kind: "DUTY", localDate: FUTURE, startMinute: 480, endMinute: 540 });
    await calendar.createInterval({ kind: "DUTY", localDate: "2099-03-04", startMinute: 480, endMinute: 540 });
    const now = at(13);
    await accounting.reconcileDue(now);
    await calendar.resolveOutcome(done.id, done.revision, "COMPLETED", now);
    const preview = await calendar.previewClearWeek(FUTURE, now);
    assert.deepEqual({ ...preview }, { scheduledAppointments: 1, pastKept: 3, duty: 1, blocked: 0 });
    assert.deepEqual({ ...(await calendar.clearWeek(FUTURE, now)) }, { ...preview });
    assert.equal((await calendar.getAppointment(done.id))?.outcome, "COMPLETED");
    assert.equal((await calendar.getAppointment(pending.id))?.lifecycle, "SCHEDULED");
    assert.equal((await calendar.getAppointment(running.id))?.lifecycle, "SCHEDULED");
    assert.equal((await calendar.getAppointment(future.id))?.lifecycle, "CANCELLED");
    assert.equal(await accounting.appointmentCredit(pending.id), "USED");
    assert.equal(await accounting.appointmentCredit(future.id), "NONE");
    assert.equal(await usedCount(accounting, client.id), 2);
    assert.equal(await usedCount(accounting, client.id, "RETURNED"), 0);
    const intervals = (await calendar.listRange(FUTURE, "2099-03-08")).intervals;
    assert.deepEqual(intervals.map((row) => row.localDate), [FUTURE]);
  } finally { await close(); }
});

test("L02 «Вернуть» after Отменена restores the outcome with one effective USED or the reservation", async () => {
  const { db, clients, calendar, accounting, personal, close } = await stores();
  try {
    const fit = await clients.create({ displayName: "Undo" });
    await accounting.setClientMode(fit.id, "FITCOACH");
    await accounting.createPack(fit.id, pack(6));
    const effective = (id: string) => (db.prepare("SELECT COALESCE(sum(delta), 0) AS n FROM dev_credit_ledger WHERE appointment_id = ?")
      .get(id) as { n: number }).n;
    const done = await calendar.createAppointment(slot(fit.id, personal.id));
    await accounting.reconcileDue(at(11));
    const closed = await calendar.resolveOutcome(done.id, done.revision, "COMPLETED", at(11));
    let cancelled = await calendar.resolveOutcome(done.id, closed.revision, "CANCELLED", at(11));
    assert.equal(effective(done.id), 0);
    const back = await calendar.restoreCancelled(done.id, cancelled.revision, "COMPLETED", at(11));
    assert.equal(back.lifecycle, "COMPLETED");
    assert.equal(back.outcome, "COMPLETED");
    assert.equal(effective(done.id), -1);
    assert.equal(await accounting.appointmentCredit(done.id), "USED");
    await assert.rejects(calendar.restoreCancelled(done.id, back.revision, null, at(11)),
      { message: "CALENDAR_RESTORE_INVALID" });

    const pending = await calendar.createAppointment(slot(fit.id, personal.id, { startMinute: 660 }));
    cancelled = await calendar.resolveOutcome(pending.id, pending.revision, "CANCELLED", at(13));
    const again = await calendar.restoreCancelled(pending.id, cancelled.revision, null, at(13));
    assert.equal(again.lifecycle, "SCHEDULED");
    assert.equal(effective(pending.id), -1);
    assert.deepEqual((await calendar.listPendingOutcomes(at(13))).map((row) => row.id), [pending.id]);

    const future = await calendar.createAppointment(slot(fit.id, personal.id, { startMinute: 900 }));
    cancelled = await calendar.resolveOutcome(future.id, future.revision, "CANCELLED", at(9));
    assert.equal(await accounting.appointmentCredit(future.id), "NONE");
    await assert.rejects(calendar.restoreCancelled(future.id, cancelled.revision, "COMPLETED", at(9)),
      { message: "CALENDAR_RESTORE_INVALID" });
    await calendar.restoreCancelled(future.id, cancelled.revision, null, at(9));
    assert.equal(await accounting.appointmentCredit(future.id), "RESERVED");
    assert.equal(effective(future.id), 0);

    const taken = await calendar.createAppointment(slot(fit.id, personal.id, { startMinute: 1020 }));
    cancelled = await calendar.resolveOutcome(taken.id, taken.revision, "CANCELLED", at(9));
    await calendar.createAppointment(slot(null, personal.id, { startMinute: 1020 }));
    await assert.rejects(calendar.restoreCancelled(taken.id, cancelled.revision, null, at(9)),
      { message: "CALENDAR_TIME_OVERLAP" });

    const deleted = await calendar.createAppointment(slot(fit.id, personal.id, { startMinute: 1140 }));
    await calendar.cancelAppointment(deleted.id, deleted.revision, "RETURN");
    await assert.rejects(calendar.restoreCancelled(deleted.id, deleted.revision + 1, null, at(9)),
      { message: "CALENDAR_RESTORE_INVALID" });

    assert.equal((await calendar.getSettings()).undoCancelPrompt, true);
    await calendar.setUndoCancelPrompt(false);
    assert.equal((await calendar.getSettings()).undoCancelPrompt, false);
  } finally { await close(); }
});

test("L02 guest becomes a client: same-name records move, past visits stay free, future ones book or bypass", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const guest = (name: string, overrides: Partial<AppointmentInput> = {}) =>
      calendar.createAppointment({ ...slot(null, personal.id, overrides), guestName: name });
    const past = await guest("Анна К", { startMinute: 480 });
    const future = await guest("  анна   к ", { localDate: "2099-03-03" });
    const other = await guest("Борис", { startMinute: 720 });
    const gone = await guest("Анна К", { startMinute: 900 });
    const goneCancelled = await calendar.resolveOutcome(gone.id, gone.revision, "CANCELLED", at(9));
    assert.equal(await calendar.countSameGuest(past.id), 1);
    const anna = await clients.create({ displayName: "Анна К" });
    await accounting.setClientMode(anna.id, "FITCOACH");
    await accounting.createPack(anna.id, pack(1));
    await assert.rejects(calendar.linkGuestToClient(past.id, past.revision + 1, anna.id, true, at(12)),
      { message: "CALENDAR_STALE_APPOINTMENT" });
    assert.equal(await calendar.linkGuestToClient(past.id, past.revision, anna.id, true, at(12)), 2);
    const linkedPast = await calendar.getAppointment(past.id);
    assert.equal(linkedPast?.clientId, anna.id);
    assert.equal(linkedPast?.guestName, null);
    assert.equal(await accounting.appointmentCredit(past.id), "NONE");
    assert.equal((await calendar.getAppointment(future.id))?.clientId, anna.id);
    assert.equal(await accounting.appointmentCredit(future.id), "RESERVED");
    assert.equal((await calendar.getAppointment(other.id))?.guestName, "Борис");
    assert.equal((await calendar.getAppointment(goneCancelled.id))?.guestName, "Анна К");
    assert.equal((await accounting.getClientSnapshot(anna.id)).ledger.filter((row) => row.entryType === "USED").length, 0);
    await assert.rejects(calendar.linkGuestToClient(past.id, null, anna.id, false, at(12)),
      { message: "CALENDAR_GUEST_LINK_INVALID" });

    const vera = await clients.create({ displayName: "Вера" });
    await accounting.setClientMode(vera.id, "FITCOACH");
    const booked = await guest("Вера", { localDate: "2099-03-04" });
    assert.equal(await calendar.linkGuestToClient(booked.id, null, vera.id, false, at(12)), 1);
    const veraRow = await calendar.getAppointment(booked.id);
    assert.equal(veraRow?.clientId, vera.id);
    assert.equal(veraRow?.creditBypass, true);
    assert.equal(await accounting.appointmentCredit(booked.id), "NONE");
  } finally { await close(); }
});
