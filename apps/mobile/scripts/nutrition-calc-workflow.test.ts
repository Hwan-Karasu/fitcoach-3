import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevNutritionCalcRepository } from "../src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createCalcProfileWorkflow } from "../src/workflows/saveCalcProfile.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const PROFILE = { goal: "LOSS", activity: "ACTIVE", workoutsPerWeek: 3, minutes: 60, intensity: "MEDIUM", stepKcal: 150 } as const;

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const calc = new DevNutritionCalcRepository(shared, WS);
  await calc.initialize();
  const lease = await shared.acquire();
  const workflow = createCalcProfileWorkflow((task) => lease.writer.write(task), calc.profileParticipant, clients.bodyParticipant);
  const client = await clients.create({ displayName: "SyntheticCalc" });
  const events: string[] = [];
  calc.subscribeCommittedChanges(() => events.push("calc"));
  clients.subscribeCommittedChanges(() => events.push("client"));
  const close = async () => { await shared.release(); await calc.close(); await clients.close(); };
  return { clients, calc, workflow, client, events, close };
}

test("профиль расчёта и пол/рост карточки — одна транзакция, уведомления после коммита", async () => {
  const { clients, calc, workflow, client, events, close } = await stores();
  try {
    const saved = await workflow.save(client.id, PROFILE, null, { sex: "FEMALE", heightCmX10: 1720 });
    assert.deepEqual(saved.stored.profile, PROFILE);
    assert.deepEqual([saved.client?.sex, saved.client?.heightCmX10, saved.client?.revision], ["FEMALE", 1720, client.revision + 1]);
    assert.deepEqual((await clients.get(client.id))?.heightCmX10, 1720);
    assert.deepEqual(events.sort(), ["calc", "client"]);
    // Без изменений карточки пишется только профиль.
    const again = await workflow.save(client.id, { ...PROFILE, stepKcal: 200 }, saved.stored.revision, null);
    assert.equal(again.client, null);
    assert.equal((await clients.get(client.id))?.revision, client.revision + 1, "карточка не тронута");
    assert.equal((await calc.getProfile(client.id))?.profile.stepKcal, 200);
  } finally { await close(); }
});

test("сбой записи карточки откатывает профиль, устаревший профиль не меняет карточку; событий нет", async () => {
  const { clients, calc, workflow, client, events, close } = await stores();
  try {
    await assert.rejects(workflow.save(client.id, PROFILE, null, { sex: "MALE", heightCmX10: -5 }), /CLIENT_HEIGHT_INVALID/u);
    assert.equal(await calc.getProfile(client.id), null, "профиль не записан");
    assert.equal(events.length, 0);
    await calc.saveProfile(client.id, PROFILE, null);
    events.length = 0;
    await assert.rejects(workflow.save(client.id, { ...PROFILE, stepKcal: 10 }, null, { sex: "MALE", heightCmX10: 1800 }), /CALC_STALE/u);
    const unchanged = await clients.get(client.id);
    assert.deepEqual([unchanged?.sex ?? null, unchanged?.heightCmX10 ?? null], [null, null], "карточка не изменена");
    assert.equal(events.length, 0);
  } finally { await close(); }
});
