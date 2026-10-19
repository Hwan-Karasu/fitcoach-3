import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { applyBuilderScope, copyWeekPlan, fillEmptyWeeks, resizeBuilderWeeks, weekRangeLabel, weeksWord, type BuilderWeek } from
  "../apps/mobile/src/features/training/plans/domain/MesocycleBuilder.ts";
import { addExercise, fillSets, newDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import type { PlannedWorkout } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const BENCH = "sys:repdb:bench";
let n = 0;
const newId = () => `id${n++}`;

function plan(prefix: string): readonly PlannedWorkout[] {
  return fillSets(addExercise(newDraft(`${prefix}w`), `${prefix}w`, `${prefix}e`, BENCH, () => `${prefix}s${n++}`), `${prefix}e`, "reps", 10)
    .plan.workouts;
}
const empty = (type: BuilderWeek["type"] = "base"): BuilderWeek => ({ type, workouts: [] });

test("UI-OWN-038 конструктор мезоцикла: копия недели — план и тип, новые ID, то же родство", () => {
  const source: BuilderWeek = { type: "heavy", workouts: plan("a") };
  const copy = copyWeekPlan(source, newId);
  assert.equal(copy.type, "heavy");
  assert.notEqual(copy.workouts[0]!.id, source.workouts[0]!.id);
  assert.equal(copy.workouts[0]!.lineageId, source.workouts[0]!.id, "родство с исходной тренировкой");
  assert.equal(copy.workouts[0]!.exercises[0]!.lineageId, source.workouts[0]!.exercises[0]!.id);
});

test("UI-OWN-038 при сохранении пустые недели берут план ближайшей заполненной раньше (иначе — первой заполненной), тип свой", () => {
  const a = plan("a"); const b = plan("b");
  const filled = fillEmptyWeeks([empty("light"), { type: "base", workouts: a }, empty("deload"), { type: "heavy", workouts: b }, empty()], newId);
  const sources = filled.map((week) => week.workouts[0]!.lineageId ?? week.workouts[0]!.id);
  assert.deepEqual(sources, [a[0]!.id, a[0]!.id, a[0]!.id, b[0]!.id, b[0]!.id], "мисклик во 2-й неделе — план не теряется");
  assert.deepEqual(filled.map((week) => week.type), ["light", "base", "deload", "heavy", "base"]);
  assert.deepEqual(fillEmptyWeeks([empty(), empty()], newId).map((week) => week.workouts.length), [0, 0], "всё пусто — без изменений");
  assert.deepEqual(resizeBuilderWeeks([{ type: "heavy", workouts: a }], 3).map((week) => [week.type, week.workouts.length]),
    [["heavy", a.length], ["base", 0], ["base", 0]]);
  assert.equal(resizeBuilderWeeks([{ type: "heavy", workouts: a }, empty()], 1).length, 1);
});

test("UI-OWN-038 программа с первым мезоциклом одной записью: настройки мезоцикла, недели по типам, участники", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, "synthetic-workspace-a", [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, "synthetic-workspace-a");
  await plans.initialize();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const program = await plans.createPeriodizedProgram({ title: "Подготовка", clientIds: [a.id, b.id], mesocycle: {
      title: "Блок 1", cycleType: "strength", repRange: { min: 3, max: 6 }, startDate: "2026-10-26",
      weeks: [{ type: "light", workouts: plan("x") }, empty("heavy"), empty("deload")] } });
    for (const clientId of [a.id, b.id]) {
      const cycle = (await plans.getPeriodizedPlan(clientId, program.id))!.mesocycles[0]!;
      assert.deepEqual([cycle.title, cycle.cycleType, cycle.repRange, cycle.startDate], ["Блок 1", "strength", { min: 3, max: 6 }, "2026-10-26"]);
      assert.deepEqual(cycle.weeks.map((week) => [week.type, week.workouts.length]), [["light", 1], ["heavy", 1], ["deload", 1]],
        "пустые недели заполнены при сохранении");
    }
    await assert.rejects(plans.createPeriodizedProgram({ title: "Пусто", clientIds: [a.id], mesocycle: { title: "Б", cycleType: null,
      repRange: null, startDate: null, weeks: [empty()] } }), (error: unknown) => error instanceof Error && error.message === "DRAFT_INVALID");
    assert.equal((await plans.getLibrary(a.id)).active.length, 1, "отказ ничего не записал");
    const template = await plans.saveBuilderAsTemplate({ title: "Шаблон силы", mesocycle: { title: "Блок 1", cycleType: "strength",
      repRange: { min: 3, max: 6 }, startDate: null, weeks: [{ type: "light", workouts: plan("t") }, empty("heavy")] } });
    assert.equal(template.payload.kind, "PERIODIZED");
    if (template.payload.kind === "PERIODIZED") {
      assert.deepEqual(template.payload.mesocycles[0]!.weeks.map((week) => [week.type, week.workouts.length]), [["light", 1], ["heavy", 1]],
        "«В шаблон» из конструктора: недели по типам, пустые заполнены");
    }
  } finally {
    await plans.close(); await clients.close();
  }
});

test("UI-OWN-040 карточка Расширенной программы: даты недели от старта мезоцикла и число недель словом", () => {
  assert.equal(weekRangeLabel("2026-10-12", 3), "26 окт — 1 ноя");
  assert.equal(weekRangeLabel("2026-12-28", 1), "28 дек — 3 янв");
  assert.deepEqual([1, 3, 5, 11, 21, 22].map(weeksWord), ["1 неделя", "3 недели", "5 недель", "11 недель", "21 неделя", "22 недели"]);
});

test("UI-OWN-041 меню области в конструкторе: правка недели переносится на недели области по родству", () => {
  const first: BuilderWeek = { type: "heavy", workouts: plan("q") };
  const weeks: readonly BuilderWeek[] = [first, { ...copyWeekPlan(first, newId), type: "base" },
    { ...copyWeekPlan(first, newId), type: "heavy" }, { ...copyWeekPlan(first, newId), type: "base" }];
  const exerciseId = first.workouts[0]!.exercises[0]!.id;
  const edited = fillSets({ title: "м", plan: { weeks: 1, workouts: first.workouts } }, exerciseId, "reps", 5).plan.workouts;
  const draft = [{ type: "heavy" as const, workouts: edited }, ...weeks.slice(1)];
  const reps = (list: readonly BuilderWeek[]) => list.map((week) => week.workouts[0]!.exercises[0]!.sets[0]!.reps);
  assert.deepEqual(reps(applyBuilderScope(draft, 0, first.workouts, "SAME_TYPE", newId)), [5, 10, 5, 10], "только тяжёлые недели");
  assert.deepEqual(reps(applyBuilderScope(draft, 0, first.workouts, "ALL", newId)), [5, 5, 5, 5]);
  assert.deepEqual(reps(applyBuilderScope(draft, 0, first.workouts, "CURRENT", newId)), [5, 10, 10, 10], "закрыть меню — только эта неделя");
  assert.equal(applyBuilderScope(weeks, 0, first.workouts, "ALL", newId), weeks, "нет правок — недели те же");
});
