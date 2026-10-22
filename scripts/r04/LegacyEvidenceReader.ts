import type { DatabaseSync } from "node:sqlite";
import { readLegacyArchiveRowsInSnapshot } from "./LegacyArchiveSourceReader.ts";
import { readLegacyCalendarRowsInSnapshot } from "./LegacyCalendarSourceReader.ts";
import { readLegacyClientDayRowsInSnapshot } from "./LegacyClientDaySourceReader.ts";
import { readLegacyClientIdentityInSnapshot } from "./LegacyClientIdentitySourceReader.ts";
import { readLegacyCurrentSetRowsInSnapshot } from "./LegacyCurrentSetSourceReader.ts";
import { readLegacyHistoryRowsInSnapshot } from "./LegacyHistorySourceReader.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./LegacyExerciseReferencePreflight.ts";
import { readLegacyMeasurementRowsInSnapshot, legacyMeasurementFields } from "./LegacyMeasurementSourceReader.ts";
import { readLegacyProfileWeightsInSnapshot } from "./LegacyWeightSourceReconciliation.ts";
import { readLegacyProgramBooksInSnapshot } from "./LegacyProgramBookSourceReader.ts";
import { readLegacyNutritionDayRowsInSnapshot } from "./LegacyNutritionDaySourceReader.ts";
import { readLegacyNutritionEntryEvidenceInSnapshot } from "./LegacyNutritionEntrySourceReader.ts";
import { readLegacySetRowsInSnapshot } from "./LegacySetSourceReader.ts";
import { readLegacyWorkoutSnapshotRowsInSnapshot } from "./LegacyWorkoutSnapshotSourceReader.ts";

/** One SQLite read snapshot for source materializations; no mixed-time cross-table matching. */
export function readLegacyEvidence(db: DatabaseSync, accountScope: string) {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  db.exec("PRAGMA query_only = ON");
  db.exec("BEGIN");
  try {
    return readLegacyEvidenceInSnapshot(db, accountScope);
  } finally { db.exec("ROLLBACK"); }
}

/** Caller owns the read transaction shared with source coverage and R02 gates. */
export function readLegacyEvidenceInSnapshot(db: DatabaseSync, accountScope: string) {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const sets = readLegacySetRowsInSnapshot(db, accountScope);
  const programBooks = readLegacyProgramBooksInSnapshot(db, accountScope);
  const history = readLegacyHistoryRowsInSnapshot(db, accountScope);
  const hasExerciseCatalog = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exercise_catalog'").get();
  const exerciseCatalog = hasExerciseCatalog ? readLegacyExerciseCatalogInSnapshot(db, accountScope) : null;
  const exerciseReferences = exerciseCatalog === null ? null
    : readLegacyExerciseReferencesInSnapshot(db, accountScope, exerciseCatalog);
  const currentTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='training_set_logs'").get();
  const currentSets = currentTable ? readLegacyCurrentSetRowsInSnapshot(db, accountScope) : null;
  const snapshotTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='training_workout_logs'").get();
  const workoutSnapshots = snapshotTable ? readLegacyWorkoutSnapshotRowsInSnapshot(db, accountScope) : null;
  const archiveTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='training_archive_entries'").get();
  const archives = archiveTable ? readLegacyArchiveRowsInSnapshot(db, accountScope) : null;
  const nutritionColumns = new Set(db.prepare("PRAGMA table_info('nutrition_days')").all()
    .map((row) => String(row.name)));
  const nutritionDays = nutritionColumns.has("meals_json")
    ? readLegacyNutritionDayRowsInSnapshot(db, accountScope) : null;
  const nutritionEntries = nutritionColumns.has("meals_json")
    ? readLegacyNutritionEntryEvidenceInSnapshot(db, accountScope) : null;
  const measurementColumns = new Set(db.prepare("PRAGMA table_info('client_measurements')").all()
    .map((row) => String(row.name)));
  const measurements = legacyMeasurementFields.every((field) => measurementColumns.has(field))
    ? readLegacyMeasurementRowsInSnapshot(db, accountScope) : null;
  const calendarColumns = new Set(db.prepare("PRAGMA table_info('calendar_appointments')").all()
    .map((row) => String(row.name)));
  const calendar = calendarColumns.has("appointment_type")
    ? readLegacyCalendarRowsInSnapshot(db, accountScope) : null;
  const clientDayColumns = new Set(db.prepare("PRAGMA table_info('client_day_facts')").all()
    .map((row) => String(row.name)));
  const clientDays = clientDayColumns.has("training")
    ? readLegacyClientDayRowsInSnapshot(db, accountScope) : null;
  const profileColumns = new Set(db.prepare("PRAGMA table_info('clients')").all()
    .map((row) => String(row.name)));
  const profileWeights = profileColumns.has("weight")
    ? readLegacyProfileWeightsInSnapshot(db, accountScope) : null;
  const clientIdentity = ["id", "workspace_id", "name", "created_at", "updated_at",
    "archived_at", "deleted_at"].every((column) => profileColumns.has(column))
    ? readLegacyClientIdentityInSnapshot(db, accountScope) : null;
  return { sets, programBooks, history, exerciseCatalog, exerciseReferences, currentSets, workoutSnapshots, archives, nutritionDays, nutritionEntries,
    measurements, calendar, clientDays, profileWeights, clientIdentity } as const;
}
