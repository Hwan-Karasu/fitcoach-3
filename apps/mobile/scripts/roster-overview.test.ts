import assert from "node:assert/strict";
import test from "node:test";
import { buildRosterOverview, createRosterOverviewSource, hasRestrictions } from "../src/read-models/rosterOverview.ts";
import { latestPoint } from "../src/features/measurements/domain/MeasurementRules.ts";
import { sumNutrients } from "../src/features/nutrition/domain/DiaryRules.ts";
import type { HomeSummaryRules } from "../src/read-models/clientHomeSummary.ts";
import type { Appointment } from "../src/features/calendar/public.ts";
import type { ClientAccountingSnapshot } from "../src/features/accounting/public.ts";

const rules: HomeSummaryRules = {
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
  mode: "FITCOACH", inheritedMode: false, preferredPackId: null, available, reserved: 0, ledger: [], payments: [],
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
  assert.equal(a?.creditStatus, "AVAILABLE");
  assert.equal(overview.get("B")?.creditStatus, "UNKNOWN");
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

test("optional roster tiles use owner facts, retain zero, and skip reads for unselected metrics", async () => {
  type Ports = Parameters<typeof createRosterOverviewSource>[0];
  let measurementReads = 0;
  let foodReads = 0;
  let stepReads = 0;
  const source = createRosterOverviewSource({ rules,
    calendar: { listRange: async () => ({ appointments: [], intervals: [] }) } as unknown as Ports["calendar"],
    accounting: { getClientSnapshot: async () => null } as unknown as Ports["accounting"],
    questionnaire: { getAnswers: async () => null } as unknown as Ports["questionnaire"],
    measurements: { listForClient: async (id: string) => {
      measurementReads += 1;
      return { measurements: id === "A" ? [{ id: "mass", clientId: id, type: "WEIGHT", valueX10: 805, localDate: "2026-10-17", localMinute: null, method: "MANUAL", revision: 1 }] : [], primaries: [] };
    } } as unknown as Ports["measurements"],
    diary: { listEatenEntries: async (id: string) => {
      foodReads += 1;
      return id === "A" ? [{ snapshot: { eaten: { kcalX10: 0, proteinX10: null, fatX10: null, carbsX10: null } } }] : [];
    } } as unknown as Ports["diary"],
    calc: { listSteps: async (id: string) => { stepReads += 1; return id === "A" ? [{ localDate: "2026-10-17", steps: 0 }] : []; } } as unknown as Ports["calc"],
    latestPoint, sumNutrients,
  });
  const now = new Date(2026, 9, 17, 12);
  await source.load(["A", "B"], now, ["credits"]);
  assert.deepEqual([measurementReads, foodReads, stepReads], [0, 0, 0]);
  const result = await source.load(["A", "B"], now, ["weight", "fatPercent", "calories", "steps"]);
  const value = (client: string, metric: string) => result.get(client)?.metrics.find((item) => item.id === metric)?.value;
  assert.equal(value("A", "weight"), "80,5 кг");
  assert.equal(value("A", "calories"), "0 ккал");
  assert.equal(value("A", "steps"), "0");
  assert.equal(value("A", "fatPercent"), null);
  assert.equal(value("B", "weight"), null);
  assert.equal(value("B", "calories"), null);
  assert.equal(value("B", "steps"), null);
  assert.deepEqual([measurementReads, foodReads, stepReads], [2, 2, 2]);
});
