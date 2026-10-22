import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { derivePackPricing } from "../apps/mobile/src/features/accounting/domain/PackPricing.ts";
import { devAccountingCatalog, DEV_ACCOUNTING_LEDGER } from "../apps/mobile/src/features/accounting/data/DevAccountingCatalog.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { accountingHistoryDate, shiftAccountingMonth } from "../apps/mobile/src/features/accounting/presentation/accountingHistoryPeriod.ts";
import { DevAccountingRepository, devAccountingCalendarHook, devAccountingClientDeletionParticipant } from
  "../apps/mobile/src/features/accounting/data/DevAccountingRepository.ts";
import { choosePack, chooseManualWriteOffPack, formatKopeks, lastReturnableDebit, parseRublesToKopeks, pricePerSessionKopeks } from
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


test("стоимость пакета: количество × цена занятия, точные копейки и пересчёт при изменении количества", () => {
  assert.deepEqual(derivePackPricing("10", "", "1500", "SESSION"),
    { count: 10, totalKopeks: 1500000, totalText: "15000", sessionText: "1500" });
  assert.deepEqual(derivePackPricing("12", "", "1 700,50", "SESSION"),
    { count: 12, totalKopeks: 2040600, totalText: "20406", sessionText: "1 700,50" });
  assert.equal(derivePackPricing("3", "", "0,10", "SESSION").totalKopeks, 30, "не использовать float рубли");
  assert.equal(derivePackPricing("4", "", "3333,33", "SESSION").totalText, "13333,32");
});

test("стоимость пакета: при вводе общей суммы цена занятия справочная, её округление не меняет сумму", () => {
  const three = derivePackPricing("3", "10000", "", "TOTAL");
  assert.equal(three.totalKopeks, 1000000);
  assert.equal(three.sessionText, "3333,33");
  const four = derivePackPricing("4", three.totalText, three.sessionText, "TOTAL");
  assert.equal(four.totalKopeks, 1000000);
  assert.equal(four.sessionText, "2500");
  assert.equal(derivePackPricing("10", "15 000,50", "999", "TOTAL").sessionText, "1500,05", "последнее изменённое поле задаёт второе");
});

test("стоимость пакета: неполный/невалидный ввод не выдаётся за ноль, явный ноль допустим", () => {
  for (const count of ["", "0", "-1", "1001", "1,5", "abc"]) {
    const result = derivePackPricing(count, "", "1500", "SESSION");
    assert.equal(result.count, null);
    assert.equal(result.totalKopeks, "invalid");
    assert.equal(result.totalText, "");
  }
  for (const amount of ["-1", "1,234", "abc"]) {
    assert.equal(derivePackPricing("10", "", amount, "SESSION").totalKopeks, "invalid");
    assert.equal(derivePackPricing("10", amount, "", "TOTAL").totalKopeks, "invalid");
  }
  assert.equal(derivePackPricing("10", "", "", "SESSION").totalKopeks, "empty");
  assert.equal(derivePackPricing("10", "", "", "TOTAL").sessionText, "");
  assert.equal(derivePackPricing("10", "", "0", "SESSION").totalKopeks, 0);
});

test("пакет из цены занятия: сохраняется вычисленная общая стоимость, оплата не начисляет повторно занятия", async () => {
  const { clients, accounting, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticPackPrice" });
    const pricing = derivePackPricing("10", "", "1700,50", "SESSION");
    assert.equal(typeof pricing.totalKopeks, "number");
    const created = await accounting.createPack(client.id, pack(pricing.count!, { totalKopeks: pricing.totalKopeks }));
    const before = await accounting.getClientSnapshot(client.id);
    assert.equal(before.packs[0]?.pack.totalKopeks, 1700500);
    assert.equal(before.packs[0]?.pack.grantedCount, 10);
    await accounting.recordPayment(client.id, { packId: created.id, amountKopeks: 1700500, paidOn: "2026-10-20", method: "transfer", note: null });
    const after = await accounting.getClientSnapshot(client.id);
    assert.equal(after.ledger.length, before.ledger.length);
    assert.equal(after.packs[0]?.paidKopeks, 1700500);
  } finally { await close(); }
});


