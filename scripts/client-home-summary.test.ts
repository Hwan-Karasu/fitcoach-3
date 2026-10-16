import assert from "node:assert/strict";
import test from "node:test";
import { formatKopeks, pricePerSessionKopeks } from "../apps/mobile/src/features/accounting/domain/AccountingRules.ts";
import type { ClientAccountingSnapshot, PackBalance } from "../apps/mobile/src/features/accounting/domain/AccountingModel.ts";
import { ageOn, formatYears } from "../apps/mobile/src/features/clients/domain/ClientRosterPresentation.ts";
import type { Measurement } from "../apps/mobile/src/features/measurements/domain/MeasurementModel.ts";
import { formatValue, latestPoint } from "../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { buildClientHomeSummary } from "../apps/mobile/src/read-models/clientHomeSummary.ts";

const rules = { latestPoint, formatValue, formatKopeks, pricePerSessionKopeks };
const TODAY = "2026-10-16";

const measurement = (id: string, valueX10: number, localDate: string, localMinute: number | null): Measurement =>
  ({ id, clientId: "c", type: "WEIGHT", valueX10, localDate, localMinute, method: "MANUAL", revision: 1 });

const balance = (overrides: Partial<PackBalance["pack"]>, available: number, reserved = 0): PackBalance => ({
  pack: { id: overrides.id ?? "p", title: "Пакет", creditScope: "GENERAL", sessionTypeId: null, sessionTypeName: null,
    grantedCount: 10, totalKopeks: 1_500_000, expiresOn: null, createdAt: "2026-10-01", ...overrides },
  ledgerBalance: available + reserved, reserved, available, paidKopeks: 0,
});

const snapshot = (mode: ClientAccountingSnapshot["mode"], packs: readonly PackBalance[]): ClientAccountingSnapshot =>
  ({ mode, inheritedMode: false, packs, available: 0, reserved: 0, ledger: [], payments: [] });

test("C05 Home tiles project measurements: latest daily point, ambiguity, never a zero", () => {
  const empty = buildClientHomeSummary(rules, null, null, TODAY);
  assert.deepEqual(empty.metrics.map((metric) => metric.value), [null, null, null]);
  assert.deepEqual({ ...empty.pack }, { kind: "UNAVAILABLE" });
  const single = buildClientHomeSummary(rules, null, {
    measurements: [measurement("a", 801, "2026-10-14", 480), measurement("b", 795, "2026-10-10", null)], primaries: [],
  }, TODAY);
  assert.deepEqual({ ...single.metrics[0] }, { label: "Вес", value: "80,1", unit: "кг", status: "от 14.10" });
  assert.equal(single.metrics[1]?.value, null);
  const ambiguous = buildClientHomeSummary(rules, null, {
    measurements: [measurement("a", 801, "2026-10-14", 480), measurement("b", 808, "2026-10-14", 1200)], primaries: [],
  }, TODAY);
  assert.equal(ambiguous.metrics[0]?.value, null);
  assert.equal(ambiguous.metrics[0]?.status, "14.10: выберите основной");
});

test("C05 abonement summary comes from ledger balances, with modes, expiry and tone", () => {
  assert.equal(buildClientHomeSummary(rules, snapshot("UNTRACKED", []), null, TODAY).pack.kind, "NOT_TRACKED");
  assert.deepEqual({ ...buildClientHomeSummary(rules, snapshot("EXTERNAL", []), null, TODAY).pack },
    { kind: "NOT_TRACKED", label: "Учёт ведётся вне FitCoach" });
  assert.equal(buildClientHomeSummary(rules, snapshot("FITCOACH", []), null, TODAY).pack.kind, "NO_PACK");
  const pack = buildClientHomeSummary(rules, snapshot("FITCOACH", [
    balance({ id: "late", expiresOn: null }, 5),
    balance({ id: "soon", expiresOn: "2026-11-01", totalKopeks: 800_000, grantedCount: 4 }, 1, 1),
    balance({ id: "expired", expiresOn: "2026-10-01" }, 3),
  ]), null, TODAY).pack;
  assert.ok(pack.kind === "TRACKED");
  assert.equal(pack.available, 6);
  assert.equal(pack.reserved, 1);
  assert.equal(pack.tone, "active");
  assert.equal(pack.expiresOn, "2026-11-01");
  assert.equal(pack.pricePerSession, "2\u00a0000\u00a0₽");
  const low = buildClientHomeSummary(rules, snapshot("FITCOACH", [balance({}, 2)]), null, TODAY).pack;
  assert.ok(low.kind === "TRACKED" && low.tone === "warning");
  const none = buildClientHomeSummary(rules, snapshot("FITCOACH", [balance({}, 0, 0)]), null, TODAY).pack;
  assert.ok(none.kind === "TRACKED" && none.tone === "empty" && none.pricePerSession === null);
});

test("C05 age is full years on the local date; Russian plural", () => {
  assert.equal(ageOn("1990-10-16", "2026-10-16"), 36);
  assert.equal(ageOn("1990-10-17", "2026-10-16"), 35);
  assert.equal(ageOn("2000-02-29", "2025-02-28"), 24);
  assert.equal(ageOn("2000-02-29", "2025-03-01"), 25);
  assert.equal(ageOn("2026-10-16", "2026-10-16"), null);
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25, 112].map(formatYears),
    ["1 год", "2 года", "5 лет", "11 лет", "21 год", "22 года", "25 лет", "112 лет"]);
});
