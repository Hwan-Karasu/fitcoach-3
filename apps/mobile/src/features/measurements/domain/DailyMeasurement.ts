import type { Measurement, MeasurementInput } from "./MeasurementModel.ts";
import type { MeasurementRepositoryPort } from "./MeasurementRepositoryPort.ts";
import { dailyPoints } from "./MeasurementRules.ts";

/**
 * Дневное значение показателя (главная клиента, «Расчёт»): за дату нет записи — новая; есть одна — исправляется на месте (тот же факт и время), чтобы день не стал неоднозначным
 * (§49.15, §49.18); несколько записей без выбранной основной — `MEASUREMENT_AMBIGUOUS_DAY`, значение молча не выбирается.
 */
export async function upsertDailyMeasurement(repository: MeasurementRepositoryPort, clientId: string, input: MeasurementInput, now: Date = new Date()): Promise<Measurement> {
  const journal = await repository.listForClient(clientId);
  const point = dailyPoints(journal.measurements, journal.primaries, input.type).find((candidate) => candidate.localDate === input.localDate);
  if (point === undefined) return repository.record(clientId, input, now);
  if (point.kind === "VALUE") return repository.correct(point.measurement.id, point.measurement.revision, { ...input, localMinute: point.measurement.localMinute }, now);
  throw new Error("MEASUREMENT_AMBIGUOUS_DAY");
}
