import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { TransferProgram, TransferPlanHistory } from "../../../../shared/training-transfer/TrainingTransfer.ts";
import { storedSimpleHistory, storedMesocycle } from "../domain/StoredPlanShape.ts";
import { readStructure, writeStructure } from "./SimplePlanStore.ts";
import { readMesocycles, insertMesocycle } from "./PeriodizedStore.ts";
import { readSimpleWeeks, writeSimpleOverride } from "./SimpleWeekStore.ts";

/** Owner commands, called with the application's single transaction. */
export async function exportTrainingPlans(tx: SqliteStatementPort, workspace: string, client: string, ids: readonly string[]): Promise<TransferProgram[]> {
  const rows = await tx.all<{ id: string; title: string; kind: "SIMPLE" | "PERIODIZED"; createdAt: string; archivedAt: string | null; weeks: number | null }>(`SELECT p.id, p.title, p.kind, p.created_at AS createdAt, m.archived_at AS archivedAt, p.weeks
    FROM training_programs p JOIN training_program_members m ON m.workspace_id=p.workspace_id AND m.program_id=p.id WHERE m.workspace_id=? AND m.client_id=? ORDER BY p.id`, [workspace, client]);
  const result: TransferProgram[] = [];
  for (const row of rows.filter((r) => ids.includes(r.id))) {
    const simple = row.kind === "SIMPLE" ? await readStructure(tx, workspace, row.id, row.weeks ?? 1) : null;
    result.push({ id: row.id, title: row.title, kind: row.kind, createdAt: row.createdAt, archivedAt: row.archivedAt, simple,
      simpleWeeks: simple ? await readSimpleWeeks(tx, workspace, client, row.id, simple) : [],
      mesocycles: row.kind === "PERIODIZED" ? await readMesocycles(tx, workspace, row.id, client) : [] });
  }
  return result;
}
export async function importTrainingPlans(tx: SqliteStatementPort, workspace: string, client: string, programs: readonly TransferProgram[]): Promise<void> {
  for (const p of programs) {
    await tx.run(`INSERT INTO training_programs(id,workspace_id,kind,title,revision,created_at,updated_at,weeks) VALUES(?,?,?,?,1,?,?,?)`, [p.id, workspace, p.kind, p.title, p.createdAt, p.createdAt, p.simple?.weeks ?? null]);
    await tx.run(`INSERT INTO training_program_members(workspace_id,program_id,client_id,joined_at,archived_at) VALUES(?,?,?,?,?)`, [workspace, p.id, client, p.createdAt, p.archivedAt]);
    if (p.simple) {
      await writeStructure(tx, workspace, p.id, p.simple);
      for (const week of p.simpleWeeks) for (const workout of week.workouts) await writeSimpleOverride(tx, workspace, client, p.id, week.index, workout);
    }
    for (const cycle of p.mesocycles) await insertMesocycle(tx, workspace, p.id, client, cycle, new Date(p.createdAt));
  }
}
export async function exportTrainingPlanHistory(tx: SqliteStatementPort, workspace: string, client: string, ids: readonly string[]): Promise<TransferPlanHistory[]> {
  const result: TransferPlanHistory[] = [];
  for (const table of ["training_simple_versions", "training_structure_versions"] as const) {
    const rows = await tx.all<{ id: string; programId: string; validFrom: string; validTo: string; json: string }>(`SELECT id,program_id AS programId,valid_from AS validFrom,valid_to AS validTo,structure_json AS json FROM ${table} WHERE workspace_id=? AND client_id=? ORDER BY id`, [workspace, client]);
    for (const row of rows.filter((r) => ids.includes(r.programId))) {
      const structure: unknown = JSON.parse(row.json); const metadata = { id: row.id, programId: row.programId, validFrom: row.validFrom, validTo: row.validTo };
      if (table === "training_simple_versions" && storedSimpleHistory(structure)) result.push({ ...metadata, simple: structure, mesocycle: null });
      else if (table === "training_structure_versions" && storedMesocycle(structure)) result.push({ ...metadata, simple: null, mesocycle: structure });
      else throw new Error("Повреждена историческая структура программы. Экспорт остановлен.");
    }
  }
  return result;
}
export async function importTrainingPlanHistory(tx: SqliteStatementPort, workspace: string, client: string, history: readonly TransferPlanHistory[]): Promise<void> {
  for (const h of history) {
    if (h.simple) await tx.run(`INSERT INTO training_simple_versions(id,workspace_id,client_id,program_id,valid_from,valid_to,structure_json) VALUES(?,?,?,?,?,?,?)`, [h.id, workspace, client, h.programId, h.validFrom, h.validTo, JSON.stringify(h.simple)]);
    else if (h.mesocycle) await tx.run(`INSERT INTO training_structure_versions(id,workspace_id,client_id,program_id,mesocycle_id,valid_from,valid_to,structure_json) VALUES(?,?,?,?,?,?,?,?)`, [h.id, workspace, client, h.programId, h.mesocycle.id, h.validFrom, h.validTo, JSON.stringify(h.mesocycle)]);
  }
}
