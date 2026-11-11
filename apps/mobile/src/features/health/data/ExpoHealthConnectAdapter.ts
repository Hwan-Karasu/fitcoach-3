import { aggregateGroupByPeriod, getGrantedPermissions, getSdkStatus, initialize, openHealthConnectSettings, readRecords, requestPermission,
  SdkAvailabilityStatus, type Permission } from "react-native-health-connect";
import type { HealthAvailability, HealthDayValue, HealthMetric, HealthRange } from "../domain/HealthModel.ts";
import { HEALTH_METRICS } from "../domain/HealthModel.ts";
import type { HealthConnectPort } from "../domain/HealthPorts.ts";
import { lastValuePerDay, readHealthPages, sleepMinutesByWakeDate, toHundredths, toTenths, type SleepSessionInput } from "../domain/HealthRules.ts";

type ReadType = "Steps" | "SleepSession" | "TotalCaloriesBurned" | "ActiveCaloriesBurned" | "Weight" | "BodyFat";
const RECORD_OF: Readonly<Record<HealthMetric, ReadType>> = {
  STEPS: "Steps", SLEEP_MIN: "SleepSession", TOTAL_KCAL: "TotalCaloriesBurned", ACTIVE_KCAL: "ActiveCaloriesBurned", WEIGHT_X100: "Weight", BODY_FAT_X10: "BodyFat",
};

const pad = (value: number) => String(value).padStart(2, "0");
/** Локальная дата устройства (`YYYY-MM-DD`) для момента времени. */
const localDate = (instant: string | Date): string => {
  const at = typeof instant === "string" ? new Date(instant) : instant;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};
/** Локальная полночь даты как момент ISO. */
const midnight = (date: string): Date => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const dayAfter = (date: string): string => localDate(new Date(midnight(date).getTime() + 36 * 3_600_000));

/**
 * Health Connect на устройстве (ADR-059): только чтение, шесть видов данных. Проверяется на устройстве (APK, не Expo Go): узкие места — совместимость библиотеки
 * с Expo SDK 57 и формат агрегатов. Домен получает уже разобранные дневные значения; всё, что можно проверить без устройства, вынесено в `HealthRules`.
 */
export class ExpoHealthConnectAdapter implements HealthConnectPort {
  private initialized = false;

  private async ensure(): Promise<boolean> {
    if (!this.initialized) this.initialized = await initialize().catch(() => false);
    return this.initialized;
  }

  async availability(): Promise<HealthAvailability> {
    let status: number;
    try { status = await getSdkStatus(); } catch { return "UNSUPPORTED"; }
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return (await this.ensure()) ? "AVAILABLE" : "UNSUPPORTED";
    return status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ? "UPDATE_REQUIRED" : "NOT_INSTALLED";
  }

  async grantedMetrics(): Promise<readonly HealthMetric[]> {
    if (!(await this.ensure())) return [];
    const granted = await getGrantedPermissions();
    return HEALTH_METRICS.filter((metric) => granted.some((permission) => permission.accessType === "read" && permission.recordType === RECORD_OF[metric]));
  }

  async requestPermissions(): Promise<readonly HealthMetric[]> {
    if (!(await this.ensure())) return [];
    const wanted: Permission[] = HEALTH_METRICS.map((metric) => ({ accessType: "read", recordType: RECORD_OF[metric] }));
    await requestPermission([...wanted, { accessType: "read", recordType: "ReadHealthDataHistory" }]);
    return this.grantedMetrics();
  }

  async readDaily(metrics: readonly HealthMetric[], range: HealthRange): Promise<readonly HealthDayValue[]> {
    if (!(await this.ensure())) return [];
    const start = midnight(range.from).toISOString();
    const end = midnight(dayAfter(range.to)).toISOString();
    const result: HealthDayValue[] = [];
    const inRange = (date: string) => date >= range.from && date <= range.to;

    // Срезы по календарным дням (Period, а не 24-часовой Duration): в день перевода часов сутки не сдвигаются.
    const totals = async (metric: "STEPS" | "TOTAL_KCAL" | "ACTIVE_KCAL") => {
      const groups = metric === "STEPS"
        ? (await aggregateGroupByPeriod({ recordType: "Steps", timeRangeFilter: { operator: "between", startTime: start, endTime: end }, timeRangeSlicer: { period: "DAYS", length: 1 } })).map((group) => ({ at: group.startTime, value: group.result.COUNT_TOTAL }))
        : metric === "TOTAL_KCAL"
          ? (await aggregateGroupByPeriod({ recordType: "TotalCaloriesBurned", timeRangeFilter: { operator: "between", startTime: start, endTime: end }, timeRangeSlicer: { period: "DAYS", length: 1 } })).map((group) => ({ at: group.startTime, value: group.result.ENERGY_TOTAL.inKilocalories }))
          : (await aggregateGroupByPeriod({ recordType: "ActiveCaloriesBurned", timeRangeFilter: { operator: "between", startTime: start, endTime: end }, timeRangeSlicer: { period: "DAYS", length: 1 } })).map((group) => ({ at: group.startTime, value: group.result.ACTIVE_CALORIES_TOTAL.inKilocalories }));
      for (const group of groups) {
        const date = localDate(group.at);
        if (inRange(date) && Number.isFinite(group.value) && group.value > 0) result.push({ localDate: date, metric, value: Math.round(group.value) });
      }
    };

    /** Все страницы записей вида за интервал; неполный/зациклившийся ответ не выдаётся за успешное чтение. */
    const readAll = async <T extends "SleepSession" | "Weight" | "BodyFat">(type: T, from: string) => {
      return readHealthPages<Awaited<ReturnType<typeof readRecords<T>>>["records"][number]>((pageToken) =>
        readRecords(type, { timeRangeFilter: { operator: "between", startTime: from, endTime: end }, pageSize: 500, ...(pageToken === undefined ? {} : { pageToken }) }));
    };

    for (const metric of metrics) {
      if (metric === "STEPS" || metric === "TOTAL_KCAL" || metric === "ACTIVE_KCAL") await totals(metric);
      else if (metric === "SLEEP_MIN") {
        // Ночь, закончившаяся утром первого дня интервала, начинается раньше: читаем на сутки назад.
        const sessions: SleepSessionInput[] = (await readAll("SleepSession", new Date(midnight(range.from).getTime() - 24 * 3_600_000).toISOString()))
          .map((record) => ({ startTime: record.startTime, endTime: record.endTime, ...(record.stages === undefined ? {} : { stages: record.stages }) }));
        for (const [date, minutes] of sleepMinutesByWakeDate(sessions, (instant) => localDate(instant))) if (inRange(date)) result.push({ localDate: date, metric, value: minutes });
      } else if (metric === "WEIGHT_X100") {
        const days = lastValuePerDay((await readAll("Weight", start)).map((record) => ({ time: record.time, value: record.weight.inKilograms })), (instant) => localDate(instant));
        for (const [date, kg] of days) if (inRange(date)) result.push({ localDate: date, metric, value: toHundredths(kg) });
      } else {
        const days = lastValuePerDay((await readAll("BodyFat", start)).map((record) => ({ time: record.time, value: record.percentage })), (instant) => localDate(instant));
        for (const [date, percent] of days) if (inRange(date)) result.push({ localDate: date, metric, value: toTenths(percent) });
      }
    }
    return result;
  }

  openSettings(): void { openHealthConnectSettings(); }
}
