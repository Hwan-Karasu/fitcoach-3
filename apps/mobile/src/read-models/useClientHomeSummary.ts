import { useEffect, useRef, useState } from "react";
import { formatKopeks, pricePerSessionKopeks, type AccountingRepositoryPort } from "../features/accounting/public.ts";
import type { ClientHomeSummary } from "../features/clients/public.ts";
import { formatValue, latestPoint, localDateOf, type MeasurementRepositoryPort } from
  "../features/measurements/public.ts";
import { buildClientHomeSummary, type HomeSummaryRules } from "./clientHomeSummary.ts";

/** Чистые правила владельцев для проекций Главной и списка клиентов. */
export const homeSummaryRules: HomeSummaryRules = { latestPoint, formatValue, formatKopeks, pricePerSessionKopeks };

/**
 * Home reads owners' public ports and refreshes only on their committed changes for this client;
 * the last valid snapshot stays on screen while a refresh runs (Feature 16 §5).
 */
export function useClientHomeSummary(clientId: string, accounting: AccountingRepositoryPort,
  measurements: MeasurementRepositoryPort): ClientHomeSummary | null {
  const [summary, setSummary] = useState<ClientHomeSummary | null>(null);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    const safe = <T>(load: () => Promise<T>) => Promise.resolve().then(load).catch(() => null);
    void Promise.all([
      safe(() => accounting.getClientSnapshot(clientId)),
      safe(() => measurements.listForClient(clientId)),
    ]).then(([ledger, journal]) => {
      if (request === generation.current) setSummary(buildClientHomeSummary(homeSummaryRules, ledger, journal, localDateOf(new Date())));
    });
  }, [accounting, clientId, measurements, tick]);

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offAccounting = accounting.subscribeCommittedChanges((change) => {
      if (change.clientIds === "ALL" || change.clientIds.includes(clientId)) refresh();
    });
    const offMeasurements = measurements.subscribeCommittedChanges((change) => {
      if (change.clientId === clientId) refresh();
    });
    return () => { offAccounting(); offMeasurements(); };
  }, [accounting, clientId, measurements]);

  return summary;
}
