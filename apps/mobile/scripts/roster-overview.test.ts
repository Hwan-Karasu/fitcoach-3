import assert from "node:assert/strict";
import test from "node:test";
import { buildRosterOverview, hasRestrictions } from "../src/read-models/rosterOverview.ts";
import type { HomeSummaryRules } from "../src/read-models/clientHomeSummary.ts";
import type { Appointment } from "../src/features/calendar/public.ts";
import type { ClientAccountingSnapshot } from "../src/features/accounting/public.ts";

const rules: HomeSummaryRules = {
  latestPoint: () => null,
  formatValue: (value) => String(value / 10),
  formatKopeks: (kopeks) => `${kopeks / 100} ₽`,
  pricePerSessionKopeks: (total, sessions) => Math.round(total / sessions),
};

function appointment(id: string, clientId: string, localDate: string, startMinute: number,
  lifecycle: Appointment["lifecycle"] = "SCHEDULED", durationMinutes = 60): Appointment {
  return { id, clientId, localDate, startMinute, durationMinutes, lifecycle, guestName: null,
    participantDeleted: false, sessionTypeId: "t", sessionTypeName: "Персональная", note: null,
    creditBypass: false, outcome: null, revision: 1 };
}

const tracked = (available: number): ClientAccountingSnapshot => ({
  mode: "FITCOACH", inheritedMode: false, available, reserved: 0, ledger: [], payments: [],
  packs: [{ pack: { id: "p", title: "8", grantedCount: 8, totalKopeks: 800_000, expiresOn: null,
    createdAt: "2026-10-01T00:00:00Z" }, available, reserved: 0 }],
} as unknown as ClientAccountingSnapshot);

test("GetRosterMetrics: следующее занятие, «Сегодня» до конца записи, абонемент, нет факта ≠ 0", () => {
  // Сейчас 10:30 17.10: у A запись 10:00–11:00 идёт, следующая — завтра 09:00.
  const overview = buildRosterOverview({
    rules, clientIds: ["A", "B", "C"], today: "2026-10-17", nowMinute: 10 * 60 + 30,
    appointments: [
      appointment("a1", "A", "2026-10-17", 10 * 60),
      appointment("a2", "A", "2026-10-18", 9 * 60),
      appointment("b1", "B", "2026-10-17", 9 * 60), // закончилась в 10:00
      appointment("b2", "B", "2026-10-17", 12 * 60, "CANCELLED"),
      appointment("b3", "B", "2026-10-25", 18 * 60 + 15),
    ],
    accounting: new Map([["A", tracked(5)], ["B", null]]),
    answers: new Map(),
  });
  const a = overview.get("A");
  assert.equal(a?.todayStartMinute, 10 * 60);
  assert.equal(a?.todayEndMinute, 11 * 60);
  assert.deepEqual(a?.metrics, [
    { id: "nextAppointment", value: "Завтра 09:00" },
    { id: "lastTraining", value: null },
    { id: "credits", value: "5 зан." },
  ]);
  const b = overview.get("B");
  assert.equal(b?.todayStartMinute, null, "закончившаяся ровно сейчас и отменённая не держат в фильтре");
  assert.equal(b?.metrics[0]?.value, "25.10 18:15");
  assert.equal(b?.metrics[2]?.value, null, "недоступный учёт — «нет данных», а не ноль");
  assert.equal(overview.get("C")?.metrics[0]?.value, null);
});

test("Индикатор ограничений: явное «есть противопоказания» или заполненное поле здоровья", () => {
  assert.equal(hasRestrictions(null), false);
  assert.equal(hasRestrictions({ "sys:health.noContra": true }), false);
  assert.equal(hasRestrictions({ "sys:health.noContra": false }), true);
  assert.equal(hasRestrictions({ "sys:health.injuries": "  " }), false);
  assert.equal(hasRestrictions({ "sys:health.injuries": "колено" }), true);
});
