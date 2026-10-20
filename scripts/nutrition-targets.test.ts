import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { devNutritionCalcClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionCalcRepository.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { devNutritionClientDeletionParticipant } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { DevNutritionTargetsRepository, devNutritionTargetsClientDeletionParticipant } from
  "../apps/mobile/src/features/nutrition/data/DevNutritionTargetsRepository.ts";
import type { DaySummary } from "../apps/mobile/src/features/nutrition/domain/DiaryModel.ts";
import type { Corridors } from "../apps/mobile/src/features/nutrition/domain/TargetModel.ts";
import { affectedPeriod, assessDay, energyConsistency, judge, resolveTarget, validateVersion, versionFor, weekdayOf } from
  "../apps/mobile/src/features/nutrition/domain/TargetRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const NOW = new Date("2026-10-20T10:00:00.000Z");
/** 2026-10-19 — понедельник, 20 — вторник, 24 — суббота (проверено по календарю, не по коду). */
const MON = "2026-10-19";
const TUE = "2026-10-20";
const SAT = "2026-10-24";

/** Коридор ккал в целых ккал → десятые. */
const kcalOnly = (min: number, max: number): Corridors => ({ kcal: { minX10: min * 10, maxX10: max * 10 }, protein: null, fat: null, carbs: null });
const range = (min: number, max: number) => ({ minX10: min * 10, maxX10: max * 10 });
/** Расписание: понедельник и вторник заданы, остальное — без цели. */
const monTue = (mon: Corridors, tue: Corridors) => [mon, tue, null, null, null, null, null];

function day(kcal: number | null, protein: number | null = null): DaySummary {
  const empty = { kcalX10: null, proteinX10: null, fatX10: null, carbsX10: null };
  return { localDate: MON, state: "FOOD_RECORDED", foodEntries: 1,
    totals: { ...empty, kcalX10: kcal === null ? null : kcal * 10, proteinX10: protein === null ? null : protein * 10 },
    bySlot: { BREAKFAST: null, LUNCH: null, DINNER: null, SNACK: null } };
}

async function stores(participants = true) {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, participants ? [devNutritionClientDeletionParticipant, devNutritionTargetsClientDeletionParticipant, devNutritionCalcClientDeletionParticipant] : []);
  await clients.initialize();
  const targets = new DevNutritionTargetsRepository(shared, WS);
  await targets.initialize();
  const close = async () => { await targets.close(); await clients.close(); };
  return { db, clients, targets, close };
}
const code = (name: string) => (error: unknown) => error instanceof Error && error.message === name;

test("N03 §49.8.2: границы входят в коридор — 1899 ниже, 2000 внутри, 2101 выше; белок оценивается отдельно", () => {
  const kcal = range(1900, 2100);
  assert.deepEqual([1899, 1900, 2000, 2100, 2101].map((value) => judge(kcal, value * 10)), ["BELOW", "IN", "IN", "IN", "ABOVE"]);
  const target = { source: "EXCEPTION" as const, corridors: { kcal, protein: range(140, 160), fat: null, carbs: null } };
  const verdict = assessDay(day(2000, 130), target);
  assert.deepEqual([verdict.kcal, verdict.protein, verdict.fat], ["IN", "BELOW", "UNKNOWN"], "калории в коридоре не скрывают недобор белка; жира цели нет");
});

test("N03 §49.8.2: день без еды, неизвестное значение и отсутствие цели — не «ниже нормы»", () => {
  const target = { source: "EXCEPTION" as const, corridors: kcalOnly(1900, 2100) };
  const noFood: DaySummary = { ...day(null), state: "NO_FOOD", foodEntries: 0 };
  assert.equal(assessDay(noFood, target).kcal, "UNKNOWN");
  assert.equal(assessDay(day(null), target).kcal, "UNKNOWN", "калорийность дня неизвестна");
  assert.equal(assessDay(day(2000), { source: "NONE" }).kcal, "UNKNOWN");
});

test("N03 §49.9.2: понедельник 2400–2600, вторник 2100–2300 — 2350 ккал ниже в понедельник и выше во вторник", () => {
  const version = { id: "v", clientId: "c", effectiveFrom: "2026-10-01", revision: 1, days: monTue(kcalOnly(2400, 2600), kcalOnly(2100, 2300)) };
  assert.deepEqual([weekdayOf(MON), weekdayOf(TUE), weekdayOf(SAT)], [0, 1, 5]);
  const mon = resolveTarget([version], [], MON);
  const tue = resolveTarget([version], [], TUE);
  assert.equal(assessDay(day(2350), mon).kcal, "BELOW");
  assert.equal(assessDay(day(2350), tue).kcal, "ABOVE");
  assert.equal(resolveTarget([version], [], SAT).source, "NONE", "в субботу цели нет — не нулевой коридор");
});

