import { runF04Probe, type F04ProbeReport } from "../diagnostics/runF04Probe.ts";
import { openExpoSqliteConnection } from "../../shared/db/ExpoSqliteConnection.ts";
import { DevClientRepository } from "../../features/clients/data/DevClientRepository.ts";
import type { ClientArchivePort, ClientChangePort, ClientRecoveryDraftPort, ClientRepositoryPort,
  ClientRosterPort } from "../../features/clients/public.ts";
import { BootCoordinator } from "../bootstrap/BootCoordinator.ts";
import { createDevBootDependencies, DEV_WORKSPACE_ID } from "../bootstrap/DevBootDependencies.ts";

type DevClientServices = ClientRepositoryPort & ClientRecoveryDraftPort & ClientRosterPort
  & ClientChangePort & ClientArchivePort;

/** Explicit dev composition. Production boot will get separate, owner-scoped bindings. */
export interface DevServices {
  readonly runSqliteProbe: () => Promise<F04ProbeReport>;
  readonly clients: DevClientServices;
}

export function createDevServices(clients: DevClientServices): DevServices {
  return {
    runSqliteProbe: () => runF04Probe(() => openExpoSqliteConnection("fitcoach_f04_probe.db")),
    clients,
  };
}

export interface DevRuntime {
  readonly boot: BootCoordinator;
  readonly services: DevServices;
}

export function createDevRuntime(): DevRuntime {
  const clients = new DevClientRepository(
    () => openExpoSqliteConnection("fitcoach_f04_clients_dev.db"), DEV_WORKSPACE_ID);
  return {
    boot: new BootCoordinator(createDevBootDependencies(
      () => openExpoSqliteConnection("fitcoach_f03_dev_gate.db"),
      () => clients.initialize(),
    )),
    services: createDevServices(clients),
  };
}
