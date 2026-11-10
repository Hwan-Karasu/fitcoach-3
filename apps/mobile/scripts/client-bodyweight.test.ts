import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { useBodyOf } from "../src/features/training/analytics/presentation/useBodyOf.ts";
import type { BodyOf, BodyWeight, BodyweightSource } from "../src/features/training/analytics/presentation/trainingStats.ts";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from "../src/features/measurements/data/DevMeasurementRepository.ts";
import { dailyPoints } from "../src/features/measurements/domain/MeasurementRules.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createClientBodyweight } from "../src/read-models/clientBodyweight.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Read-model импортирует public.ts фич (там экраны .tsx), поэтому тест живёт здесь.
const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 16, 21, 0);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("AUDIT-ALL-1: при смене клиента тоннаж не использует массу прежнего клиента до завершения чтения", async () => {
  let lookup!: BodyOf;
  let complete!: (points: readonly BodyWeight[]) => void;
  let subscriptions = 0;
  const source: BodyweightSource = {
    list: (clientId) => clientId === "a" ? Promise.resolve([{ date: "2026-10-01", kg: 80 }])
      : new Promise((resolve) => { complete = resolve; }),
    subscribe: () => { subscriptions += 1; return () => { subscriptions -= 1; }; },
  };
  function Probe({ clientId }: { clientId: string }) { lookup = useBodyOf(source, clientId); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { clientId: "a" })); });
    assert.equal(lookup("2026-10-10")!.kg, 80);
    await act(async () => tree.update(createElement(Probe, { clientId: "b" })));
    assert.equal(lookup("2026-10-10"), null);
    assert.equal(subscriptions, 1);
    await act(async () => complete([{ date: "2026-10-02", kg: 60 }]));
    assert.equal(lookup("2026-10-10")!.kg, 60);
  } finally { if (tree) await act(async () => tree.unmount()); }
  assert.equal(subscriptions, 0);
});

test("AUDIT-ALL-1: медленное прежнее чтение замеров не отменяет результат последнего committed change", async () => {
  let lookup!: BodyOf;
  const requests: Array<Readonly<{ resolve: (points: readonly BodyWeight[]) => void; reject: (error: Error) => void }>> = [];
  let changed: () => void = () => undefined;
  const source: BodyweightSource = {
    list: () => new Promise((resolve, reject) => { requests.push({ resolve, reject }); }),
    subscribe: (_id, listener) => { changed = listener; return () => undefined; },
  };
  function Probe() { lookup = useBodyOf(source, "a"); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe)); });
    await act(async () => changed());
    await act(async () => requests[1]!.resolve([{ date: "2026-10-01", kg: 85 }]));
    assert.equal(lookup("2026-10-10")!.kg, 85);
    await act(async () => requests[0]!.resolve([{ date: "2026-10-01", kg: 80 }]));
    assert.equal(lookup("2026-10-10")!.kg, 85);
    await act(async () => changed());
    await act(async () => requests[2]!.reject(new Error("READ_FAILED")));
    assert.equal(lookup("2026-10-10"), null, "отказ последнего источника означает невычислимый тоннаж");
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("ряд массы тела: один достоверный замер в день; день с несколькими без основного не входит, выбор основного возвращает его (§49.18, §48.86.36)", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devMeasurementClientDeletionParticipant]);
  await clients.initialize();
  const measurements = new DevMeasurementRepository(shared, WS);
  await measurements.initialize();
  try {
    const a = (await clients.create({ displayName: "SyntheticA" })).id;
    const b = (await clients.create({ displayName: "SyntheticB" })).id;
    const weight = (valueX10: number, localDate: string) => ({ type: "WEIGHT" as const, valueX10, localDate, localMinute: null });
    await measurements.record(a, weight(820, "2026-09-02"), NOW);
    await measurements.record(a, weight(840, "2026-09-15"), NOW);
    const first = await measurements.record(a, weight(830, "2026-09-20"), NOW);
    await measurements.record(a, weight(850, "2026-09-20"), NOW);
    await measurements.record(a, { type: "WAIST", valueX10: 800, localDate: "2026-09-02", localMinute: null }, NOW);
    await measurements.record(b, weight(990, "2026-09-02"), NOW);
    const port = createClientBodyweight(dailyPoints, measurements);
    assert.deepEqual(await port.list(a), [{ date: "2026-09-02", kg: 82 }, { date: "2026-09-15", kg: 84 }], "20 сентября неоднозначно; талия и клиент B не влияют");
    await measurements.setPrimary(first.id);
    assert.deepEqual(await port.list(a), [{ date: "2026-09-02", kg: 82 }, { date: "2026-09-15", kg: 84 }, { date: "2026-09-20", kg: 83 }]);
    let notified = 0;
    const off = port.subscribe(a, () => { notified += 1; });
    await measurements.record(b, weight(980, "2026-09-03"), NOW);
    assert.equal(notified, 0, "замеры другого клиента не будят");
    await measurements.record(a, weight(810, "2026-09-25"), NOW);
    assert.equal(notified, 1);
    off();
  } finally {
    await measurements.close();
    await clients.close();
  }
});
