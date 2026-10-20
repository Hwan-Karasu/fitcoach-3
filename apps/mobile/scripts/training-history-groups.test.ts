import assert from "node:assert/strict";
import test from "node:test";
import type { TrainingHistoryEntry } from "../src/features/training/archive/presentation/trainingHistory.ts";
import { filterHistory } from "../src/features/training/archive/presentation/trainingHistory.ts";
import { mesocyclesWithHistory, programsWithHistory, scopeSummary, workoutGroups, workoutOptions } from "../src/features/training/archive/presentation/historyGroups.ts";
import { durationText, plural, timeText } from "../src/features/training/archive/presentation/historyText.ts";

type Overrides = Partial<TrainingHistoryEntry> & Pick<TrainingHistoryEntry, "key" | "programId" | "actualDate">;
const entry = (over: Overrides): TrainingHistoryEntry => ({ programTitle: over.programId, programKind: "PERIODIZED", archived: false, planDeleted: false,
  mesocycleId: null, mesocycleTitle: null, mesocycleIndex: null, workoutTitle: "Тренировка 1", workoutKey: "k1", plannedWorkoutId: "w1", weekIndex: 1,
  status: "COMPLETED", startedAt: null, finishedAt: null, durationSec: null, workingSets: 3, exercises: [], ...over });

const E = [
  entry({ key: "e1", programId: "P", programTitle: "Силовой блок", mesocycleId: "m2", mesocycleTitle: "Силовой", mesocycleIndex: 1, workoutKey: "up", workoutTitle: "Верх тела", actualDate: "2026-09-21", weekIndex: 3 }),
  entry({ key: "e2", programId: "P", programTitle: "Силовой блок", mesocycleId: "m2", mesocycleTitle: "Силовой", mesocycleIndex: 1, workoutKey: "up", workoutTitle: "Верх тела (новое)", actualDate: "2026-09-28", weekIndex: 4, status: "IN_PROGRESS", workingSets: 2 }),
  entry({ key: "e3", programId: "P", programTitle: "Силовой блок", mesocycleId: "m1", mesocycleTitle: "Базовый", mesocycleIndex: 0, workoutKey: "up", workoutTitle: "Верх тела", actualDate: "2026-09-07", weekIndex: 1 }),
  entry({ key: "e4", programId: "P", programTitle: "Силовой блок", mesocycleId: "m2", mesocycleTitle: "Силовой", mesocycleIndex: 1, workoutKey: "low", workoutTitle: "Верх тела", actualDate: "2026-09-22", weekIndex: 3, status: "MISSED", workingSets: 0 }),
  entry({ key: "s1", programId: "S", programTitle: "Фуллбади", programKind: "SIMPLE", workoutKey: "w", plannedWorkoutId: "w", workoutTitle: "Фуллбади", actualDate: "2026-10-02", weekIndex: 1 }),
  entry({ key: "d1", programId: "D", programTitle: "Старый план", planDeleted: true, mesocycleTitle: "Блок А", workoutKey: "dw1", workoutTitle: "День 2", actualDate: "2026-08-01" }),
  entry({ key: "d2", programId: "D", programTitle: "Старый план", planDeleted: true, mesocycleTitle: "Блок Б", workoutKey: "dw1", workoutTitle: "День 2", actualDate: "2026-08-08", weekIndex: 2 }),
  entry({ key: "d3", programId: "D", programTitle: "Старый план", planDeleted: true, mesocycleTitle: "Блок Б", workoutKey: "dw10", workoutTitle: "День 10", actualDate: "2026-08-09", weekIndex: 2 }),
];

test("список программ: по дате последнего занятия, счётчики «проведено / записей / рабочих подходов», пометки", () => {
  const programs = programsWithHistory(E);
  assert.deepEqual(programs.map((item) => item.programId), ["S", "P", "D"], "новее — выше");
  const p = programs.find((item) => item.programId === "P")!;
  assert.deepEqual([p.title, p.kind, p.records, p.completed, p.workingSets, p.mesocycles, p.lastDate],
    ["Силовой блок", "PERIODIZED", 4, 2, 8, 2, "2026-09-28"], "4 записи; проведено 2 (e1, e3); подходы 3+2+3+0; мезоциклов 2");
  const d = programs.find((item) => item.programId === "D")!;
  assert.deepEqual([d.planDeleted, d.mesocycles, d.records], [true, 0, 3], "у программы с удалённым планом мезоциклов нет, записи есть");
  assert.equal(programs.find((item) => item.programId === "S")!.mesocycles, 0, "у Простой мезоциклов нет");
});

