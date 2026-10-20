import assert from "node:assert/strict";
import test from "node:test";
import { buckets, entriesInRange, exerciseActivity, muscleGroups, rangeFor, recordsInRange, scaleFor, statusCounts, summarize } from
  "../src/features/training/analytics/presentation/trainingStats.ts";
import type { SetFact, SetType, SetValues, WorkoutStatus } from "../src/features/training/execution/domain/ExecutionModel.ts";
import type { TrainingHistoryEntry } from "../src/features/training/archive/presentation/trainingHistory.ts";
import type { ExerciseInfo } from "../src/features/training/plans/domain/ExerciseLookupPort.ts";

const BENCH = "sys:bench";
const PULLUP = "sys:pullup-weighted";
const CURL = "sys:curl";
let n = 0;

const infos: Readonly<Record<string, ExerciseInfo>> = {
  [BENCH]: { name: "Жим", metrics: ["load", "reps"], thumbnail: null, unilateral: false, group: { id: "chest", label: "Грудь" } },
  [CURL]: { name: "Бицепс", metrics: ["load", "reps"], thumbnail: null, unilateral: false, group: { id: "upper_arms", label: "Плечи и руки" } },
  [PULLUP]: { name: "Подтягивания с весом", metrics: ["addedLoad", "reps"], thumbnail: null, unilateral: false, group: { id: "back", label: "Спина" } },
};
const infoOf = (id: string) => infos[id];

const values = (kg: number | null, reps: number | null): SetValues => ({ reps, loadGrams: kg === null ? null : kg * 1000, durationSec: null, distanceM: null });
function fact(exerciseId: string, value: SetValues, options: Partial<Readonly<{ setType: SetType; confirmed: boolean }>> = {}): SetFact {
  n += 1;
  return { id: `f${n}`, plannedSetId: `p${n}`, plannedExerciseId: `pe${n}`, exerciseId, position: n, setType: options.setType ?? "NORMAL", values: value,
    drops: [], rpe: null, confirmed: options.confirmed ?? true, sides: null, extra: false, revision: 1 };
}
function entry(key: string, date: string, status: WorkoutStatus, facts: readonly SetFact[], programId = "A"): TrainingHistoryEntry {
  const groups = new Map<string, SetFact[]>();
  for (const item of facts) groups.set(item.exerciseId, [...(groups.get(item.exerciseId) ?? []), item]);
  return { key, programId, programTitle: programId, programKind: "SIMPLE", archived: false, planDeleted: false, mesocycleId: null, mesocycleTitle: null,
    workoutTitle: "Т", plannedWorkoutId: "w", weekIndex: 1, actualDate: date, status, confirmedSets: facts.length, volumeKg: 0,
    exercises: [...groups].map(([exerciseId, list]) => ({ exerciseId, facts: list })) };
}

test("сводка: незавершённая тренировка даёт подходы, но не «проведено» (§48.86.25)", () => {
  const entries = [
    entry("a", "2026-10-01", "COMPLETED", [fact(BENCH, values(100, 5)), fact(BENCH, values(100, 5))]),
    entry("b", "2026-10-02", "IN_PROGRESS", [fact(BENCH, values(80, 5))]),
    entry("c", "2026-10-03", "MISSED", [fact(BENCH, values(50, 5), { confirmed: false })]),
  ];
  const summary = summarize(entries, infoOf);
  assert.equal(summary.completed, 1);
  assert.equal(summary.workouts, 3);
  assert.equal(summary.workingSets, 3, "подходы считаются при любом исходе, незасчитанный — нет");
});

test("разминка и незасчитанные подходы не входят в рабочие и тоннаж", () => {
  const summary = summarize([entry("a", "2026-10-01", "COMPLETED", [fact(BENCH, values(40, 10), { setType: "WARMUP" }),
    fact(BENCH, values(100, 5), { confirmed: false }), fact(BENCH, values(100, 5))])], infoOf);
  assert.equal(summary.workingSets, 1);
  assert.equal(summary.tonnageKg, 500);
});

test("тоннаж: известные 800 кг + невычислимый подход → 800 и пометка неполных (§48.86.15)", () => {
  const summary = summarize([entry("a", "2026-10-01", "COMPLETED", [fact(BENCH, values(100, 8)), fact(PULLUP, values(10, 8))])], infoOf);
  assert.equal(summary.tonnageKg, 800);
  assert.equal(summary.incompleteSets, 1);
});

test("нет вычислимых величин — тоннаж «нет данных», а не 0 (§48.86.32)", () => {
  const onlyBody = summarize([entry("a", "2026-10-01", "COMPLETED", [fact(PULLUP, values(10, 8))])], infoOf);
  assert.equal(onlyBody.tonnageKg, null);
  assert.equal(onlyBody.incompleteSets, 1);
  const noReps = summarize([entry("a", "2026-10-01", "COMPLETED", [fact(BENCH, values(100, null))])], infoOf);
  assert.equal(noReps.tonnageKg, null, "вес без повторов — невычислимо");
  assert.equal(noReps.incompleteSets, 1);
});

