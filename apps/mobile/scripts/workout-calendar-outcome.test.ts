import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createLocalRepositories } from "../src/app/composition/createLocalRepositories.ts";
import type { SystemCatalog } from "../src/features/exercises/public.ts";
import { DevAccountingRepository, devAccountingCalendarHook } from "../src/features/accounting/data/DevAccountingRepository.ts";
import { DevCalendarRepository, devCalendarClientDeletionParticipant } from "../src/features/calendar/data/DevCalendarRepository.ts";
import type { AppointmentInput } from "../src/features/calendar/domain/CalendarModel.ts";
import { pickStartedPending } from "../src/features/calendar/domain/CalendarRules.ts";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, fillSets, newDraft } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createWorkoutOutcomeWorkflow } from "../src/workflows/completeWorkoutWithAppointment.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// ADR-048: «Завершить тренировку» отмечает сегодняшнюю начавшуюся запись клиента в календаре. Время — параметром `at`.
const WS = "synthetic-workspace-a";
const TODAY = "2026-10-28";
const at = (hour: number, minute = 0) => new Date(2026, 9, 28, hour, minute);

async function setup(options: Readonly<{ credit?: boolean }> = {}) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devCalendarClientDeletionParticipant, devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const calendar = new DevCalendarRepository(shared, WS, options.credit === true ? devAccountingCalendarHook : null);
  await calendar.initialize();
  const accounting = new DevAccountingRepository(shared, WS);
  await accounting.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  const a = (await clients.create({ displayName: "SyntheticA" })).id;
  const b = (await clients.create({ displayName: "SyntheticB" })).id;
  const personal = (await calendar.listSessionTypes()).find((type) => type.requiresCredit)!;
  if (options.credit === true) {
    await accounting.setClientMode(a, "FITCOACH");
    await accounting.createPack(a, { title: "Пакет 2", creditScope: "GENERAL", sessionTypeId: null, sessionTypeName: null, grantedCount: 2, totalKopeks: 340_000, expiresOn: null });
  }
  const program = await plans.createProgram({ kind: "PERIODIZED", title: "Проверка", clientIds: [a] });
  let n = 0;
  const draft = fillSets(addExercise(newDraft("w1"), "w1", "e1", "sys:repdb:bench", () => `s${n++}`), "e1", "reps", 10);
  const created = await plans.createMesocycle(a, program.id, program.revision, { title: "Блок", weeks: 1, firstWeek: draft.plan.workouts, clientIds: [a] });
  const workoutId = (await plans.getPeriodizedPlan(a, program.id))!.mesocycles[0]!.weeks[0]!.workouts[0]!.id;
  void created;
  const slot = { clientId: a, programId: program.id, weekIndex: 1, plannedWorkoutId: workoutId };
  const lease = await shared.acquire();
  const transaction = <T>(task: (tx: never) => Promise<T>) => lease.writer.write(task as never) as Promise<T>;
  const workflow = createWorkoutOutcomeWorkflow(transaction as never, execution.outcomeParticipant, calendar.outcomeParticipant);
  const book = (overrides: Partial<AppointmentInput>) => calendar.createAppointment({ localDate: TODAY, startMinute: 1080, durationMinutes: 60,
    clientId: a, guestName: null, note: null, sessionTypeId: personal.id, ...overrides });
  const outcomes = async () => (await calendar.listRange(TODAY, "2026-10-30")).appointments.map((item) => [item.startMinute, item.localDate, item.outcome]);
  return { a, b, slot, workflow, book, outcomes, calendar, execution, shared, accounting,
    close: async () => { await shared.release(); await accounting.close(); await execution.close(); await plans.close(); await calendar.close(); await clients.close(); } };
}

test("ADR-048 запись сегодня 18:00, завершение в 18:30: запись «Проведена», подсказка с временем начала", async () => {
  const env = await setup();
  try {
    await env.book({});
    const result = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(18, 30));
    assert.deepEqual(result.calendar, { kind: "MARKED", startMinute: 1080 });
    assert.equal(result.session.outcome, "COMPLETED");
    assert.deepEqual(await env.outcomes(), [[1080, TODAY, "COMPLETED"]]);
  } finally { await env.close(); }
});

test("ADR-048 запись ещё не началась, чужая, на другой день или уже с исходом — не трогается", async () => {
  const env = await setup();
  try {
    await env.book({ startMinute: 1080 });
    const early = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(17, 50));
    assert.equal(early.calendar, null, "в 17:50 запись на 18:00 ещё не началась");
    assert.deepEqual(await env.outcomes(), [[1080, TODAY, null]]);
  } finally { await env.close(); }
  const other = await setup();
  try {
    await other.book({ clientId: other.b, startMinute: 600 });
    await other.book({ localDate: "2026-10-29", startMinute: 600 });
    await other.book({ clientId: null, guestName: "Гость", startMinute: 660 });
    const result = await other.workflow.setOutcome(other.slot, "COMPLETED", null, at(18, 30));
    assert.equal(result.calendar, null);
    assert.deepEqual((await other.outcomes()).map((row) => row[2]), [null, null, null]);
  } finally { await other.close(); }
  const resolved = await setup();
  try {
    const manual = await resolved.book({ startMinute: 600 });
    await resolved.calendar.resolveOutcome(manual.id, manual.revision, "MISSED", at(18, 0));
    const result = await resolved.workflow.setOutcome(resolved.slot, "COMPLETED", null, at(18, 30));
    assert.equal(result.calendar, null, "запись, отмеченная вручную, не перезаписывается");
    assert.deepEqual(await resolved.outcomes(), [[600, TODAY, "MISSED"]]);
  } finally { await resolved.close(); }
});

