/**
 * Health Connect (ADR-059, UIX-15…17): чтение шести видов данных для одной карточки «для себя». Данные приходят только из системы (никакой записи
 * в Health Connect), хранятся по дням и не удаляются при отключении.
 */
export const HEALTH_METRICS = ["STEPS", "SLEEP_MIN", "TOTAL_KCAL", "ACTIVE_KCAL", "WEIGHT_X10", "BODY_FAT_X10"] as const;
export type HealthMetric = typeof HEALTH_METRICS[number];

export const HEALTH_METRIC_LABELS: Readonly<Record<HealthMetric, string>> = {
  STEPS: "Шаги", SLEEP_MIN: "Сон", TOTAL_KCAL: "Общий расход", ACTIVE_KCAL: "Активный расход", WEIGHT_X10: "Вес", BODY_FAT_X10: "% жира",
};

/** Значение показателя за локальный день: шаги и ккал — целые, сон — минуты, вес и % жира — десятые доли. */
export interface HealthDayValue {
  readonly localDate: string;
  readonly metric: HealthMetric;
  readonly value: number;
}

/** Привязка Health Connect к одной карточке клиента. */
export interface HealthLink {
  readonly clientId: string;
  readonly linkedAt: string;
  /** `null` — ещё ни разу не синхронизировано. */
  readonly lastSyncAt: string | null;
  /** Виды данных, на которые на момент последней синхронизации было разрешение. */
  readonly grantedMetrics: readonly HealthMetric[];
}

/** Состояние самой службы на устройстве. */
export type HealthAvailability = "AVAILABLE" | "NOT_INSTALLED" | "UPDATE_REQUIRED" | "UNSUPPORTED";

export interface HealthRange {
  readonly from: string;
  readonly to: string;
}

export type HealthErrorCode = "HEALTH_ALREADY_LINKED" | "HEALTH_NOT_LINKED" | "HEALTH_VALUE_INVALID" | "HEALTH_UNAVAILABLE";

/** Допустимые значения (отсекают явный мусор из внешней системы): шаги до 200 000, сон до 24 часов, расход до 20 000 ккал, вес 20–400 кг, жир 2–75 %. */
export function isValidHealthValue(metric: HealthMetric, value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0) return false;
  switch (metric) {
    case "STEPS": return value <= 200_000;
    case "SLEEP_MIN": return value <= 24 * 60;
    case "TOTAL_KCAL": case "ACTIVE_KCAL": return value <= 20_000;
    case "WEIGHT_X10": return value >= 200 && value <= 4000;
    case "BODY_FAT_X10": return value >= 20 && value <= 750;
  }
}
