import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from "../src/features/measurements/data/DevMeasurementRepository.ts";
import { dailyPoints } from "../src/features/measurements/domain/MeasurementRules.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createClientBodyweight } from "../src/read-models/clientBodyweight.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Read-model импортирует public.ts фич (там экраны .tsx), поэтому тест живёт здесь.
const WS = "synthetic-workspace-a";
const NOW = new Date(2026, 9, 16, 21, 0);

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
