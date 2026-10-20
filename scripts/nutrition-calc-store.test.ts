import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { devNutritionClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { devNutritionTargetsClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionTargetsRepository.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevNutritionCalcRepository, devNutritionCalcClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { type CalcProfile, validateCalcProfile } from "../apps/mobile/src/features/nutrition/domain/CalcRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");
const PROFILE: CalcProfile = { sex: "MALE", age: 37, heightCm: 181, goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 3, minutes: 60, intensity: "MEDIUM", stepKcal: 100 };

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devNutritionClientDeletionParticipant, devNutritionTargetsClientDeletionParticipant, devNutritionCalcClientDeletionParticipant]);
  await clients.initialize();
  const calc = new DevNutritionCalcRepository(shared, WS);
  await calc.initialize();
  const close = async () => { await calc.close(); await clients.close(); };
  return { db, clients, calc, close };
}
const code = (name: string) => (error: unknown) => error instanceof Error && error.message === name;

test("профиль расчёта: проверка ввода — возраст, рост, тренировки, минуты и шаг цели в разумных границах; пустой пол и возраст допустимы", () => {
  assert.deepEqual(validateCalcProfile(PROFILE), PROFILE);
  assert.equal(validateCalcProfile({ ...PROFILE, sex: null, age: null, heightCm: null }).age, null, "не введено — не ноль");
  for (const bad of [{ age: 0 }, { age: 121 }, { age: 37.5 }, { heightCm: 20 }, { heightCm: 301 }, { workoutsPerWeek: -1 }, { workoutsPerWeek: 22 }, { minutes: 0 }, { minutes: 601 },
    { stepKcal: -1 }, { stepKcal: 1001 }]) {
    assert.throws(() => validateCalcProfile({ ...PROFILE, ...bad }), code("CALC_PROFILE_INVALID"), JSON.stringify(bad));
  }
});

test("профиль расчёта: нет записи — null; сохранение по revision; устаревшая правка отклоняется; клиенты изолированы", async () => {
  const { clients, calc, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    assert.equal(await calc.getProfile(a.id), null);
    const first = await calc.saveProfile(a.id, PROFILE, null, NOW);
    assert.deepEqual([first.revision, first.profile.age, first.profile.goal], [1, 37, "MAINTENANCE"]);
    await assert.rejects(calc.saveProfile(a.id, PROFILE, null, NOW), code("CALC_STALE"), "повторное создание без revision");
    const second = await calc.saveProfile(a.id, { ...PROFILE, goal: "LOSS", heightCm: 181.5 }, 1, NOW);
    assert.deepEqual([second.revision, second.profile.goal, second.profile.heightCm], [2, "LOSS", 181.5], "рост с десятой сохраняется");
    await assert.rejects(calc.saveProfile(a.id, PROFILE, 1, NOW), code("CALC_STALE"), "устаревшая revision");
    assert.equal(await calc.getProfile(b.id), null, "чужой профиль не виден");
    await assert.rejects(calc.saveProfile(a.id, { ...PROFILE, age: 0 }, 2, NOW), code("CALC_PROFILE_INVALID"));
    assert.equal((await calc.getProfile(a.id))?.revision, 2, "отклонённая правка ничего не изменила");
  } finally { await close(); }
});

test("шаги: одно значение на дату; пусто ≠ 0; среднее считается по дням с известными шагами", async () => {
  const { clients, calc, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    assert.deepEqual(await calc.listSteps(client.id, "2026-10-01", "2026-10-31"), []);
    await calc.setSteps(client.id, "2026-10-18", 8000, NOW);
    await calc.setSteps(client.id, "2026-10-19", 6000, NOW);
    await calc.setSteps(client.id, "2026-10-19", 7000, NOW);
    assert.deepEqual(await calc.listSteps(client.id, "2026-10-01", "2026-10-31"), [{ localDate: "2026-10-18", steps: 8000 }, { localDate: "2026-10-19", steps: 7000 }]);
    assert.equal(await calc.averageSteps(client.id, "2026-10-01", "2026-10-31"), 7500, "(8000 + 7000) / 2; день без записи не считается нулём");
    assert.equal(await calc.averageSteps(client.id, "2026-09-01", "2026-09-30"), null);
    await assert.rejects(calc.setSteps(client.id, "2026-10-20", 0, NOW), code("CALC_STEPS_INVALID"));
    await assert.rejects(calc.setSteps(client.id, "2026-10-20", 100001, NOW), code("CALC_STEPS_INVALID"));
    await assert.rejects(calc.setSteps(client.id, "2026-02-31", 5000, NOW), code("DIARY_DATE_INVALID"));
    await calc.clearSteps(client.id, "2026-10-18");
    assert.deepEqual((await calc.listSteps(client.id, "2026-10-01", "2026-10-31")).map((day) => day.localDate), ["2026-10-19"]);
  } finally { await close(); }
});

test("§15.7 окончательное удаление клиента убирает профиль расчёта и шаги, чужие не трогает; без владельца — отказ", async () => {
  const { clients, calc, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "Gone" });
    const kept = await clients.create({ displayName: "Kept" });
    await calc.saveProfile(gone.id, PROFILE, null, NOW);
    await calc.setSteps(gone.id, "2026-10-18", 8000, NOW);
    await calc.saveProfile(kept.id, PROFILE, null, NOW);
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    const manifest = await clients.previewPermanentDelete(gone.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "nutrition.calc")?.rows, 2);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.equal(await calc.getProfile(gone.id), null);
    assert.deepEqual(await calc.listSteps(gone.id, "2026-10-01", "2026-10-31"), []);
    assert.notEqual(await calc.getProfile(kept.id), null);
  } finally { await close(); }
  const blockedDb = new DatabaseSync(":memory:");
  const blockedShared = new SharedSqliteDatabase(async () => nodeSqlitePort(blockedDb));
  const blockedClients = new DevClientRepository(blockedShared, WS, []);
  await blockedClients.initialize();
  const blockedCalc = new DevNutritionCalcRepository(blockedShared, WS);
  await blockedCalc.initialize();
  try {
    const client = await blockedClients.create({ displayName: "Blocked" });
    await blockedCalc.setSteps(client.id, "2026-10-18", 8000, NOW);
    const archived = await blockedClients.setArchived(client.id, client.revision, true);
    await assert.rejects(blockedClients.deleteArchivedPermanently(client.id, archived.revision), { message: "CLIENT_DELETION_BLOCKED" });
  } finally { await blockedCalc.close(); await blockedClients.close(); }
});
