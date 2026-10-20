import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { PlannedExercise, PlannedSet, PlannedWorkout, SimplePlan } from "../domain/SimplePlanModel.ts";

/**
 * Чтение и запись тренировок программы. У Простой программы тренировки без недели (`week_id IS NULL`), у
 * Расширенной — у каждой недели свои (T04). Запись — по стабильным ID: существующие строки обновляются (порядок,
 * название, значения), убранные удаляются, новые добавляются (§48.5.7 п. 5). Чужие ID отклоняются — иначе правка
 * задела бы чужую структуру.
 */

export type SetRow = Readonly<{ id: string; exerciseRowId: string; reps: number | null; repsMax: number | null; loadGrams: number | null;
  durationSec: number | null; distanceM: number | null }>;

/** Тренировки программы (`weekId = null`) или одной недели Расширенной программы. */
export async function readWorkouts(tx: SqliteStatementPort, workspaceId: string, programId: string,
  weekId: string | null): Promise<readonly PlannedWorkout[]> {
  const workouts = await tx.all<{ id: string; title: string; lineageId: string | null }>(`SELECT id, title,
      lineage_id AS lineageId FROM dev_training_workouts
    WHERE workspace_id = ? AND program_id = ? AND week_id IS ? ORDER BY position`, [workspaceId, programId, weekId]);
  const exercises = await tx.all<{ id: string; workoutId: string; exerciseId: string; restSec: number | null;
    instruction: string | null; rirMin: number | null; rirMax: number | null; lineageId: string | null; supersetId: string | null }>(`SELECT e.id,
      e.workout_id AS workoutId, e.exercise_id AS exerciseId, e.rest_sec AS restSec, e.instruction, e.rir_min AS rirMin,
      e.rir_max AS rirMax, e.lineage_id AS lineageId, e.superset_id AS supersetId
      FROM dev_training_planned_exercises e
    JOIN dev_training_workouts w ON w.id = e.workout_id AND w.workspace_id = e.workspace_id
    WHERE e.workspace_id = ? AND w.program_id = ? AND w.week_id IS ? ORDER BY e.position`, [workspaceId, programId, weekId]);
  const sets = await tx.all<SetRow>(`SELECT s.id, s.planned_exercise_id AS exerciseRowId, s.reps, s.reps_max AS repsMax,
      s.load_grams AS loadGrams,
      s.duration_sec AS durationSec, s.distance_m AS distanceM FROM dev_training_planned_sets s
    JOIN dev_training_planned_exercises e ON e.id = s.planned_exercise_id AND e.workspace_id = s.workspace_id
    JOIN dev_training_workouts w ON w.id = e.workout_id AND w.workspace_id = e.workspace_id
    WHERE s.workspace_id = ? AND w.program_id = ? AND w.week_id IS ? ORDER BY s.position`, [workspaceId, programId, weekId]);
  return workouts.map(plannedWorkoutOf(exercises, sets));
}

export type WorkoutRow = Readonly<{ id: string; title: string; lineageId: string | null }>;
export type ExerciseRow = Readonly<{ id: string; workoutId: string; exerciseId: string; restSec: number | null;
  instruction: string | null; rirMin: number | null; rirMax: number | null; lineageId: string | null; supersetId: string | null }>;

/**
 * Сборка тренировки из плоских строк запросов: упражнения и подходы группируются Map-ами за один проход, порядок — как в
 * запросах (`ORDER BY position`). Одна функция для чтения недели и всей программы пакетом.
 */
export function plannedWorkoutOf(exercises: readonly ExerciseRow[], sets: readonly SetRow[]): (workout: WorkoutRow) => PlannedWorkout {
  const setsByExercise = new Map<string, PlannedSet[]>();
  for (const { id, exerciseRowId, reps, repsMax, loadGrams, durationSec, distanceM } of sets) {
    const list = setsByExercise.get(exerciseRowId) ?? [];
    list.push({ id, reps, repsMax, loadGrams, durationSec, distanceM });
    setsByExercise.set(exerciseRowId, list);
  }
  const exercisesByWorkout = new Map<string, PlannedExercise[]>();
  for (const exercise of exercises) {
    const list = exercisesByWorkout.get(exercise.workoutId) ?? [];
    list.push({ id: exercise.id,
      ...(exercise.supersetId === null ? {} : { supersetId: exercise.supersetId }),
      ...(exercise.lineageId === null ? {} : { lineageId: exercise.lineageId }),
      exerciseId: exercise.exerciseId, restSec: exercise.restSec,
      instruction: exercise.instruction, rir: exercise.rirMin === null ? null : { min: exercise.rirMin, max: exercise.rirMax },
      sets: setsByExercise.get(exercise.id) ?? [] });
    exercisesByWorkout.set(exercise.workoutId, list);
  }
  return (workout) => ({ id: workout.id, title: workout.title, ...(workout.lineageId === null ? {} : { lineageId: workout.lineageId }),
    exercises: exercisesByWorkout.get(workout.id) ?? [] });
}

