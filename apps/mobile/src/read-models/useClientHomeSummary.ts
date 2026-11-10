import { useEffect, useMemo, useState } from "react";
import type { AccountingRepositoryPort, ClientAccountingSnapshot } from "../features/accounting/public.ts";
import type { ClientHomeSummary } from "../features/clients/public.ts";
import { buildClientHomeSummary, type HomeSummaryRules } from "./clientHomeSummary.ts";

type AccountingSource = Pick<AccountingRepositoryPort, "getClientSnapshot" | "subscribeCommittedChanges">;

/** Прежний снимок сохраняется только в рамках того же клиента/источника; дата меняет проекцию без чтения БД. */
export function useClientHomeSummary(clientId: string, accounting: AccountingSource, today: string, rules: HomeSummaryRules): ClientHomeSummary | null {
  const [loaded, setLoaded] = useState<Readonly<{ clientId: string; source: AccountingSource; ledger: ClientAccountingSnapshot | null }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => accounting.getClientSnapshot(clientId)).catch(() => null).then((ledger) => {
      if (active) setLoaded({ clientId, source: accounting, ledger });
    });
    return () => { active = false; };
  }, [accounting, clientId, tick]);
  useEffect(() => accounting.subscribeCommittedChanges((change) => {
    if (change.clientIds === "ALL" || change.clientIds.includes(clientId)) setTick((value) => value + 1);
  }), [accounting, clientId]);
  return useMemo(() => loaded?.clientId === clientId && loaded.source === accounting
    ? buildClientHomeSummary(rules, loaded.ledger, today) : null, [accounting, clientId, loaded, rules, today]);
}
