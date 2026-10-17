import { BODY_PARTS, TRACKING_PROFILE_IDS, type BodyPart, type ExerciseDefinition, type ExerciseMedia,
  type TrackingProfileId } from "../../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";

/**
 * Source Adapter + Normalization + Validation для RepDB Free (§29.2, §39.1): внешняя запись → ExerciseDefinition
 * FitCoach. RepDB не становится доменной моделью: ID — свой (`sys:repdb:<id>`), профиль учёта — по правилам ниже.
 */

/** Поля записи RepDB, которые использует адаптер (schema_version 3). */
export interface RepdbRecord {
  readonly id: string;
  readonly name_en: string;
  readonly category?: string;
  readonly force_type?: string;
  readonly mechanic?: string;
  readonly difficulty?: string;
  readonly equipment?: string | null;
  readonly body_part: string;
  readonly primary_muscles?: readonly string[];
  readonly secondary_muscles?: readonly string[];
  readonly is_unilateral?: boolean;
  readonly is_bodyweight?: boolean;
  readonly variation_group?: string;
  readonly instructions_en?: readonly string[];
  readonly tips_en?: readonly string[];
  readonly images?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Явные решения по профилю там, где поля источника не дают однозначного ответа (§33.4). */
const PROFILE_OVERRIDES: Readonly<Record<string, TrackingProfileId>> = {
  "weighted-pull-up": "ADDED_LOAD_REPS",
  "weighted-dips": "ADDED_LOAD_REPS",
  "assisted-pull-ups": "ASSISTANCE_REPS",
  "assisted-dips": "ASSISTANCE_REPS",
  "sled-row": "LOAD_DISTANCE",
  "dumbbell-farmers-walk": "LOAD_DISTANCE",
  "kettlebell-farmers-walk": "LOAD_DISTANCE",
  "suitcase-carry": "LOAD_DISTANCE",
  "db-overhead-carry": "LOAD_DISTANCE",
  "double-db-overhead-carry": "LOAD_DISTANCE",
  "kettlebell-overhead-carry": "LOAD_DISTANCE",
  "double-kettlebell-overhead-carry": "LOAD_DISTANCE",
  "running": "DISTANCE_DURATION",
  "walking": "DISTANCE_DURATION",
  "treadmill-running": "DISTANCE_DURATION",
  "incline-treadmill-walk": "DISTANCE_DURATION",
  "rowing-machine": "DISTANCE_DURATION",
  "ski-erg": "DISTANCE_DURATION",
};

/** Оборудование без собственной внешней нагрузки: учёт по повторам или времени. */
const UNLOADED_EQUIPMENT = new Set(["pull_up_bar", "rings", "dip_station", "suspension_trainer", "stability_ball",
  "flat_bench", "plyo_box", "loop_band", "resistance_band", "glute_ham_developer", "climbing_rope", "ab_wheel",
  "jump_rope", "battle_rope"]);

export function trackingProfileOf(record: RepdbRecord): TrackingProfileId {
  const override = PROFILE_OVERRIDES[record.id];
  if (override !== undefined) return override;
  const equipment = record.equipment ?? null;
  const loaded = equipment !== null && !UNLOADED_EQUIPMENT.has(equipment) && record.is_bodyweight !== true;
  if (record.category === "stretching" || record.category === "cardio") return "DURATION";
  if (record.force_type === "static") return loaded ? "LOAD_DURATION" : "DURATION";
  return loaded ? "LOAD_REPS" : "REPS";
}

function mediaOf(record: RepdbRecord): ExerciseMedia | null {
  const flat = record.images?.flat;
  if (flat === undefined) return null;
  return { start: flat.start ?? null, peak: flat.peak ?? null, main: flat.main ?? null };
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? value as T : null;
}

export function systemExerciseId(sourceId: string): string {
  return `sys:repdb:${sourceId}`;
}

export function normalizeRecord(record: RepdbRecord, ruName: string | undefined): ExerciseDefinition {
  const bodyPart = oneOf<BodyPart>(record.body_part, BODY_PARTS);
  if (bodyPart === null) throw new Error(`REPDB_BODY_PART_UNKNOWN:${record.id}:${record.body_part}`);
  const nameEn = record.name_en.trim();
  return {
    id: systemExerciseId(record.id),
    origin: "SYSTEM",
    name: ruName?.trim() || nameEn,
    nameEn,
    bodyPart,
    primaryMuscles: [...(record.primary_muscles ?? [])],
    secondaryMuscles: [...(record.secondary_muscles ?? [])],
    equipment: record.equipment ?? null,
    trackingProfile: trackingProfileOf(record),
    mechanic: oneOf(record.mechanic, ["compound", "isolation"] as const),
    difficulty: oneOf(record.difficulty, ["beginner", "intermediate", "advanced"] as const),
    unilateral: record.is_unilateral === true,
    variationGroup: record.variation_group ?? null,
    instructions: [...(record.instructions_en ?? [])],
    tips: [...(record.tips_en ?? [])],
    media: mediaOf(record),
    source: { provider: "REPDB", sourceId: record.id },
  };
}

/** Проверка набора: ID уникальны и стабильного вида, названия есть, профиль из разрешённых (§33.3). */
export function validateCatalog(exercises: readonly ExerciseDefinition[]): readonly string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const exercise of exercises) {
    if (ids.has(exercise.id)) problems.push(`дубликат ID ${exercise.id}`);
    ids.add(exercise.id);
    if (!/^sys:repdb:[a-z0-9-]+$/.test(exercise.id)) problems.push(`ID не по формату: ${exercise.id}`);
    if (!exercise.name.trim()) problems.push(`нет названия: ${exercise.id}`);
    if (!TRACKING_PROFILE_IDS.includes(exercise.trackingProfile)) problems.push(`профиль вне V1: ${exercise.id}`);
  }
  return problems;
}
