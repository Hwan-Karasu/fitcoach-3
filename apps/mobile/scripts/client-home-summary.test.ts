import assert from "node:assert/strict";
import test from "node:test";
import { formatKopeks, pricePerSessionKopeks } from "../src/features/accounting/domain/AccountingRules.ts";
import type { ClientAccountingSnapshot, PackBalance } from "../src/features/accounting/domain/AccountingModel.ts";
import { ageOn, formatYears } from "../src/features/clients/domain/ClientRosterPresentation.ts";
import { buildClientHomeSummary } from "../src/read-models/clientHomeSummary.ts";

const rules = { formatKopeks, pricePerSessionKopeks };
const TODAY = "2026-10-16";

const balance = (overrides: Partial<PackBalance["pack"]>, available: number, reserved = 0): PackBalance => ({
  pack: { id: overrides.id ?? "p", title: "Пакет", creditScope: "GENERAL", sessionTypeId: null, sessionTypeName: null,
    grantedCount: 10, totalKopeks: 1_500_000, expiresOn: null, createdAt: "2026-10-01", ...overrides },
  ledgerBalance: available + reserved, reserved, available, paidKopeks: 0,
});

const snapshot = (mode: ClientAccountingSnapshot["mode"], packs: readonly PackBalance[]): ClientAccountingSnapshot =>
  ({ mode, inheritedMode: false, preferredPackId: null, packs, returnableDebitId: null, available: 0, reserved: 0, ledger: [], payments: [] });

test("C05 abonement summary comes from ledger balances, with modes, expiry and tone", () => {
  assert.equal(buildClientHomeSummary(rules, snapshot("UNTRACKED", []), TODAY).pack.kind, "NOT_TRACKED");
  assert.deepEqual({ ...buildClientHomeSummary(rules, snapshot("EXTERNAL", []), TODAY).pack },
    { kind: "NOT_TRACKED", label: "Учёт ведётся вне FitCoach" });
  assert.equal(buildClientHomeSummary(rules, snapshot("FITCOACH", []), TODAY).pack.kind, "NO_PACK");
  const pack = buildClientHomeSummary(rules, snapshot("FITCOACH", [
    balance({ id: "late", expiresOn: null }, 5),
    balance({ id: "soon", expiresOn: "2026-11-01", totalKopeks: 800_000, grantedCount: 4 }, 1, 1),
    balance({ id: "expired", expiresOn: "2026-10-01" }, 3),
  ]), TODAY).pack;
  assert.ok(pack.kind === "TRACKED");
  assert.equal(pack.available, 6);
  assert.equal(pack.granted, 14, "начислено по действующим пакетам (10 + 4); просроченный не считается — «доступно 6/14»");
  assert.equal(pack.reserved, 1);
  assert.equal(pack.tone, "active");
  assert.equal(pack.expiresOn, "2026-11-01");
  assert.equal(pack.pricePerSession, "2\u00a0000\u00a0₽");
  const low = buildClientHomeSummary(rules, snapshot("FITCOACH", [balance({}, 2)]), TODAY).pack;
  assert.ok(low.kind === "TRACKED" && low.tone === "warning");
  const none = buildClientHomeSummary(rules, snapshot("FITCOACH", [balance({}, 0, 0)]), TODAY).pack;
  assert.ok(none.kind === "TRACKED" && none.tone === "empty" && none.pricePerSession === null);
});

test("C05 Home shows only the preferred pack, including its own price, expiry and empty balance", () => {
  const packs = [balance({ id: "other" }, 8),
    balance({ id: "chosen", grantedCount: 4, totalKopeks: 800_000, expiresOn: "2026-11-01" }, 1, 2)];
  const chosen = { ...snapshot("FITCOACH", packs), preferredPackId: "chosen" };
  const result = buildClientHomeSummary(rules, chosen, TODAY).pack;
  assert.deepEqual(result, { kind: "TRACKED", available: 1, granted: 4, reserved: 2,
    tone: "warning", pricePerSession: "2\u00a0000\u00a0₽", expiresOn: "2026-11-01", writeOffAvailable: true, returnableDebitId: null });
  const empty = buildClientHomeSummary(rules, { ...chosen, packs: [packs[0]!, balance(packs[1]!.pack, 0)] }, TODAY).pack;
  assert.ok(empty.kind === "TRACKED" && empty.available === 0 && empty.granted === 4 && empty.tone === "empty");
  const expired = buildClientHomeSummary(rules, chosen, "2026-11-02").pack;
  assert.ok(expired.kind === "TRACKED" && expired.available === 0 && expired.granted === 4);
  const automatic = buildClientHomeSummary(rules, { ...chosen, preferredPackId: null }, TODAY).pack;
  assert.ok(automatic.kind === "TRACKED" && automatic.available === 9 && automatic.granted === 14);
});

test("A02 Главная: «Списать» доступно только при живом занятии в обслуживающем пакете; «Отменить» — по id из снимка", () => {
  const ready = buildClientHomeSummary(rules, { ...snapshot("FITCOACH", [balance({ id: "a" }, 3)]), returnableDebitId: "debit-1" }, TODAY).pack;
  assert.ok(ready.kind === "TRACKED" && ready.writeOffAvailable && ready.returnableDebitId === "debit-1");
  const empty = buildClientHomeSummary(rules, snapshot("FITCOACH", [balance({ id: "a" }, 0, 1)]), TODAY).pack;
  assert.ok(empty.kind === "TRACKED" && !empty.writeOffAvailable && empty.returnableDebitId === null, "всё занято резервами — списывать нечего");
  const expired = buildClientHomeSummary(rules, { ...snapshot("FITCOACH", [balance({ id: "a", expiresOn: "2026-10-01" }, 3)]), preferredPackId: "a" }, TODAY).pack;
  assert.ok(expired.kind === "TRACKED" && !expired.writeOffAvailable, "выбранный истёкший пакет не списывается");
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
