import assert from "node:assert/strict";
import test from "node:test";
import { bodyweightLookup, bucketKeyOf, buckets, compareMonths, delta, entriesInRange, exerciseActivity, monthRange, muscleGroups, planCompletion, rangeFor, recordsInRange, sanitizeFilter, scaleFor, statusCounts, summarize, trimToGroup } from
  "../src/features/training/analytics/presentation/trainingStats.ts";
import type { SetFact, SetType, SetValues, WorkoutStatus } from "../src/features/training/execution/domain/ExecutionModel.ts";
import type { TrainingHistoryEntry } from "../src/features/training/archive/presentation/trainingHistory.ts";
import { ALL_OPTION, mesocycleOptions, programOptions } from "../src/features/training/archive/presentation/trainingHistory.ts";
import { periodRange } from "../src/features/training/analytics/presentation/statsFilters.ts";
import type { ExerciseInfo } from "../src/features/training/plans/domain/ExerciseLookupPort.ts";

const BENCH = "sys:bench";
const PULLUP = "sys:pullup-weighted";
const CURL = "sys:curl";
let n = 0;

const infos: Record<string, ExerciseInfo> = {
  [BENCH]: { name: "Жим", metrics: ["load", "reps"], thumbnail: null, unilateral: false, group: { id: "chest", label: "Грудь" } },
  [CURL]: { name: "Бицепс", metrics: ["load", "reps"], thumbnail: null, unilateral: false, group: { id: "upper_arms", label: "Плечи и руки" } },
  [PULLUP]: { name: "Подтягивания с весом", metrics: ["addedLoad", "reps"], thumbnail: null, unilateral: false, group: { id: "back", label: "Спина" } },
};
const ASSIST = "sys:assisted-pullup";
infos[ASSIST] = { name: "Подтягивания в гравитроне", metrics: ["assistance", "reps"], thumbnail: null, unilateral: false, group: { id: "back", label: "Спина" } };
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
  return { key, programId, programTitle: programId, programKind: "SIMPLE", archived: false, planDeleted: false, mesocycleId: null, mesocycleIndex: null, mesocycleTitle: null,
    workoutTitle: "Т", workoutKey: "w", plannedWorkoutId: "w", weekIndex: 1, actualDate: date, status, startedAt: null, finishedAt: null, durationSec: null, workingSets: facts.length,
    exercises: [...groups].map(([exerciseId, list]) => ({ exerciseId, facts: list, note: null })) };
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

test("сравнение месяцев: 14 октября — с 1–14 сентября; завершённый сентябрь — со всем августом (§48.86.18)", () => {
  assert.deepEqual(compareMonths({ year: 2026, month: 10 }, "2026-10-14"), { current: { from: "2026-10-01", to: "2026-10-14" }, previous: { from: "2026-09-01", to: "2026-09-14" }, partial: true });
  assert.deepEqual(compareMonths({ year: 2026, month: 9 }, "2026-10-14"), { current: { from: "2026-09-01", to: "2026-09-30" }, previous: { from: "2026-08-01", to: "2026-08-31" }, partial: false });
});

