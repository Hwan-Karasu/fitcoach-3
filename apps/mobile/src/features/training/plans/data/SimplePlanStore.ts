import type { SqlValue, SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import { assertIdsFree, deleteRows, insertRows, upsertRows } from "../../../../shared/db/BatchInsert.ts";
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
      lineage_id AS lineageId FROM training_workouts
    WHERE workspace_id = ? AND program_id = ? AND week_id IS ? ORDER BY position`, [workspaceId, programId, weekId]);
  const exercises = await tx.all<{ id: string; workoutId: string; exerciseId: string; restSec: number | null;
    instruction: string | null; rirMin: number | null; rirMax: number | null; lineageId: string | null; supersetId: string | null }>(`SELECT e.id,
      e.workout_id AS workoutId, e.exercise_id AS exerciseId, e.rest_sec AS restSec, e.instruction, e.rir_min AS rirMin,
      e.rir_max AS rirMax, e.lineage_id AS lineageId, e.superset_id AS supersetId
      FROM training_planned_exercises e
    JOIN training_workouts w ON w.id = e.workout_id AND w.workspace_id = e.workspace_id
    WHERE e.workspace_id = ? AND w.program_id = ? AND w.week_id IS ? ORDER BY e.position`, [workspaceId, programId, weekId]);
  const sets = await tx.all<SetRow>(`SELECT s.id, s.planned_exercise_id AS exerciseRowId, s.reps, s.reps_max AS repsMax,
      s.load_grams AS loadGrams,
      s.duration_sec AS durationSec, s.distance_m AS distanceM FROM training_planned_sets s
    JOIN training_planned_exercises e ON e.id = s.planned_exercise_id AND e.workspace_id = s.workspace_id
    JOIN training_workouts w ON w.id = e.workout_id AND w.workspace_id = e.workspace_id
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

const TABLES = {
  workouts: { name: "training_workouts", columns: ["id", "workspace_id", "program_id", "position", "title", "week_id", "lineage_id"],
    update: ["position", "title", "lineage_id"] },
  exercises: { name: "training_planned_exercises", columns: ["id", "workspace_id", "workout_id", "position", "exercise_id", "rest_sec",
    "instruction", "rir_min", "rir_max", "lineage_id", "superset_id"],
  update: ["workout_id", "position", "exercise_id", "rest_sec", "instruction", "rir_min", "rir_max", "lineage_id", "superset_id"] },
  sets: { name: "training_planned_sets", columns: ["id", "workspace_id", "planned_exercise_id", "position", "reps", "reps_max",
    "load_grams", "duration_sec", "distance_m"],
  update: ["planned_exercise_id", "position", "reps", "reps_max", "load_grams", "duration_sec", "distance_m"] },
} as const;
type Table = keyof typeof TABLES;

/** Строки таблиц ровно в том виде, в каком их пишет `writeWorkouts`: по ним же сравниваются сохранённая и новая неделя. */
function rowsOf(workspaceId: string, programId: string, weekId: string | null,
  workouts: readonly PlannedWorkout[]): Record<Table, Map<string, readonly SqlValue[]>> {
  const rows = { workouts: new Map<string, readonly SqlValue[]>(), exercises: new Map<string, readonly SqlValue[]>(),
    sets: new Map<string, readonly SqlValue[]>() };
  for (const [workoutIndex, workout] of workouts.entries()) {
    rows.workouts.set(workout.id, [workout.id, workspaceId, programId, workoutIndex, workout.title.trim(), weekId, workout.lineageId ?? null]);
    for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
      rows.exercises.set(exercise.id, [exercise.id, workspaceId, workout.id, exerciseIndex, exercise.exerciseId, exercise.restSec,
        exercise.instruction, exercise.rir?.min ?? null, exercise.rir?.max ?? null, exercise.lineageId ?? null, exercise.supersetId ?? null]);
      for (const [setIndex, set] of exercise.sets.entries()) {
        rows.sets.set(set.id, [set.id, workspaceId, exercise.id, setIndex, set.reps, set.repsMax, set.loadGrams, set.durationSec, set.distanceM]);
      }
    }
  }
  return rows;
}

const sameRow = (a: readonly SqlValue[], b: readonly SqlValue[]) => a.length === b.length && a.every((value, at) => value === b[at]);

/**
 * Запись тренировок программы (`weekId = null`) или одной недели. Пишутся только новые и изменённые строки и пачками:
 * на телефоне каждый запрос — обмен по мосту Expo, а правка «все недели» иначе стоит тысяч запросов (PERF-PLAN-BATCH).
 */
