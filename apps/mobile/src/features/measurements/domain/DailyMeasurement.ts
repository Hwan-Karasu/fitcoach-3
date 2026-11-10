import type { Measurement, MeasurementInput } from "./MeasurementModel.ts";
import type { MeasurementRepositoryPort } from "./MeasurementRepositoryPort.ts";

/**
 * Дневное значение показателя (главная клиента, «Расчёт»): за дату нет записи — новая; есть одна — исправляется на месте (тот же факт и время), чтобы день не стал неоднозначным
 * (§49.15, §49.18); несколько записей без выбранной основной — `MEASUREMENT_AMBIGUOUS_DAY`, значение молча не выбирается.
 */
export async function upsertDailyMeasurement(repository: MeasurementRepositoryPort, clientId: string, input: MeasurementInput, now: Date = new Date()): Promise<Measurement> {
  return repository.upsertDaily(clientId, input, now);
}