test("мезоциклы с историей: только Расширенная, в порядке плана, без повторов; у «план удалён» ленты нет", () => {
  assert.deepEqual(mesocyclesWithHistory(E, "P").map((item) => [item.mesocycleId, item.title]), [["m1", "Базовый"], ["m2", "Силовой"]]);
  assert.deepEqual(mesocyclesWithHistory(E, "S"), []);
  assert.deepEqual(mesocyclesWithHistory(E, "D"), [], "план удалён — подписи из снимка, ленты мезоциклов нет");
});

test("группы тренировок: по ключу, а не по названию; новые выполнения сверху; заголовок — по ближайшему выполнению", () => {
  const groups = workoutGroups(E, { programId: "P", mesocycleId: "m2" });
  assert.deepEqual(groups.map((group) => group.key), ["low", "up"], "две тренировки с одним названием «Верх тела» не склеены; порядок — по названию");
  const up = groups.find((group) => group.key === "up")!;
  assert.deepEqual(up.occurrences.map((item) => item.key), ["e2", "e1"], "новое выполнение сверху");
  assert.equal(up.title, "Верх тела (новое)", "название ближайшего по дате выполнения");
  assert.deepEqual([up.completed, up.occurrences.length], [1, 2], "проведено только COMPLETED");
  assert.equal(workoutGroups(E, { programId: "P", mesocycleId: null }).find((group) => group.key === "up")!.occurrences.length, 3, "вся программа — все мезоциклы");
});

test("блок «план удалён»: один набор групп по id тренировки, названия числовым порядком, мезоцикл — подпись выполнения", () => {
  const groups = workoutGroups(E, { programId: "D", mesocycleId: null });
  assert.deepEqual(groups.map((group) => group.title), ["День 2", "День 10"], "«День 2» раньше «День 10»");
  assert.deepEqual(groups[0]!.occurrences.map((item) => item.mesocycleTitle), ["Блок Б", "Блок А"], "каждое выполнение хранит свою подпись мезоцикла");
});

test("заголовок группы: если у ближайшего выполнения названия нет — ближайшее непустое, иначе «Тренировка»", () => {
  const items = [entry({ key: "a", programId: "X", workoutKey: "k", workoutTitle: null, actualDate: "2026-01-02" }),
    entry({ key: "b", programId: "X", workoutKey: "k", workoutTitle: "День А", actualDate: "2026-01-01" })];
  assert.equal(workoutGroups(items, { programId: "X", mesocycleId: null })[0]!.title, "День А");
  assert.equal(workoutGroups([items[0]!], { programId: "X", mesocycleId: null })[0]!.title, "Тренировка");
});

test("фильтр «Тренировка»: третий уровень после программы и мезоцикла, варианты по группам", () => {
  const filter = (programId: string | null, mesocycleId: string | null, workoutKey: string | null) => ({ programId, mesocycleId, workoutKey });
  assert.deepEqual(filterHistory(E, filter("P", "m2", "up")).map((item) => item.key).sort(), ["e1", "e2"], "мезоцикл 2, тренировка up");
  assert.deepEqual(filterHistory(E, filter("P", null, "up")).map((item) => item.key).sort(), ["e1", "e2", "e3"], "вся программа, тренировка up");
  assert.deepEqual(filterHistory(E, filter("P", "m2", null)).length, 3, "без тренировки — весь мезоцикл");
  assert.deepEqual(workoutOptions(E, "P", "m2"), [{ value: "__all__", label: "Все тренировки" }, { value: "low", label: "Верх тела" }, { value: "up", label: "Верх тела (новое)" }]);
  assert.deepEqual(workoutOptions(E, "D", null).map((option) => option.label), ["Все тренировки", "День 2", "День 10"]);
});

test("сводка области: проведено / записей / рабочих подходов по записям выбора", () => {
  assert.deepEqual(scopeSummary(E.filter((item) => item.programId === "P" && item.mesocycleId === "m2")), { records: 3, completed: 1, workingSets: 5 },
    "e1 (3 подхода, проведена), e2 (2, в работе), e4 (0, пропущена)");
  assert.deepEqual(scopeSummary([]), { records: 0, completed: 0, workingSets: 0 });
});

test("подписи: склонение, длительность и время", () => {
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25].map((n) => plural(n, "выполнение", "выполнения", "выполнений")),
    ["выполнение", "выполнения", "выполнений", "выполнений", "выполнений", "выполнение", "выполнения", "выполнений"]);
  assert.equal(durationText(65 * 60), "1 ч 05 мин");
  assert.equal(durationText(45 * 60), "45 мин");
  assert.equal(durationText(2 * 3600), "2 ч");
  assert.equal(durationText(20), "меньше минуты");
  assert.equal(timeText(new Date(2026, 9, 20, 9, 5).toISOString()), "09:05", "местное время устройства");
});
