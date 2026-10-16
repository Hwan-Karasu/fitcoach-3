import type { ClientArchivePort, ClientChangePort, ClientCountsQueryPort, ClientLifecycleCounts,
  ClientListModel, ClientListQueryPort, ClientRosterPort } from "../features/clients/public.ts";
import { QueryRegistry } from "./QueryRegistry.ts";

const defaultBirthday = {
  birthdayPinEnabled: true, birthdayPinLeadDays: 14, showBirthdayBadge: true,
} as const;

/** Dev wiring of scoped client projections; no business facts are stored here. */
export class ClientListController {
  readonly active: ClientListQueryPort;
  readonly archived: ClientListQueryPort;
  readonly counts: ClientCountsQueryPort;
  private readonly registry = new QueryRegistry();
  private readonly unsubscribe: () => void;

  constructor(repository: ClientRosterPort & ClientArchivePort & ClientChangePort, workspaceId: string) {
    if (!workspaceId.trim()) throw new Error("CLIENT_QUERY_WORKSPACE_REQUIRED");
    this.active = this.registry.register<ClientListModel>(
      { kind: "client-roster", workspaceId, parameters: "ACTIVE" },
      [{ domain: "clients.ACTIVE", workspaceId }],
      async () => {
        const [rows, sort, birthday, dismissals] = await Promise.all([
          repository.listRoster("ACTIVE"), repository.getRosterSort(),
          repository.getBirthdaySettings(), repository.listBirthdayDismissals(),
        ]);
        return { rows, sort, archiveSort: "ARCHIVED_AT", birthday, dismissals };
      },
    );
    this.archived = this.registry.register<ClientListModel>(
      { kind: "client-roster", workspaceId, parameters: "ARCHIVED" },
      [{ domain: "clients.ARCHIVED", workspaceId }],
      async () => {
        const [rows, archiveSort] = await Promise.all([
          repository.listRoster("ARCHIVED"), repository.getArchiveSort(),
        ]);
        return { rows, sort: "NAME", archiveSort, birthday: defaultBirthday, dismissals: [] };
      },
    );
    this.counts = this.registry.register<ClientLifecycleCounts>(
      { kind: "client-counts", workspaceId },
      [{ domain: "clients.ACTIVE", workspaceId }, { domain: "clients.ARCHIVED", workspaceId }],
      () => repository.countByLifecycle(),
    );
    this.unsubscribe = repository.subscribeCommittedChanges((change) => {
      this.registry.publish(change.affectedRosters.map((lifecycle) => ({
        domain: `clients.${lifecycle}`, workspaceId,
        clientId: change.clientId ?? undefined,
        entityIds: change.clientId === null ? undefined : [change.clientId],
      })));
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.registry.dispose();
  }
}
