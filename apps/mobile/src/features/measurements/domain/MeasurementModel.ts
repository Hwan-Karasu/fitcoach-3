/** §49.14 П9: the fixed V1 set — body mass, body fat and eight circumferences; no custom types. */
export const MEASUREMENT_TYPES = ["WEIGHT", "BODY_FAT", "NECK", "SHOULDERS", "CHEST", "WAIST", "HIPS", "ARM",
  "THIGH", "CALF"] as const;
export type MeasurementType = typeof MEASUREMENT_TYPES[number];

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
