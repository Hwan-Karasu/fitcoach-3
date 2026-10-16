/** Minimal client display data the Calendar may show; owned and served by Clients (§13.22). */
export interface CalendarParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly emoji: string | null;
  readonly active: boolean;
}

export interface CalendarParticipantDirectoryPort {
  listParticipants(): Promise<readonly CalendarParticipant[]>;
  /** Fires after any committed client change; the directory may be stale until reloaded. */
  subscribe(listener: () => void): () => void;
}
