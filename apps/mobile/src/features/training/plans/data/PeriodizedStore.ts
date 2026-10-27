import { registerNavigationCopy } from "./NavigationGroupStore.ts";
import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { CycleType, Mesocycle, PlanWeek, WeekType } from "../domain/PeriodizedModel.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";
import type { SqlValue } from "../../../../shared/db/SqlitePort.ts";
import { insertRows } from "../../../../shared/db/BatchInsert.ts";
import { insertWorkoutsOfNewWeeks, plannedWorkoutOf, writeWorkouts, type ExerciseRow, type SetRow, type WorkoutRow } from "./SimplePlanStore.ts";

/**
 * Мезоциклы Расширенной программы (T04): у каждого участника свои строки мезоциклов, недель и тренировок
 * (§48.28); общие у копий — только родство (`lineage_id`).
 */

type MesocycleRow = Readonly<{ id: string; lineageId: string; title: string; cycleType: CycleType | null; repMin: number | null;
  repMax: number | null; startDate: string | null }>;

export async function readMesocycles(tx: SqliteStatementPort, workspaceId: string, programId: string,
  clientId: string): Promise<readonly Mesocycle[]> {
  // Пять запросов на всю программу клиента, а не по запросу на мезоцикл, неделю и упражнение: на телефоне каждое обращение
  // идёт через мост Expo, и сотни последовательных чтений давали секунды при открытии и переключении участников.
  const rows = await tx.all<MesocycleRow>(`SELECT id, lineage_id AS lineageId, title, cycle_type AS cycleType, rep_min AS repMin, rep_max AS repMax,
    start_date AS startDate FROM training_mesocycles
    WHERE workspace_id = ? AND program_id = ? AND client_id = ? ORDER BY position`, [workspaceId, programId, clientId]);
  if (rows.length === 0) return [];
  const weeks = await tx.all<{ id: string; mesocycleId: string; position: number; type: WeekType }>(`SELECT k.id, k.mesocycle_id AS mesocycleId,
      k.position, k.week_type AS type FROM training_weeks k
    JOIN training_mesocycles m ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id
    WHERE k.workspace_id = ? AND m.program_id = ? AND m.client_id = ? ORDER BY k.position`, [workspaceId, programId, clientId]);
  const workouts = await tx.all<WorkoutRow & { weekId: string }>(`SELECT w.id, w.title, w.lineage_id AS lineageId, w.week_id AS weekId
      FROM training_workouts w ${OWNED_BY_CLIENT}
    WHERE w.workspace_id = ? AND w.program_id = ? AND m.program_id = ? AND m.client_id = ? ORDER BY w.position`,
  [workspaceId, programId, programId, clientId]);
  const exercises = await tx.all<ExerciseRow>(`SELECT e.id, e.workout_id AS workoutId, e.exercise_id AS exerciseId, e.rest_sec AS restSec,
      e.instruction, e.rir_min AS rirMin, e.rir_max AS rirMax, e.lineage_id AS lineageId, e.superset_id AS supersetId
      FROM training_planned_exercises e
    JOIN training_workouts w ON w.id = e.workout_id AND w.workspace_id = e.workspace_id ${OWNED_BY_CLIENT}
    WHERE e.workspace_id = ? AND w.program_id = ? AND m.program_id = ? AND m.client_id = ? ORDER BY e.position`,
  [workspaceId, programId, programId, clientId]);
  const sets = await tx.all<SetRow>(`SELECT s.id, s.planned_exercise_id AS exerciseRowId, s.reps, s.reps_max AS repsMax,
      s.load_grams AS loadGrams, s.duration_sec AS durationSec, s.distance_m AS distanceM FROM training_planned_sets s
    JOIN training_planned_exercises e ON e.id = s.planned_exercise_id AND e.workspace_id = s.workspace_id
    JOIN training_workouts w ON w.id = e.workout_id AND w.workspace_id = e.workspace_id ${OWNED_BY_CLIENT}
    WHERE s.workspace_id = ? AND w.program_id = ? AND m.program_id = ? AND m.client_id = ? ORDER BY s.position`,
  [workspaceId, programId, programId, clientId]);
  const toWorkout = plannedWorkoutOf(exercises, sets);
  const workoutsByWeek = new Map<string, PlannedWorkout[]>();
  for (const { weekId, ...workout } of workouts) workoutsByWeek.set(weekId, [...(workoutsByWeek.get(weekId) ?? []), toWorkout(workout)]);
  const weeksByMesocycle = new Map<string, PlanWeek[]>();
  for (const week of weeks) {
    weeksByMesocycle.set(week.mesocycleId, [...(weeksByMesocycle.get(week.mesocycleId) ?? []),
      { id: week.id, index: week.position + 1, type: week.type, workouts: workoutsByWeek.get(week.id) ?? [] }]);
  }
  return rows.map(({ repMin, repMax, ...rest }): Mesocycle => ({ ...rest, repRange: repMin === null ? null : { min: repMin, max: repMax },
    weeks: weeksByMesocycle.get(rest.id) ?? [] }));
}