test("N03 §49.11.2: версия A до 14.10, B с 15.10 — прошлые дни по A; до первой версии цели нет", () => {
  const a = { id: "a", clientId: "c", effectiveFrom: "2026-10-01", revision: 1, days: Array(7).fill(kcalOnly(2000, 2200)) };
  const b = { id: "b", clientId: "c", effectiveFrom: "2026-10-15", revision: 1, days: Array(7).fill(kcalOnly(1800, 1900)) };
  const pick = (date: string) => { const target = resolveTarget([b, a], [], date); return target.source === "SCHEDULE" ? [target.effectiveFrom, target.corridors.kcal?.minX10] : null; };
  assert.deepEqual(pick("2026-10-14"), ["2026-10-01", 20000]);
  assert.deepEqual(pick("2026-10-15"), ["2026-10-15", 18000]);
  assert.equal(pick("2026-09-30"), null);
  assert.equal(versionFor([a, b], "2026-12-31")?.id, "b");
  assert.deepEqual(affectedPeriod([a, b], "2026-10-05"), { from: "2026-10-05", to: "2026-10-14" }, "ретроспективная версия затронет период до следующей");
  assert.deepEqual(affectedPeriod([a, b], "2026-10-20"), { from: "2026-10-20", to: null });
});

test("N03 §49.12: исключение даты сильнее расписания; следующая суббота — по обычному; после удаления — снова расписание", () => {
  const sat = (corridors: Corridors) => [null, null, null, null, null, corridors, null];
  const version = { id: "v", clientId: "c", effectiveFrom: "2026-10-01", revision: 1, days: sat(kcalOnly(2100, 2300)) };
  const exception = { clientId: "c", localDate: SAT, corridors: kcalOnly(2600, 2800) };
  const withException = resolveTarget([version], [exception], SAT);
  assert.equal(withException.source === "EXCEPTION" && withException.corridors.kcal?.minX10, 26000);
  const nextSat = resolveTarget([version], [exception], "2026-10-31");
  assert.equal(nextSat.source === "SCHEDULE" && nextSat.corridors.kcal?.minX10, 21000);
  assert.equal(resolveTarget([version], [], SAT).source, "SCHEDULE");
});

test("N03 ввод: min > max, отрицательное, не 7 дней и версия без единого коридора отклоняются", () => {
  const ok = { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(2000, 2100), kcalOnly(2000, 2100)) };
  assert.equal(validateVersion(ok).days.length, 7);
  assert.throws(() => validateVersion({ ...ok, days: monTue(kcalOnly(2100, 1900), kcalOnly(2000, 2100)) }), code("TARGET_RANGE_INVALID"));
  assert.throws(() => validateVersion({ ...ok, days: monTue({ ...kcalOnly(1, 2), protein: { minX10: -1, maxX10: 5 } }, kcalOnly(2000, 2100)) }), code("TARGET_RANGE_INVALID"));
  assert.throws(() => validateVersion({ ...ok, days: ok.days.slice(0, 6) }), code("TARGET_DAYS_INVALID"));
  assert.throws(() => validateVersion({ ...ok, days: Array(7).fill(null) }), code("TARGET_EMPTY"));
  assert.throws(() => validateVersion({ ...ok, effectiveFrom: "2026-13-01" }), code("DIARY_DATE_INVALID"));
  assert.doesNotThrow(() => validateVersion({ ...ok, days: monTue(kcalOnly(2000, 2000), kcalOnly(2000, 2000)) }), "равные границы — частный случай");
});

test("N03 §49.8.1.5: согласованность калорий и макродиапазонов — только предупреждение", () => {
  const macros = { protein: range(140, 160), fat: range(55, 70), carbs: range(180, 220) };
  // 4×140+9×55+4×180 = 1775 … 4×160+9×70+4×220 = 2150 ккал.
  assert.equal(energyConsistency({ kcal: range(1900, 2100), ...macros }), "OK");
  assert.equal(energyConsistency({ kcal: range(3000, 3200), ...macros }), "INCOMPATIBLE");
  assert.equal(energyConsistency({ kcal: range(1000, 1700), ...macros }), "INCOMPATIBLE");
  assert.equal(energyConsistency({ kcal: range(1900, 2100), protein: null, fat: null, carbs: null }), "UNKNOWN");
});

