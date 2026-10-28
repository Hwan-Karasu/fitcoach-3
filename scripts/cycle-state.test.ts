import assert from "node:assert/strict";
import test from "node:test";
import { cycleStateFrom } from "../apps/mobile/src/features/training/plans/domain/CycleState.ts";
import type { Mesocycle } from "../apps/mobile/src/features/training/plans/domain/PeriodizedModel.ts";
import type { PlannedWorkout } from "../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";

// CYCLE-STRIP-3: переключение циклов на месте — состояние цикла строится из уже прочитанного плана, без чтения базы.
const workout = (id: string): PlannedWorkout => ({ id, title: `Т ${id}`, exercises: [] });
const cycle = (id: string, title: string, weeks: number, extra: Partial<Mesocycle> = {}): Mesocycle => ({ id, lineageId: `l-${id}`, title,
  weeks: Array.from({ length: weeks }, (_, at) => ({ id: `${id}-w${at}`, index: at + 1, type: at === 0 ? "heavy" as const : "base" as const, workouts: [workout(`${id}-t${at}`)] })), ...extra });
const plan = { mesocycles: [
  cycle("a", "Волна 1", 3, { cycleType: "strength", repRange: { min: 3, max: 5 }, startDate: "2026-09-01" }),
  cycle("b", "Волна 2", 2)] };

test("существующий цикл: название, настройки, недели и точки отсчёта берутся из плана", () => {
  const state = cycleStateFrom(plan, "a", "2026-10-28");
  assert.equal(state.title, "Волна 1");
  assert.equal(state.cycleType, "strength");
  assert.equal(state.repsText, "3-5");
  assert.equal(state.startDate, "2026-09-01");
  assert.deepEqual(state.weeks.map((week) => [week.type, week.workouts[0]!.id]), [["heavy", "a-t0"], ["base", "a-t1"], ["base", "a-t2"]]);
  assert.deepEqual([...state.baselines.keys()], [0, 1, 2]);
  assert.equal(state.baselines.get(1), state.weeks[1]!.workouts, "точка отсчёта — те же тренировки недели");
  assert.deepEqual(state.baseWeeks?.map((week) => week.type), ["heavy", "base", "base"]);
});

test("цикл без настроек получает значения по умолчанию, а переключение туда и обратно не смешивает циклы", () => {
  const second = cycleStateFrom(plan, "b", "2026-10-28");
  assert.deepEqual([second.title, second.cycleType, second.repsText, second.startDate, second.weeks.length], ["Волна 2", "hypertrophy", "", "2026-10-28", 2]);
  const again = cycleStateFrom(plan, "a", "2026-10-28");
  assert.deepEqual(again.weeks.map((week) => week.workouts[0]!.id), ["a-t0", "a-t1", "a-t2"], "правки и недели цикла B не попали в цикл A");
});

test("новый цикл: следующий номер, четыре пустые недели, настройки по умолчанию, без точек отсчёта", () => {
  const fresh = cycleStateFrom(plan, undefined, "2026-10-28");
  assert.deepEqual([fresh.title, fresh.cycleType, fresh.repsText, fresh.startDate], ["Мезоцикл 3", "hypertrophy", "8-12", "2026-10-28"]);
  assert.deepEqual(fresh.weeks.map((week) => [week.type, week.workouts.length]), [["base", 0], ["base", 0], ["base", 0], ["base", 0]]);
  assert.equal(fresh.baseWeeks, null);
  assert.equal(fresh.baselines.size, 0);
});

test("неизвестный цикл — как новый", () => {
  assert.equal(cycleStateFrom(plan, "missing", "2026-10-28").title, "Мезоцикл 3");
});
