/** §33.2 Измеряемые величины подхода. Производные (темп, объём, e1RM) вручную не вводятся. */
export type TrackingMetric = "reps" | "load" | "addedLoad" | "assistance" | "duration" | "distance";

/** §33.3 Разрешённые профили учёта V1; новые сочетания — только отдельным решением. */
export type TrackingProfileId =
  | "REPS" | "LOAD_REPS" | "ADDED_LOAD_REPS" | "ASSISTANCE_REPS" | "DURATION"
  | "REPS_DURATION" | "DISTANCE_DURATION" | "LOAD_DISTANCE" | "LOAD_DURATION";

export const TRACKING_PROFILES: Readonly<Record<TrackingProfileId, readonly TrackingMetric[]>> = {
  REPS: ["reps"],
  LOAD_REPS: ["load", "reps"],
  ADDED_LOAD_REPS: ["addedLoad", "reps"],
  ASSISTANCE_REPS: ["assistance", "reps"],
  DURATION: ["duration"],
  REPS_DURATION: ["reps", "duration"],
  DISTANCE_DURATION: ["distance", "duration"],
  LOAD_DISTANCE: ["load", "distance"],
  LOAD_DURATION: ["load", "duration"],
};

export const TRACKING_PROFILE_IDS = Object.keys(TRACKING_PROFILES) as readonly TrackingProfileId[];

/** Группа мышц — обязательная категория упражнения, в том числе своего (§31.11, Feature 08). */
export type BodyPart = "chest" | "back" | "shoulders" | "upper_arms" | "lower_arms" | "core"
  | "upper_legs" | "lower_legs" | "full_body";

export const BODY_PARTS: readonly BodyPart[] = ["chest", "back", "shoulders", "upper_arms", "lower_arms", "core",
  "upper_legs", "lower_legs", "full_body"];

export type ExerciseOrigin = "SYSTEM" | "CUSTOM";

/** Изображения упражнения: начальное и пиковое положение либо одна поза. Пути — внутри источника. */
export interface ExerciseMedia {
  readonly start: string | null;
  readonly peak: string | null;
  readonly main: string | null;
}

/** Ссылка на запись внешнего источника: не является identity FitCoach (§29.2). */
export interface ExerciseSourceRef {
  readonly provider: "REPDB";
  readonly sourceId: string;
}

/**
 * ExerciseDefinition реестра FitCoach (§39.1, §39.7): системное и своё упражнение — одна сущность.
 * ID стабилен и не меняется при обновлении источника.
 */
export interface ExerciseDefinition {
  readonly id: string;
  readonly origin: ExerciseOrigin;
  /** Название по-русски; если перевода нет — английское. */
  readonly name: string;
  readonly nameEn: string | null;
  readonly bodyPart: BodyPart;
  readonly primaryMuscles: readonly string[];
  readonly secondaryMuscles: readonly string[];
  readonly equipment: string | null;
  readonly trackingProfile: TrackingProfileId;
  readonly mechanic: "compound" | "isolation" | null;
  readonly difficulty: "beginner" | "intermediate" | "advanced" | null;
  readonly unilateral: boolean;
  readonly variationGroup: string | null;
  readonly instructions: readonly string[];
  readonly tips: readonly string[];
  /** Язык техники и советов: русский перевод либо английский оригинал источника. */
  readonly textLanguage: "ru" | "en";
  readonly media: ExerciseMedia | null;
  readonly source: ExerciseSourceRef | null;
}

/** Сведения о версии системного набора: для проверки лицензии перед релизом (§29.4). */
export interface SystemCatalogMeta {
  readonly provider: "REPDB";
  readonly datasetName: string;
  readonly datasetSchemaVersion: number;
  readonly sourceSha256: string;
  readonly importedAt: string;
  readonly license: string;
  readonly attribution: string;
  readonly count: number;
  /** Упражнения без русского названия (показываются по-английски). */
  readonly missingRuNames: number;
}

export interface SystemCatalog {
  readonly meta: SystemCatalogMeta;
  readonly exercises: readonly ExerciseDefinition[];
}