test("основной пакет: новые записи берут выбранный; старые резервы, перенос и списания не меняются", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "PreferredSynthetic" });
    await accounting.setClientMode(client.id, "FITCOACH");
    const general = await accounting.createPack(client.id, pack(3));
    const typed = await accounting.createPack(client.id, pack(3, { title: "Typed", creditScope: "SESSION_TYPE", sessionTypeId: personal.id, sessionTypeName: personal.name }));
    const first = await calendar.createAppointment(slot(client.id, personal.id));
    assert.equal((await accounting.getClientSnapshot(client.id)).packs.find((p) => p.pack.id === typed.id)?.reserved, 1);
    await accounting.setPreferredPack(client.id, general.id);
    const second = await calendar.createAppointment(slot(client.id, personal.id, { startMinute: 660 }));
    const selected = await accounting.getClientSnapshot(client.id);
    assert.equal(selected.preferredPackId, general.id);
    assert.equal(selected.packs.find((p) => p.pack.id === general.id)?.reserved, 1);
    assert.equal(selected.packs.find((p) => p.pack.id === typed.id)?.reserved, 1);
    assert.deepEqual(await accounting.bookingContext(client.id, personal.id, true), { kind: "AVAILABLE", available: 2, preferredPackTitle: general.title });
    await accounting.setPreferredPack(client.id, typed.id);
    await calendar.updateAppointment(second.id, second.revision, slot(client.id, personal.id, { localDate: "2099-03-03", startMinute: 660 }));
    await accounting.reconcileDue(new Date(2099, 2, 4));
    const done = await accounting.getClientSnapshot(client.id);
    assert.equal(done.ledger.find((row) => row.appointmentId === first.id && row.entryType === "USED")?.packId, typed.id);
    assert.equal(done.ledger.find((row) => row.appointmentId === second.id && row.entryType === "USED")?.packId, general.id);
    await accounting.setPreferredPack(client.id, null);
    assert.equal((await accounting.getClientSnapshot(client.id)).preferredPackId, null);
  } finally { await close(); }
});