test("ADR-048 две начавшиеся записи сегодня: отмечается та, что началась позже", async () => {
  const env = await setup();
  try {
    await env.book({ startMinute: 600 });
    await env.book({ startMinute: 960 });
    const result = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(18, 30));
    assert.deepEqual(result.calendar, { kind: "MARKED", startMinute: 960 });
    assert.deepEqual(await env.outcomes(), [[600, TODAY, null], [960, TODAY, "COMPLETED"]]);
  } finally { await env.close(); }
});

test("ADR-048 тренировка с датой не сегодня (импорт) календарь не трогает", async () => {
  const env = await setup();
  try {
    await env.book({});
    // Выполнение создано вчера: дата тренировки — вчера, сегодняшнее завершение её не меняет.
    const yesterday = new Date(2026, 9, 27, 12, 0);
    const session = await env.execution.setOutcome(env.slot, null, null, yesterday);
    const result = await env.workflow.setOutcome(env.slot, "COMPLETED", session.revision, at(18, 30));
    assert.equal(result.session.actualDate, "2026-10-27");
    assert.equal(result.calendar, null);
    assert.deepEqual(await env.outcomes(), [[1080, TODAY, null]]);
  } finally { await env.close(); }
});

test("ADR-048 «Отменить завершение» снимает исход записи, повторное завершение отмечает ту же запись; «Пропущена» календарь не трогает", async () => {
  const env = await setup();
  try {
    await env.book({});
    const done = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(18, 30));
    const undone = await env.workflow.setOutcome(env.slot, null, done.session.revision, at(18, 40));
    assert.deepEqual(undone.calendar, { kind: "CLEARED", startMinute: 1080 });
    assert.deepEqual(await env.outcomes(), [[1080, TODAY, null]]);
    const again = await env.workflow.setOutcome(env.slot, "COMPLETED", undone.session.revision, at(18, 50));
    assert.deepEqual(again.calendar, { kind: "MARKED", startMinute: 1080 });
    const missed = await env.workflow.setOutcome(env.slot, "MISSED", again.session.revision, at(19, 0));
    assert.deepEqual(missed.calendar, { kind: "CLEARED", startMinute: 1080 }, "смена «Завершена» на другой исход снимает отметку");
    const final = await env.workflow.setOutcome(env.slot, "CANCELLED", missed.session.revision, at(19, 5));
    assert.equal(final.calendar, null, "«Пропущена»/«Отменена» запись календаря сами не отмечают");
  } finally { await env.close(); }
});

test("AUD28-02 после смены даты тренировки отмена завершения уведомляет календарь за день записи, а не тренировки", async () => {
  const env = await setup();
  try {
    await env.book({});
    const done = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(18, 30));
    const moved = await env.execution.setActualDate(env.slot, "2026-10-27", done.session.revision, at(18, 35));
    const changes: unknown[] = [];
    const unsubscribe = env.calendar.subscribeCommittedChanges((change) => changes.push(change.dates));
    const undone = await env.workflow.setOutcome(env.slot, null, moved.revision, at(18, 40));
    unsubscribe();
    assert.deepEqual(undone.calendar, { kind: "CLEARED", startMinute: 1080 });
    assert.deepEqual(changes, [[TODAY]]);
  } finally { await env.close(); }
});

test("AUD28-03 окончательное удаление клиента сообщает календарю: записи обезличены, кэш недели сбрасывается", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const repositories = createLocalRepositories(shared, WS, { meta: { version: "test", source: "REPDB", license: "test", exerciseCount: 0 }, exercises: [] } as unknown as SystemCatalog);
  await repositories.initialize();
  try {
    const gone = await repositories.clients.create({ displayName: "SyntheticGone" });
    const personal = (await repositories.calendar.listSessionTypes())[0]!;
    await repositories.calendar.createAppointment({ localDate: TODAY, startMinute: 1080, durationMinutes: 60, clientId: gone.id,
      guestName: null, note: null, sessionTypeId: personal.id });
    const archived = await repositories.clients.setArchived(gone.id, gone.revision, true);
    const changes: unknown[] = [];
    const unsubscribe = repositories.calendar.subscribeCommittedChanges((change) => changes.push(change.dates));
    await repositories.clients.deleteArchivedPermanently(gone.id, archived.revision);
    unsubscribe();
    assert.deepEqual(changes, ["ALL"]);
  } finally { await repositories.close(); }
});

