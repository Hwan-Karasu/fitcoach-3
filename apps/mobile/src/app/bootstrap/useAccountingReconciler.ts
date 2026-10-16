import { useEffect } from "react";
import { AppState } from "react-native";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";

/**
 * §48.35.3: settle ended appointments on start, on every resume and once a minute while open.
 * Reconciliation is idempotent, so overlapping triggers never create a second USED.
 */
export function useAccountingReconciler(accounting: AccountingRepositoryPort): void {
  useEffect(() => {
    let running = false;
    const run = () => {
      if (running) return;
      running = true;
      void accounting.reconcileDue(new Date()).catch(() => undefined)
        .finally(() => { running = false; });
    };
    run();
    const timer = setInterval(run, 60_000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") run(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [accounting]);
}
