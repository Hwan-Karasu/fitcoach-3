import { DatabaseSync } from "node:sqlite";

export interface ReferenceOwnerProbeReport {
  readonly status: "reference-only" | "candidate-overlay";
  readonly foreignKeysEnabled: boolean;
  readonly appointmentForeignClientAccepted: boolean;
  readonly appointmentForeignSessionTypeAccepted: boolean;
  readonly diaryForeignWorkspaceProductAccepted: boolean;
  readonly programForeignWorkspaceCohortAccepted: boolean;
  readonly primaryForeignMeasurementAccepted: boolean;
  readonly sessionForeignClientProgramAccepted: boolean;
  readonly reassignProgramAfterSessionAccepted: boolean;
  readonly reassignMeasurementAfterPrimaryAccepted: boolean;
  readonly appointmentOwnSessionTypeAccepted: boolean;
  readonly diaryOwnProductAccepted: boolean;
  readonly diaryOwnRecipeAccepted: boolean;
  readonly programOwnCohortAccepted: boolean;
  readonly updateProgramNameAccepted: boolean;
  readonly updateMeasurementValueAccepted: boolean;
  readonly updateAppointmentToForeignTypeAccepted: boolean;
  readonly updateDiaryToForeignProductAccepted: boolean;
  readonly updateProgramToForeignCohortAccepted: boolean;
  readonly moveReferencedSessionTypeAccepted: boolean;
  readonly moveReferencedProductAccepted: boolean;
  readonly moveReferencedRecipeAccepted: boolean;
  readonly moveReferencedCohortAccepted: boolean;
  readonly productionSchemaApproved: false;
  readonly targetWrites: 0;
}

const instant = "2026-01-01T10:00:00Z";

function accepts(db: DatabaseSync, sql: string): boolean {
  db.exec("SAVEPOINT d01_probe");
  try {
    db.exec(sql);
    return true;
  } catch { return false; }
  finally { db.exec("ROLLBACK TO d01_probe; RELEASE d01_probe"); }
}

