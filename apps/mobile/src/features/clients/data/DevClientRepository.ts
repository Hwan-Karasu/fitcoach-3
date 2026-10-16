import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { ClientRecord, CreateClientInput, ClientRepositoryPort } from
  "../domain/ClientRepositoryPort.ts";
import type { ArchiveSortMode, ClientArchivePort, ClientDeletionManifest,
  ClientLifecycleCounts } from "../domain/ClientArchivePort.ts";
import type { ClientChangePort, ClientCommittedChange } from "../domain/ClientChangePort.ts";
import type { ClientFormDraft, ClientRecoveryDraft, ClientRecoveryDraftPort } from
  "../domain/ClientRecoveryDraftPort.ts";
import type { BirthdayDismissal, ClientRosterPort, ClientRosterRow,
  RosterBirthdaySettings, RosterSortMode } from
  "../domain/ClientRosterPort.ts";
import { birthdayOccurrenceForYear } from "../domain/ClientRosterPresentation.ts";
import { validPastBirthDate } from "../domain/ClientProfileValidation.ts";
import { devClientCatalog } from "./DevClientCatalog.ts";

interface ClientRow {
  id: string;
  displayName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  birthDate: string | null;
  heightCmX10: number | null;
  emoji: string | null;
  lifecycle: "ACTIVE" | "ARCHIVED";
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface RosterRow extends ClientRow { lastOpenedAt: string | null }

interface DraftRow {
  id: string;
  clientId: string | null;
  mode: "create" | "edit";
  baseClientRevision: number | null;
  questionnaireRevision: string | null;
  draftSchemaVersion: number;
  formDataJson: string;
  questionnaireAnswersJson: string;
  updatedAt: string;
}

const draftColumns = `id, client_id AS clientId, mode,
  base_client_revision AS baseClientRevision,
  questionnaire_revision AS questionnaireRevision,
  draft_schema_version AS draftSchemaVersion,
  form_data_json AS formDataJson,
  questionnaire_answers_json AS questionnaireAnswersJson,
  updated_at AS updatedAt`;

const columns = `id, display_name AS displayName, contact_phone AS contactPhone,
  contact_email AS contactEmail, birth_date AS birthDate,
  height_cm_x10 AS heightCmX10, emoji, lifecycle, revision, created_at AS createdAt,
  updated_at AS updatedAt, archived_at AS archivedAt`;

function optional(value: string | undefined, maxLength: number): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length > maxLength) throw new Error("CLIENT_FIELD_TOO_LONG");
  return normalized || null;
}

function validatedInput(input: CreateClientInput): Readonly<{
  name: string; phone: string | null; email: string | null;
  birthDate: string | null; heightCmX10: number | null; emoji: string | null;
}> {
  const name = input.displayName.trim();
  if (!name || name.length > 200) throw new Error("CLIENT_NAME_INVALID");
  const phone = optional(input.contactPhone, 60);
  const email = optional(input.contactEmail, 254);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("CLIENT_EMAIL_INVALID");
  }
  const birthDate = input.birthDate?.trim() || null;
  if (!validPastBirthDate(birthDate)) throw new Error("CLIENT_BIRTH_DATE_INVALID");
  const heightCmX10 = input.heightCmX10 ?? null;
  if (heightCmX10 !== null && (!Number.isSafeInteger(heightCmX10) || heightCmX10 <= 0)) {
    throw new Error("CLIENT_HEIGHT_INVALID");
  }
  const emoji = input.emoji?.trim() || null;
  if (emoji !== null && Array.from(emoji).length > 8) throw new Error("CLIENT_EMOJI_INVALID");
  return { name, phone, email, birthDate, heightCmX10, emoji };
}

async function clientById(tx: SqliteStatementPort, workspaceId: string, id: string): Promise<ClientRecord> {
  const row = await tx.first<ClientRow>(
    `SELECT ${columns} FROM dev_clients WHERE workspace_id = ? AND id = ?`, [workspaceId, id]);
  if (row === null) throw new Error("CLIENT_NOT_FOUND");
  return row;
}

