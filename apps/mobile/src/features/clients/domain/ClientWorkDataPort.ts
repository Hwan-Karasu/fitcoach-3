import type { SafetyImportReview, TrainerNote, TrainerTag } from "./ClientWorkDataModel.ts";

export interface StoredTrainerNote extends TrainerNote { readonly revision: number }
export interface StoredTrainerTag extends TrainerTag { readonly revision: number }
/** Joined to the Client Card transaction, never a second post-save command. */
export interface ClientWorkDataCreationParticipant<Tx> {
  create(tx: Tx, clientId: string, input: Readonly<{ noteBody: string | null; tagIds: readonly string[] }>): Promise<StoredTrainerNote | null>;
}
/** Immutable import evidence belongs to 3.x after cutover. It is not a live link
 * to the old file; no legacy parser is required to retain or back it up. */
export interface ClientWorkImportEvidence {
  readonly workspaceId: string;
  readonly clientId: string;
  readonly sourceSha256: string;
  readonly sourceKey: string;
  readonly importedAt: string;
  readonly sourceJson: string;
  readonly projectionJson: string;
}
export interface ClientWorkDataPort {
  initialize(): Promise<void>;
  close(): Promise<void>;
  listNotes(clientId: string, search?: string): Promise<readonly StoredTrainerNote[]>;
  createNote(clientId: string, body: string): Promise<StoredTrainerNote>;
  updateNote(clientId: string, id: string, expectedRevision: number,
    patch: Readonly<{ body: string; pinned: boolean }>): Promise<StoredTrainerNote>;
  listTags(includeArchived?: boolean): Promise<readonly StoredTrainerTag[]>;
  listClientTags(clientId: string): Promise<readonly StoredTrainerTag[]>;
  createTag(name: string, color?: string | null): Promise<StoredTrainerTag>;
  updateTag(id: string, expectedRevision: number,
    patch: Readonly<{ name: string; color: string | null; lifecycle: "ACTIVE" | "ARCHIVED" }>): Promise<StoredTrainerTag>;
  assignTag(clientId: string, tagId: string): Promise<void>;
  unassignTag(clientId: string, tagId: string): Promise<void>;
  listSafetyImportReviews(clientId: string): Promise<readonly SafetyImportReview[]>;
  getImportEvidence(clientId: string): Promise<readonly ClientWorkImportEvidence[]>;
}
