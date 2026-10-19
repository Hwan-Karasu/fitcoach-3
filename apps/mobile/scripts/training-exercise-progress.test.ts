import assert from "node:assert/strict";
import test from "node:test";
import { brzycki, exerciseSessions, progressMetrics, progressSeries, repRecords, sessionValue } from
  "../src/features/training/analytics/presentation/exerciseProgress.ts";
import type { SetFact, SetType, SetValues } from "../src/features/training/execution/domain/ExecutionModel.ts";
import type { TrainingHistoryEntry } from "../src/features/training/archive/presentation/trainingHistory.ts";

const BENCH = "sys:repdb:bench";
const SQUAT = "sys:repdb:squat";
let n = 0;

function values(kg: number | null, reps: number | null): SetValues {
  return { reps, loadGrams: kg === null ? null : kg * 1000, durationSec: null, distanceM: null };
}
function fact(exerciseId: string, value: SetValues, options: Partial<Readonly<{ setType: SetType; confirmed: boolean }>> = {}): SetFact {
  n += 1;
  return { id: `f${n}`, plannedSetId: `p${n}`, plannedExerciseId: `pe-${exerciseId}`, exerciseId, position: n,
    setType: options.setType ?? "NORMAL", values: value, drops: [], rpe: null, confirmed: options.confirmed ?? true,
    sides: null, extra: false, revision: 1 };
}
function entry(key: string, date: string, programId: string, facts: readonly SetFact[]): TrainingHistoryEntry {
  const groups = new Map<string, SetFact[]>();
  for (const item of facts) groups.set(item.exerciseId, [...(groups.get(item.exerciseId) ?? []), item]);
  return { key, programId, programTitle: programId, programKind: "SIMPLE", archived: false, planDeleted: false, mesocycleId: null,
    mesocycleTitle: null, workoutTitle: "Тренировка 1", plannedWorkoutId: "w1", weekIndex: 1, actualDate: date, status: "COMPLETED",
    confirmedSets: facts.length, volumeKg: 0, exercises: [...groups].map(([exerciseId, list]) => ({ exerciseId, facts: list })) };
}

test("e1RM по Бжицки: 1–12 повторений, выше — не считается (§48.86.8)", () => {
  assert.equal(brzycki(100, 1), 100);
  assert.equal(Math.round(brzycki(100, 8)! * 100) / 100, 124.14);
  assert.equal(brzycki(100, 12), 144);
  assert.equal(brzycki(100, 13), null);
  assert.equal(brzycki(100, 0), null);
});

test("история упражнения собирает занятия из всех программ, новые сверху (§37.3, §48.8)", () => {
  const history = [
    entry("e2", "2026-10-10", "B", [fact(BENCH, values(80, 5))]),
    entry("e1", "2026-10-01", "A", [fact(BENCH, values(70, 5)), fact(SQUAT, values(100, 5))]),
    entry("e0", "2026-09-20", "A", [fact(SQUAT, values(90, 5))]),
  ];
  const sessions = exerciseSessions(history, BENCH);
  assert.deepEqual(sessions.map((session) => [session.entry.key, session.facts.length]), [["e2", 1], ["e1", 1]]);
});

test("разминка и незасчитанные подходы не дают рекордов и точек графика (§35.13, §48.86.8 п. 4)", () => {
  const sessions = exerciseSessions([entry("e1", "2026-10-01", "A", [
    fact(BENCH, values(120, 1), { setType: "WARMUP" }),
    fact(BENCH, values(110, 1), { confirmed: false }),
    fact(BENCH, values(100, 1)),
  ])], BENCH);
  assert.equal(sessionValue(sessions[0]!, "maxLoad"), 100);
  assert.deepEqual(repRecords(sessions).map((record) => [record.reps, record.loadKg]), [[1, 100]]);
});

test("таблица рекордов — лучший вес на точное число повторений, с датой первого достижения (§37.7)", () => {
  const sessions = exerciseSessions([
    entry("e3", "2026-10-15", "A", [fact(BENCH, values(100, 5)), fact(BENCH, values(90, 8))]),
    entry("e2", "2026-10-08", "A", [fact(BENCH, values(100, 5))]),
    entry("e1", "2026-10-01", "A", [fact(BENCH, values(95, 5)), fact(BENCH, values(110, 1))]),
  ], BENCH);
  assert.deepEqual(repRecords(sessions).map((record) => [record.reps, record.loadKg, record.date]),
    [[1, 110, "2026-10-01"], [5, 100, "2026-10-08"], [8, 90, "2026-10-15"]]);
});

test("нет веса — нет точки, а не ноль (§48.86.32)", () => {
  const sessions = exerciseSessions([
    entry("e2", "2026-10-08", "A", [fact(BENCH, values(null, 10))]),
    entry("e1", "2026-10-01", "A", [fact(BENCH, values(100, 8))]),
  ], BENCH);
  assert.equal(sessionValue(sessions[0]!, "e1rm"), null);
  assert.deepEqual(progressSeries(sessions, "e1rm").map((point) => point.date), ["2026-10-01"]);
  assert.equal(sessionValue(sessions[0]!, "maxReps"), 10);
});

test("графики зависят от профиля учёта (§37.6)", () => {
  assert.deepEqual(progressMetrics(["load", "reps"]), ["e1rm", "maxLoad", "volume", "maxReps"]);
  assert.deepEqual(progressMetrics(["reps"]), ["maxReps", "totalReps"]);
  assert.deepEqual(progressMetrics(["duration"]), ["maxDuration"]);
  assert.deepEqual(progressMetrics(["distance", "duration"]), ["maxDistance", "maxDuration"]);
});