test("основной пакет: исчерпание и несовпадение типа не приводят к тихому списанию из другого пакета", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "PreferredEmpty" });
    await accounting.setClientMode(client.id, "FITCOACH");
    const chosen = await accounting.createPack(client.id, pack(1, { creditScope: "SESSION_TYPE", sessionTypeId: personal.id, sessionTypeName: personal.name }));
    const fallback = await accounting.createPack(client.id, pack(5));
    await accounting.setPreferredPack(client.id, chosen.id);
    const other = await calendar.createSessionType({ name: "Other paid", category: "TRAINING", defaultDurationMinutes: 60, requiresCredit: true, color: null });
    assert.deepEqual(await accounting.bookingContext(client.id, other.id, true), { kind: "PREFERRED_UNAVAILABLE" });
    await assert.rejects(calendar.createAppointment(slot(client.id, other.id)), { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    await calendar.createAppointment(slot(client.id, personal.id));
    assert.deepEqual(await accounting.bookingContext(client.id, personal.id, true), { kind: "PREFERRED_UNAVAILABLE" });
    await assert.rejects(calendar.createAppointment(slot(client.id, personal.id, { startMinute: 660 })), { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    assert.equal((await accounting.getClientSnapshot(client.id)).packs.find((p) => p.pack.id === fallback.id)?.reserved, 0);
    await accounting.setPreferredPack(client.id, null);
    await calendar.createAppointment(slot(client.id, personal.id, { startMinute: 660 }));
    assert.equal((await accounting.getClientSnapshot(client.id)).packs.find((p) => p.pack.id === fallback.id)?.reserved, 1);
  } finally { await close(); }
});

test("основной пакет: срок действия, изоляция клиентов, повторное чтение и удаление клиента", async () => {
  const { db, clients, accounting, close } = await stores();
  try {
    const a = await clients.create({ displayName: "PreferredA" });
    const b = await clients.create({ displayName: "PreferredB" });
    const own = await accounting.createPack(a.id, pack(2));
    const expired = await accounting.createPack(a.id, pack(2, { expiresOn: PAST }));
    const foreign = await accounting.createPack(b.id, pack(2));
    await accounting.setPreferredPack(a.id, own.id);
    await assert.rejects(accounting.setPreferredPack(a.id, foreign.id), { message: "ACCOUNTING_PREFERRED_PACK_INVALID" });
    await assert.rejects(accounting.setPreferredPack(a.id, expired.id), { message: "ACCOUNTING_PREFERRED_PACK_INVALID" });
    assert.throws(() => db.prepare("UPDATE dev_client_preferred_packs SET pack_id = ? WHERE workspace_id = ? AND client_id = ?").run(foreign.id, WS, a.id), /FOREIGN KEY/u);
    assert.equal((await accounting.getClientSnapshot(a.id)).preferredPackId, own.id);
    assert.equal((await accounting.getClientSnapshot(b.id)).preferredPackId, null);
    const archived = await clients.setArchived(a.id, a.revision, true);
    await clients.deleteArchivedPermanently(a.id, archived.revision);
    assert.equal((await accounting.getClientSnapshot(a.id)).preferredPackId, null);
    assert.equal((await accounting.getClientSnapshot(b.id)).packs[0]?.pack.id, foreign.id);
  } finally { await close(); }
});

test("пакет с оплатой: сумма и дата сохраняются вместе, дата создания пакета остаётся фактической", async () => {
  const { clients, accounting, close } = await stores();
  try {
    const client = await clients.create({ displayName: "PackAndPayment" });
    const created = await accounting.createPack(client.id, pack(10, { payment: { paidOn: "2026-10-15", method: "cash" } }));
    const snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.packs.length, 1);
    assert.equal(snapshot.ledger.filter((r) => r.entryType === "ISSUED").length, 1);
    assert.equal(snapshot.payments.length, 1);
    assert.equal(snapshot.payments[0]?.packId, created.id);
    assert.equal(snapshot.payments[0]?.amountKopeks, created.totalKopeks);
    assert.equal(snapshot.payments[0]?.paidOn, "2026-10-15");
    assert.equal(snapshot.payments[0]?.method, "cash");
    assert.equal(snapshot.payments[0]?.createdAt, created.createdAt);
    assert.equal(snapshot.packs[0]?.paidKopeks, created.totalKopeks);
    assert.equal(snapshot.packs[0]?.ledgerBalance, 10);
    await accounting.createPack(client.id, pack(3));
    assert.equal((await accounting.getClientSnapshot(client.id)).payments.length, 1, "пакет без оплаты её не создаёт");
  } finally { await close(); }
});

test("пакет с оплатой: неверная дата и ошибка записи оплаты не оставляют частичный пакет или начисление", async () => {
  const { db, clients, accounting, close } = await stores();
  try {
    const client = await clients.create({ displayName: "AtomicPackPayment" });
    const seen: unknown[] = [];
    accounting.subscribeCommittedChanges((change) => seen.push(change));
    await assert.rejects(accounting.createPack(client.id, pack(10, { payment: { paidOn: "2026-02-30", method: "cash" } })), { message: "ACCOUNTING_PAYMENT_INVALID" });
    db.exec("CREATE TRIGGER synthetic_payment_failure BEFORE INSERT ON dev_payment_records BEGIN SELECT RAISE(ABORT, 'synthetic payment failure'); END");
    await assert.rejects(accounting.createPack(client.id, pack(10, { payment: { paidOn: "2026-10-20", method: "transfer" } })), /synthetic payment failure/u);
    const snapshot = await accounting.getClientSnapshot(client.id);
    assert.deepEqual([snapshot.packs.length, snapshot.ledger.length, snapshot.payments.length], [0, 0, 0]);
    assert.deepEqual(seen, []);
  } finally { await close(); }
});

