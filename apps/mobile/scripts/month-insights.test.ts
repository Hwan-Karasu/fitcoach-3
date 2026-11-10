import assert from "node:assert/strict";
import test from "node:test";
import { attentionNotes, bestResult, loadSetsOf, monthPhrase, monthPrepositional } from "../src/features/training/analytics/presentation/monthInsights.ts";

test("UIX-11: фраза-вывод — больше, меньше, столько же, нет в прошлом месяце, нет занятий; неполный месяц — «за такой же срок»", () => {
  const base = { month: 11, previousMonth: 10, partial: false };
  assert.equal(monthPhrase({ ...base, completed: 9, previousCompleted: 7 }), "В ноябре проведено 9 занятий — на 2 больше, чем в октябре.");
  assert.equal(monthPhrase({ ...base, completed: 4, previousCompleted: 5 }), "В ноябре проведено 4 занятия — на 1 меньше, чем в октябре.");
  assert.equal(monthPhrase({ ...base, completed: 1, previousCompleted: 1 }), "В ноябре проведено 1 занятие — столько же, сколько в октябре.");
  assert.equal(monthPhrase({ ...base, completed: 5, previousCompleted: 0 }), "В ноябре проведено 5 занятий; в октябре занятий не было.");
  assert.equal(monthPhrase({ ...base, completed: 0, previousCompleted: 6 }), "В ноябре проведённых занятий пока нет.");
  assert.equal(monthPhrase({ month: 3, previousMonth: 2, completed: 11, previousCompleted: 8, partial: true }), "В марте проведено 11 занятий — на 3 больше, чем за такой же срок в феврале.");
  assert.equal(monthPrepositional(12), "декабре");
  assert.equal(monthPrepositional(1), "январе");
});

test("UIX-11: лучший результат — самый тяжёлый подход месяца, при равенстве больше повторов; изменение к прошлому месяцу по тому же упражнению", () => {
  const current = [{ exerciseId: "squat", loadKg: 100, reps: 5 }, { exerciseId: "bench", loadKg: 80, reps: 8 }, { exerciseId: "squat", loadKg: 100, reps: 6 }];
  const previous = [{ exerciseId: "squat", loadKg: 95, reps: 5 }, { exerciseId: "squat", loadKg: 90, reps: 8 }, { exerciseId: "bench", loadKg: 82.5, reps: 5 }];
  assert.deepEqual(bestResult(current, previous), { exerciseId: "squat", loadKg: 100, reps: 6, previousLoadKg: 95 });
  assert.deepEqual(bestResult([{ exerciseId: "row", loadKg: 60, reps: 10 }], previous), { exerciseId: "row", loadKg: 60, reps: 10, previousLoadKg: null }, "в прошлом месяце упражнения не было — изменение неизвестно");
  assert.equal(bestResult([], previous), null);
});

test("UIX-11: подходы «вес × повторы» — только рабочие, двусторонние пропускаются, пустые значения не считаются", () => {
  const fact = (confirmed: boolean, setType: string, loadGrams: number | null, reps: number | null, sides: unknown = null) => ({ confirmed, setType, values: { loadGrams, reps }, sides });
  const entry = { exercises: [
    { exerciseId: "squat", facts: [fact(true, "NORMAL", 100_000, 5), fact(true, "WARMUP", 60_000, 10), fact(false, "NORMAL", 110_000, 3), fact(true, "NORMAL", null, 5), fact(true, "NORMAL", 90_000, 5, {})] },
    { exerciseId: "plank", facts: [fact(true, "NORMAL", 20_000, 5)] },
  ] };
  const infoOf = (id: string) => ({ metrics: id === "squat" ? ["load", "reps"] : ["duration"] }) as never;
  assert.deepEqual(loadSetsOf([entry as never], infoOf), [{ exerciseId: "squat", loadKg: 100, reps: 5 }]);
});

test("UIX-11: «на что обратить внимание» — пропущенные, снижение, неполные данные; без замечаний пусто", () => {
  assert.deepEqual(attentionNotes({ missed: 0, incompleteSets: 0, completed: 8, previousCompleted: 8, partial: false }), []);
  assert.deepEqual(attentionNotes({ missed: 2, incompleteSets: 0, completed: 5, previousCompleted: 9, partial: false }), ["Пропущено 2 занятия.", "Проведено на 4 меньше, чем в прошлом месяце."]);
  assert.deepEqual(attentionNotes({ missed: 1, incompleteSets: 3, completed: 5, previousCompleted: 4, partial: true }), ["Пропущено 1 занятие.", "Неполные данные: 3 подх. без веса, повторов или массы тела — в тоннаж не вошли."]);
  assert.deepEqual(attentionNotes({ missed: 0, incompleteSets: 0, completed: 2, previousCompleted: 3, partial: true }), ["Проведено на 1 меньше, чем за такой же срок в прошлом месяце."]);
});