test("сравнение месяцев: короткий предыдущий месяц не достраивается; январь сравнивается с декабрём", () => {
  // 31 марта — последний день, месяц ещё не закончился: 31 день против 28 дней февраля, без выдуманных 29–31.
  assert.deepEqual(compareMonths({ year: 2026, month: 3 }, "2026-03-31").previous, { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(compareMonths({ year: 2027, month: 1 }, "2027-01-20").previous, { from: "2026-12-01", to: "2026-12-20" });
  assert.deepEqual(monthRange({ year: 2028, month: 2 }), { from: "2028-02-01", to: "2028-02-29" }, "високосный февраль");
});

test("разница: 8 → 10 даёт +2 и +25%; нулевая база — без процента; ненадёжное — без разницы (§48.86.14, §48.86.15)", () => {
  assert.deepEqual(delta(10, 8), { abs: 2, pct: 25 });
  assert.deepEqual(delta(5, 0), { abs: 5, pct: null });
  assert.deepEqual(delta(0, 0), { abs: 0, pct: null });
  assert.deepEqual(delta(800, 700, false), { abs: null, pct: null });
  assert.deepEqual(delta(null, 700), { abs: null, pct: null });
});

test("фильтр, которого нет в данных, безопасно сбрасывается (§48.86.16 п. 3)", () => {
  const entries = [entry("a", "2026-10-01", "COMPLETED", [fact(BENCH, values(1, 1))], "A")];
  assert.deepEqual(sanitizeFilter(entries, { programId: "A", mesocycleId: null, workoutKey: null }), { programId: "A", mesocycleId: null, workoutKey: null });
  assert.deepEqual(sanitizeFilter(entries, { programId: "удалена", mesocycleId: "м", workoutKey: "w" }), { programId: null, mesocycleId: null, workoutKey: null });
  assert.deepEqual(sanitizeFilter(entries, { programId: "A", mesocycleId: "удалён", workoutKey: "w" }), { programId: "A", mesocycleId: null, workoutKey: null },
    "нет мезоцикла — сбрасывается и тренировка");
  assert.deepEqual(sanitizeFilter(entries, { programId: "A", mesocycleId: null, workoutKey: "w" }), { programId: "A", mesocycleId: null, workoutKey: "w" },
    "тренировка есть в данных — выбор остаётся");
  assert.deepEqual(sanitizeFilter(entries, { programId: "A", mesocycleId: null, workoutKey: "удалена" }), { programId: "A", mesocycleId: null, workoutKey: null },
    "тренировки уже нет в данных — безопасный сброс");
});

test("переход от столбца: занятия попадают в тот же интервал, что и столбец; от группы — только её упражнения (§48.86.19)", () => {
  const entries = [entry("a", "2026-10-07", "COMPLETED", [fact(BENCH, values(100, 5)), fact(CURL, values(20, 10))]), entry("b", "2026-10-14", "COMPLETED", [fact(BENCH, values(100, 5))])];
  assert.deepEqual(entries.filter((item) => bucketKeyOf(item.actualDate, "week") === "2026-10-05").map((item) => item.key), ["a"]);
  const chest = trimToGroup(entries, infoOf, "chest");
  assert.deepEqual(chest.map((item) => [item.key, item.exercises.map((exercise) => exercise.exerciseId)]), [["a", [BENCH]], ["b", [BENCH]]]);
  assert.equal(entries[0]!.exercises.length, 2, "исходные данные не изменены");
});

test("масса тела на дату занятия: последний замер не позже, из будущего не берётся (§48.86.36)", () => {
  const lookup = bodyweightLookup([{ date: "2026-09-02", kg: 82 }, { date: "2026-09-15", kg: 84 }]);
  assert.deepEqual(lookup("2026-09-10"), { kg: 82, date: "2026-09-02" }, "10 сентября — замер 2 сентября, не 15-го");
  assert.equal(lookup("2026-09-01"), null, "до первого замера — нет данных");
  assert.deepEqual(lookup("2026-09-15"), { kg: 84, date: "2026-09-15" }, "замер в тот же день подходит");
  assert.equal(bodyweightLookup([])("2026-09-10"), null);
});

test("тоннаж с массой тела: с доп. весом (80 + 10) × 8 = 720, с помощью (80 − 30) × 10 = 500 (§48.86.7)", () => {
  const body = bodyweightLookup([{ date: "2026-09-02", kg: 80 }]);
  const weighted = summarize([entry("a", "2026-09-10", "COMPLETED", [fact(PULLUP, values(10, 8))])], infoOf, body);
  assert.deepEqual([weighted.tonnageKg, weighted.incompleteSets], [720, 0]);
  const assisted = summarize([entry("a", "2026-09-10", "COMPLETED", [fact(ASSIST, values(30, 10))])], infoOf, body);
  assert.deepEqual([assisted.tonnageKg, assisted.incompleteSets], [500, 0]);
});

test("тоннаж с массой тела: нет замера, помощь больше массы или пустой вес — невычислимо, не ноль", () => {
  const body = bodyweightLookup([{ date: "2026-09-02", kg: 80 }]);
  const noBody = summarize([entry("a", "2026-09-01", "COMPLETED", [fact(PULLUP, values(10, 8))])], infoOf, body);
  assert.deepEqual([noBody.tonnageKg, noBody.incompleteSets], [null, 1], "1 сентября замеров ещё не было");
  const negative = summarize([entry("a", "2026-09-10", "COMPLETED", [fact(ASSIST, values(90, 10))])], infoOf, body);
  assert.deepEqual([negative.tonnageKg, negative.incompleteSets], [null, 1], "80 − 90 < 0 — не исправляется молча");
  const emptyLoad = summarize([entry("a", "2026-09-10", "COMPLETED", [fact(PULLUP, values(null, 8))])], infoOf, body);
  assert.deepEqual([emptyLoad.tonnageKg, emptyLoad.incompleteSets], [null, 1]);
  const mixed = summarize([entry("a", "2026-09-10", "COMPLETED", [fact(BENCH, values(100, 8)), fact(PULLUP, values(10, 8))])], infoOf);
  assert.deepEqual([mixed.tonnageKg, mixed.incompleteSets], [800, 1], "без ряда массы тела — 800 кг и один неполный");
});

test("выполнение плана: 10 из 12 = 83,33%; пропуск, отмена и «в работе» в числитель не входят (§48.86.9)", () => {
  const entries = [
    ...Array.from({ length: 10 }, (_, index) => entry("c" + index, "2026-10-0" + ((index % 9) + 1), "COMPLETED", [fact(BENCH, values(1, 1))])),
    entry("m", "2026-10-20", "MISSED", [fact(BENCH, values(1, 1))]), entry("x", "2026-10-21", "CANCELLED", [fact(BENCH, values(1, 1))]),
    entry("w", "2026-10-22", "IN_PROGRESS", [fact(BENCH, values(1, 1))]),
  ];
  const result = planCompletion(entries, 12);
  assert.deepEqual([result.done, result.planned, result.missed, result.cancelled], [10, 12, 1, 1]);
  assert.equal(Math.round(result.pct! * 100) / 100, 83.33);
  assert.equal(planCompletion(entries, 0).pct, null, "нет плановых тренировок — процент не считается");
});

test("границы периода: готовый — от сегодняшней даты, свой — ровно выбранные, без выбора — три месяца", () => {
  const now = new Date(2026, 9, 30);
  assert.deepEqual(periodRange(now, { period: "30", custom: null }), { from: "2026-10-01", to: "2026-10-30" });
  assert.deepEqual(periodRange(now, { period: "custom", custom: { from: "2026-09-12", to: "2026-10-20" } }), { from: "2026-09-12", to: "2026-10-20" });
  assert.deepEqual(periodRange(now, { period: "custom", custom: null }), { from: "2026-08-02", to: "2026-10-30" });
  assert.deepEqual(periodRange(now, { period: "all", custom: { from: "2026-09-12", to: "2026-10-20" } }), { from: null, to: "2026-10-30" }, "запомненный свой период не влияет на «Всё время»");
});

test("варианты выбора программы: «Все» первым, по одной строке на программу, архив и удалённый план помечены", () => {
  const base = entry("a", "2026-10-03", "COMPLETED", [fact(BENCH, values(1, 1))], "P1");
  const entries = [
    { ...base, key: "1", programTitle: "Сила" },
    { ...base, key: "2", programId: "P2", programTitle: "Лето", archived: true },
    { ...base, key: "3", programId: "P3", programTitle: "Старая", planDeleted: true },
    { ...base, key: "4", programTitle: "Сила" },
  ];
  assert.deepEqual(programOptions(entries), [{ value: ALL_OPTION, label: "Все программы" }, { value: "P1", label: "Сила" },
    { value: "P2", label: "Лето (архив)" }, { value: "P3", label: "Старая (план удалён)" }]);
  assert.deepEqual(programOptions([]), [{ value: ALL_OPTION, label: "Все программы" }], "нет занятий — только «Все»");
});

test("варианты мезоциклов: только выбранной программы, без повторов и без простой программы", () => {
  const base = entry("a", "2026-10-03", "COMPLETED", [fact(BENCH, values(1, 1))], "P1");
  const entries = [
    { ...base, key: "1", mesocycleId: "M1", mesocycleTitle: "Блок 1" }, { ...base, key: "2", mesocycleId: "M2", mesocycleTitle: "Блок 2" },
    { ...base, key: "3", mesocycleId: "M1", mesocycleTitle: "Блок 1" }, { ...base, key: "4", programId: "P9", mesocycleId: "M9", mesocycleTitle: "Чужой" },
    { ...base, key: "5", programId: "P2", mesocycleId: null, mesocycleTitle: null },
  ];
  assert.deepEqual(mesocycleOptions(entries, "P1"), [{ value: ALL_OPTION, label: "Все мезоциклы" }, { value: "M1", label: "Блок 1" }, { value: "M2", label: "Блок 2" }]);
  assert.deepEqual(mesocycleOptions(entries, "P2"), [{ value: ALL_OPTION, label: "Все мезоциклы" }]);
});

test("сводка: средняя длительность — по занятиям с парой отметок, при любом исходе (§48.86.17)", () => {
  const timed = (key: string, status: WorkoutStatus, durationSec: number | null) => ({ ...entry(key, "2026-10-01", status, [fact(BENCH, values(50, 5))]), durationSec });
  const summary = summarize([timed("a", "COMPLETED", 3600), timed("b", "MISSED", 1800), timed("c", "COMPLETED", null)], infoOf);
  assert.equal(summary.avgDurationSec, 2700, "(60 + 30) / 2 минут; занятие без отметок не разбавляет среднее");
  assert.equal(summary.timedWorkouts, 2);
  assert.equal(summarize([timed("d", "COMPLETED", null)], infoOf).avgDurationSec, null);
});
