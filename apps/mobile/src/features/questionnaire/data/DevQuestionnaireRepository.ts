import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { AnswerValue, Answers, ClientAnswers, CompletionStatus, PublishedQuestionnaire, PublishSummary,
  QuestionnaireDraft, QuestionnaireSchema } from "../domain/QuestionnaireModel.ts";
import type { QuestionnaireCommittedChange, QuestionnaireRepositoryPort } from "../domain/QuestionnaireRepositoryPort.ts";
import { allFields, completionStatus, defaultQuestionnaireSchema, normalizeAnswer, withMissingSystemOptions, publishSummary, sameSchema,
  validateSchema } from "../domain/QuestionnaireRules.ts";
import { DEV_QUESTIONNAIRE_LEDGER, devQuestionnaireCatalog } from "./DevQuestionnaireCatalog.ts";

interface VersionRow { version: number; publishedAt: string; schemaJson: string }
interface DraftRow { baseVersion: number; revision: number; schemaJson: string }

function localToday(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseSchema(json: string): QuestionnaireSchema {
  return JSON.parse(json) as QuestionnaireSchema;
}

/** Questionnaire side of PermanentlyDeleteArchivedClient (§15.7): only that client's answers. */
export const devQuestionnaireClientDeletionParticipant = {
  owner: "questionnaire.answers",
  tables: ["dev_questionnaire_answers"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_questionnaire_answers
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM dev_questionnaire_answers WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Explicitly dev-only new-install store sharing the clients dev file. */
export class DevQuestionnaireRepository implements QuestionnaireRepositoryPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: QuestionnaireCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
  }

  /** The clients store must initialize first; the standard questionnaire becomes version 1. */
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
    if (!this.workspaceId.trim()) throw new Error("QUESTIONNAIRE_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devQuestionnaireCatalog, DEV_QUESTIONNAIRE_LEDGER);
      await writer.write(async (tx) => {
        const existing = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_questionnaire_versions
          WHERE workspace_id = ?`, [this.workspaceId]);
        if ((existing?.n ?? 0) > 0) {
          await this.topUpSystemOptions(tx);
          return;
        }
        const json = JSON.stringify(defaultQuestionnaireSchema());
        const now = new Date().toISOString();
        await tx.run(`INSERT INTO dev_questionnaire_versions (workspace_id, version, format_version, schema_json,
          base_version, published_at) VALUES (?, 1, 1, ?, NULL, ?)`, [this.workspaceId, json, now]);
        await tx.run(`INSERT INTO dev_questionnaire_drafts (workspace_id, base_version, revision, schema_json, updated_at)
          VALUES (?, 1, 1, ?, ?)`, [this.workspaceId, json, now]);
      });
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  /** Новые пункты стандартных вопросов (например, группы мышц) попадают в установленную анкету новой версией; правки тренера в черновике не затираются. */
  private async topUpSystemOptions(tx: SqliteStatementPort): Promise<void> {
    const current = await this.current(tx);
    const next = withMissingSystemOptions(current.schema, defaultQuestionnaireSchema());
    if (next === null) return;
    const draft = await this.draft(tx);
    if (draft.baseVersion !== current.version || !sameSchema(draft.schema, current.schema)) return;
    const version = current.version + 1;
    const now = new Date().toISOString();
    await tx.run(`INSERT INTO dev_questionnaire_versions (workspace_id, version, format_version, schema_json,
      base_version, published_at) VALUES (?, ?, 1, ?, ?, ?)`, [this.workspaceId, version, JSON.stringify(next), current.version, now]);
    await this.replaceDraft(tx, draft.revision, version, next);
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("QUESTIONNAIRE_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: QuestionnaireCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: QuestionnaireCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  private async current(tx: SqliteStatementPort): Promise<PublishedQuestionnaire> {
    const row = await tx.first<VersionRow>(`SELECT version, published_at AS publishedAt, schema_json AS schemaJson
      FROM dev_questionnaire_versions WHERE workspace_id = ? ORDER BY version DESC LIMIT 1`, [this.workspaceId]);
    if (row === null) throw new Error("QUESTIONNAIRE_STORE_NOT_READY");
    return { version: row.version, publishedAt: row.publishedAt, schema: parseSchema(row.schemaJson) };
  }

  private async draft(tx: SqliteStatementPort): Promise<QuestionnaireDraft> {
    const row = await tx.first<DraftRow>(`SELECT base_version AS baseVersion, revision, schema_json AS schemaJson
      FROM dev_questionnaire_drafts WHERE workspace_id = ?`, [this.workspaceId]);
    if (row === null) throw new Error("QUESTIONNAIRE_STORE_NOT_READY");
    return { baseVersion: row.baseVersion, revision: row.revision, schema: parseSchema(row.schemaJson) };
  }

  getPublished(): Promise<PublishedQuestionnaire> { return this.current(this.ready().connection); }

  async listVersions(): Promise<readonly Readonly<{ version: number; publishedAt: string }>[]> {
    return this.ready().connection.all(`SELECT version, published_at AS publishedAt FROM dev_questionnaire_versions
      WHERE workspace_id = ? ORDER BY version DESC`, [this.workspaceId]);
  }

  async getVersion(version: number): Promise<PublishedQuestionnaire> {
    const row = await this.ready().connection.first<VersionRow>(`SELECT version, published_at AS publishedAt,
      schema_json AS schemaJson FROM dev_questionnaire_versions WHERE workspace_id = ? AND version = ?`,
    [this.workspaceId, version]);
    if (row === null) throw new Error("QUESTIONNAIRE_VERSION_NOT_FOUND");
    return { version: row.version, publishedAt: row.publishedAt, schema: parseSchema(row.schemaJson) };
  }

  getDraft(): Promise<QuestionnaireDraft> { return this.draft(this.ready().connection); }

  private async replaceDraft(tx: SqliteStatementPort, expectedRevision: number | null, baseVersion: number,
    schema: QuestionnaireSchema): Promise<QuestionnaireDraft> {
    const result = await tx.run(`UPDATE dev_questionnaire_drafts SET base_version = ?, revision = revision + 1,
        schema_json = ?, updated_at = ? WHERE workspace_id = ? AND (? IS NULL OR revision = ?)`,
    [baseVersion, JSON.stringify(schema), new Date().toISOString(), this.workspaceId, expectedRevision, expectedRevision]);
    if (result.changes !== 1) throw new Error("QUESTIONNAIRE_DRAFT_STALE");
    return this.draft(tx);
  }

  async saveDraft(expectedRevision: number, schema: QuestionnaireSchema): Promise<QuestionnaireDraft> {
    if (schema.formatVersion !== 1 || !Array.isArray(schema.sections)) throw new Error("QUESTIONNAIRE_SCHEMA_INVALID");
    const saved = await this.ready().writer.write(async (tx) => {
      const current = await this.draft(tx);
      // An older autosave finishing late cannot overwrite a newer one (§25.4).
      if (current.revision !== expectedRevision) throw new Error("QUESTIONNAIRE_DRAFT_STALE");
      return this.replaceDraft(tx, expectedRevision, current.baseVersion, schema);
    });
    this.publish({ scope: "SCHEMA", clientId: null });
    return saved;
  }

  async previewPublish(): Promise<PublishSummary> {
    const { connection } = this.ready();
    return publishSummary((await this.current(connection)).schema, (await this.draft(connection)).schema);
  }

  /** Answered fields and options must survive (hidden or retired is fine); types change only text↔text. */
  private async assertAnswersKept(tx: SqliteStatementPort, published: QuestionnaireSchema,
    next: QuestionnaireSchema): Promise<void> {
    const rows = await tx.all<{ fieldId: string; valueJson: string }>(`SELECT field_id AS fieldId, value_json AS valueJson
      FROM dev_questionnaire_answers WHERE workspace_id = ?`, [this.workspaceId]);
    const before = new Map(allFields(published).map((item) => [item.field.id, item.field]));
    const after = new Map(allFields(next).map((item) => [item.field.id, item.field]));
    for (const row of rows) {
      const target = after.get(row.fieldId);
      const old = before.get(row.fieldId);
      if (old === undefined) continue;
      if (target === undefined) throw new Error("QUESTIONNAIRE_ANSWERED_FIELD_REMOVED");
      const textual = (type: string) => type === "SHORT_TEXT" || type === "LONG_TEXT";
      if (target.type !== old.type && !(textual(target.type) && textual(old.type))) {
        throw new Error("QUESTIONNAIRE_ANSWERED_TYPE_CHANGED");
      }
      const value = JSON.parse(row.valueJson) as AnswerValue;
      const used = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      if ((target.type === "SINGLE_CHOICE" || target.type === "MULTI_CHOICE")
        && used.some((id) => !target.options.some((option) => option.id === id))) {
        throw new Error("QUESTIONNAIRE_ANSWERED_FIELD_REMOVED");
      }
    }
  }

  async publishDraft(expectedRevision: number): Promise<PublishedQuestionnaire> {
    const published = await this.ready().writer.write(async (tx) => {
      const draft = await this.draft(tx);
      const current = await this.current(tx);
      if (draft.revision !== expectedRevision) throw new Error("QUESTIONNAIRE_DRAFT_STALE");
      // A stale draft never overwrites a newer published version; the draft itself is kept (§25.7.2).
      if (draft.baseVersion !== current.version) throw new Error("QUESTIONNAIRE_STALE_BASE");
      if (validateSchema(draft.schema).length > 0) throw new Error("QUESTIONNAIRE_SCHEMA_INVALID");
      if (sameSchema(draft.schema, current.schema)) throw new Error("QUESTIONNAIRE_NOTHING_TO_PUBLISH");
      await this.assertAnswersKept(tx, current.schema, draft.schema);
      const version = current.version + 1;
      const json = JSON.stringify(draft.schema);
      const now = new Date().toISOString();
      await tx.run(`INSERT INTO dev_questionnaire_versions (workspace_id, version, format_version, schema_json,
        base_version, published_at) VALUES (?, ?, 1, ?, ?, ?)`, [this.workspaceId, version, json, current.version, now]);
      await this.replaceDraft(tx, expectedRevision, version, draft.schema);
      return { version, publishedAt: now, schema: draft.schema };
    });
    this.publish({ scope: "SCHEMA", clientId: null });
    return published;
  }

  async discardDraft(): Promise<QuestionnaireDraft> {
    const draft = await this.ready().writer.write(async (tx) => {
      const current = await this.current(tx);
      return this.replaceDraft(tx, null, current.version, current.schema);
    });
    this.publish({ scope: "SCHEMA", clientId: null });
    return draft;
  }

  async draftFromVersion(version: number | "DEFAULT"): Promise<QuestionnaireDraft> {
    const draft = await this.ready().writer.write(async (tx) => {
      const current = await this.current(tx);
      let schema = defaultQuestionnaireSchema();
      if (version !== "DEFAULT") {
        const row = await tx.first<VersionRow>(`SELECT version, published_at AS publishedAt, schema_json AS schemaJson
          FROM dev_questionnaire_versions WHERE workspace_id = ? AND version = ?`, [this.workspaceId, version]);
        if (row === null) throw new Error("QUESTIONNAIRE_VERSION_NOT_FOUND");
        schema = parseSchema(row.schemaJson);
      }
      // The base is the current version: publishing it creates a new linear version (§25.18).
      return this.replaceDraft(tx, null, current.version, schema);
    });
    this.publish({ scope: "SCHEMA", clientId: null });
    return draft;
  }

  private async answers(tx: SqliteStatementPort, clientId: string): Promise<ClientAnswers> {
    const rows = await tx.all<{ fieldId: string; valueJson: string; schemaVersion: number }>(`SELECT field_id AS fieldId,
      value_json AS valueJson, schema_version AS schemaVersion FROM dev_questionnaire_answers
      WHERE workspace_id = ? AND client_id = ?`, [this.workspaceId, clientId]);
    const answers: Record<string, AnswerValue> = {};
    for (const row of rows) answers[row.fieldId] = JSON.parse(row.valueJson) as AnswerValue;
    return { answers, schemaVersion: rows.length === 0 ? null : Math.max(...rows.map((row) => row.schemaVersion)) };
  }

  getAnswers(clientId: string): Promise<ClientAnswers> { return this.answers(this.ready().connection, clientId); }

  async saveAnswers(clientId: string, patch: Readonly<Record<string, AnswerValue | null>>): Promise<ClientAnswers> {
    const today = localToday();
    const saved = await this.ready().writer.write(async (tx) => {
      // Answers are checked against the schema current at commit time, so an outdated open form
      // cannot write into a retired or unknown field (§25.14).
      const current = await this.current(tx);
      const known = new Map(allFields(current.schema).map((item) => [item.field.id, item.field]));
      const before = (await this.answers(tx, clientId)).answers;
      const now = new Date().toISOString();
      for (const [fieldId, raw] of Object.entries(patch)) {
        const target = known.get(fieldId);
        if (target === undefined) throw new Error("QUESTIONNAIRE_ANSWER_INVALID");
        const value = normalizeAnswer(target, raw, before[fieldId], today);
        if (value === null) {
          await tx.run("DELETE FROM dev_questionnaire_answers WHERE workspace_id = ? AND client_id = ? AND field_id = ?",
            [this.workspaceId, clientId, fieldId]);
        } else {
          await tx.run(`INSERT INTO dev_questionnaire_answers (workspace_id, client_id, field_id, value_json,
              schema_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, client_id, field_id) DO UPDATE SET value_json = excluded.value_json,
              schema_version = excluded.schema_version, updated_at = excluded.updated_at`,
          [this.workspaceId, clientId, fieldId, JSON.stringify(value), current.version, now]);
        }
      }
      return this.answers(tx, clientId);
    });
    this.publish({ scope: "ANSWERS", clientId });
    return saved;
  }

  async completion(clientId: string): Promise<CompletionStatus> {
    const { connection } = this.ready();
    const [published, client] = await Promise.all([this.current(connection), this.answers(connection, clientId)]);
    return completionStatus(published.schema, client.answers as Answers);
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
