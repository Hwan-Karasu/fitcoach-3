import type { CycleType } from "../domain/MesocycleBuilder.ts";
import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { Mesocycle, PlanWeek, WeekType } from "../domain/PeriodizedModel.ts";
import { readWorkouts, writeWorkouts } from "./SimplePlanStore.ts";

/**
 * Мезоциклы Расширенной программы (T04): у каждого участника свои строки мезоциклов, недель и тренировок
 * (§48.28); общие у копий — только родство (`lineage_id`).
 */

type MesocycleRow = Readonly<{ id: string; lineageId: string; title: string; cycleType: CycleType | null; repMin: number | null;
  repMax: number | null; startDate: string | null }>;

export async function readMesocycles(tx: SqliteStatementPort, workspaceId: string, programId: string,
  clientId: string): Promise<readonly Mesocycle[]> {
  const rows = await tx.all<MesocycleRow>(`SELECT id, lineage_id AS lineageId, title, cycle_type AS cycleType, rep_min AS repMin, rep_max AS repMax,
    start_date AS startDate FROM dev_training_mesocycles
    WHERE workspace_id = ? AND program_id = ? AND client_id = ? ORDER BY position`, [workspaceId, programId, clientId]);
  const result: Mesocycle[] = [];
  for (const row of rows) {
    const weeks = await tx.all<{ id: string; position: number; type: WeekType }>(`SELECT id, position, week_type AS type
      FROM dev_training_weeks WHERE workspace_id = ? AND mesocycle_id = ? ORDER BY position`, [workspaceId, row.id]);
    const planWeeks: PlanWeek[] = [];
    for (const week of weeks) {
      planWeeks.push({ id: week.id, index: week.position + 1, type: week.type,
        workouts: await readWorkouts(tx, workspaceId, programId, week.id) });
    }
    const { repMin, repMax, ...rest } = row;
    result.push({ ...rest, repRange: repMin === null ? null : { min: repMin, max: repMax }, weeks: planWeeks });
  }
  return result;
}

/** Новый мезоцикл участника в конец его списка. */
export async function insertMesocycle(tx: SqliteStatementPort, workspaceId: string, programId: string, clientId: string,
  mesocycle: Mesocycle, now: Date): Promise<void> {
  const last = await tx.first<{ position: number | null }>(`SELECT max(position) AS position FROM dev_training_mesocycles
    WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [workspaceId, programId, clientId]);
  await tx.run(`INSERT INTO dev_training_mesocycles (id, workspace_id, program_id, client_id, lineage_id, position, title, created_at,
    cycle_type, rep_min, rep_max, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [mesocycle.id, workspaceId, programId, clientId,
    mesocycle.lineageId, (last?.position ?? -1) + 1, mesocycle.title.trim(), now.toISOString(), mesocycle.cycleType ?? null,
    mesocycle.repRange?.min ?? null, mesocycle.repRange?.max ?? null, mesocycle.startDate ?? null]);
  for (const week of mesocycle.weeks) {
    await tx.run(`INSERT INTO dev_training_weeks (id, workspace_id, mesocycle_id, position, week_type) VALUES (?, ?, ?, ?, ?)`,
      [week.id, workspaceId, mesocycle.id, week.index - 1, week.type]);
    await writeWorkouts(tx, workspaceId, programId, week.id, week.workouts);
  }
}

export async function writeWeek(tx: SqliteStatementPort, workspaceId: string, programId: string, week: PlanWeek): Promise<void> {
  await tx.run("UPDATE dev_training_weeks SET week_type = ? WHERE workspace_id = ? AND id = ?", [week.type, workspaceId, week.id]);
  await writeWorkouts(tx, workspaceId, programId, week.id, week.workouts);
}

/** Удаление всех мезоциклов участника в программе (окончательное удаление клиента). */
export async function deleteMemberMesocycles(tx: SqliteStatementPort, workspaceId: string, programId: string,
  clientId: string): Promise<void> {
  await tx.run("DELETE FROM dev_training_mesocycle_selection WHERE workspace_id = ? AND program_id = ? AND client_id = ?",
    [workspaceId, programId, clientId]);
  for (const mesocycle of await readMesocycles(tx, workspaceId, programId, clientId)) {
    for (const week of mesocycle.weeks) {
      await writeWorkouts(tx, workspaceId, programId, week.id, []);
      await tx.run("DELETE FROM dev_training_weeks WHERE workspace_id = ? AND id = ?", [workspaceId, week.id]);
    }
    await tx.run("DELETE FROM dev_training_mesocycles WHERE workspace_id = ? AND id = ?", [workspaceId, mesocycle.id]);
  }
}

export async function selectedMesocycle(tx: SqliteStatementPort, workspaceId: string, programId: string,
  clientId: string): Promise<string | null> {
  const row = await tx.first<{ id: string }>(`SELECT mesocycle_id AS id FROM dev_training_mesocycle_selection
    WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [workspaceId, programId, clientId]);
  return row?.id ?? null;
}

/** Возвращает true, если выбор изменился. */
export async function saveSelection(tx: SqliteStatementPort, workspaceId: string, programId: string, clientId: string,
  mesocycleId: string): Promise<boolean> {
  const result = await tx.run(`INSERT INTO dev_training_mesocycle_selection (workspace_id, client_id, program_id, mesocycle_id)
    VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, program_id) DO UPDATE SET mesocycle_id = excluded.mesocycle_id
      WHERE mesocycle_id IS NOT excluded.mesocycle_id`, [workspaceId, clientId, programId, mesocycleId]);
  return result.changes > 0;
}
