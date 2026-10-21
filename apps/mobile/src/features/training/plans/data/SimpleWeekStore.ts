import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import { UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { PlannedWorkout, SimplePlan } from "../domain/SimplePlanModel.ts";
import type { SimplePlanVersion, SimpleWeek } from "../domain/SimpleWorkoutEdit.ts";

/** Недельное отличие из JSON-снимка; нечитаемое (не тренировка) — `null`: неделя показывает базовый план, а не ломает всю программу. */
export function parseOverride(json: string, workoutId: string): PlannedWorkout | null {
  try {
    const value = JSON.parse(json) as Partial<PlannedWorkout> | null;
    return value !== null && typeof value === "object" && value.id === workoutId && Array.isArray(value.exercises) ? value as PlannedWorkout : null;
  } catch { return null; }
}

export async function readSimpleWeeks(tx: SqliteStatementPort, workspaceId: string, clientId: string, programId: string,
  base: SimplePlan): Promise<readonly SimpleWeek[]> {
  const rows = await tx.all<{ week: number; workoutId: string; json: string }>(`SELECT week_index AS week,
    workout_id AS workoutId, workout_json AS json FROM dev_training_simple_overrides
    WHERE workspace_id = ? AND client_id = ? AND program_id = ?`, [workspaceId, clientId, programId]);
  const overrides = new Map(rows.flatMap((row) => { const workout = parseOverride(row.json, row.workoutId); return workout === null ? [] : [[`${row.week}:${row.workoutId}`, workout] as const]; }));
  return Array.from({ length: base.weeks }, (_, index) => ({ index: index + 1,
    workouts: base.workouts.map((workout) => overrides.get(`${index + 1}:${workout.id}`) ?? workout) }));
}

export async function writeSimpleOverride(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  programId: string, week: number, workout: PlannedWorkout): Promise<void> {
  await tx.run(`INSERT INTO dev_training_simple_overrides(workspace_id, client_id, program_id, week_index, workout_id, workout_json)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, program_id, week_index, workout_id)
    DO UPDATE SET workout_json = excluded.workout_json`, [workspaceId, clientId, programId, week, workout.id, JSON.stringify(workout)]);
}

export async function readSimpleHistory(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  programId: string): Promise<readonly SimplePlanVersion[]> {
  const rows = await tx.all<{ id: string; validFrom: string; validTo: string; json: string }>(`SELECT id,
    valid_from AS validFrom, valid_to AS validTo, structure_json AS json FROM dev_training_simple_versions
    WHERE workspace_id = ? AND client_id = ? AND program_id = ? ORDER BY rowid DESC`, [workspaceId, clientId, programId]);
  return rows.map(({ json, ...row }) => ({ ...row, ...JSON.parse(json) as Pick<SimplePlanVersion, "title" | "weeks"> }));
}

export async function preserveSimple(tx: SqliteStatementPort, workspaceId: string, clientId: string, programId: string,
  createdAt: string, title: string, weeks: readonly SimpleWeek[], now: Date): Promise<void> {
  const previous = await tx.first<{ at: string }>(`SELECT valid_to AS at FROM dev_training_simple_versions
    WHERE workspace_id = ? AND client_id = ? AND program_id = ? ORDER BY rowid DESC LIMIT 1`, [workspaceId, clientId, programId]);
  const from = previous?.at ?? createdAt;
  const to = new Date(Math.max(new Date(from).getTime(), now.getTime())).toISOString();
  const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
  if (!id) throw new Error("PROGRAM_ID_UNAVAILABLE");
  await tx.run(`INSERT INTO dev_training_simple_versions
    (id, workspace_id, client_id, program_id, valid_from, valid_to, structure_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [id, workspaceId, clientId, programId, from, to, JSON.stringify({ title, weeks })]);
}

/** Недельный снимок не должен присвоить ID, принадлежащие другой тренировке или клиенту. */
export async function assertSimpleIdentities(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  programId: string, workout: PlannedWorkout, known: readonly PlannedWorkout[]): Promise<void> {
  const idsOf = (item: PlannedWorkout) => item.exercises.flatMap((exercise) => [exercise.id, ...exercise.sets.map((set) => set.id)]);
  const owned = new Set(known.flatMap(idsOf));
  const exercises = new Map(known.flatMap((item) => item.exercises.map((exercise) => [exercise.id, exercise.exerciseId] as const)));
  const setOwners = new Map(known.flatMap((item) => item.exercises.flatMap((exercise) => exercise.sets.map((set) => [set.id, exercise.id] as const))));
  for (const exercise of workout.exercises) {
    if (exercises.has(exercise.id) && exercises.get(exercise.id) !== exercise.exerciseId) throw new Error("DRAFT_INVALID");
    for (const set of exercise.sets) if (setOwners.has(set.id) && setOwners.get(set.id) !== exercise.id) throw new Error("DRAFT_INVALID");
  }
  const fresh = idsOf(workout).filter((id) => !owned.has(id));
  if (fresh.length === 0) return;
  // ID чужих снимков собираются одним проходом, а не сканом всех снимков на каждый новый ID.
  const foreign = new Set((await tx.all<{ id: string }>(`SELECT j.value AS id FROM dev_training_simple_overrides o,
    json_tree(o.workout_json) j WHERE j.key = 'id' AND NOT
    (o.workspace_id = ? AND o.client_id = ? AND o.program_id = ? AND o.workout_id = ?)`,
  [workspaceId, clientId, programId, workout.id])).map((row) => row.id));
  for (const id of fresh) {
    if (foreign.has(id)) throw new Error("DRAFT_INVALID");
    const taken = await tx.first<{ id: string }>(`SELECT id FROM dev_training_planned_exercises WHERE id = ?
      UNION ALL SELECT id FROM dev_training_planned_sets WHERE id = ?
      UNION ALL SELECT id FROM dev_training_workouts WHERE id = ? LIMIT 1`, [id, id, id]);
    if (taken) throw new Error("DRAFT_INVALID");
  }
}
