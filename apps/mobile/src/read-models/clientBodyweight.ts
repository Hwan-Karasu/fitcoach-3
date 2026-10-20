import type { DailyPoint, DailyPrimary, Measurement, MeasurementRepositoryPort, MeasurementType } from "../features/measurements/public.ts";

/** Правило владельца замеров — одно значение на день (§49.18); передаётся параметром, чтобы read-model не тянул экраны. */
export type DailyPointsRule = (measurements: readonly Measurement[], primaries: readonly DailyPrimary[], type: MeasurementType) => readonly DailyPoint[];

/**
 * Ряд массы тела клиента для статистики (§48.86.36): по одному достоверному значению на день, по возрастанию даты.
 * День с несколькими замерами без выбранного основного не входит — среднее и произвольное «последнее» запрещены (§49.18).
 */
export function createClientBodyweight(dailyPoints: DailyPointsRule,
  measurements: Pick<MeasurementRepositoryPort, "listForClient" | "subscribeCommittedChanges">) {
  return {
    async list(clientId: string): Promise<readonly Readonly<{ date: string; kg: number }>[]> {
      const { measurements: rows, primaries } = await measurements.listForClient(clientId);
      return dailyPoints(rows, primaries, "WEIGHT").flatMap((point) =>
        point.kind === "VALUE" ? [{ date: point.localDate, kg: point.measurement.valueX10 / 10 }] : []);
    },
    subscribe(clientId: string, listener: () => void): () => void {
      return measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) listener(); });
    },
  };
}

export type ClientBodyweightPort = ReturnType<typeof createClientBodyweight>;
