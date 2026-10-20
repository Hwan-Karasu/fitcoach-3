import type { ClientAccountingSnapshot } from "../features/accounting/public.ts";
import type { ClientHomeSummary, HomeMetric, HomePackSummary } from "../features/clients/public.ts";
import type { ClientMeasurements, DailyPoint, MeasurementType } from "../features/measurements/public.ts";

/** Owners' pure rules, injected so this projection stays type-only towards feature public APIs. */
export interface HomeSummaryRules {
  readonly latestPoint: (measurements: ClientMeasurements["measurements"], primaries: ClientMeasurements["primaries"],
    type: MeasurementType) => DailyPoint | null;
  readonly formatValue: (valueX10: number, type: MeasurementType) => string;
  readonly formatKopeks: (kopeks: number) => string;
  readonly pricePerSessionKopeks: (totalKopeks: number, sessions: number) => number;
}

/** «Подходит к концу» threshold, taken from the build120 reference; not a new product rule. */
const LOW_CREDITS = 2;

function shortDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

function metric(rules: HomeSummaryRules, label: string, data: ClientMeasurements | null,
  type: MeasurementType): HomeMetric {
  if (data === null) return { label, value: null };
  const point = rules.latestPoint(data.measurements, data.primaries, type);
  if (point === null) return { label, value: null };
  if (point.kind === "AMBIGUOUS") return { label, value: null, status: `${shortDate(point.localDate)}: выберите основной` };
  const [value, unit] = rules.formatValue(point.measurement.valueX10, type).split(" ");
  return { label, value: value ?? null, unit, status: `от ${shortDate(point.localDate)}` };
}

/** Only packs usable today count; the ledger owner already derived each balance. */
export function packSummary(rules: HomeSummaryRules, snapshot: ClientAccountingSnapshot | null, today: string): HomePackSummary {
  if (snapshot === null) return { kind: "UNAVAILABLE" };
  if (snapshot.mode === "UNTRACKED") return { kind: "NOT_TRACKED", label: "Учёт тренировок не ведётся" };
  if (snapshot.mode === "EXTERNAL") return { kind: "NOT_TRACKED", label: "Учёт ведётся вне FitCoach" };
  if (snapshot.packs.length === 0) return { kind: "NO_PACK" };
  const usable = snapshot.packs.filter((row) => row.pack.expiresOn === null || row.pack.expiresOn >= today);
  const available = usable.reduce((sum, row) => sum + Math.max(row.available, 0), 0);
  const reserved = usable.reduce((sum, row) => sum + row.reserved, 0);
  const granted = usable.reduce((sum, row) => sum + row.pack.grantedCount, 0);
  // The pack that serves next: the nearest expiry, then the oldest (§22.1.2 order without the type split).
  const next = usable.filter((row) => row.available > 0).sort((a, b) =>
    (a.pack.expiresOn ?? "9999-12-31").localeCompare(b.pack.expiresOn ?? "9999-12-31")
      || a.pack.createdAt.localeCompare(b.pack.createdAt))[0];
  const price = next !== undefined && next.pack.totalKopeks > 0
    ? rules.formatKopeks(rules.pricePerSessionKopeks(next.pack.totalKopeks, next.pack.grantedCount)) : null;
  return {
    kind: "TRACKED", available, granted, reserved,
    tone: available === 0 ? "empty" : available <= LOW_CREDITS ? "warning" : "active",
    pricePerSession: price, expiresOn: next?.pack.expiresOn ?? null,
  };
}

/** Projection of Measurements and SessionAccounting facts; a failed source stays «нет данных». */
export function buildClientHomeSummary(rules: HomeSummaryRules, accounting: ClientAccountingSnapshot | null,
  measurements: ClientMeasurements | null, today: string): ClientHomeSummary {
  return {
    metrics: [
      metric(rules, "Вес", measurements, "WEIGHT"),
      metric(rules, "% жира", measurements, "BODY_FAT"),
      // Workouts per week need the Training diary (T03); until then the tile honestly stays empty.
      { label: "Трен./нед.", value: null, status: "нет дневника" },
    ],
    pack: packSummary(rules, accounting, today),
  };
}
