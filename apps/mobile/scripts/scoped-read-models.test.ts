import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { useClientHomeSummary } from "../src/read-models/useClientHomeSummary.ts";
import type { HomeSummaryRules } from "../src/read-models/clientHomeSummary.ts";
import type { AccountingRepositoryPort } from "../src/features/accounting/domain/AccountingRepositoryPort.ts";
import type { ClientAccountingSnapshot } from "../src/features/accounting/domain/AccountingModel.ts";
import type { TrainingHistoryEntry } from "../src/features/training/archive/presentation/trainingHistory.ts";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === "@react-navigation/native" ? { url: new URL("./support/native-panel-boundary.ts", import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { useClientHistory } = await import("../src/features/training/archive/presentation/useClientHistory.ts");
hooks.deregister();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rules: HomeSummaryRules = { formatKopeks: String, pricePerSessionKopeks: (total, sessions) => Math.round(total / sessions) };
const snapshot: ClientAccountingSnapshot = { mode: "FITCOACH", inheritedMode: false, preferredPackId: null, returnableDebitId: null,
  available: 5, reserved: 0, ledger: [], payments: [], packs: [{ pack: { id: "pack", title: "Synthetic", creditScope: "GENERAL",
    sessionTypeId: null, sessionTypeName: null, grantedCount: 5, totalKopeks: 0, expiresOn: "2026-11-10", createdAt: "2026-11-01T10:00:00Z" },
    ledgerBalance: 5, reserved: 0, available: 5, paidKopeks: 0 }] };

test("AUDIT-ALL-1: истёкший в полночь абонемент меняет сводку без нового чтения БД", async () => {
  let state!: ReturnType<typeof useClientHomeSummary>;
  let reads = 0;
  const accounting = { getClientSnapshot: async () => { reads += 1; return snapshot; }, subscribeCommittedChanges: () => () => undefined };
  function Probe({ today }: { today: string }) { state = useClientHomeSummary("a", accounting, today, rules); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { today: "2026-11-10" })); });
    assert.equal(state?.pack.kind, "TRACKED");
    assert.equal(state?.pack.kind === "TRACKED" && state.pack.available, 5);
    await act(async () => { tree.update(createElement(Probe, { today: "2026-11-11" })); });
    assert.equal(state?.pack.kind === "TRACKED" && state.pack.available, 0);
    assert.equal(state?.pack.kind === "TRACKED" && state.pack.writeOffAvailable, false);
    assert.equal(reads, 1);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("AUDIT-ALL-1: новый клиент не показывает чужой пакет; позднее перечитывание прежнего клиента игнорируется", async () => {
  let state!: ReturnType<typeof useClientHomeSummary>;
  let resolveA!: (next: ClientAccountingSnapshot) => void;
  let resolveB!: (next: ClientAccountingSnapshot) => void;
  let changed!: Parameters<AccountingRepositoryPort["subscribeCommittedChanges"]>[0];
  let first = true;
  const accounting = { getClientSnapshot: (id: string) => {
    if (first) { first = false; return Promise.resolve(snapshot); }
    return new Promise<ClientAccountingSnapshot>((resolve) => { if (id === "a") resolveA = resolve; else resolveB = resolve; });
  }, subscribeCommittedChanges: (listener: typeof changed) => { changed = listener; return () => undefined; } };
  function Probe({ id }: { id: string }) { state = useClientHomeSummary(id, accounting, "2026-11-10", rules); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { id: "a" })); });
    await act(async () => changed({ clientIds: ["a"] }));
    await act(async () => { tree.update(createElement(Probe, { id: "b" })); });
    assert.equal(state, null);
    await act(async () => resolveA(snapshot));
    assert.equal(state, null);
    await act(async () => resolveB({ ...snapshot, packs: [], available: 0 }));
    assert.equal((state as ReturnType<typeof useClientHomeSummary>)?.pack.kind, "NO_PACK");
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("AUDIT-ALL-1: история другого клиента недоступна, пока его чтение не завершено", async () => {
  let state!: ReturnType<typeof useClientHistory>;
  let finish!: (entries: readonly TrainingHistoryEntry[]) => void;
  const history = { list: (id: string) => id === "a" ? Promise.resolve([]) : new Promise<readonly TrainingHistoryEntry[]>((resolve) => { finish = resolve; }),
    subscribe: () => () => undefined };
  function Probe({ id }: { id: string }) { state = useClientHistory(history, id); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { id: "a" })); });
    assert.deepEqual(state.entries, []);
    await act(async () => { tree.update(createElement(Probe, { id: "b" })); });
    assert.equal(state.entries, null, "даже пустой список принадлежит конкретному клиенту и не считается ответом нового");
    await act(async () => finish([]));
    assert.deepEqual(state.entries, []);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