test("миграция основного пакета v1→v2 сохраняет прежние пакеты/оплаты и автоматический режим", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const calendar = new DevCalendarRepository(shared, WS);
  await calendar.initialize();
  const client = await clients.create({ displayName: "AccountingV1" });
  await runMigrations(new WriterCoordinator(nodeSqlitePort(db)), devAccountingCatalog.filter((m) => m.version === 1), DEV_ACCOUNTING_LEDGER);
  db.prepare("INSERT INTO dev_client_accounting (workspace_id, client_id, mode) VALUES (?, ?, 'FITCOACH')").run(WS, client.id);
  db.prepare("INSERT INTO dev_session_packs (id, workspace_id, client_id, title, credit_scope, granted_count, total_kopeks, created_at) VALUES ('old-pack', ?, ?, 'Old', 'GENERAL', 10, 1000000, '2026-10-01T12:00:00Z')").run(WS, client.id);
  db.prepare("INSERT INTO dev_credit_ledger (id, workspace_id, client_id, pack_id, entry_type, delta, operation_key, created_at) VALUES ('old-issued', ?, ?, 'old-pack', 'ISSUED', 10, 'issued:old-pack', '2026-10-01T12:00:00Z')").run(WS, client.id);
  db.prepare("INSERT INTO dev_payment_records (id, workspace_id, client_id, pack_id, amount_kopeks, paid_on, method, created_at) VALUES ('old-payment', ?, ?, 'old-pack', 1000000, '2026-10-01', 'cash', '2026-10-01T12:00:00Z')").run(WS, client.id);
  const accounting = new DevAccountingRepository(shared, WS);
  await accounting.initialize();
  try {
    const snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.preferredPackId, null);
    assert.equal(snapshot.available, 10);
    assert.equal(snapshot.packs[0]?.paidKopeks, 1000000);
    await accounting.setPreferredPack(client.id, "old-pack");
    assert.equal((await accounting.getClientSnapshot(client.id)).preferredPackId, "old-pack");
  } finally { await accounting.close(); await calendar.close(); await clients.close(); }
});

test("история: навигация по месяцам переносит год вперёд и назад", () => {
  assert.equal(shiftAccountingMonth("2026-12", 1), "2027-01");
  assert.equal(shiftAccountingMonth("2026-01", -1), "2025-12");
  assert.equal(shiftAccountingMonth("2026-10", -12), "2025-10");
  assert.equal(shiftAccountingMonth("2026-10", 1), "2026-11");
});

test("история: месяц оплаты определяется указанной датой оплаты, месяц занятий — локальной датой записи", () => {
  const at = new Date(2026, 9, 20, 12).toISOString();
  assert.equal(accountingHistoryDate(at), "2026-10-20");
  assert.equal(accountingHistoryDate(at, "2025-12-31"), "2025-12-31");
  assert.equal(accountingHistoryDate(at, "2026-09-30").slice(0, 7), "2026-09");
});

test("A02 ручное списание берёт пакет с ближайшим сроком; истёкший и пустой не участвуют", () => {
  const base = { creditScope: "GENERAL" as const, sessionTypeId: null, available: 3 };
  const candidates = [
    { ...base, id: "no-expiry", expiresOn: null, createdAt: "2026-01-01" },
    { ...base, id: "soon", expiresOn: "2026-11-01", createdAt: "2026-02-01" },
    { ...base, id: "expired", expiresOn: "2026-01-01", createdAt: "2025-01-01" },
    { ...base, id: "empty", expiresOn: "2026-10-30", createdAt: "2025-01-01", available: 0 },
  ];
  assert.equal(chooseManualWriteOffPack(candidates, "2026-10-22", null)?.id, "soon");
  assert.equal(chooseManualWriteOffPack(candidates, "2026-10-22", "no-expiry")?.id, "no-expiry");
  assert.equal(chooseManualWriteOffPack(candidates, "2026-10-22", "empty"), null, "выбранный пустой пакет не заменяется другим");
  assert.equal(chooseManualWriteOffPack([], "2026-10-22", null), null);
});