export async function writeWorkouts(tx: SqliteStatementPort, workspaceId: string, programId: string, weekId: string | null,
  workouts: readonly PlannedWorkout[]): Promise<void> {
  const stored = rowsOf(workspaceId, programId, weekId, await readWorkouts(tx, workspaceId, programId, weekId));
  const next = rowsOf(workspaceId, programId, weekId, workouts);
  const order: readonly Table[] = ["workouts", "exercises", "sets"];
  for (const table of order) {
    // Чужие ID отклоняются; повтор нового ID внутри правки — тоже (assertIdsFree).
    const fresh = workouts.flatMap((workout) => table === "workouts" ? [workout.id]
      : workout.exercises.flatMap((exercise) => table === "exercises" ? [exercise.id] : exercise.sets.map((set) => set.id)))
      .filter((id) => !stored[table].has(id));
    await assertIdsFree(tx, TABLES[table].name, fresh, "DRAFT_INVALID");
  }
  for (const table of order) {
    const changed = [...next[table]].filter(([id, row]) => { const old = stored[table].get(id); return old === undefined || !sameRow(old, row); });    await upsertRows(tx, TABLES[table].name, TABLES[table].columns, TABLES[table].update, changed.map(([, row]) => row));
  }
  // Убранное удаляется снизу вверх: подходы → упражнения → тренировки (FK RESTRICT).
  for (const table of [...order].reverse()) {
    await deleteRows(tx, TABLES[table].name, [...stored[table].keys()].filter((id) => !next[table].has(id)));
  }
}

/**
 * Тренировки только что созданных недель (в них ничего ещё нет, поэтому нечего обновлять и удалять). То же, что
 * `writeWorkouts` для пустой недели, но пачками: на телефоне построчная запись книги из тысяч подходов занимала десятки секунд.
 * Занятые или повторяющиеся ID отклоняются так же, как там (`DRAFT_INVALID`).
 */
export async function insertWorkoutsOfNewWeeks(tx: SqliteStatementPort, workspaceId: string, programId: string,
  weeks: readonly Readonly<{ id: string; workouts: readonly PlannedWorkout[] }>[]): Promise<void> {
  const workouts: SqlValue[][] = []; const exercises: SqlValue[][] = []; const sets: SqlValue[][] = [];
  for (const week of weeks) {
    for (const [workoutIndex, workout] of week.workouts.entries()) {
      workouts.push([workout.id, workspaceId, programId, workoutIndex, workout.title.trim(), week.id, workout.lineageId ?? null]);
      for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
        exercises.push([exercise.id, workspaceId, workout.id, exerciseIndex, exercise.exerciseId, exercise.restSec, exercise.instruction,
          exercise.rir?.min ?? null, exercise.rir?.max ?? null, exercise.lineageId ?? null, exercise.supersetId ?? null]);
        for (const [setIndex, set] of exercise.sets.entries()) {
          sets.push([set.id, workspaceId, exercise.id, setIndex, set.reps, set.repsMax, set.loadGrams, set.durationSec, set.distanceM]);
        }
      }
    }
  }
  await assertIdsFree(tx, "training_workouts", workouts.map((row) => row[0] as string), "DRAFT_INVALID");
  await assertIdsFree(tx, "training_planned_exercises", exercises.map((row) => row[0] as string), "DRAFT_INVALID");
  await assertIdsFree(tx, "training_planned_sets", sets.map((row) => row[0] as string), "DRAFT_INVALID");
  await insertRows(tx, "training_workouts", ["id", "workspace_id", "program_id", "position", "title", "week_id", "lineage_id"], workouts);
  await insertRows(tx, "training_planned_exercises", ["id", "workspace_id", "workout_id", "position", "exercise_id", "rest_sec",
    "instruction", "rir_min", "rir_max", "lineage_id", "superset_id"], exercises);
  await insertRows(tx, "training_planned_sets", ["id", "workspace_id", "planned_exercise_id", "position", "reps", "reps_max",
    "load_grams", "duration_sec", "distance_m"], sets);
}

export async function writeStructure(tx: SqliteStatementPort, workspaceId: string, programId: string, plan: SimplePlan): Promise<void> {
  await writeWorkouts(tx, workspaceId, programId, null, plan.workouts);
}

/** Удаление всей структуры Простой программы (окончательное удаление её единственного клиента). */
export async function deleteStructure(tx: SqliteStatementPort, workspaceId: string, programId: string): Promise<void> {
  await writeWorkouts(tx, workspaceId, programId, null, []);
}
