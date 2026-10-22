import type { DatabaseSync } from "node:sqlite";
import { legacyObjectJson, requireLegacyColumns } from "./LegacyExerciseCatalogSourceReader.ts";

type StructureTable = "training_programs" | "training_weeks" | "training_workouts" | "training_exercises";
export type ProgramStructureIssue = "MISSING_OWNER" | "MISSING_PARENT" | "UNASSIGNED_PROGRAM" |
  "UNASSIGNED_WEEK" | "CROSS_CLIENT_PROGRAM" | "WEEK_PROGRAM_MISMATCH" |
  "PARENT_REQUIRES_REVIEW" | "INVALID_JSON" | "INVALID_POSITION" | "DUPLICATE_POSITION";

export interface LegacyProgramStructureCandidate {
  readonly sourceIdentityKey: string;
  readonly accountScope: string;
  readonly sourceTable: StructureTable;
  readonly sourceRowId: string;
  readonly clientId: string | null;
  readonly sourceProgramId: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly parentSourceKey: string | null;
  readonly jsonShape: "object" | "invalid" | "column-not-observed";
  readonly lifecycle: "ACTIVE_SOURCE" | "DELETION_MARKER_PRESENT" | "column-not-observed";
  readonly issues: readonly ProgramStructureIssue[];
  readonly targetId: null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Structural source graph only. A program row is never promoted to a v3 top-level program here. */
export function readLegacyProgramStructureInSnapshot(db: DatabaseSync, accountScope: string) {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const required: Record<StructureTable, readonly string[]> = {
    training_programs: ["id", "client_id"], training_weeks: ["id", "program_id", "week_index"],
    training_workouts: ["id", "client_id", "program_id", "week_id"],
    training_exercises: ["id", "workout_id"],
  };
  requireLegacyColumns(db, "clients", ["id"], "R04_STRUCTURE_SHAPE_UNSUPPORTED");
  const clients = new Set<string>();
  for (const row of db.prepare("SELECT id FROM clients").all()) {
    const id = text(row.id);
    if (id === null || clients.has(id)) throw new Error("R04_STRUCTURE_CLIENT_IDENTITY_INVALID");
    clients.add(id);
  }
  const result: LegacyProgramStructureCandidate[] = [];
  const indices = new Map<StructureTable, Map<string, LegacyProgramStructureCandidate>>();
  for (const table of Object.keys(required) as StructureTable[]) {
    requireLegacyColumns(db, table, required[table], "R04_STRUCTURE_SHAPE_UNSUPPORTED");
    const index = new Map<string, LegacyProgramStructureCandidate>();
    indices.set(table, index);
    const rawRows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    const positionGroups = new Map<string, number>();
    const parentColumn = table === "training_weeks" ? "program_id"
      : table === "training_workouts" ? "week_id" : table === "training_exercises" ? "workout_id" : null;
    const positionColumn = table === "training_weeks" ? "week_index" : "sort_index";
    for (const raw of rawRows) {
      if (parentColumn !== null && text(raw[parentColumn]) !== null && Object.hasOwn(raw, positionColumn)) {
        const key = JSON.stringify([raw[parentColumn], raw[positionColumn]]);
        positionGroups.set(key, (positionGroups.get(key) ?? 0) + 1);
      }
    }
    for (const raw of rawRows) {
      const id = text(raw.id);
      if (id === null || index.has(id)) throw new Error("R04_STRUCTURE_ROW_IDENTITY_INVALID");
      const issues = new Set<ProgramStructureIssue>();
      let clientId = text(raw.client_id);
      let sourceProgramId = table === "training_programs" ? id : text(raw.program_id);
      let parent: LegacyProgramStructureCandidate | undefined;
      if (table === "training_weeks") {
        parent = indices.get("training_programs")!.get(sourceProgramId ?? "");
        if (!parent) issues.add("MISSING_PARENT");
        clientId = parent?.clientId ?? null;
      } else if (table === "training_workouts") {
        const program = indices.get("training_programs")!.get(sourceProgramId ?? "");
        if (sourceProgramId === null) issues.add("UNASSIGNED_PROGRAM");
        else if (!program) issues.add("MISSING_PARENT");
        else {
          if (program.clientId !== clientId) issues.add("CROSS_CLIENT_PROGRAM");
          if (program.issues.length > 0) issues.add("PARENT_REQUIRES_REVIEW");
        }
        const weekId = text(raw.week_id);
        parent = indices.get("training_weeks")!.get(weekId ?? "");
        if (weekId === null) issues.add("UNASSIGNED_WEEK");
        else if (!parent) issues.add("MISSING_PARENT");
        else if (parent.sourceProgramId !== sourceProgramId) issues.add("WEEK_PROGRAM_MISMATCH");
      } else if (table === "training_exercises") {
        parent = indices.get("training_workouts")!.get(text(raw.workout_id) ?? "");
        if (!parent) issues.add("MISSING_PARENT");
        clientId = parent?.clientId ?? null;
        sourceProgramId = parent?.sourceProgramId ?? null;
      }
      if (clientId === null || !clients.has(clientId)) issues.add("MISSING_OWNER");
      if (parent && parent.issues.length > 0) issues.add("PARENT_REQUIRES_REVIEW");
      const jsonColumn = table === "training_programs" ? "settings_json" : "data_json";
      const jsonShape = !Object.hasOwn(raw, jsonColumn) ? "column-not-observed"
        : legacyObjectJson(raw[jsonColumn]) === null ? "invalid" : "object";
      if (jsonShape === "invalid") issues.add("INVALID_JSON");
      if (parentColumn !== null && Object.hasOwn(raw, positionColumn)) {
        const position = raw[positionColumn];
        if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 0) issues.add("INVALID_POSITION");
        if (text(raw[parentColumn]) !== null
          && (positionGroups.get(JSON.stringify([raw[parentColumn], position])) ?? 0) > 1) {
          issues.add("DUPLICATE_POSITION");
        }
      }
      const candidate: LegacyProgramStructureCandidate = {
        sourceIdentityKey: JSON.stringify([accountScope, table, id]), accountScope,
        sourceTable: table, sourceRowId: id, clientId, sourceProgramId, raw,
        parentSourceKey: parent?.sourceIdentityKey ?? null, jsonShape,
        lifecycle: !Object.hasOwn(raw, "deleted_at") ? "column-not-observed"
          : raw.deleted_at === null ? "ACTIVE_SOURCE" : "DELETION_MARKER_PRESENT",
        issues: [...issues], targetId: null,
      };
      index.set(id, candidate);
      result.push(candidate);
    }
  }
  return result;
}

