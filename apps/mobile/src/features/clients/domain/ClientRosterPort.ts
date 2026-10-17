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
  /**
   * Быстрая смена эмодзи из списка (§7.8, ChangeClientEmoji): меняет только эмодзи, с CAS по revision;
   * null — вернуть инициалы. Ошибки: CLIENT_STALE_OR_WRONG_SCOPE, CLIENT_EMOJI_INVALID.
   */
  changeEmoji(clientId: string, expectedRevision: number, emoji: string | null): Promise<ClientRecord>;
  /** Called only when the client's workspace is the focused user context. */
  recordRealOpen(clientId: string, at?: string): Promise<void>;
}
