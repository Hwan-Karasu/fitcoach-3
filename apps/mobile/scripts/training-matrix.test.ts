import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { buildProgramMatrix } from "../src/features/training/execution/presentation/programMatrix.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { addExercise, fillSets, newDraft, replaceExercise } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Сборщик матрицы в presentation импортирует public.ts планов (там экраны .tsx), поэтому тест здесь.
const WS = "synthetic-workspace-a";
const BENCH = "sys:repdb:bench";
const ROW = "sys:repdb:row";

test("T05 матрица: замена — отдельная строка с прочерками, тоннаж только по засчитанным подходам (§48.5.3, §48.44)", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await execution.initialize();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const program = await plans.createProgram({ kind: "PERIODIZED", title: "Сила", clientIds: [a.id] });
    let n = 0;
    const firstWeek = fillSets(addExercise(newDraft("w1"), "w1", "e1", BENCH, () => `s${n++}`), "e1", "reps", 10).plan.workouts;
    const created = await plans.createMesocycle(a.id, program.id, program.revision, { title: "Блок", weeks: 3, firstWeek, clientIds: [a.id] });
    let cycle = (await plans.getPeriodizedPlan(a.id, program.id))!.mesocycles[0]!;
    const week2 = cycle.weeks[1]!;
    const replaced = replaceExercise({ title: "М", plan: { weeks: 1, workouts: week2.workouts } }, week2.workouts[0]!.exercises[0]!.id,
      "row2", ROW, ["reps", "loadGrams"], () => `r${n++}`).plan.workouts;
    await plans.saveWeek(a.id, program.id, created.program.revision, { mesocycleId: cycle.id, weekIndex: 2, workouts: replaced,
      type: "base", scope: "CURRENT", clientIds: [a.id] });
    cycle = (await plans.getPeriodizedPlan(a.id, program.id))!.mesocycles[0]!;

    const record = async (weekIndex: number, reps: number) => {
      const workout = cycle.weeks[weekIndex - 1]!.workouts[0]!;
      const exercise = workout.exercises[0]!;
      await execution.saveSet({ slot: { clientId: a.id, programId: program.id, weekIndex, plannedWorkoutId: workout.id },
        plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId, plannedSetId: exercise.sets[0]!.id, position: 0,
        metrics: ["load", "reps"], values: { loadGrams: 100_000, reps, durationSec: null, distanceM: null }, setType: "NORMAL",
        drops: [], rpe: null, expectedRevision: null });
    };
    await record(1, 8);
    await execution.setConfirmationMode("MANUAL");
    await record(3, 6);

    const matrix = buildProgramMatrix(cycle.weeks.map((week) => ({ index: week.index, caption: null, workouts: week.workouts })),
      await execution.listProgramExecutions(a.id, program.id), () => ["reps", "loadGrams"],
      { plan: (set) => String(set.reps ?? "—"), values: (values) => `${values.reps} × ${(values.loadGrams ?? 0) / 1000}` });
    assert.equal(matrix.sections.length, 1);
    const [bench, row] = matrix.sections[0]!.rows;
    assert.deepEqual([bench!.exerciseId, [...bench!.cells.keys()]], [BENCH, [1, 3]], "в неделе 2 жима нет — прочерк");
    assert.deepEqual([row!.exerciseId, [...row!.cells.keys()]], [ROW, [2]], "тяга — отдельная строка");
    assert.deepEqual(bench!.cells.get(1)!.sets[0], { label: "1", plan: "10", fact: "8 × 100", done: true });
    assert.equal(bench!.cells.get(3)!.sets[0]!.fact, "6 × 100", "предварительное значение видно");
    assert.equal(bench!.cells.get(3)!.sets[0]!.done, false);
    assert.deepEqual([...matrix.totals.entries()], [[1, 800], [2, 0], [3, 0]], "тоннаж — только засчитанные подходы");
  } finally {
    await execution.close(); await plans.close(); await clients.close();
  }
});