/** Every table that may hold rows of one client; deletion order respects the FKs. */
const clientOwnedTables = [
  { owner: "clients.recoveryDrafts", table: "dev_client_recovery_drafts" },
  { owner: "clients.activity", table: "dev_client_activity" },
  { owner: "clients.birthdayDismissals", table: "dev_birthday_dismissals" },
] as const;

/**
 * Another owner's rows that reference a client. Wired only by the composition root; the owner
 * decides whether its rows are deleted, cancelled or anonymized (§15.7–15.8).
 */
export interface DevClientDeletionParticipant {
  readonly owner: string;
  readonly tables: readonly string[];
  count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number>;
  detach(tx: SqliteStatementPort, workspaceId: string, clientId: string, now: string): Promise<void>;
}

async function deletionManifest(tx: SqliteStatementPort, workspaceId: string, clientId: string,
  participants: readonly DevClientDeletionParticipant[]): Promise<ClientDeletionManifest> {
  const client = await clientById(tx, workspaceId, clientId);
  if (client.lifecycle !== "ARCHIVED") throw new Error("CLIENT_NOT_ARCHIVED");
  const owners = [{ owner: "clients.profile", rows: 1 }];
  for (const { owner, table } of clientOwnedTables) {
    const row = await tx.first<{ n: number }>(
      `SELECT count(*) AS n FROM ${table} WHERE workspace_id = ? AND client_id = ?`,
      [workspaceId, clientId]);
    owners.push({ owner, rows: row?.n ?? 0 });
  }
  for (const participant of participants) {
    owners.push({ owner: participant.owner, rows: await participant.count(tx, workspaceId, clientId) });
  }
  return { clientId, displayName: client.displayName, revision: client.revision, owners };
}

/** Fails closed when the schema gained a client reference that the manifest does not know. */
async function assertManifestCoversSchema(tx: SqliteStatementPort,
  participants: readonly DevClientDeletionParticipant[]): Promise<void> {
  const referencing = await tx.all<{ name: string }>(`SELECT DISTINCT m.name FROM sqlite_master AS m
    WHERE m.type = 'table' AND m.name NOT IN ('dev_clients', 'sqlite_sequence') AND (
      EXISTS (SELECT 1 FROM pragma_foreign_key_list(m.name) AS f WHERE f."table" = 'dev_clients')
      OR EXISTS (SELECT 1 FROM pragma_table_info(m.name) AS c WHERE c.name = 'client_id'))`);
  const known = new Set<string>([...clientOwnedTables.map((entry) => entry.table),
    ...participants.flatMap((participant) => participant.tables)]);
  if (referencing.some((row) => !known.has(row.name))) throw new Error("CLIENT_DELETION_BLOCKED");
}

function parseDraft(row: DraftRow): ClientRecoveryDraft {
  let form: unknown;
  let answers: unknown;
  try {
    form = JSON.parse(row.formDataJson);
    answers = JSON.parse(row.questionnaireAnswersJson);
  } catch { throw new Error("CLIENT_DRAFT_CORRUPT"); }
  if (row.draftSchemaVersion !== 1 || row.questionnaireRevision !== null
    || !Array.isArray(answers) || answers.length !== 0
    || typeof form !== "object" || form === null) throw new Error("CLIENT_DRAFT_UNSUPPORTED");
  const fields = form as Record<string, unknown>;
  if (["displayName", "contactPhone", "contactEmail", "birthDate", "heightDraft"]
    .some((field) => typeof fields[field] !== "string")
    || (fields.emoji !== null && typeof fields.emoji !== "string")) {
    throw new Error("CLIENT_DRAFT_CORRUPT");
  }
  return {
    id: row.id, clientId: row.clientId, mode: row.mode,
    baseClientRevision: row.baseClientRevision, questionnaireRevision: null,
    draftSchemaVersion: 1, updatedAt: row.updatedAt,
    formData: fields as unknown as ClientFormDraft, questionnaireAnswers: [],
  };
}

