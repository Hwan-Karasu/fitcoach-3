import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteDatabaseLease } from "../../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import { reportReadIssue } from "../../../shared/diagnostics/ReadIssues.ts";
import { trainerTagName } from "../domain/ClientWorkDataModel.ts";
import type { ClientWorkDataCreationParticipant, ClientWorkDataPort } from "../domain/ClientWorkDataPort.ts";
import type { DevClientDeletionParticipant } from "./DevClientRepository.ts";
import { WORK_DATA_FORMAT, workDataFail as fail, workDataRevision, workDataTime, workEvidence, workNote, workReview, workTag, type WorkDataRow } from "./ClientWorkDataRows.ts";

const clientTables = ["client_work_import_evidence", "client_safety_import_reviews", "client_tag_assignments", "trainer_notes"] as const;
const bodyValid = (body: string) => { if (typeof body !== "string" || !body.trim()) fail("BODY_REQUIRED"); };
const colorValid = (color: string | null) => { if (color !== null && (typeof color !== "string" || !color.trim())) fail("COLOR_INVALID"); };
const revisionValid = (revision: number) => { if (!workDataRevision(revision)) fail("REVISION_INVALID"); };
async function client(tx: SqliteStatementPort, workspaceId: string, clientId: string, active: boolean): Promise<void> {
  const row = await tx.first<{ lifecycle: string }>("SELECT lifecycle FROM clients WHERE workspace_id=? AND id=?", [workspaceId, clientId]);
  if (!row || !["ACTIVE", "ARCHIVED"].includes(row.lifecycle)) fail("CLIENT_NOT_FOUND");
  if (active && row.lifecycle !== "ACTIVE") fail("CLIENT_ARCHIVED");
}
function readable<T>(rows: readonly WorkDataRow[], decode: (row: WorkDataRow) => T, source: string): T[] {
  const result: T[] = [];
  for (const row of rows) { try { result.push(decode(row)); } catch { reportReadIssue(source); } }
  return result;
}
/** Ordinary 3.x owner. Never creates/migrates a schema, reads a legacy file or
 * regenerates imported IDs. Admission/DDL is the composition root's responsibility. */
