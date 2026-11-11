import { isLocalDate } from "../../../shared/domain/LocalDate.ts";
import { formatDecimal } from "../../../shared/format/decimalX100.ts";
import { MEASUREMENT_TYPES, type DailyPoint, type DailyPrimary, type Measurement, type MeasurementInput,
  type MeasurementType } from "./MeasurementModel.ts";

export type MeasurementRuleError =
  | "MEASUREMENT_TYPE_INVALID"
  | "MEASUREMENT_VALUE_INVALID"
  | "MEASUREMENT_DATE_INVALID"
  | "MEASUREMENT_TIME_INVALID"
  | "MEASUREMENT_METHOD_INVALID";

function fail(code: MeasurementRuleError): never { throw new Error(code); }

interface TypeInfo {
  readonly label: string;
  readonly unit: "кг" | "%" | "см";
  /** Plausible bounds in hundredths; a typo like 801 kg is refused, not stored. */
  readonly minX100: number;
  readonly maxX100: number;
  /** Точность значения в сотых: 1 — до 0,01 (масса тела), 10 — до 0,1 (остальное). Значение должно быть кратно шагу. */
  readonly step: 1 | 10;
}

const circumference = (label: string): TypeInfo => ({ label, unit: "см", minX100: 1000, maxX100: 25000, step: 10 });

export const measurementTypeInfo: Readonly<Record<MeasurementType, TypeInfo>> = {
  WEIGHT: { label: "Масса тела", unit: "кг", minX100: 2000, maxX100: 40000, step: 1 },
  BODY_FAT: { label: "Процент жира", unit: "%", minX100: 200, maxX100: 7500, step: 10 },
  NECK: circumference("Шея"),
  SHOULDERS: circumference("Плечи"),
  CHEST: circumference("Грудь"),
  WAIST: circumference("Талия"),
  HIPS: circumference("Бёдра"),
  ARM: circumference("Рука"),
  THIGH: circumference("Бедро"),
  CALF: circumference("Икра"),
  ABDOMEN: circumference("Живот"),
  ARM_L: circumference("Плечо, левое"),
  ARM_R: circumference("Плечо, правое"),
  FOREARM_L: circumference("Предплечье, левое"),
  FOREARM_R: circumference("Предплечье, правое"),
  THIGH_L: circumference("Бедро, левое"),
  THIGH_R: circumference("Бедро, правое"),
  CALF_L: circumference("Голень, левая"),
  CALF_R: circumference("Голень, правая"),
};

/** Сколько знаков после запятой допускает тип: масса тела — два, остальное — один. */
export const decimalsOf = (type: MeasurementType): 1 | 2 => (measurementTypeInfo[type].step === 1 ? 2 : 1);

/**
 * «88,35», «88.35», «88,4», «88» → 8835 / 8840 / 8800 (сотые); пусто или больше допустимого числа знаков (у массы тела два, у остального один) → null
 * (неизвестное не превращается в ноль).
 */
export function parseValue(text: string, type: MeasurementType): number | null {
  const normalized = text.trim().replace(/\s+/gu, "").replace(",", ".");
  const pattern = decimalsOf(type) === 2 ? /^\d{1,4}(\.\d{1,2})?$/u : /^\d{1,4}(\.\d)?$/u;
  if (!pattern.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".") as [string, string?];
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export { formatDecimal };

export function formatValue(valueX100: number, type: MeasurementType): string {
  return `${formatDecimal(valueX100)} ${measurementTypeInfo[type].unit}`;
}

/** «08:05» → 485; empty → null (only the date is known). */
export function parseTime(text: string): number | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  const match = /^(\d{1,2})[:.](\d{2})$/u.exec(value);
  if (match === null) return "invalid";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : "invalid";
}

export function formatTime(minute: number | null): string {
  if (minute === null) return "время не указано";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export { isLocalDate };

export function localDateOf(at: Date): string {
  return `${String(at.getFullYear()).padStart(4, "0")}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  if (!isLocalDate(date)) fail("MEASUREMENT_DATE_INVALID");
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

const monthGenitive = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
  "сентября", "октября", "ноября", "декабря"] as const;

export function formatDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${monthGenitive[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** A fact cannot be measured in the future; the bounds keep obvious typos out of history. */
export function validateMeasurement(input: MeasurementInput, now: Date): MeasurementInput {
  if (!(MEASUREMENT_TYPES as readonly string[]).includes(input.type)) fail("MEASUREMENT_TYPE_INVALID");
  const info = measurementTypeInfo[input.type];
  if (!Number.isSafeInteger(input.valueX100) || input.valueX100 < info.minX100 || input.valueX100 > info.maxX100 || input.valueX100 % info.step !== 0) {
    fail("MEASUREMENT_VALUE_INVALID");
  }
  if (!isLocalDate(input.localDate) || input.localDate > localDateOf(now)) fail("MEASUREMENT_DATE_INVALID");
  if (input.localMinute !== null && (!Number.isSafeInteger(input.localMinute)
    || input.localMinute < 0 || input.localMinute > 1439)) fail("MEASUREMENT_TIME_INVALID");
  if (input.method !== undefined && input.method !== "MANUAL" && !(input.method === "VISUAL_ESTIMATE" && input.type === "BODY_FAT")) {
    fail("MEASUREMENT_METHOD_INVALID");
  }
  return input;
}

/** Journal order: newest date first; timed entries by time, date-only entries after them. */
export function compareJournal(a: Measurement, b: Measurement): number {
  if (a.localDate !== b.localDate) return a.localDate < b.localDate ? 1 : -1;
  if (a.localMinute !== b.localMinute) {
    if (a.localMinute === null) return 1;
    if (b.localMinute === null) return -1;
    return b.localMinute - a.localMinute;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * §49.18 П12: per `type + date`, the chosen primary; else the single entry; else AMBIGUOUS with all
 * candidates — never an average and never an arbitrary «last». Oldest date first, for graphs.
 */
export function dailyPoints(measurements: readonly Measurement[], primaries: readonly DailyPrimary[],
  type: MeasurementType): readonly DailyPoint[] {
  const byDate = new Map<string, Measurement[]>();
  for (const row of measurements) {
    if (row.type !== type) continue;
    byDate.set(row.localDate, [...(byDate.get(row.localDate) ?? []), row]);
  }
  return [...byDate.keys()].sort().map((localDate): DailyPoint => {
    const candidates = [...(byDate.get(localDate) ?? [])].sort(compareJournal);
    const chosenId = primaries.find((entry) => entry.type === type && entry.localDate === localDate)?.measurementId;
    const chosen = candidates.find((row) => row.id === chosenId);
    if (chosen !== undefined) return { kind: "VALUE", type, localDate, measurement: chosen, chosen: true };
    const [only] = candidates;
    if (candidates.length === 1 && only !== undefined) {
      return { kind: "VALUE", type, localDate, measurement: only, chosen: false };
    }
    return { kind: "AMBIGUOUS", type, localDate, candidates };
  });
}

/** Current value = the latest daily point; null means «нет данных», not zero. */
export function latestPoint(measurements: readonly Measurement[], primaries: readonly DailyPrimary[],
  type: MeasurementType): DailyPoint | null {
  const points = dailyPoints(measurements, primaries, type);
  return points[points.length - 1] ?? null;
}
