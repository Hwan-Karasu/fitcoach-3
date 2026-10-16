import { runF04Probe, type F04ProbeReport } from "../diagnostics/runF04Probe.ts";
import { openExpoSqliteConnection } from "../../shared/db/ExpoSqliteConnection.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { DevAccountingRepository, devAccountingCalendarHook, devAccountingClientDeletionParticipant } from
  "../../features/accounting/data/DevAccountingRepository.ts";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import { DevCalendarRepository, devCalendarClientDeletionParticipant } from
  "../../features/calendar/data/DevCalendarRepository.ts";
import type { CalendarParticipantDirectoryPort, CalendarRepositoryPort } from
  "../../features/calendar/public.ts";
import { DevClientRepository } from "../../features/clients/data/DevClientRepository.ts";
import { DevMeasurementRepository, devMeasurementClientDeletionParticipant } from
  "../../features/measurements/data/DevMeasurementRepository.ts";
import type { MeasurementRepositoryPort } from "../../features/measurements/public.ts";
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
  readonly accounting: AccountingRepositoryPort;
  readonly measurements: MeasurementRepositoryPort;
  /** Active session types that can consume a credit, for SESSION_TYPE packs. */
  readonly listCreditSessionTypes: () => Promise<readonly Readonly<{ id: string; name: string }>[]>;
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

export function createDevServices(clients: DevClientServices, calendar: CalendarRepositoryPort,
  accounting: AccountingRepositoryPort, measurements: MeasurementRepositoryPort): DevServices {
  return {
    runSqliteProbe: () => runF04Probe(() => openExpoSqliteConnection("fitcoach_f04_probe.db")),
    clients,
    calendar,
    calendarParticipants: participantDirectory(clients),
    accounting,
    measurements,
    listCreditSessionTypes: async () => (await calendar.listSessionTypes())
      .filter((type) => type.requiresCredit && !type.archived)
      .map((type) => ({ id: type.id, name: type.name })),
  };
}

export interface DevRuntime {
  readonly boot: BootCoordinator;
  readonly services: DevServices;
}

export function createDevRuntime(): DevRuntime {
  // Clients, Calendar and Accounting share one dev file: a client delete, a booking and its
  // reservation each commit as one transaction across owners.
  const database = new SharedSqliteDatabase(() => openExpoSqliteConnection("fitcoach_f04_clients_dev.db"));
  const clients = new DevClientRepository(database, DEV_WORKSPACE_ID,
    [devAccountingClientDeletionParticipant, devCalendarClientDeletionParticipant,
      devMeasurementClientDeletionParticipant]);
  const calendar = new DevCalendarRepository(database, DEV_WORKSPACE_ID, devAccountingCalendarHook);
  const accounting = new DevAccountingRepository(database, DEV_WORKSPACE_ID);
  const measurements = new DevMeasurementRepository(database, DEV_WORKSPACE_ID);
  // Calendar commands move reservations inside their own transactions.
  calendar.subscribeCommittedChanges(() => accounting.notifyExternalChange());
  return {
    boot: new BootCoordinator(createDevBootDependencies(
      () => openExpoSqliteConnection("fitcoach_f03_dev_gate.db"),
      async () => {
        await clients.initialize();
        await calendar.initialize();
        await accounting.initialize();
        await measurements.initialize();
      },
    )),
    services: createDevServices(clients, calendar, accounting, measurements),
  };
}
