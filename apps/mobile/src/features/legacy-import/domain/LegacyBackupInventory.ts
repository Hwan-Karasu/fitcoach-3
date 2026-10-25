/** Aggregate report only. Account, database and client identities stay private. */
export interface LegacyBackupInventory {
  readonly format: "sqlite-atbackup";
  readonly tableCount: number;
  readonly integrityErrors: number;
  readonly foreignKeyErrors: number;
  readonly formatVersion: number | null;
  readonly schemaVersion: number | null;
  readonly sourceSchemaVersion: number | null;
  readonly migrationRows: number;
  readonly migrationMax: number | null;
  readonly migrationLedgerContiguous: boolean;
  readonly bindingRows: number;
  readonly bindingMatchesManifest: boolean;
  readonly clientRows: number;
  readonly distinctClientWorkspaces: number;
  readonly missingClientWorkspaceRows: number;
  readonly missingRequiredShape: readonly string[];
  readonly status: "candidate" | "blocked";
  readonly reasons: readonly string[];
}
export interface LegacyBackupAdmission {
  readonly inventory: LegacyBackupInventory;
  readonly accountScope: string;
  readonly sourceDatabaseId: string;
  readonly sourceDataRevision: number;
  readonly sourceBackupId: string;
  /** Export metadata only; never a date for imported facts. */
  readonly sourceCreatedAt: string;
  /** null only if clients, questionnaire and explicit template bindings supply no namespace. */
  readonly sourceWorkspaceId: string | null;
}
export class LegacySourceAdmissionError extends Error {
  readonly code = "LEGACY_SOURCE_REJECTED";
  readonly inventory: LegacyBackupInventory;
  constructor(inventory: LegacyBackupInventory) { super("LEGACY_SOURCE_REJECTED"); this.inventory = inventory; }
}
