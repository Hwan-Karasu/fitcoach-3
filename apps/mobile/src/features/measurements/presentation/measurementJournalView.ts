import type { ClientMeasurements, Measurement, MeasurementType } from "../domain/MeasurementModel.ts";
import { addDays, compareJournal, dailyPoints } from "../domain/MeasurementRules.ts";

export type JournalPeriod = "30" | "90" | "365" | "ALL";

/** Filter facts without averaging ambiguous days or substituting an older current value. */
export function measurementJournalView(data: ClientMeasurements, type: MeasurementType | "ALL", period: JournalPeriod, today: string) {
  const start = period === "ALL" ? null : addDays(today, 1 - Number(period));
  const rows = data.measurements.filter((row) => (type === "ALL" || row.type === type)
    && (start === null || row.localDate >= start) && row.localDate <= today).sort(compareJournal);
  const grouped = new Map<string, Measurement[]>();
  for (const row of rows) grouped.set(row.localDate, [...(grouped.get(row.localDate) ?? []), row]);
  const points = type === "ALL" ? [] : dailyPoints(rows, data.primaries, type);
  const latest = points.at(-1) ?? null;
  const first = points[0];
  const changeX10 = latest?.kind === "VALUE" && first?.kind === "VALUE" && first.localDate !== latest.localDate
    ? latest.measurement.valueX10 - first.measurement.valueX10 : null;
  return { rows, days: [...grouped.entries()], points, latest, changeX10,
    ambiguousCount: points.filter((point) => point.kind === "AMBIGUOUS").length };
}
