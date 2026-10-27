import { useEffect, useState } from "react";
import type { BootCoordinator } from "./BootCoordinator.ts";
import type { RuntimeMaintenance } from "../runtime/RuntimeMaintenance.ts";

/** Keep repository remounts separate from the screen opened after maintenance. */
export function useMaintenanceView(boot: Pick<BootCoordinator, "state">,
  maintenance: Pick<RuntimeMaintenance, "state" | "subscribe">) {
  const [view, setView] = useState({ phase: maintenance.state, generation: 0, initialBackup: false });
  useEffect(() => maintenance.subscribe((phase) => {
    // Capture readiness at notification time: boot may finish before React applies this update.
    const startedInApp = phase === "DRAINING" && boot.state.kind === "APP_READY";
    setView((before) => ({ phase,
      generation: before.generation + (phase === "DRAINING" && before.phase === "ACTIVE" ? 1 : 0),
      initialBackup: before.initialBackup || (startedInApp && before.phase === "ACTIVE"),
    }));
  }), [boot, maintenance]);
  return view;
}