export function summarizeLegacyProgramStructure(rows: readonly LegacyProgramStructureCandidate[]) {
  const issueRowCounts: Record<ProgramStructureIssue, number> = {
    MISSING_OWNER: 0, MISSING_PARENT: 0, UNASSIGNED_PROGRAM: 0, UNASSIGNED_WEEK: 0,
    CROSS_CLIENT_PROGRAM: 0, WEEK_PROGRAM_MISMATCH: 0, PARENT_REQUIRES_REVIEW: 0,
    INVALID_JSON: 0, INVALID_POSITION: 0, DUPLICATE_POSITION: 0,
  };
  for (const row of rows) for (const issue of row.issues) issueRowCounts[issue] += 1;
  return {
    status: "requires-mapping" as const, physicalRows: rows.length,
    programRows: rows.filter((row) => row.sourceTable === "training_programs").length,
    weekRows: rows.filter((row) => row.sourceTable === "training_weeks").length,
    workoutRows: rows.filter((row) => row.sourceTable === "training_workouts").length,
    exerciseRows: rows.filter((row) => row.sourceTable === "training_exercises").length,
    rowsRequiringReview: rows.filter((row) => row.issues.length > 0).length,
    deletionMarkerRows: rows.filter((row) => row.lifecycle === "DELETION_MARKER_PRESENT").length,
    missingLifecycleShapeRows: rows.filter((row) => row.lifecycle === "column-not-observed").length,
    missingJsonShapeRows: rows.filter((row) => row.jsonShape === "column-not-observed").length,
    issueRowCounts, targetWrites: 0 as const,
  };
}