/** Explicitly dev-only new-install store; not D01 production DDL or a legacy importer. */
export class DevClientRepository implements ClientRepositoryPort, ClientRecoveryDraftPort,
  ClientRosterPort, ClientChangePort, ClientArchivePort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly participants: readonly DevClientDeletionParticipant[];
  private readonly changeListeners = new Set<(change: ClientCommittedChange) => void>();

  constructor(
    database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string,
    deletionParticipants: readonly DevClientDeletionParticipant[] = [],
  ) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
    this.participants = deletionParticipants;
  }

  initialize(): Promise<void> {
    if (this.connection !== null) return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const opening = this.openAndMigrate();
    this.opening = opening;
    void opening.finally(() => { if (this.opening === opening) this.opening = null; })
      .catch(() => undefined);
    return opening;
  }

  private async openAndMigrate(): Promise<void> {
    if (!this.workspaceId.trim()) throw new Error("CLIENT_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devClientCatalog);
      await writer.write(async (tx) => {
        await tx.run(`INSERT OR IGNORE INTO dev_workspaces (id, display_name, created_at)
          VALUES (?, ?, ?)`, [this.workspaceId, "Локальное рабочее пространство", new Date().toISOString()]);
        const workspace = await tx.first<{ id: string }>(
          "SELECT id FROM dev_workspaces WHERE id = ?", [this.workspaceId]);
        if (workspace?.id !== this.workspaceId) throw new Error("CLIENT_WORKSPACE_UNAVAILABLE");
        await tx.run("DELETE FROM dev_client_recovery_drafts WHERE updated_at < ?",
          [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]);
      });
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("CLIENT_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: ClientCommittedChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  private publishCommitted(change: ClientCommittedChange): void {
    for (const listener of this.changeListeners) {
      try { listener(change); }
      catch { /* A broken observer must not turn a committed write into failure. */ }
    }
  }

  async list(lifecycle: ClientRecord["lifecycle"]): Promise<readonly ClientRecord[]> {
    const { connection } = this.ready();
    return connection.all<ClientRow>(`SELECT ${columns} FROM dev_clients
      WHERE workspace_id = ? AND lifecycle = ? ORDER BY display_name COLLATE NOCASE, id`,
    [this.workspaceId, lifecycle]);
  }

  async listRoster(lifecycle: ClientRecord["lifecycle"]): Promise<readonly ClientRosterRow[]> {
    const { connection } = this.ready();
    return connection.all<RosterRow>(`SELECT ${columns}, activity.last_opened_at AS lastOpenedAt
      FROM dev_clients LEFT JOIN dev_client_activity AS activity
        ON activity.workspace_id = dev_clients.workspace_id AND activity.client_id = dev_clients.id
      WHERE dev_clients.workspace_id = ? AND lifecycle = ?
      ORDER BY display_name COLLATE NOCASE, dev_clients.id`,
    [this.workspaceId, lifecycle]);
  }

  async getRosterSort(): Promise<RosterSortMode> {
    const { connection } = this.ready();
    const row = await connection.first<{ sort_mode: RosterSortMode }>(
      "SELECT sort_mode FROM dev_roster_preferences WHERE workspace_id = ?", [this.workspaceId]);
    return row?.sort_mode ?? "NAME";
  }

  async setRosterSort(mode: RosterSortMode): Promise<void> {
    if (mode !== "NAME" && mode !== "RECENT") throw new Error("CLIENT_ROSTER_SORT_INVALID");
    const { writer } = this.ready();
    await writer.write(async (tx) => {
      await tx.run(`INSERT INTO dev_roster_preferences (workspace_id, sort_mode) VALUES (?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET sort_mode = excluded.sort_mode`,
      [this.workspaceId, mode]);
    });
    this.publishCommitted({ clientId: null, affectedRosters: ["ACTIVE"] });
  }

  async getBirthdaySettings(): Promise<RosterBirthdaySettings> {
    const { connection } = this.ready();
    const row = await connection.first<{
      birthday_pin_enabled: number; birthday_pin_lead_days: number;
      show_birthday_badge: number;
    }>(`SELECT birthday_pin_enabled, birthday_pin_lead_days, show_birthday_badge
      FROM dev_roster_preferences WHERE workspace_id = ?`, [this.workspaceId]);
    return {
      birthdayPinEnabled: row?.birthday_pin_enabled !== 0,
      birthdayPinLeadDays: row?.birthday_pin_lead_days ?? 14,
      showBirthdayBadge: row?.show_birthday_badge !== 0,
    };
  }

  async setBirthdaySettings(settings: RosterBirthdaySettings): Promise<void> {
    if (typeof settings.birthdayPinEnabled !== "boolean"
      || typeof settings.showBirthdayBadge !== "boolean"
      || !Number.isSafeInteger(settings.birthdayPinLeadDays)
      || settings.birthdayPinLeadDays < 1 || settings.birthdayPinLeadDays > 60) {
      throw new Error("CLIENT_BIRTHDAY_SETTINGS_INVALID");
    }
    const { writer } = this.ready();
    await writer.write(async (tx) => {
      await tx.run(`INSERT OR IGNORE INTO dev_roster_preferences (workspace_id, sort_mode)
        VALUES (?, 'NAME')`, [this.workspaceId]);
      await tx.run(`UPDATE dev_roster_preferences SET birthday_pin_enabled = ?,
        birthday_pin_lead_days = ?, show_birthday_badge = ? WHERE workspace_id = ?`,
      [settings.birthdayPinEnabled ? 1 : 0, settings.birthdayPinLeadDays,
        settings.showBirthdayBadge ? 1 : 0, this.workspaceId]);
    });
    this.publishCommitted({ clientId: null, affectedRosters: ["ACTIVE"] });
  }

  async listBirthdayDismissals(): Promise<readonly BirthdayDismissal[]> {
    const { connection } = this.ready();
    return connection.all<BirthdayDismissal>(`SELECT client_id AS clientId,
      occurrence_date AS occurrenceDate FROM dev_birthday_dismissals WHERE workspace_id = ?`,
    [this.workspaceId]);
  }

  async dismissBirthday(clientId: string, occurrenceDate: string): Promise<void> {
    if (!clientId.trim() || !/^\d{4}-\d{2}-\d{2}$/u.test(occurrenceDate)) {
      throw new Error("CLIENT_BIRTHDAY_DISMISSAL_INVALID");
    }
    const { writer } = this.ready();
    await writer.write(async (tx) => {
      const client = await tx.first<{ birth_date: string | null }>(
        `SELECT birth_date FROM dev_clients WHERE workspace_id = ? AND id = ? AND lifecycle = 'ACTIVE'`,
        [this.workspaceId, clientId]);
      if (client === null || client.birth_date === null
        || birthdayOccurrenceForYear(client.birth_date, Number(occurrenceDate.slice(0, 4)))
          !== occurrenceDate) throw new Error("CLIENT_BIRTHDAY_DISMISSAL_INVALID");
      await tx.run(`INSERT OR IGNORE INTO dev_birthday_dismissals
        (workspace_id, client_id, occurrence_date) VALUES (?, ?, ?)`,
      [this.workspaceId, clientId, occurrenceDate]);
    });
    this.publishCommitted({ clientId, affectedRosters: ["ACTIVE"] });
  }

  async recordRealOpen(clientId: string, at = new Date().toISOString()): Promise<void> {
    if (!clientId.trim() || Number.isNaN(Date.parse(at))) throw new Error("CLIENT_OPEN_INVALID");
    const { writer } = this.ready();
    await writer.write(async (tx) => {
      const result = await tx.run(`INSERT INTO dev_client_activity
        (workspace_id, client_id, last_opened_at)
        SELECT workspace_id, id, ? FROM dev_clients
        WHERE workspace_id = ? AND id = ? AND lifecycle = 'ACTIVE'
        ON CONFLICT(workspace_id, client_id)
        DO UPDATE SET last_opened_at = excluded.last_opened_at`,
      [at, this.workspaceId, clientId]);
      if (result.changes !== 1) throw new Error("CLIENT_OPEN_WRONG_SCOPE_OR_ARCHIVED");
    });
    this.publishCommitted({ clientId, affectedRosters: ["ACTIVE"] });
  }

  async get(id: string): Promise<ClientRecord | null> {
    if (!id.trim()) return null;
    const { connection } = this.ready();
    return connection.first<ClientRow>(
      `SELECT ${columns} FROM dev_clients WHERE workspace_id = ? AND id = ?`,
      [this.workspaceId, id]);
  }

  async create(input: CreateClientInput): Promise<ClientRecord> {
    const { name, phone, email, birthDate, heightCmX10, emoji } = validatedInput(input);
    const { writer } = this.ready();
    const created = await writer.write(async (tx) => {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("CLIENT_ID_UNAVAILABLE");
      const now = new Date().toISOString();
      await tx.run(`INSERT INTO dev_clients
        (id, workspace_id, display_name, contact_phone, contact_email,
         birth_date, height_cm_x10, emoji, lifecycle,
         revision, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, NULL)`,
      [id, this.workspaceId, name, phone, email, birthDate, heightCmX10, emoji, now, now]);
      await tx.run(`DELETE FROM dev_client_recovery_drafts
        WHERE workspace_id = ? AND mode = 'create'`, [this.workspaceId]);
      return clientById(tx, this.workspaceId, id);
    });
    this.publishCommitted({ clientId: created.id, affectedRosters: ["ACTIVE"] });
    return created;
  }

  async update(id: string, expectedRevision: number, input: CreateClientInput): Promise<ClientRecord> {
    if (!id.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("CLIENT_COMMAND_INVALID");
    }
    const { name, phone, email, birthDate, heightCmX10, emoji } = validatedInput(input);
    const { writer } = this.ready();
    const updated = await writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_clients SET display_name = ?, contact_phone = ?,
        contact_email = ?, birth_date = ?, height_cm_x10 = ?, emoji = ?,
        updated_at = ?, revision = revision + 1
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'ACTIVE'`,
      [name, phone, email, birthDate, heightCmX10, emoji,
        new Date().toISOString(), this.workspaceId, id, expectedRevision]);
      if (result.changes !== 1) throw new Error("CLIENT_STALE_OR_WRONG_SCOPE");
      await tx.run(`DELETE FROM dev_client_recovery_drafts
        WHERE workspace_id = ? AND mode = 'edit' AND client_id = ?`, [this.workspaceId, id]);
      return clientById(tx, this.workspaceId, id);
    });
    this.publishCommitted({ clientId: id, affectedRosters: ["ACTIVE"] });
    return updated;
  }

  async loadDraft(clientId: string | null): Promise<ClientRecoveryDraft | null> {
    const { connection } = this.ready();
    const where = clientId === null ? "mode = 'create' AND client_id IS NULL"
      : "mode = 'edit' AND client_id = ?";
    const bindings = clientId === null ? [this.workspaceId] : [this.workspaceId, clientId];
    const row = await connection.first<DraftRow>(`SELECT ${draftColumns}
      FROM dev_client_recovery_drafts WHERE workspace_id = ? AND ${where}
      AND updated_at >= ?`,
    [...bindings, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]);
    return row === null ? null : parseDraft(row);
  }

  async saveDraft(input: Readonly<{
    clientId: string | null;
    baseClientRevision: number | null;
    formData: ClientFormDraft;
  }>): Promise<ClientRecoveryDraft> {
    if ((input.clientId === null && input.baseClientRevision !== null)
      || (input.clientId !== null && (!input.clientId.trim()
        || !Number.isSafeInteger(input.baseClientRevision) || (input.baseClientRevision ?? 0) < 1))) {
      throw new Error("CLIENT_DRAFT_SCOPE_INVALID");
    }
    const form = input.formData;
    if ([form.displayName, form.contactPhone, form.contactEmail, form.birthDate,
      form.heightDraft].some((value) => typeof value !== "string")
      || (form.emoji !== null && typeof form.emoji !== "string")) {
      throw new Error("CLIENT_DRAFT_FORM_INVALID");
    }
    const mode = input.clientId === null ? "create" : "edit";
    const { writer } = this.ready();
    return writer.write(async (tx) => {
      const where = input.clientId === null ? "mode = 'create' AND client_id IS NULL"
        : "mode = 'edit' AND client_id = ?";
      const lookupBindings = input.clientId === null ? [this.workspaceId]
        : [this.workspaceId, input.clientId];
      const existing = await tx.first<{ id: string }>(`SELECT id FROM dev_client_recovery_drafts
        WHERE workspace_id = ? AND ${where}`, lookupBindings);
      const id = existing?.id ?? (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("CLIENT_DRAFT_ID_UNAVAILABLE");
      const now = new Date().toISOString();
      if (existing) {
        await tx.run(`UPDATE dev_client_recovery_drafts SET base_client_revision = ?,
          form_data_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
        [input.baseClientRevision, JSON.stringify(form), now, id, this.workspaceId]);
      } else {
        await tx.run(`INSERT INTO dev_client_recovery_drafts
          (id, workspace_id, client_id, mode, base_client_revision,
           questionnaire_revision, draft_schema_version, form_data_json,
           questionnaire_answers_json, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, 1, ?, '[]', ?)`,
        [id, this.workspaceId, input.clientId, mode, input.baseClientRevision,
          JSON.stringify(form), now]);
      }
      const row = await tx.first<DraftRow>(`SELECT ${draftColumns}
        FROM dev_client_recovery_drafts WHERE workspace_id = ? AND id = ?`,
      [this.workspaceId, id]);
      if (row === null) throw new Error("CLIENT_DRAFT_NOT_FOUND");
      return parseDraft(row);
    });
  }

  async discardDraft(clientId: string | null): Promise<void> {
    const { writer } = this.ready();
    await writer.write(async (tx) => {
      if (clientId === null) {
        await tx.run(`DELETE FROM dev_client_recovery_drafts
          WHERE workspace_id = ? AND mode = 'create'`, [this.workspaceId]);
      } else {
        await tx.run(`DELETE FROM dev_client_recovery_drafts
          WHERE workspace_id = ? AND mode = 'edit' AND client_id = ?`,
        [this.workspaceId, clientId]);
      }
    });
  }

  async setArchived(id: string, expectedRevision: number, archived: boolean): Promise<ClientRecord> {
    if (!id.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("CLIENT_COMMAND_INVALID");
    }
    const { writer } = this.ready();
    const changed = await writer.write(async (tx) => {
      const now = new Date().toISOString();
      const result = await tx.run(`UPDATE dev_clients SET lifecycle = ?, archived_at = ?,
        updated_at = ?, revision = revision + 1
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = ?`,
      [archived ? "ARCHIVED" : "ACTIVE", archived ? now : null,
        now, this.workspaceId, id, expectedRevision, archived ? "ACTIVE" : "ARCHIVED"]);
      if (result.changes !== 1) throw new Error("CLIENT_STALE_OR_WRONG_SCOPE");
      if (archived) {
        await tx.run(`DELETE FROM dev_client_activity
          WHERE workspace_id = ? AND client_id = ?`, [this.workspaceId, id]);
      }
      return clientById(tx, this.workspaceId, id);
    });
    this.publishCommitted({ clientId: id, affectedRosters: ["ACTIVE", "ARCHIVED"] });
    return changed;
  }

  async getArchiveSort(): Promise<ArchiveSortMode> {
    const { connection } = this.ready();
    const row = await connection.first<{ archive_sort_mode: ArchiveSortMode }>(
      "SELECT archive_sort_mode FROM dev_roster_preferences WHERE workspace_id = ?", [this.workspaceId]);
    return row?.archive_sort_mode ?? "ARCHIVED_AT";
  }

  async setArchiveSort(mode: ArchiveSortMode): Promise<void> {
    if (mode !== "ARCHIVED_AT" && mode !== "NAME") throw new Error("CLIENT_ARCHIVE_SORT_INVALID");
    const { writer } = this.ready();
    await writer.write(async (tx) => {
      await tx.run(`INSERT OR IGNORE INTO dev_roster_preferences (workspace_id, sort_mode)
        VALUES (?, 'NAME')`, [this.workspaceId]);
      await tx.run("UPDATE dev_roster_preferences SET archive_sort_mode = ? WHERE workspace_id = ?",
        [mode, this.workspaceId]);
    });
    this.publishCommitted({ clientId: null, affectedRosters: ["ARCHIVED"] });
  }

  async countByLifecycle(): Promise<ClientLifecycleCounts> {
    const { connection } = this.ready();
    const rows = await connection.all<{ lifecycle: ClientRecord["lifecycle"]; n: number }>(
      `SELECT lifecycle, count(*) AS n FROM dev_clients WHERE workspace_id = ? GROUP BY lifecycle`,
      [this.workspaceId]);
    return {
      active: rows.find((row) => row.lifecycle === "ACTIVE")?.n ?? 0,
      archived: rows.find((row) => row.lifecycle === "ARCHIVED")?.n ?? 0,
    };
  }

  async previewPermanentDelete(clientId: string): Promise<ClientDeletionManifest> {
    if (!clientId.trim()) throw new Error("CLIENT_COMMAND_INVALID");
    const { connection } = this.ready();
    return deletionManifest(connection, this.workspaceId, clientId, this.participants);
  }

  async deleteArchivedPermanently(clientId: string, expectedRevision: number): Promise<void> {
    if (!clientId.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("CLIENT_COMMAND_INVALID");
    }
    const { writer } = this.ready();
    await writer.write(async (tx) => {
      const manifest = await deletionManifest(tx, this.workspaceId, clientId, this.participants);
      if (manifest.revision !== expectedRevision) throw new Error("CLIENT_STALE_OR_WRONG_SCOPE");
      await assertManifestCoversSchema(tx, this.participants);
      const now = new Date().toISOString();
      for (const participant of this.participants) {
        await participant.detach(tx, this.workspaceId, clientId, now);
        if (await participant.count(tx, this.workspaceId, clientId) !== 0) {
          throw new Error("CLIENT_DELETION_BLOCKED");
        }
      }
      for (const { table } of clientOwnedTables) {
        await tx.run(`DELETE FROM ${table} WHERE workspace_id = ? AND client_id = ?`,
          [this.workspaceId, clientId]);
      }
      const result = await tx.run(`DELETE FROM dev_clients
        WHERE workspace_id = ? AND id = ? AND revision = ? AND lifecycle = 'ARCHIVED'`,
      [this.workspaceId, clientId, expectedRevision]);
      if (result.changes !== 1) throw new Error("CLIENT_STALE_OR_WRONG_SCOPE");
      const violations = await tx.all<unknown>("PRAGMA foreign_key_check");
      if (violations.length > 0) throw new Error("CLIENT_DELETION_BLOCKED");
    });
    this.publishCommitted({ clientId, affectedRosters: ["ARCHIVED"] });
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