test("A02 последнее списание: возвращённое пропускается, списания на несколько занятий и выдача не возвращаются", () => {
  const entry = (id: string, entryType: "USED" | "ADJUSTMENT" | "RETURNED" | "ISSUED", delta: number, sourceEntryId: string | null = null) =>
    ({ id, entryType, delta, sourceEntryId });
  // От новых к старым.
  assert.equal(lastReturnableDebit([entry("r2", "RETURNED", 1, "d2"), entry("d3", "ADJUSTMENT", -1), entry("d2", "USED", -1), entry("i", "ISSUED", 5)]), "d3");
  assert.equal(lastReturnableDebit([entry("r3", "RETURNED", 1, "d3"), entry("d3", "ADJUSTMENT", -1), entry("r2", "RETURNED", 1, "d2"), entry("d2", "USED", -1)]), null);
  assert.equal(lastReturnableDebit([entry("a", "ADJUSTMENT", -3), entry("b", "ADJUSTMENT", 2), entry("i", "ISSUED", 5)]), null);
  assert.equal(lastReturnableDebit([]), null);
});

test("A02 «Списать» и «Отменить»: факты не удаляются, возврат один, пустой журнал нечего возвращать", async () => {
  const { clients, accounting, close } = await stores();
  try {
    const client = await clients.create({ displayName: "WriteOff" });
    await accounting.setClientMode(client.id, "FITCOACH");
    await assert.rejects(accounting.writeOff(client.id), { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    await assert.rejects(accounting.returnLastDebit(client.id, "any"), { message: "ACCOUNTING_NOTHING_TO_RETURN" });
    await accounting.createPack(client.id, pack(2));
    await accounting.writeOff(client.id);
    let snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.available, 1);
    const debit = snapshot.ledger.find((row) => row.entryType === "ADJUSTMENT");
    assert.equal(debit?.delta, -1);
    assert.equal(debit?.reason, "Ручное списание");
    assert.equal(snapshot.returnableDebitId, debit?.id);
    await accounting.returnLastDebit(client.id, debit!.id);
    snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.available, 2);
    assert.equal(snapshot.ledger.length, 3, "выдача, списание и возврат — три факта");
    const returned = snapshot.ledger.find((row) => row.entryType === "RETURNED");
    assert.equal(returned?.delta, 1);
    assert.equal(returned?.sourceEntryId, debit!.id);
    assert.equal(snapshot.returnableDebitId, null);
    await assert.rejects(accounting.returnLastDebit(client.id, debit!.id), { message: "ACCOUNTING_NOTHING_TO_RETURN" });
    assert.equal((await accounting.getClientSnapshot(client.id)).available, 2);
  } finally { await close(); }
});

test("A02 списать нельзя ниже нуля; два списания возвращаются от последнего к первому; устаревшая кнопка отклоняется", async () => {
  const { clients, accounting, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Order" });
    await accounting.setClientMode(client.id, "FITCOACH");
    await accounting.createPack(client.id, pack(2));
    await accounting.writeOff(client.id);
    const firstId = (await accounting.getClientSnapshot(client.id)).returnableDebitId!;
    await accounting.writeOff(client.id);
    await assert.rejects(accounting.writeOff(client.id), { message: "ACCOUNTING_INSUFFICIENT_CREDIT" });
    const secondId = (await accounting.getClientSnapshot(client.id)).returnableDebitId!;
    assert.notEqual(secondId, firstId);
    await assert.rejects(accounting.returnLastDebit(client.id, firstId), { message: "ACCOUNTING_STALE" });
    assert.equal((await accounting.getClientSnapshot(client.id)).available, 0);
    await accounting.returnLastDebit(client.id, secondId);
    assert.equal((await accounting.getClientSnapshot(client.id)).returnableDebitId, firstId);
    await accounting.returnLastDebit(client.id, firstId);
    assert.equal((await accounting.getClientSnapshot(client.id)).available, 2);
  } finally { await close(); }
});

