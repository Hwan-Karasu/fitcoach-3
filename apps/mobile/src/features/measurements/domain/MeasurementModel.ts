/** §49.14 П9: the fixed V1 set — body mass, body fat and eight circumferences; no custom types. */
export const MEASUREMENT_TYPES = ["WEIGHT", "BODY_FAT", "NECK", "SHOULDERS", "CHEST", "WAIST", "HIPS", "ARM",
  "THIGH", "CALF", "ABDOMEN", "ARM_L", "ARM_R", "FOREARM_L", "FOREARM_R", "THIGH_L", "THIGH_R", "CALF_L", "CALF_R"] as const;
export type MeasurementType = typeof MEASUREMENT_TYPES[number];

/**
 * Группа обхватов для карточки «Замеры» (UX v1.1, NUT-FS-07…12). Сторона — часть типа (`ARM_L`, `ARM_R`): так левая и правая — независимые ряды со своими основными значениями дня.
 * `legacy` — прежний односторонний тип («Рука», «Бедро», «Икра»): его старые значения остаются «без указания стороны» и не копируются в Л/П.
 */
export interface MeasurementGroup {
  readonly id: string;
  readonly label: string;
  /** Односторонний показатель. */
  readonly single?: MeasurementType;
  readonly left?: MeasurementType;
  readonly right?: MeasurementType;
  readonly legacy?: MeasurementType;
}

export const MEASUREMENT_GROUPS: readonly MeasurementGroup[] = [
  { id: "NECK", label: "Шея", single: "NECK" }, { id: "SHOULDERS", label: "Плечи", single: "SHOULDERS" }, { id: "CHEST", label: "Грудь", single: "CHEST" },
  { id: "WAIST", label: "Талия", single: "WAIST" }, { id: "ABDOMEN", label: "Живот", single: "ABDOMEN" }, { id: "HIPS", label: "Бёдра", single: "HIPS" },
  { id: "BICEPS", label: "Плечо", left: "ARM_L", right: "ARM_R", legacy: "ARM" }, { id: "FOREARM", label: "Предплечье", left: "FOREARM_L", right: "FOREARM_R" },
  { id: "THIGH", label: "Бедро", left: "THIGH_L", right: "THIGH_R", legacy: "THIGH" }, { id: "CALF", label: "Голень", left: "CALF_L", right: "CALF_R", legacy: "CALF" },
];

/** Provenance: a manual entry or a saved US Navy estimate (§49.16), never mixed silently. */
export type MeasurementMethod = "MANUAL" | "NAVY_ESTIMATE";

/**
 * One observation with a stable ID (§49.15). Values are tenths (80,1 kg → 801) so no float drift;
 * `localMinute` is null when only the date is known — no invented time.
 */
export interface Measurement {
  readonly id: string;
  readonly clientId: string;
  readonly type: MeasurementType;
  readonly valueX10: number;
  readonly localDate: string;
  readonly localMinute: number | null;
  readonly method: MeasurementMethod;
  readonly revision: number;
}

export interface MeasurementInput {
  readonly type: MeasurementType;
  readonly valueX10: number;
  readonly localDate: string;
  readonly localMinute: number | null;
}

/** The trainer's explicit choice for one `clientId + type + localDate` (§49.18 П12). */
export interface DailyPrimary {
  readonly type: MeasurementType;
  readonly localDate: string;
  readonly measurementId: string;
}

export interface ClientMeasurements {
  readonly measurements: readonly Measurement[];
  readonly primaries: readonly DailyPrimary[];
}

/** A daily graph point: a value, or several entries waiting for a primary choice; never an average. */
export type DailyPoint =
  | Readonly<{ kind: "VALUE"; type: MeasurementType; localDate: string; measurement: Measurement; chosen: boolean }>
  | Readonly<{ kind: "AMBIGUOUS"; type: MeasurementType; localDate: string; candidates: readonly Measurement[] }>;
