import type { DatabaseSync } from "node:sqlite";

/** Physical legacy source fixture, not target DDL. No source defaults/normalizers. */
export function createLegacyTrainingTables(db: DatabaseSync) {
  db.exec(`CREATE TABLE training_programs(id TEXT PRIMARY KEY,client_id TEXT,mode TEXT,name TEXT,cycle_type TEXT,settings_json TEXT,book_id TEXT,is_template INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT,template_workspace_id TEXT);
    CREATE TABLE training_weeks(id TEXT PRIMARY KEY,program_id TEXT,week_index INTEGER,week_type TEXT,label TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_workouts(id TEXT PRIMARY KEY,client_id TEXT,program_id TEXT,week_id TEXT,sort_index INTEGER,name TEXT,data_json TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_exercises(id TEXT PRIMARY KEY,workout_id TEXT,sort_index INTEGER,name TEXT,note TEXT,template_exercise_id TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_set_logs(id TEXT PRIMARY KEY,exercise_id TEXT,set_index INTEGER,reps TEXT,weight TEXT,rpe TEXT,completed_at TEXT,data_json TEXT,deleted_at TEXT,set_kind TEXT,effort_outcome TEXT);
    CREATE TABLE training_library_programs(id TEXT PRIMARY KEY,client_id TEXT,name TEXT,mode TEXT,created_at TEXT,archived_at TEXT);
    CREATE TABLE training_workspaces(client_id TEXT,active_program_id TEXT,week_state_json TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_program_view_state(actor_id TEXT,client_id TEXT,library_id TEXT,selected_program_id TEXT,state_json TEXT);
    CREATE TABLE training_library_preferences(actor_id TEXT,client_id TEXT,preferred_id TEXT);
    CREATE TABLE training_archive_entries(id TEXT PRIMARY KEY,client_id TEXT,data_json TEXT,archived_at TEXT,deleted_at TEXT);
    CREATE TABLE training_sessions(id TEXT PRIMARY KEY,client_id TEXT,source_workout_id TEXT,program_key TEXT,week_key TEXT,workout_name TEXT,performed_at TEXT,date_source TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_session_exercises(id TEXT PRIMARY KEY,session_id TEXT,source_exercise_id TEXT,catalog_id TEXT,exercise_key TEXT,name TEXT,sort_index INTEGER,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_session_sets(id TEXT PRIMARY KEY,session_exercise_id TEXT,source_fact_id TEXT,set_index INTEGER,reps TEXT,weight TEXT,rpe TEXT,set_kind TEXT,effort_outcome TEXT,completed_at TEXT,segments_json TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_set_segments(id TEXT PRIMARY KEY,set_log_id TEXT,segment_index INTEGER,reps TEXT,weight TEXT,deleted_at TEXT);
    CREATE TABLE training_exercise_history(id TEXT PRIMARY KEY,client_id TEXT,exercise_key TEXT,source_fact_id TEXT,data_json TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_workout_logs(id TEXT PRIMARY KEY,client_id TEXT,workout_id TEXT,logged_at TEXT,data_json TEXT,deleted_at TEXT);`);
}
