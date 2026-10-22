import { useEffect, useRef, useState } from "react";
import { formatKopeks, pricePerSessionKopeks, type AccountingRepositoryPort } from "../features/accounting/public.ts";
import type { ClientHomeSummary } from "../features/clients/public.ts";
import { localDateOf } from "../features/measurements/public.ts";
import { buildClientHomeSummary, type HomeSummaryRules } from "./clientHomeSummary.ts";

/** Чистые правила владельцев для проекций Главной и списка клиентов. */
export const homeSummaryRules: HomeSummaryRules = { formatKopeks, pricePerSessionKopeks };

/**
 * Home reads owners' public ports and refreshes only on their committed changes for this client;
 * the last valid snapshot stays on screen while a refresh runs (Feature 16 §5).
 */
export function useClientHomeSummary(clientId: string, accounting: AccountingRepositoryPort): ClientHomeSummary | null {
  const [summary, setSummary] = useState<ClientHomeSummary | null>(null);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    const safe = <T>(load: () => Promise<T>) => Promise.resolve().then(load).catch(() => null);
    void safe(() => accounting.getClientSnapshot(clientId)).then((ledger) => {
      if (request === generation.current) setSummary(buildClientHomeSummary(homeSummaryRules, ledger, localDateOf(new Date())));
    });
  }, [accounting, clientId, tick]);

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    return accounting.subscribeCommittedChanges((change) => {
      if (change.clientIds === "ALL" || change.clientIds.includes(clientId)) refresh();
    });
  }, [accounting, clientId]);

  return summary;
}
