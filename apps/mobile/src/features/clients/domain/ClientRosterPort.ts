import type { ClientRecord } from "./ClientRepositoryPort.ts";

export type RosterSortMode = "NAME" | "RECENT";

export interface ClientRosterRow extends ClientRecord {
  readonly lastOpenedAt: string | null;
}

export interface RosterBirthdaySettings {
  readonly birthdayPinEnabled: boolean;
  readonly birthdayPinLeadDays: number;
  readonly showBirthdayBadge: boolean;
}

export interface BirthdayDismissal {
  readonly clientId: string;
  readonly occurrenceDate: string;
}

export interface ClientRosterPort {
  listRoster(lifecycle: ClientRecord["lifecycle"]): Promise<readonly ClientRosterRow[]>;
  getRosterSort(): Promise<RosterSortMode>;
  setRosterSort(mode: RosterSortMode): Promise<void>;
  getBirthdaySettings(): Promise<RosterBirthdaySettings>;
  setBirthdaySettings(settings: RosterBirthdaySettings): Promise<void>;
  listBirthdayDismissals(): Promise<readonly BirthdayDismissal[]>;
  dismissBirthday(clientId: string, occurrenceDate: string): Promise<void>;
  /** Called only when the client's workspace is the focused user context. */
  recordRealOpen(clientId: string, at?: string): Promise<void>;
}
