import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import type { Appointment, CalendarRepositoryPort } from "../../features/calendar/public.ts";

export interface AppointmentOutcomeQueue {
  readonly items: readonly Appointment[];
  readonly visible: boolean;
  /** «Позже»: hide until the next resume; nothing is resolved or charged again. */
  readonly later: () => void;
}

/**
 * §48.35.3: on start, on every resume and once a minute while open, settle ended reservations
 * idempotently first, then surface every ended appointment without an outcome. Works without
 * Android notification permission; a dismissed card comes back on the next resume.
 */
export function useAppointmentOutcomeQueue(calendar: CalendarRepositoryPort,
  accounting: AccountingRepositoryPort): AppointmentOutcomeQueue {
  const [items, setItems] = useState<readonly Appointment[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const generation = useRef(0);

  const reload = useCallback(() => {
    const request = ++generation.current;
    void Promise.resolve().then(() => calendar.listPendingOutcomes(new Date())).then((rows) => {
      if (request === generation.current) setItems(rows);
    }, () => undefined);
  }, [calendar]);

  useEffect(() => {
    let running = false;
    const run = () => {
      if (running) return;
      running = true;
      void accounting.reconcileDue(new Date()).catch(() => undefined)
        .finally(() => { running = false; reload(); });
    };
    run();
    const timer = setInterval(run, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setDismissed(new Set());
      run();
    });
    const unsubscribe = calendar.subscribeCommittedChanges(reload);
    return () => { clearInterval(timer); subscription.remove(); unsubscribe(); };
  }, [accounting, calendar, reload]);

  const later = useCallback(() => {
    setDismissed(new Set(items.map((row) => row.id)));
  }, [items]);

  return { items, visible: items.some((row) => !dismissed.has(row.id)), later };
}