/** Executes reference SQL and optional experimental overlay in disposable memory only. */
export function probeReferenceOwnerGuards(
  referenceSql: string,
  candidateOverlaySql?: string,
): ReferenceOwnerProbeReport {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(referenceSql);
    if (candidateOverlaySql !== undefined) db.exec(candidateOverlaySql);
    const foreignKeysEnabled = (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys === 1;
    db.prepare("INSERT INTO workspaces(id,created_at) VALUES (?,?)").run("synthetic-w1", instant);
    db.prepare("INSERT INTO workspaces(id,created_at) VALUES (?,?)").run("synthetic-w2", instant);
    db.prepare("INSERT INTO clients(id,workspace_id,display_name,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("synthetic-c1", "synthetic-w1", "Synthetic A", instant, instant);
    db.prepare("INSERT INTO clients(id,workspace_id,display_name,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("synthetic-c2", "synthetic-w2", "Synthetic B", instant, instant);
    db.prepare("INSERT INTO session_types(id,workspace_id,display_name,requires_credit) VALUES (?,?,?,?)")
      .run("synthetic-t2", "synthetic-w2", "Synthetic type", 0);
    db.prepare("INSERT INTO session_types(id,workspace_id,display_name,requires_credit) VALUES (?,?,?,?)")
      .run("synthetic-t1", "synthetic-w1", "Synthetic own type", 0);
    db.prepare("INSERT INTO food_products(id,workspace_id,display_name,per_100g_json,updated_at) VALUES (?,?,?,?,?)")
      .run("synthetic-f2", "synthetic-w2", "Synthetic food", "{}", instant);
    db.prepare("INSERT INTO food_products(id,workspace_id,display_name,per_100g_json,updated_at) VALUES (?,?,?,?,?)")
      .run("synthetic-f1", "synthetic-w1", "Synthetic own food", "{}", instant);
    db.prepare("INSERT INTO nutrition_recipes(id,workspace_id,display_name,updated_at) VALUES (?,?,?,?)")
      .run("synthetic-r1", "synthetic-w1", "Synthetic own recipe", instant);
    db.prepare("INSERT INTO program_cohorts(id,workspace_id,created_at) VALUES (?,?,?)")
      .run("synthetic-g2", "synthetic-w2", instant);
    db.prepare("INSERT INTO program_cohorts(id,workspace_id,created_at) VALUES (?,?,?)")
      .run("synthetic-g1", "synthetic-w1", instant);
    db.prepare("INSERT INTO training_programs(id,client_id,mode,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("synthetic-p2", "synthetic-c2", "SIMPLE", "Synthetic program", instant, instant);
    db.prepare(`INSERT INTO body_measurements(id,client_id,metric_key,value_scaled,scale,unit,
      local_date,date_precision,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run("synthetic-m2", "synthetic-c2", "weight", 8000, 100, "kg", "2026-01-01", "DATE", instant);
    db.prepare(`INSERT INTO measurement_daily_primary(client_id,metric_key,local_date,measurement_id)
      VALUES (?,?,?,?)`).run("synthetic-c2", "weight", "2026-01-01", "synthetic-m2");
    db.prepare(`INSERT INTO workout_sessions(id,client_id,source_program_id,origin_program_key,
      origin_context_json,date_precision,outcome,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("synthetic-s2", "synthetic-c2", "synthetic-p2",
      "synthetic-p2", "{}", "UNKNOWN", "NOT_STARTED", instant, instant);

    const appointmentForeignClientAccepted = accepts(db, `INSERT INTO calendar_appointments
      (id,workspace_id,client_id,start_at,end_at,local_date,created_at,updated_at)
      VALUES ('synthetic-a1','synthetic-w1','synthetic-c2','2026-01-01T10:00:00Z',
      '2026-01-01T11:00:00Z','2026-01-01','${instant}','${instant}')`);
    const appointmentForeignSessionTypeAccepted = accepts(db, `INSERT INTO calendar_appointments
      (id,workspace_id,client_id,session_type_id,start_at,end_at,local_date,created_at,updated_at)
      VALUES ('synthetic-a2','synthetic-w1','synthetic-c1','synthetic-t2',
      '2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','2026-01-01','${instant}','${instant}')`);
    const diaryForeignWorkspaceProductAccepted = accepts(db, `INSERT INTO food_diary_entries
      (id,client_id,local_date,meal_slot,source_type,source_id,source_snapshot_json,
      amount_g_x100,entered_at,updated_at)
      VALUES ('synthetic-e1','synthetic-c1','2026-01-01','BREAKFAST','PRODUCT',
      'synthetic-f2','{}',10000,'${instant}','${instant}')`);
    const programForeignWorkspaceCohortAccepted = accepts(db, `INSERT INTO training_programs
      (id,client_id,cohort_id,mode,display_name,created_at,updated_at)
      VALUES ('synthetic-p1','synthetic-c1','synthetic-g2','SIMPLE','Synthetic program',
      '${instant}','${instant}')`);
    const primaryForeignMeasurementAccepted = accepts(db, `INSERT INTO measurement_daily_primary
      (client_id,metric_key,local_date,measurement_id)
      VALUES ('synthetic-c1','weight','2026-01-01','synthetic-m2')`);
    const sessionForeignClientProgramAccepted = accepts(db, `INSERT INTO workout_sessions
      (id,client_id,source_program_id,origin_program_key,origin_context_json,date_precision,
      outcome,created_at,updated_at)
      VALUES ('synthetic-s1','synthetic-c1','synthetic-p2','synthetic-p2','{}',
      'UNKNOWN','NOT_STARTED','${instant}','${instant}')`);
    const reassignProgramAfterSessionAccepted = accepts(db,
      "UPDATE training_programs SET client_id='synthetic-c1' WHERE id='synthetic-p2'");
    const reassignMeasurementAfterPrimaryAccepted = accepts(db,
      "UPDATE body_measurements SET client_id='synthetic-c1' WHERE id='synthetic-m2'");
    const appointmentOwnSessionTypeAccepted = accepts(db, `INSERT INTO calendar_appointments
      (id,workspace_id,client_id,session_type_id,start_at,end_at,local_date,created_at,updated_at)
      VALUES ('synthetic-own-a','synthetic-w1','synthetic-c1','synthetic-t1',
      '2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','2026-01-01','${instant}','${instant}')`);
    const diaryOwnProductAccepted = accepts(db, `INSERT INTO food_diary_entries
      (id,client_id,local_date,meal_slot,source_type,source_id,source_snapshot_json,
      amount_g_x100,entered_at,updated_at)
      VALUES ('synthetic-own-f','synthetic-c1','2026-01-01','BREAKFAST','PRODUCT',
      'synthetic-f1','{}',10000,'${instant}','${instant}')`);
    const diaryOwnRecipeAccepted = accepts(db, `INSERT INTO food_diary_entries
      (id,client_id,local_date,meal_slot,source_type,source_id,source_snapshot_json,
      amount_g_x100,entered_at,updated_at)
      VALUES ('synthetic-own-r','synthetic-c1','2026-01-01','LUNCH','RECIPE',
      'synthetic-r1','{}',10000,'${instant}','${instant}')`);
    const programOwnCohortAccepted = accepts(db, `INSERT INTO training_programs
      (id,client_id,cohort_id,mode,display_name,created_at,updated_at)
      VALUES ('synthetic-own-p','synthetic-c1','synthetic-g1','SIMPLE','Synthetic own program',
      '${instant}','${instant}')`);
    const updateProgramNameAccepted = accepts(db,
      "UPDATE training_programs SET display_name='Renamed' WHERE id='synthetic-p2'");
    const updateMeasurementValueAccepted = accepts(db,
      "UPDATE body_measurements SET value_scaled=8100 WHERE id='synthetic-m2'");
    const updateAppointmentToForeignTypeAccepted = accepts(db, `INSERT INTO calendar_appointments
      (id,workspace_id,client_id,session_type_id,start_at,end_at,local_date,created_at,updated_at)
      VALUES ('synthetic-update-a','synthetic-w1','synthetic-c1','synthetic-t1',
      '2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','2026-01-01','${instant}','${instant}');
      UPDATE calendar_appointments SET session_type_id='synthetic-t2' WHERE id='synthetic-update-a'`);
    const updateDiaryToForeignProductAccepted = accepts(db, `INSERT INTO food_diary_entries
      (id,client_id,local_date,meal_slot,source_type,source_id,source_snapshot_json,
      amount_g_x100,entered_at,updated_at)
      VALUES ('synthetic-update-f','synthetic-c1','2026-01-01','BREAKFAST','PRODUCT',
      'synthetic-f1','{}',10000,'${instant}','${instant}');
      UPDATE food_diary_entries SET source_id='synthetic-f2' WHERE id='synthetic-update-f'`);
    const updateProgramToForeignCohortAccepted = accepts(db, `INSERT INTO training_programs
      (id,client_id,cohort_id,mode,display_name,created_at,updated_at)
      VALUES ('synthetic-update-p','synthetic-c1','synthetic-g1','SIMPLE','Synthetic program',
      '${instant}','${instant}');
      UPDATE training_programs SET cohort_id='synthetic-g2' WHERE id='synthetic-update-p'`);
    const moveReferencedSessionTypeAccepted = accepts(db, `INSERT INTO calendar_appointments
      (id,workspace_id,client_id,session_type_id,start_at,end_at,local_date,created_at,updated_at)
      VALUES ('synthetic-linked-a','synthetic-w2','synthetic-c2','synthetic-t2',
      '2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','2026-01-01','${instant}','${instant}');
      UPDATE session_types SET workspace_id='synthetic-w1' WHERE id='synthetic-t2'`);
    const moveReferencedProductAccepted = accepts(db, `INSERT INTO food_diary_entries
      (id,client_id,local_date,meal_slot,source_type,source_id,source_snapshot_json,
      amount_g_x100,entered_at,updated_at)
      VALUES ('synthetic-linked-f','synthetic-c2','2026-01-01','BREAKFAST','PRODUCT',
      'synthetic-f2','{}',10000,'${instant}','${instant}');
      UPDATE food_products SET workspace_id='synthetic-w1' WHERE id='synthetic-f2'`);
    const moveReferencedRecipeAccepted = accepts(db, `INSERT INTO food_diary_entries
      (id,client_id,local_date,meal_slot,source_type,source_id,source_snapshot_json,
      amount_g_x100,entered_at,updated_at)
      VALUES ('synthetic-linked-r','synthetic-c1','2026-01-01','BREAKFAST','RECIPE',
      'synthetic-r1','{}',10000,'${instant}','${instant}');
      UPDATE nutrition_recipes SET workspace_id='synthetic-w2' WHERE id='synthetic-r1'`);
    const moveReferencedCohortAccepted = accepts(db, `UPDATE training_programs
      SET cohort_id='synthetic-g2' WHERE id='synthetic-p2';
      UPDATE program_cohorts SET workspace_id='synthetic-w1' WHERE id='synthetic-g2'`);
    return {
      status: candidateOverlaySql === undefined ? "reference-only" : "candidate-overlay",
      foreignKeysEnabled,
      appointmentForeignClientAccepted, appointmentForeignSessionTypeAccepted,
      diaryForeignWorkspaceProductAccepted, programForeignWorkspaceCohortAccepted,
      primaryForeignMeasurementAccepted, sessionForeignClientProgramAccepted,
      reassignProgramAfterSessionAccepted, reassignMeasurementAfterPrimaryAccepted,
      appointmentOwnSessionTypeAccepted, diaryOwnProductAccepted, diaryOwnRecipeAccepted,
      programOwnCohortAccepted, updateProgramNameAccepted, updateMeasurementValueAccepted,
      updateAppointmentToForeignTypeAccepted, updateDiaryToForeignProductAccepted,
      updateProgramToForeignCohortAccepted, moveReferencedSessionTypeAccepted,
      moveReferencedProductAccepted, moveReferencedRecipeAccepted, moveReferencedCohortAccepted,
      productionSchemaApproved: false, targetWrites: 0,
    };
  } finally { db.close(); }
}