/** Недели и мезоциклы, которыми владеет клиент выбранной программы: условие для запросов по тренировкам. */
const OWNED_BY_CLIENT = `JOIN training_weeks k ON k.id = w.week_id AND k.workspace_id = w.workspace_id
  JOIN training_mesocycles m ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id`;

/** Новый мезоцикл участника в конец его списка. */
export async function insertMesocycle(tx: SqliteStatementPort, workspaceId: string, programId: string, clientId: string,
  mesocycle: Mesocycle, now: Date): Promise<void> {
  const last = await tx.first<{ position: number | null }>(`SELECT max(position) AS position FROM training_mesocycles
    WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [workspaceId, programId, clientId]);
  await tx.run(`INSERT INTO training_mesocycles (id, workspace_id, program_id, client_id, lineage_id, position, title, created_at,
    cycle_type, rep_min, rep_max, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [mesocycle.id, workspaceId, programId, clientId,
    mesocycle.lineageId, (last?.position ?? -1) + 1, mesocycle.title.trim(), now.toISOString(), mesocycle.cycleType ?? null,
    mesocycle.repRange?.min ?? null, mesocycle.repRange?.max ?? null, mesocycle.startDate ?? null]);
  await registerNavigationCopy(tx, workspaceId, { clientId, programId, mesocycleId: mesocycle.id }, mesocycle.lineageId);
  // Недели новые, поэтому тренировки пишутся пачками, а не по строке (мост Expo: каждый запрос стоит времени).
  const weeks: SqlValue[][] = mesocycle.weeks.map((week) => [week.id, workspaceId, mesocycle.id, week.index - 1, week.type]);
  await insertRows(tx, "training_weeks", ["id", "workspace_id", "mesocycle_id", "position", "week_type"], weeks);
  await insertWorkoutsOfNewWeeks(tx, workspaceId, programId, mesocycle.weeks);
}

export async function writeWeek(tx: SqliteStatementPort, workspaceId: string, programId: string, week: PlanWeek): Promise<void> {
  await tx.run("UPDATE training_weeks SET week_type = ? WHERE workspace_id = ? AND id = ?", [week.type, workspaceId, week.id]);
  await writeWorkouts(tx, workspaceId, programId, week.id, week.workouts);
}

/** Удаление всех мезоциклов участника в программе (окончательное удаление клиента). */
export async function deleteMemberMesocycles(tx: SqliteStatementPort, workspaceId: string, programId: string,
  clientId: string): Promise<void> {
  await tx.run("DELETE FROM training_mesocycle_selection WHERE workspace_id = ? AND program_id = ? AND client_id = ?",
    [workspaceId, programId, clientId]);
  for (const mesocycle of await readMesocycles(tx, workspaceId, programId, clientId)) {
    for (const week of mesocycle.weeks) {
      await writeWorkouts(tx, workspaceId, programId, week.id, []);
      await tx.run("DELETE FROM training_weeks WHERE workspace_id = ? AND id = ?", [workspaceId, week.id]);
    }
    await tx.run("DELETE FROM training_mesocycles WHERE workspace_id = ? AND id = ?", [workspaceId, mesocycle.id]);
  }
}

export async function selectedMesocycle(tx: SqliteStatementPort, workspaceId: string, programId: string,
  clientId: string): Promise<string | null> {
  const row = await tx.first<{ id: string }>(`SELECT mesocycle_id AS id FROM training_mesocycle_selection
    WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [workspaceId, programId, clientId]);
  return row?.id ?? null;
}

/** Возвращает true, если выбор изменился. */
export async function saveSelection(tx: SqliteStatementPort, workspaceId: string, programId: string, clientId: string,
  mesocycleId: string): Promise<boolean> {
  const result = await tx.run(`INSERT INTO training_mesocycle_selection (workspace_id, client_id, program_id, mesocycle_id)
    VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, program_id) DO UPDATE SET mesocycle_id = excluded.mesocycle_id
      WHERE mesocycle_id IS NOT excluded.mesocycle_id`, [workspaceId, clientId, programId, mesocycleId]);
  return result.changes > 0;
}
