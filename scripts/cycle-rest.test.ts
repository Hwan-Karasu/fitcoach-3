import assert from "node:assert/strict";
import test from "node:test";
import { CYCLE_TYPES, restForNewExercises, retuneBuilderRest, type BuilderWeek } from "../apps/mobile/src/features/training/plans/domain/MesocycleBuilder.ts";
import { REST_DEFAULT_SEC, type PlannedExercise, type SimpleProgramDraft } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { fillRestWhenAbsent } from "../apps/mobile/src/features/import/domain/TransferRest.ts";
import { DEFAULT_REST_SEC } from "../apps/mobile/src/shared/training-transfer/CycleRest.ts";
import type { TransferCycle } from "../apps/mobile/src/shared/training-transfer/TrainingTransfer.ts";

const exercise = (id: string, restSec: number | null): PlannedExercise => ({ id, exerciseId: `sys:${id}`, restSec, instruction: null, rir: null, sets: [] });
const draft = (...exercises: PlannedExercise[]): SimpleProgramDraft => ({ title: "Цикл", plan: { weeks: 1, workouts: [{ id: "w", title: "Т", exercises }] } });
const rests = (value: SimpleProgramDraft) => value.plan.workouts[0]!.exercises.map((item) => item.restSec);

test("отдых по типу цикла: гипертрофия 2:00, сила 3:00, мощность 4:00, выносливость 1:00, рекомпозиция и свой 1:30", () => {
  assert.deepEqual(Object.fromEntries(CYCLE_TYPES.map((item) => [item.id, item.restSec])),
    { hypertrophy: 120, strength: 180, power: 240, endurance: 60, recomp: 90, custom: 90 });
});

test("CYCLE-PRESETS: повторения по типу цикла — гипертрофия 8–12, сила 6–8, мощность 3–5, выносливость 12–15, рекомпозиция 9–12, свой пусто", () => {
  assert.deepEqual(Object.fromEntries(CYCLE_TYPES.map((item) => [item.id, item.reps])), {
    hypertrophy: { min: 8, max: 12 }, strength: { min: 6, max: 8 }, power: { min: 3, max: 5 },
    endurance: { min: 12, max: 15 }, recomp: { min: 9, max: 12 }, custom: null });
});

test("новые упражнения с отдыхом по умолчанию получают отдых типа цикла, остальные не меняются", () => {
  const before = draft(exercise("old", REST_DEFAULT_SEC), exercise("fresh", REST_DEFAULT_SEC), exercise("custom", 45), exercise("off", null));
  const next = restForNewExercises(before, (id) => id !== "old", 180);
  assert.deepEqual(rests(next), [REST_DEFAULT_SEC, 180, 45, null], "старое, заданное вручную и выключенное таймером не тронуты");
});

test("отдых типа цикла равен умолчанию — ничего не меняется, тот же объект", () => {
  const before = draft(exercise("fresh", REST_DEFAULT_SEC));
  assert.equal(restForNewExercises(before, () => true, REST_DEFAULT_SEC), before);
});

test("отдых по умолчанию в общей таблице совпадает с отдыхом по умолчанию плана", () => {
  assert.equal(DEFAULT_REST_SEC, REST_DEFAULT_SEC);
});

const cycle = (type: TransferCycle["cycleType"], ...rest: readonly (number | null)[]): TransferCycle => ({ id: "c", lineageId: "c", title: "Ц", cycleType: type,
  weeks: [{ id: "w", index: 1, type: "base", workouts: [{ id: "t", title: "Т", exercises: rest.map((restSec, at) => ({ id: `e${at}`, exerciseId: "x", restSec,
    instruction: null, rir: null, sets: [] })) }] }] });
const restsOf = (value: TransferCycle) => value.weeks.flatMap((week) => week.workouts.flatMap((workout) => workout.exercises.map((item) => item.restSec)));

test("импорт: источник без отдыха получает отдых по типу цикла, без типа — по умолчанию", () => {
  const [strength, untyped] = fillRestWhenAbsent([cycle("strength", null, null), cycle(null, null)]);
  assert.deepEqual(restsOf(strength!), [180, 180]);
  assert.deepEqual(restsOf(untyped!), [90]);
});

test("импорт: если отдых задан хотя бы у одного упражнения, пустые — сознательно выключенный таймер", () => {
  const source = cycle("hypertrophy", 60, null);
  assert.equal(fillRestWhenAbsent([source])[0], source);
});

test("импорт: пустой цикл не меняется", () => {
  const source = cycle("power");
  assert.equal(fillRestWhenAbsent([source])[0], source);
});

const week = (...rest: readonly (number | null)[]): BuilderWeek => ({ type: "base", workouts: [{ id: "t", title: "Т", exercises: rest.map((restSec, at) => exercise(`e${at}`, restSec)) }] });
const weekRests = (value: BuilderWeek) => value.workouts[0]!.exercises.map((item) => item.restSec);

test("смена типа цикла: упражнения с отдыхом прежнего типа переходят на отдых нового, заданное вручную и выключенное — нет", () => {
  const weeks = [week(90, 45, null, 90), week(90)];
  const next = retuneBuilderRest(weeks, 90, 120);
  assert.deepEqual(next.map(weekRests), [[120, 45, null, 120], [120]]);
  assert.deepEqual(weeks.map(weekRests), [[90, 45, null, 90], [90]], "исходные недели не изменены");
});

test("смена типа цикла: отдых прежнего и нового типа совпадает или менять нечего — те же недели", () => {
  const weeks = [week(45, null)];
  assert.equal(retuneBuilderRest(weeks, 90, 90), weeks);
  assert.equal(retuneBuilderRest(weeks, 90, 120), weeks, "нет упражнений с отдыхом 90");
});