export class SqliteClientWorkDataRepository implements ClientWorkDataPort {
  private lease: SqliteDatabaseLease | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly now: () => string;
  constructor(database: SharedSqliteDatabase, workspaceId: string, now: () => string = () => new Date().toISOString()) {
    this.database = database; this.workspaceId = workspaceId; this.now = now;
  }
  initialize(): Promise<void> {
    if (this.lease) return Promise.resolve();
    if (this.opening) return this.opening;
    const pending = this.open(); this.opening = pending;
    void pending.finally(() => { if (this.opening === pending) this.opening = null; }).catch(() => undefined);
    return pending;
  }
  private async open(): Promise<void> {
    const lease = await this.database.acquire();
    try {
      const formats = await lease.connection.all<{ id: number; format_version: number; tag_name_policy: string }>("SELECT * FROM client_work_data_format");
      if (formats.length !== 1 || formats[0]?.id !== 1 || formats[0].format_version !== WORK_DATA_FORMAT.version
        || formats[0].tag_name_policy !== WORK_DATA_FORMAT.tagNamePolicy
        || !await lease.connection.first("SELECT 1 FROM workspaces WHERE id=?", [this.workspaceId])) fail("FORMAT_UNSUPPORTED");
      this.lease = lease;
    } catch { await this.database.release(); fail("FORMAT_UNSUPPORTED"); }
  }
  async close(): Promise<void> {
    if (this.opening) await this.opening.catch(() => undefined);
    if (!this.lease) return; this.lease = null; await this.database.release();
  }
  private async access(): Promise<SqliteDatabaseLease> { await this.initialize(); if (!this.lease) return fail("CLOSED"); return this.lease; }
  private time(): string { const value = this.now(); if (!workDataTime(value)) return fail("TIME_INVALID"); return value; }
  async listNotes(clientId: string, search = "") {
    const { connection } = await this.access(); await client(connection, this.workspaceId, clientId, false);
    const rows = await connection.all<WorkDataRow>("SELECT * FROM trainer_notes WHERE workspace_id=? AND client_id=? ORDER BY pinned DESC,created_at DESC,id", [this.workspaceId, clientId]);
    const needle = search.trim().normalize("NFC").toLocaleLowerCase("ru-RU");
    return readable(rows, workNote, "clients.workData.notes").filter((n) => !needle || n.body.normalize("NFC").toLocaleLowerCase("ru-RU").includes(needle));
  }
  async createNote(clientId: string, body: string) {
    bodyValid(body); const { writer } = await this.access();
    return writer.write((tx) => this.createNoteIn(tx, clientId, body));
  }
  private async createNoteIn(tx: SqliteStatementPort, clientId: string, body: string) {
    await client(tx, this.workspaceId, clientId, true); const now = this.time();
    const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id; if (!id) return fail("ID_UNAVAILABLE");
    await tx.run("INSERT INTO trainer_notes VALUES(?,?,?,?,?,?,0,'null',1)", [id, this.workspaceId, clientId, body, now, now]);
    return workNote((await tx.first<WorkDataRow>("SELECT * FROM trainer_notes WHERE id=? AND workspace_id=?", [id, this.workspaceId]))!);
  }
  async updateNote(clientId: string, id: string, expectedRevision: number, patch: Readonly<{ body: string; pinned: boolean }>) {
    const { body, pinned } = patch; bodyValid(body); revisionValid(expectedRevision); if (typeof pinned !== "boolean") fail("PIN_INVALID");
    const { writer } = await this.access(); return writer.write(async (tx) => {
      await client(tx, this.workspaceId, clientId, true);
      const updated = await tx.run("UPDATE trainer_notes SET body=?,pinned=?,updated_at=?,revision=revision+1 WHERE workspace_id=? AND client_id=? AND id=? AND revision=?",
        [body, pinned ? 1 : 0, this.time(), this.workspaceId, clientId, id, expectedRevision]);
      if (updated.changes !== 1) return fail("STALE_OR_WRONG_SCOPE");
      return workNote((await tx.first<WorkDataRow>("SELECT * FROM trainer_notes WHERE id=? AND workspace_id=?", [id, this.workspaceId]))!);
    });
  }
  async listTags(includeArchived = false) {
    const { connection } = await this.access();
    const rows = await connection.all<WorkDataRow>(`SELECT * FROM trainer_tags WHERE workspace_id=? ${includeArchived ? "" : "AND lifecycle='ACTIVE'"} ORDER BY normalized_name,id`, [this.workspaceId]);
    return readable(rows, workTag, "clients.workData.tags");
  }
  async listClientTags(clientId: string) {
    const { connection } = await this.access(); await client(connection, this.workspaceId, clientId, false);
    const rows = await connection.all<WorkDataRow>(`SELECT t.* FROM trainer_tags t JOIN client_tag_assignments a ON a.tag_id=t.id AND a.workspace_id=t.workspace_id
      WHERE a.workspace_id=? AND a.client_id=? ORDER BY t.normalized_name,t.id`, [this.workspaceId, clientId]);
    return readable(rows, workTag, "clients.workData.tags");
  }
  async createTag(name: string, color: string | null = null) {
    const normalized = trainerTagName(name); colorValid(color); const { writer } = await this.access();
    return writer.write(async (tx) => {
      await this.uniqueTag(tx, normalized.key); const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id; if (!id) return fail("ID_UNAVAILABLE");
      await tx.run("INSERT INTO trainer_tags VALUES(?,?,?,?,?,'ACTIVE',1)", [id, this.workspaceId, normalized.name, normalized.key, color]);
      return workTag((await tx.first<WorkDataRow>("SELECT * FROM trainer_tags WHERE workspace_id=? AND id=?", [this.workspaceId, id]))!);
    });
  }
  async updateTag(id: string, expectedRevision: number, patch: Readonly<{ name: string; color: string | null; lifecycle: "ACTIVE" | "ARCHIVED" }>) {
    const { name, color, lifecycle } = patch, normalized = trainerTagName(name); colorValid(color); revisionValid(expectedRevision);
    if (!["ACTIVE", "ARCHIVED"].includes(lifecycle)) fail("LIFECYCLE_INVALID"); const { writer } = await this.access();
    return writer.write(async (tx) => {
      await this.uniqueTag(tx, normalized.key, id);
      const updated = await tx.run("UPDATE trainer_tags SET name=?,normalized_name=?,color=?,lifecycle=?,revision=revision+1 WHERE workspace_id=? AND id=? AND revision=?",
        [normalized.name, normalized.key, color, lifecycle, this.workspaceId, id, expectedRevision]);
      if (updated.changes !== 1) return fail("STALE_OR_WRONG_SCOPE");
      return workTag((await tx.first<WorkDataRow>("SELECT * FROM trainer_tags WHERE workspace_id=? AND id=?", [this.workspaceId, id]))!);
    });
  }
  private async uniqueTag(tx: SqliteStatementPort, key: string, except = ""): Promise<void> {
    if (await tx.first("SELECT 1 FROM trainer_tags WHERE workspace_id=? AND normalized_name=? AND id<>?", [this.workspaceId, key, except])) fail("TAG_NAME_CONFLICT");
  }
  async assignTag(clientId: string, tagId: string): Promise<void> {
    const { writer } = await this.access(); await writer.write((tx) => this.assignTagIn(tx, clientId, tagId));
  }
  private async assignTagIn(tx: SqliteStatementPort, clientId: string, tagId: string): Promise<void> {
    await client(tx, this.workspaceId, clientId, true);
    const tag = await tx.first<WorkDataRow>("SELECT * FROM trainer_tags WHERE workspace_id=? AND id=?", [this.workspaceId, tagId]);
    if (!tag || workTag(tag).lifecycle !== "ACTIVE") return fail("TAG_UNAVAILABLE");
    await tx.run("INSERT OR IGNORE INTO client_tag_assignments VALUES(?,?,?)", [this.workspaceId, clientId, tagId]);
  }
  readonly creationParticipant: ClientWorkDataCreationParticipant<SqliteStatementPort> = {
    create: async (tx, clientId, input) => {
      const body = input.noteBody, tagIds = [...input.tagIds];
      if (body !== null) bodyValid(body);
      if (tagIds.some((id) => typeof id !== "string" || !id.trim())) return fail("TAG_UNAVAILABLE");
      await client(tx, this.workspaceId, clientId, true);
      const note = body === null ? null : await this.createNoteIn(tx, clientId, body);
      for (const id of new Set(tagIds)) await this.assignTagIn(tx, clientId, id);
      return note;
    },
  };
  async unassignTag(clientId: string, tagId: string): Promise<void> {
    const { writer } = await this.access(); await writer.write(async (tx) => {
      await client(tx, this.workspaceId, clientId, true);
      await tx.run("DELETE FROM client_tag_assignments WHERE workspace_id=? AND client_id=? AND tag_id=?", [this.workspaceId, clientId, tagId]);
    });
  }
  async listSafetyImportReviews(clientId: string) {
    const { connection } = await this.access(); await client(connection, this.workspaceId, clientId, false);
    return readable(await connection.all<WorkDataRow>("SELECT * FROM client_safety_import_reviews WHERE workspace_id=? AND client_id=? ORDER BY imported_at,id", [this.workspaceId, clientId]), workReview, "clients.workData.reviews");
  }
  async getImportEvidence(clientId: string) {
    const { connection } = await this.access(); await client(connection, this.workspaceId, clientId, false);
    return readable(await connection.all<WorkDataRow>("SELECT * FROM client_work_import_evidence WHERE workspace_id=? AND client_id=? ORDER BY source_sha256,source_key", [this.workspaceId, clientId]), workEvidence, "clients.workData.evidence");
  }
  /** Composition joins this participant to the explicit archived-client deletion
   * transaction. Workspace tags survive deletion of one of their clients. */
  deletionParticipant(): DevClientDeletionParticipant {
    return { owner: "clients.workData", tables: clientTables,
      count: async (tx: SqliteStatementPort, workspaceId: string, clientId: string) => {
        if (workspaceId !== this.workspaceId) return fail("WRONG_SCOPE"); let count = 0;
        for (const table of clientTables) count += (await tx.first<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE workspace_id=? AND client_id=?`, [workspaceId, clientId]))!.n;
        return count;
      },
      detach: async (tx: SqliteStatementPort, workspaceId: string, clientId: string) => {
        if (workspaceId !== this.workspaceId) return fail("WRONG_SCOPE");
        const row = await tx.first<{ lifecycle: string }>("SELECT lifecycle FROM clients WHERE workspace_id=? AND id=?", [workspaceId, clientId]);
        if (row?.lifecycle !== "ARCHIVED") return fail("CLIENT_NOT_ARCHIVED");
        for (const table of clientTables) await tx.run(`DELETE FROM ${table} WHERE workspace_id=? AND client_id=?`, [workspaceId, clientId]);
      } };
  }
}