test("A02 «Отменить» возвращает автосписание по записи: запись не меняется, занятие помечено возвращённым, отмена записи не возвращает второй раз", async () => {
  const { clients, calendar, accounting, personal, close } = await stores();
  try {
    const client = await clients.create({ displayName: "AutoUsed" });
    await accounting.setClientMode(client.id, "FITCOACH");
    await accounting.createPack(client.id, pack(3));
    const visit = await calendar.createAppointment(slot(client.id, personal.id, { localDate: PAST }));
    await accounting.reconcileDue(new Date(2026, 9, 16, 12, 0));
    assert.equal(await accounting.appointmentCredit(visit.id), "USED");
    let snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.available, 2);
    await accounting.returnLastDebit(client.id, snapshot.returnableDebitId!);
    assert.equal(await accounting.appointmentCredit(visit.id), "RETURNED");
    assert.equal((await calendar.getAppointment(visit.id))?.lifecycle, "SCHEDULED");
    snapshot = await accounting.getClientSnapshot(client.id);
    assert.equal(snapshot.available, 3);
    assert.equal(snapshot.returnableDebitId, null);
    await calendar.cancelAppointment(visit.id, visit.revision, "RETURN");
    const after = await accounting.getClientSnapshot(client.id);
    assert.equal(after.available, 3, "возврат записью календаря не дублирует возврат с Главной");
    assert.equal(after.ledger.filter((row) => row.entryType === "RETURNED").length, 1);
  } finally { await close(); }
});

test("A02 схема: второй возврат того же списания и возврат не-списания отвергаются самой базой", async () => {
  const { db, clients, accounting, close } = await stores();
  try {
    const client = await clients.create({ displayName: "Schema" });
    const other = await clients.create({ displayName: "Other" });
    await accounting.setClientMode(client.id, "FITCOACH");
    await accounting.createPack(client.id, pack(2));
    await accounting.createPack(other.id, pack(2));
    await accounting.writeOff(client.id);
    const snapshot = await accounting.getClientSnapshot(client.id);
    const debit = snapshot.returnableDebitId!;
    const issued = snapshot.ledger.find((row) => row.entryType === "ISSUED")!;
    const packId = issued.packId;
    const insert = (id: string, source: string, packOf: string, owner: string) => db.prepare(
      "INSERT INTO dev_credit_ledger (id, workspace_id, client_id, pack_id, source_entry_id, entry_type, delta, operation_key, created_at) VALUES (?, ?, ?, ?, ?, 'RETURNED', 1, ?, 'x')")
      .run(id, WS, owner, packOf, source, id);
    assert.throws(() => insert("bad-issued", issued.id, packId, client.id), /ACCOUNTING_RETURN_SOURCE_INVALID/u);
    const otherPack = (await accounting.getClientSnapshot(other.id)).packs[0]!.pack.id;
    assert.throws(() => insert("bad-owner", debit, otherPack, other.id), /ACCOUNTING_RETURN_SOURCE_INVALID/u);
    insert("good", debit, packId, client.id);
    assert.throws(() => insert("twice", debit, packId, client.id), /UNIQUE/u);
  } finally { await close(); }
});

test("A02 списание одного клиента не затрагивает другого; окончательное удаление клиента убирает и его возвраты", async () => {
  const { clients, accounting, close } = await stores();
  try {
    const a = await clients.create({ displayName: "A" });
    const b = await clients.create({ displayName: "B" });
    for (const client of [a, b]) { await accounting.setClientMode(client.id, "FITCOACH"); await accounting.createPack(client.id, pack(2)); }
    await accounting.writeOff(a.id);
    await accounting.returnLastDebit(a.id, (await accounting.getClientSnapshot(a.id)).returnableDebitId!);
    await accounting.writeOff(b.id);
    assert.equal((await accounting.getClientSnapshot(a.id)).available, 2);
    assert.equal((await accounting.getClientSnapshot(b.id)).available, 1);
    await assert.rejects(accounting.returnLastDebit(a.id, (await accounting.getClientSnapshot(b.id)).returnableDebitId!),
      { message: "ACCOUNTING_NOTHING_TO_RETURN" });
    const archived = await clients.setArchived(a.id, a.revision, true);
    await clients.deleteArchivedPermanently(a.id, archived.revision);
    assert.equal((await accounting.getClientSnapshot(a.id)).ledger.length, 0);
    assert.equal((await accounting.getClientSnapshot(b.id)).ledger.length, 2);
  } finally { await close(); }
});
