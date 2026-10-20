import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { devNutritionCatalog, DEV_NUTRITION_LEDGER } from "../apps/mobile/src/features/nutrition/data/DevNutritionCatalog.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { devNutritionClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { devNutritionTargetsClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionTargetsRepository.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevNutritionCalcRepository, devNutritionCalcClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { type CalcProfile, validateCalcProfile } from "../apps/mobile/src/features/nutrition/domain/CalcRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");
const PROFILE: CalcProfile = { goal: "MAINTENANCE", activity: "MODERATE", workoutsPerWeek: 3, minutes: 60, intensity: "MEDIUM", stepKcal: 100 };

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

test("профиль расчёта: проверка ввода — тренировки, минуты и шаг цели в разумных границах", () => {
  assert.deepEqual(validateCalcProfile(PROFILE), PROFILE);
  for (const bad of [{ workoutsPerWeek: -1 }, { workoutsPerWeek: 22 }, { minutes: 0 }, { minutes: 601 },
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
    assert.deepEqual([first.revision, first.profile.workoutsPerWeek, first.profile.goal], [1, 3, "MAINTENANCE"]);
    await assert.rejects(calc.saveProfile(a.id, PROFILE, null, NOW), code("CALC_STALE"), "повторное создание без revision");
    const second = await calc.saveProfile(a.id, { ...PROFILE, goal: "LOSS", minutes: 45 }, 1, NOW);
    assert.deepEqual([second.revision, second.profile.goal, second.profile.minutes], [2, "LOSS", 45]);
    await assert.rejects(calc.saveProfile(a.id, PROFILE, 1, NOW), code("CALC_STALE"), "устаревшая revision");
    assert.equal(await calc.getProfile(b.id), null, "чужой профиль не виден");
    await assert.rejects(calc.saveProfile(a.id, { ...PROFILE, minutes: 0 }, 2, NOW), code("CALC_PROFILE_INVALID"));
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

test("миграция v7: профиль расчёта из v6 переживает пересоздание таблицы, пол/возраст/рост из него уходят в карточку клиента", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  await clients.initialize();
  const client = await clients.create({ displayName: "Legacy" });
  await runMigrations(new WriterCoordinator(nodeSqlitePort(db)), devNutritionCatalog.slice(0, 6), DEV_NUTRITION_LEDGER);
  db.prepare(`INSERT INTO dev_nutrition_calc_profiles (workspace_id, client_id, sex, age, height_x10, goal, activity, workouts_per_week, workout_minutes, intensity, step_kcal, revision, updated_at)
    VALUES (?, ?, 'MALE', 37, 1810, 'GAIN', 'ACTIVE', 4, 50, 'HEAVY', 200, 3, '2026-10-20T10:00:00.000Z')`).run(WS, client.id);
  const calc = new DevNutritionCalcRepository(shared, WS);
  await calc.initialize();
  try {
    const stored = await calc.getProfile(client.id);
    assert.deepEqual(stored, { revision: 3, profile: { goal: "GAIN", activity: "ACTIVE", workoutsPerWeek: 4, minutes: 50, intensity: "HEAVY", stepKcal: 200 } });
    assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('dev_nutrition_calc_profiles') WHERE name IN ('sex','age','height_x10')").get()?.n, 0);
  } finally { await calc.close(); await clients.close(); }
});

test("отметка тренировки дня: Да/Нет вручную, снятие возвращает «нет данных»; клиенты изолированы; удаление клиента убирает отметки", async () => {
  const { clients, calc, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    assert.deepEqual(await calc.listWorkoutMarks(a.id, "2026-10-01", "2026-10-31"), []);
    await calc.setWorkoutMark(a.id, "2026-10-19", true, NOW);
    await calc.setWorkoutMark(a.id, "2026-10-20", false, NOW);
    await calc.setWorkoutMark(a.id, "2026-10-19", false, NOW);
    await calc.setWorkoutMark(b.id, "2026-10-19", true, NOW);
    assert.deepEqual(await calc.listWorkoutMarks(a.id, "2026-10-01", "2026-10-31"), [{ localDate: "2026-10-19", done: false }, { localDate: "2026-10-20", done: false }], "повтор заменяет значение дня");
    assert.deepEqual(await calc.listWorkoutMarks(b.id, "2026-10-01", "2026-10-31"), [{ localDate: "2026-10-19", done: true }], "чужие отметки не видны");
    await calc.clearWorkoutMark(a.id, "2026-10-20");
    assert.deepEqual((await calc.listWorkoutMarks(a.id, "2026-10-01", "2026-10-31")).map((day) => day.localDate), ["2026-10-19"], "снятая отметка — нет данных, а не «Нет»");
    await assert.rejects(calc.setWorkoutMark(a.id, "2026-02-31", true, NOW), code("DIARY_DATE_INVALID"));
    const archived = await clients.setArchived(a.id, a.revision, true);
    const manifest = await clients.previewPermanentDelete(a.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "nutrition.calc")?.rows, 1, "отметка входит в состав удаляемого");
    await clients.deleteArchivedPermanently(a.id, archived.revision);
    assert.deepEqual(await calc.listWorkoutMarks(a.id, "2026-10-01", "2026-10-31"), []);
    assert.equal((await calc.listWorkoutMarks(b.id, "2026-10-01", "2026-10-31")).length, 1);
  } finally { await close(); }
});