test("мышечные группы: рабочие подходы по категории, разминка не считается, без категории — отдельно (§48.86.27)", () => {
  const rows = muscleGroups([entry("a", "2026-10-01", "COMPLETED", [fact(BENCH, values(100, 5)), fact(BENCH, values(100, 5)), fact(BENCH, values(100, 5)),
    fact(BENCH, values(40, 10), { setType: "WARMUP" }), fact(CURL, values(20, 10)), fact("sys:unknown", values(10, 10))])], infoOf);
  assert.deepEqual(rows.map((row) => [row.label, row.sets]), [["Грудь", 3], ["Без категории", 1], ["Плечи и руки", 1]]);
});

test("период по фактической дате включительно; «всё время» без начала", () => {
  const entries = [entry("a", "2026-09-30", "COMPLETED", [fact(BENCH, values(1, 1))]), entry("b", "2026-10-01", "COMPLETED", [fact(BENCH, values(1, 1))]),
    entry("c", "2026-10-30", "COMPLETED", [fact(BENCH, values(1, 1))])];
  const range = rangeFor(new Date(2026, 9, 30), 30);
  assert.deepEqual(range, { from: "2026-10-01", to: "2026-10-30" });
  assert.deepEqual(entriesInRange(entries, range).map((item) => item.key), ["b", "c"]);
  assert.deepEqual(entriesInRange(entries, rangeFor(new Date(2026, 9, 30), null)).map((item) => item.key), ["a", "b", "c"]);
});

test("шкала графика: до 14 дней — дни, до 120 — недели, дальше — месяцы (§48.86.31)", () => {
  assert.equal(scaleFor("2026-10-01", "2026-10-14"), "day");
  assert.equal(scaleFor("2026-10-01", "2026-10-15"), "week");
  assert.equal(scaleFor("2026-07-01", "2026-10-28"), "week");
  assert.equal(scaleFor("2026-07-01", "2026-10-29"), "month");
});

test("столбцы по неделям (с понедельника): сумма не меняется, пустые недели — ноль (§48.86.31)", () => {
  // 2026-10-05 — понедельник; 10-11 — воскресенье той же недели; 10-19 — понедельник через неделю.
  const entries = [entry("a", "2026-10-05", "COMPLETED", [fact(BENCH, values(1, 1))]), entry("b", "2026-10-11", "COMPLETED", [fact(BENCH, values(1, 1))]),
    entry("c", "2026-10-19", "COMPLETED", [fact(BENCH, values(1, 1))])];
  const { scale, items } = buckets(entries, { from: "2026-10-05", to: "2026-10-25" }, () => 1, 0);
  assert.equal(scale, "week");
  assert.deepEqual(items.map((item) => [item.key, item.value]), [["2026-10-05", 2], ["2026-10-12", 0], ["2026-10-19", 1]]);
  assert.equal(items.reduce((sum, item) => sum + (item.value ?? 0), 0), 3);
});

test("столбцы тоннажа: период без вычислимых данных — null, не 0", () => {
  const entries = [entry("a", "2026-10-05", "COMPLETED", [fact(BENCH, values(100, 5))])];
  const { items } = buckets(entries, { from: "2026-10-05", to: "2026-10-25" }, (item) => summarize([item], infoOf).tonnageKg, null);
  assert.deepEqual(items.map((item) => item.value), [500, null, null]);
});

test("рекорд, установленный до периода, «новым» не считается; фильтр программы только ограничивает показ (§48.86.35)", () => {
  const all = [
    entry("old", "2026-09-10", "COMPLETED", [fact(BENCH, values(100, 5))], "A"),
    entry("new5", "2026-10-10", "COMPLETED", [fact(BENCH, values(105, 5))], "B"),
    entry("new1", "2026-10-12", "COMPLETED", [fact(BENCH, values(120, 1))], "A"),
  ];
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const events = recordsInRange(all, entriesInRange(all, range), range, infoOf);
  assert.deepEqual(events.map((event) => [event.reps, event.loadKg, event.date]), [[1, 120, "2026-10-12"], [5, 105, "2026-10-10"]]);
  const onlyA = recordsInRange(all, entriesInRange(all, range).filter((item) => item.programId === "A"), range, infoOf);
  assert.deepEqual(onlyA.map((event) => [event.reps, event.loadKg]), [[1, 120]], "рекорд программы B скрыт фильтром, но не пересчитан");
});

test("разминочный и незасчитанный подход не создают рекорд", () => {
  const all = [entry("a", "2026-10-10", "COMPLETED", [fact(BENCH, values(200, 1), { setType: "WARMUP" }), fact(BENCH, values(150, 1), { confirmed: false }),
    fact(BENCH, values(100, 1))])];
  const range = { from: "2026-10-01", to: "2026-10-31" };
  assert.deepEqual(recordsInRange(all, all, range, infoOf).map((event) => event.loadKg), [100]);
});

test("статусы и активность упражнений", () => {
  const entries = [entry("a", "2026-10-01", "COMPLETED", [fact(BENCH, values(1, 1))]), entry("b", "2026-10-09", "MISSED", [fact(BENCH, values(1, 1)), fact(CURL, values(1, 1))]),
    entry("c", "2026-10-05", "COMPLETED", [fact(BENCH, values(1, 1))])];
  assert.deepEqual([...statusCounts(entries)].sort(), [["COMPLETED", 2], ["MISSED", 1]]);
  assert.deepEqual(exerciseActivity(entries).map((row) => [row.exerciseId, row.sessions, row.workingSets, row.lastDate]),
    [[BENCH, 3, 3, "2026-10-09"], [CURL, 1, 1, "2026-10-09"]]);
});
