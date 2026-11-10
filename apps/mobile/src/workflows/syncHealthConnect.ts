import type { MeasurementRepositoryPort } from "../features/measurements/public.ts";
import type { HealthAvailability, HealthDayValue, HealthMetric } from "../features/health/public.ts";
import type { HealthConnectPort, HealthStorePort } from "../features/health/public.ts";
import type { NutritionCalcPort } from "../features/nutrition/public.ts";

/** Предел шагов суточной активности владельца Nutrition (CALC_STEPS_INVALID: 1…100 000): больше значение хранится в Health Connect-данных, но в шаги дня не подставляется. */
const CALC_STEPS_MAX = 100_000;
const FIRST_SYNC_DAYS = 90;
const RESYNC_DAYS = 7;

export type HealthSyncOutcome =
  | Readonly<{ kind: "SYNCED"; days: number; stepsDays: number; importedWeight: number; importedFat: number }>
  | Readonly<{ kind: "NOT_LINKED" }>
  | Readonly<{ kind: "UNAVAILABLE"; availability: Exclude<HealthAvailability, "AVAILABLE"> }>
  | Readonly<{ kind: "NO_PERMISSION" }>;

export interface HealthSyncPorts {
  readonly health: HealthStorePort;
  readonly platform: HealthConnectPort;
  readonly calc: Pick<NutritionCalcPort, "setSteps" | "clearSteps" | "listSteps">;
  readonly measurements: MeasurementRepositoryPort;
  /** Правило допустимых значений владельца health (подаётся композицией, как правила других владельцев). */
  readonly isValidHealthValue: (metric: HealthMetric, value: number) => boolean;
}

const addDays = (date: string, days: number): string => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days)).toISOString().slice(0, 10);

/**
 * Обновление данных Health Connect для привязанной карточки (UIX-16, ADR-059): чтение при открытии без фона. Порядок защищает от потерь и повторов:
 * сначала значения переносятся владельцам (шаги дня — Nutrition; вес и % жира — Measurements, только если за этот день там ничего нет и день Health Connect
 * видит впервые: ручной ввод главнее, удалённое тренером не возвращается), затем сохраняются дни и время синхронизации. Сбой на любом шаге оставляет операцию
 * повторяемой: уже перенесённое повторно не дублируется. Шаги подставляются всегда (у подключённой карточки ручного ввода шагов нет).
 */
export async function syncHealthConnect(ports: HealthSyncPorts, today: string, now: Date = new Date()): Promise<HealthSyncOutcome> {
  const link = await ports.health.getLink();
  if (link === null) return { kind: "NOT_LINKED" };
  const availability = await ports.platform.availability();
  if (availability !== "AVAILABLE") return { kind: "UNAVAILABLE", availability };
  const granted = await ports.platform.grantedMetrics();
  if (granted.length === 0) return { kind: "NO_PERMISSION" };

  const range = { from: addDays(today, link.lastSyncAt === null ? -(FIRST_SYNC_DAYS - 1) : -(RESYNC_DAYS - 1)), to: today };
  const values = (await ports.platform.readDaily(granted, range)).filter((entry) => entry.localDate >= range.from && entry.localDate <= range.to
    && granted.includes(entry.metric) && ports.isValidHealthValue(entry.metric, entry.value));
  // За время системного запроса карточка могла быть отключена или привязана заново; старый ответ не имеет права писать факты.
  const current = await ports.health.getLink();
  if (current === null || current.clientId !== link.clientId || current.linkedAt !== link.linkedAt) return { kind: "NOT_LINKED" };
  const read = [...new Map(values.map((entry) => [`${entry.localDate}|${entry.metric}`, entry])).values()];
  const known = new Map((await ports.health.listDaily(link.clientId, range.from, range.to)).map((entry) => [`${entry.localDate}|${entry.metric}`, entry.value]));

  let stepsDays = 0;
  const projectedSteps = new Map(read.some((entry) => entry.metric === "STEPS")
    ? (await ports.calc.listSteps(link.clientId, range.from, range.to)).map((entry) => [entry.localDate, entry.steps]) : []);
  for (const entry of read) {
    if (entry.metric !== "STEPS") continue;
    // Значение выше предела Nutrition не подставляется и не оставляет старую положительную проекцию. Нулевые шаги адаптер не отдаёт (день без данных), поэтому нуль не обрабатывается.
    if (entry.value > CALC_STEPS_MAX) {
      if (projectedSteps.has(entry.localDate)) {
        await ports.calc.clearSteps(link.clientId, entry.localDate);
        stepsDays += 1;
      }
      continue;
    }
    if (entry.value < 1) continue;
    if (projectedSteps.get(entry.localDate) === entry.value) continue;
    await ports.calc.setSteps(link.clientId, entry.localDate, entry.value, now);
    stepsDays += 1;
  }

  const importBody = async (metric: Extract<HealthMetric, "WEIGHT_X10" | "BODY_FAT_X10">, type: "WEIGHT" | "BODY_FAT"): Promise<number> => {
    const fresh = read.filter((entry: HealthDayValue) => entry.metric === metric && !known.has(`${entry.localDate}|${metric}`));
    if (fresh.length === 0) return 0;
    const journal = await ports.measurements.listForClient(link.clientId);
    // Любая запись этого вида за день (единственная, основная или несколько) — день занят: ручной ввод главнее.
    const taken = new Set(journal.measurements.filter((row) => row.type === type).map((row) => row.localDate));
    let imported = 0;
    for (const entry of fresh) {
      if (taken.has(entry.localDate)) continue;
      const saved = await ports.measurements.recordIfDayEmpty(link.clientId, { type, valueX10: entry.value, localDate: entry.localDate, localMinute: null }, now);
      taken.add(entry.localDate);
      if (saved !== null) imported += 1;
    }
    return imported;
  };
  const importedWeight = await importBody("WEIGHT_X10", "WEIGHT");
  const importedFat = await importBody("BODY_FAT_X10", "BODY_FAT");

  await ports.health.saveSync(link.clientId, read, granted, now);
  return { kind: "SYNCED", days: read.length, stepsDays, importedWeight, importedFat };
}