test("N03 хранилище: версии по датам, повтор даты без revision отказан, правка по revision, цели клиентов изолированы", async () => {
  const { clients, targets, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const first = await targets.saveVersion(a.id, { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(2400, 2600), kcalOnly(2100, 2300)) }, null, NOW);
    assert.deepEqual([first.revision, first.days[0]?.kcal, first.days[2]], [1, range(2400, 2600), null]);
    await targets.saveVersion(a.id, { effectiveFrom: "2026-10-15", days: monTue(kcalOnly(1800, 1900), kcalOnly(1800, 1900)) }, null, NOW);
    assert.deepEqual((await targets.listVersions(a.id)).map((version) => version.effectiveFrom), ["2026-10-01", "2026-10-15"]);

    await assert.rejects(targets.saveVersion(a.id, { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(1, 2), kcalOnly(1, 2)) }, null, NOW), code("TARGET_VERSION_EXISTS"));
    const edited = await targets.saveVersion(a.id, { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(2500, 2700), kcalOnly(2100, 2300)) }, 1, NOW);
    assert.deepEqual([edited.revision, edited.days[0]?.kcal], [2, range(2500, 2700)]);
    await assert.rejects(targets.saveVersion(a.id, { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(1, 2), kcalOnly(1, 2)) }, 1, NOW), code("TARGET_STALE"));
    await assert.rejects(targets.saveVersion(a.id, { effectiveFrom: "2026-11-01", days: monTue(kcalOnly(1, 2), kcalOnly(1, 2)) }, 3, NOW), code("TARGET_STALE"), "новая дата с revision");
    assert.deepEqual(await targets.listVersions(b.id), [], "цели клиента А не видны клиенту Б");
    assert.equal((await targets.listVersions(a.id)).length, 2, "прежние версии на месте");
  } finally { await close(); }
});

test("N03 хранилище: исключения даты — запись, замена, удаление; расписание их не стирает", async () => {
  const { clients, targets, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    await targets.setException(client.id, SAT, kcalOnly(2600, 2800), NOW);
    await targets.setException(client.id, SAT, { ...kcalOnly(2500, 2700), fat: range(60, 80) }, NOW);
    const [only] = await targets.listExceptions(client.id);
    assert.deepEqual([only?.localDate, only?.corridors.kcal, only?.corridors.fat, only?.corridors.carbs], [SAT, range(2500, 2700), range(60, 80), null]);
    await targets.saveVersion(client.id, { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(2000, 2100), kcalOnly(2000, 2100)) }, null, NOW);
    assert.equal((await targets.listExceptions(client.id)).length, 1, "смена расписания исключение не трогает");
    await assert.rejects(targets.setException(client.id, SAT, { kcal: null, protein: null, fat: null, carbs: null }, NOW), code("TARGET_EMPTY"));
    await assert.rejects(targets.setException(client.id, "2026-02-30", kcalOnly(1, 2), NOW), code("DIARY_DATE_INVALID"));
    await targets.clearException(client.id, SAT);
    assert.deepEqual(await targets.listExceptions(client.id), []);
  } finally { await close(); }
});

test("N03 подписка и схема: публикация после коммита; CHECK не пускает min > max и половину пары", async () => {
  const { db, clients, targets, close } = await stores();
  try {
    const client = await clients.create({ displayName: "SyntheticA" });
    const seen: string[] = [];
    const off = targets.subscribeCommittedChanges((change) => seen.push(change.clientId));
    await targets.setException(client.id, SAT, kcalOnly(2600, 2800), NOW);
    off();
    await targets.clearException(client.id, SAT);
    assert.deepEqual(seen, [client.id]);
    const insert = (min: number | null, max: number | null) => db.prepare(`INSERT INTO dev_nutrition_target_exceptions (workspace_id, client_id, local_date,
      kcal_min_x10, kcal_max_x10, updated_at) VALUES (?, ?, '2026-10-24', ?, ?, 'x')`).run(WS, client.id, min, max);
    assert.throws(() => insert(2100, 1900), /CHECK/u);
    assert.throws(() => insert(2100, null), /CHECK/u);
    insert(null, null);
  } finally { await close(); }
});

test("§15.7 окончательное удаление клиента убирает его версии целей и исключения; без владельца — отказ", async () => {
  const { clients, targets, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "Gone" });
    const kept = await clients.create({ displayName: "Kept" });
    await targets.saveVersion(gone.id, { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(2000, 2100), kcalOnly(2000, 2100)) }, null, NOW);
    await targets.setException(gone.id, SAT, kcalOnly(2600, 2800), NOW);
    await targets.saveVersion(kept.id, { effectiveFrom: "2026-10-01", days: monTue(kcalOnly(2000, 2100), kcalOnly(2000, 2100)) }, null, NOW);
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    const manifest = await clients.previewPermanentDelete(gone.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "nutrition.targets")?.rows, 2);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    assert.deepEqual([(await targets.listVersions(gone.id)).length, (await targets.listExceptions(gone.id)).length], [0, 0]);
    assert.equal((await targets.listVersions(kept.id)).length, 1);
  } finally { await close(); }
  const blocked = await stores(false);
  try {
    const client = await blocked.clients.create({ displayName: "Blocked" });
    await blocked.targets.setException(client.id, SAT, kcalOnly(2600, 2800), NOW);
    const archived = await blocked.clients.setArchived(client.id, client.revision, true);
    await assert.rejects(blocked.clients.deleteArchivedPermanently(client.id, archived.revision), { message: "CLIENT_DELETION_BLOCKED" });
  } finally { await blocked.close(); }
});
