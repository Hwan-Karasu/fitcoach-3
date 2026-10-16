import { runF04Probe, type F04ProbeReport } from "../diagnostics/runF04Probe.ts";
import { openExpoSqliteConnection } from "../../shared/db/ExpoSqliteConnection.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { DevCalendarRepository, devCalendarClientDeletionParticipant } from
  "../../features/calendar/data/DevCalendarRepository.ts";
import type { CalendarParticipantDirectoryPort, CalendarRepositoryPort } from
  "../../features/calendar/public.ts";
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
  readonly calendar: CalendarRepositoryPort;
  readonly calendarParticipants: CalendarParticipantDirectoryPort;
}

/** Clients serve only identity/display fields to Calendar, through their public ports. */
function participantDirectory(clients: ClientRosterPort & ClientChangePort): CalendarParticipantDirectoryPort {
  return {
    listParticipants: async () => {
      const [active, archived] = await Promise.all([
        clients.listRoster("ACTIVE"), clients.listRoster("ARCHIVED"),
      ]);
      return [...active, ...archived].map((row) => ({ id: row.id, displayName: row.displayName,
        emoji: row.emoji, active: row.lifecycle === "ACTIVE" }));
    },
    subscribe: (listener) => clients.subscribeCommittedChanges(() => listener()),
  };
}

export function createDevServices(clients: DevClientServices,
  calendar: CalendarRepositoryPort): DevServices {
  return {
    runSqliteProbe: () => runF04Probe(() => openExpoSqliteConnection("fitcoach_f04_probe.db")),
    clients,
    calendar,
    calendarParticipants: participantDirectory(clients),
  };
}

export interface DevRuntime {
  readonly boot: BootCoordinator;
  readonly services: DevServices;
}

export function createDevRuntime(): DevRuntime {
  // Clients and Calendar share one dev file so a client delete commits with its §15.8 effects.
  const database = new SharedSqliteDatabase(() => openExpoSqliteConnection("fitcoach_f04_clients_dev.db"));
  const clients = new DevClientRepository(database, DEV_WORKSPACE_ID,
    [devCalendarClientDeletionParticipant]);
  const calendar = new DevCalendarRepository(database, DEV_WORKSPACE_ID);
  return {
    boot: new BootCoordinator(createDevBootDependencies(
      () => openExpoSqliteConnection("fitcoach_f03_dev_gate.db"),
      async () => { await clients.initialize(); await calendar.initialize(); },
    )),
    services: createDevServices(clients, calendar),
  };
}