export async function readStructure(tx: SqliteStatementPort, workspaceId: string, programId: string,
  weeks: number): Promise<SimplePlan> {
  return { weeks, workouts: await readWorkouts(tx, workspaceId, programId, null) };
}

async function ownedIds(tx: SqliteStatementPort, workspaceId: string, programId: string, weekId: string | null) {
  const workouts = await readWorkouts(tx, workspaceId, programId, weekId);
  return {
    workouts: new Set(workouts.map((workout) => workout.id)),
    exercises: new Set(workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.id))),
    sets: new Set(workouts.flatMap((workout) => workout.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)))),
  };
}

async function assertFree(tx: SqliteStatementPort, table: string, id: string, owned: ReadonlySet<string>) {
  if (owned.has(id)) return;
  const taken = await tx.first<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (taken !== null) throw new Error("DRAFT_INVALID");
}

/** Запись тренировок программы (`weekId = null`) или одной недели. */
export async function writeWorkouts(tx: SqliteStatementPort, workspaceId: string, programId: string, weekId: string | null,
  workouts: readonly PlannedWorkout[]): Promise<void> {
  const owned = await ownedIds(tx, workspaceId, programId, weekId);
  const keep = { workouts: new Set<string>(), exercises: new Set<string>(), sets: new Set<string>() };
  for (const [workoutIndex, workout] of workouts.entries()) {
    await assertFree(tx, "dev_training_workouts", workout.id, owned.workouts);
    keep.workouts.add(workout.id);
    await tx.run(`INSERT INTO dev_training_workouts (id, workspace_id, program_id, position, title, week_id, lineage_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET position = excluded.position, title = excluded.title, lineage_id = excluded.lineage_id`,
    [workout.id, workspaceId, programId, workoutIndex, workout.title.trim(), weekId, workout.lineageId ?? null]);
    for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
      await assertFree(tx, "dev_training_planned_exercises", exercise.id, owned.exercises);
      keep.exercises.add(exercise.id);
      await tx.run(`INSERT INTO dev_training_planned_exercises (id, workspace_id, workout_id, position, exercise_id, rest_sec,
        instruction, rir_min, rir_max, lineage_id, superset_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        workout_id = excluded.workout_id, position = excluded.position, exercise_id = excluded.exercise_id,
        rest_sec = excluded.rest_sec, instruction = excluded.instruction, rir_min = excluded.rir_min, rir_max = excluded.rir_max,
        lineage_id = excluded.lineage_id, superset_id = excluded.superset_id`,
      [exercise.id, workspaceId, workout.id, exerciseIndex, exercise.exerciseId, exercise.restSec, exercise.instruction,
        exercise.rir?.min ?? null, exercise.rir?.max ?? null, exercise.lineageId ?? null, exercise.supersetId ?? null]);
      for (const [setIndex, set] of exercise.sets.entries()) {
        await assertFree(tx, "dev_training_planned_sets", set.id, owned.sets);
        keep.sets.add(set.id);
        await tx.run(`INSERT INTO dev_training_planned_sets (id, workspace_id, planned_exercise_id, position, reps, reps_max,
            load_grams, duration_sec, distance_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET planned_exercise_id = excluded.planned_exercise_id, position = excluded.position,
            reps = excluded.reps, reps_max = excluded.reps_max, load_grams = excluded.load_grams,
            duration_sec = excluded.duration_sec, distance_m = excluded.distance_m`,
        [set.id, workspaceId, exercise.id, setIndex, set.reps, set.repsMax, set.loadGrams, set.durationSec, set.distanceM]);
      }
    }
  }
  // Убранное удаляется снизу вверх: подходы → упражнения → тренировки (FK RESTRICT).
  for (const id of owned.sets) if (!keep.sets.has(id)) await tx.run("DELETE FROM dev_training_planned_sets WHERE id = ?", [id]);
  for (const id of owned.exercises) if (!keep.exercises.has(id)) await tx.run("DELETE FROM dev_training_planned_exercises WHERE id = ?", [id]);
  for (const id of owned.workouts) if (!keep.workouts.has(id)) await tx.run("DELETE FROM dev_training_workouts WHERE id = ?", [id]);
}

export async function writeStructure(tx: SqliteStatementPort, workspaceId: string, programId: string, plan: SimplePlan): Promise<void> {
  await writeWorkouts(tx, workspaceId, programId, null, plan.workouts);
}

/** Удаление всей структуры Простой программы (окончательное удаление её единственного клиента). */
export async function deleteStructure(tx: SqliteStatementPort, workspaceId: string, programId: string): Promise<void> {
  await writeWorkouts(tx, workspaceId, programId, null, []);
}