test("AUD28-04 «Отменить завершение» возвращает списание и резерв; повторное завершение списывает ровно один раз", async () => {
  const env = await setup({ credit: true });
  try {
    await env.book({});
    const state = async () => { const snapshot = await env.accounting.getClientSnapshot(env.a); const pack = snapshot.packs[0]!;
      return { balance: pack.ledgerBalance, reserved: pack.reserved, entries: snapshot.ledger.map((entry) => entry.entryType).sort() }; };
    assert.deepEqual(await state(), { balance: 2, reserved: 1, entries: ["ISSUED"] });
    const done = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(18, 30));
    assert.deepEqual(await state(), { balance: 1, reserved: 0, entries: ["ISSUED", "USED"] });
    const undone = await env.workflow.setOutcome(env.slot, null, done.session.revision, at(18, 40));
    assert.deepEqual(undone.calendar, { kind: "CLEARED", startMinute: 1080 });
    assert.deepEqual(await state(), { balance: 2, reserved: 1, entries: ["ISSUED", "RETURNED", "USED"] }, "списание компенсировано, запись снова держит резерв");
    await env.workflow.setOutcome(env.slot, "COMPLETED", undone.session.revision, at(18, 50));
    assert.deepEqual(await state(), { balance: 1, reserved: 0, entries: ["ISSUED", "RETURNED", "USED", "USED"] }, "эффективное списание одно");
  } finally { await env.close(); }
});

test("ADR-048 повторное «Завершена» не отмечает вторую запись и не теряет связь с первой", async () => {
  const env = await setup();
  try {
    await env.book({ startMinute: 600 });
    const first = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(10, 30));
    await env.book({ startMinute: 960 });
    const again = await env.workflow.setOutcome(env.slot, "COMPLETED", first.session.revision, at(18, 30));
    assert.equal(again.calendar, null);
    const undone = await env.workflow.setOutcome(env.slot, null, again.session.revision, at(18, 40));
    assert.deepEqual(undone.calendar, { kind: "CLEARED", startMinute: 600 }, "снимается первая запись");
    assert.deepEqual(await env.outcomes(), [[600, TODAY, null], [960, TODAY, null]]);
  } finally { await env.close(); }
});

test("ADR-048 тренер вручную сменил запись на «Пропущена»: отмена завершения её не трогает", async () => {
  const env = await setup();
  try {
    const appointment = await env.book({});
    const done = await env.workflow.setOutcome(env.slot, "COMPLETED", null, at(18, 30));
    const marked = (await env.calendar.getAppointment(appointment.id))!;
    await env.calendar.resolveOutcome(marked.id, marked.revision, "MISSED", at(18, 35));
    const undone = await env.workflow.setOutcome(env.slot, null, done.session.revision, at(18, 40));
    assert.equal(undone.calendar, null);
    assert.deepEqual(await env.outcomes(), [[1080, TODAY, "MISSED"]]);
  } finally { await env.close(); }
});

test("ADR-048 сбой календаря откатывает и исход тренировки (одна транзакция)", async () => {
  const env = await setup();
  try {
    await env.book({});
    const failing = createWorkoutOutcomeWorkflow(<T>(task: (tx: never) => Promise<T>) => env.shared.acquire().then((lease) =>
      lease.writer.write(task as never) as Promise<T>) as never, env.execution.outcomeParticipant,
    { ...env.calendar.outcomeParticipant, complete: async () => { throw new Error("CALENDAR_STALE_APPOINTMENT"); } });
    await assert.rejects(failing.setOutcome(env.slot, "COMPLETED", null, at(18, 30)), { message: "CALENDAR_STALE_APPOINTMENT" });
    assert.equal((await env.execution.getWorkout(env.slot)).session, null, "тренировка не завершена");
    assert.deepEqual(await env.outcomes(), [[1080, TODAY, null]]);
  } finally { await env.close(); }
});

test("ADR-048 правило выбора: начавшаяся запись клиента на дату без исхода, позже начатая важнее", () => {
  const row = (id: string, startMinute: number, extra: object = {}) => ({ id, localDate: TODAY, startMinute, durationMinutes: 60, clientId: "c",
    guestName: null, participantDeleted: false, sessionTypeId: "t", sessionTypeName: "T", note: null, creditBypass: false,
    lifecycle: "SCHEDULED" as const, outcome: null, revision: 1, ...extra });
  const now = at(12, 0);
  assert.equal(pickStartedPending([row("a", 600), row("b", 660), row("c", 720)], "c", TODAY, now)?.id, "c", "12:00 — 720 уже началась");
  assert.equal(pickStartedPending([row("a", 780)], "c", TODAY, now), null, "13:00 ещё не началась");
  assert.equal(pickStartedPending([row("a", 600, { lifecycle: "COMPLETED", outcome: "MISSED" })], "c", TODAY, now), null);
  assert.equal(pickStartedPending([row("a", 600)], "other", TODAY, now), null);
});
