export type LegacySourceRow = Readonly<Record<string, unknown>>;

export const NUTRITION_SOURCE_TABLES = ["food_products", "nutrition_recipes", "nutrition_days", "client_day_facts", "client_kbju_state", "nutrition_archive_weeks"] as const;
export interface LegacyNutritionSource {
  readonly accountScope: string;
  readonly tables: Readonly<Record<typeof NUTRITION_SOURCE_TABLES[number], readonly LegacySourceRow[] | null>>;
}

export const legacyMeasurementFields = ["neck", "shoulders", "chest", "waist", "hips", "upper_arm", "thigh", "calf"] as const;
export interface LegacyMeasurementsSnapshot {
  readonly accountScope: string;
  /** Optional absence is different from an observed empty table. */
  readonly rows: readonly LegacySourceRow[] | null;
  readonly clientDays: readonly LegacySourceRow[] | null;
}

export const LEGACY_CALENDAR_COLUMNS = ["id", "date_key", "start_time", "end_time", "duration_minutes", "client_id", "guest_name", "client_name", "appointment_type", "note", "created_at", "updated_at", "deleted_at"] as const;
export interface LegacyCalendarSnapshot {
  readonly accountScope: string;
  readonly appointments: readonly LegacySourceRow[] | null;
  /** Calendar-owned key only; other settings need separate coverage. */
  readonly plannerRows: readonly LegacySourceRow[] | null;
  readonly unsupportedAccountingTables: readonly string[];
}

export interface LegacyDomainSnapshots {
  readonly nutrition: LegacyNutritionSource;
  readonly measurements: LegacyMeasurementsSnapshot;
  readonly calendar: LegacyCalendarSnapshot;
}
