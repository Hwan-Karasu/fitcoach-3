import { runMigrations } from "../../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../../shared/db/WriterCoordinator.ts";
import type { ClientProgramLibrary, CreateProgramInput, ProgramCard, TrainingProgram } from "../domain/ProgramModel.ts";
import { compareCards, normalizeTitle, validateCreate } from "../domain/ProgramRules.ts";
import type { TrainingPlansCommittedChange, TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { DEFAULT_WEEKS, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import { DEV_TRAINING_PLANS_LEDGER, devTrainingPlansCatalog } from "./DevTrainingPlansCatalog.ts";
import { deleteStructure, readStructure, writeStructure } from "./SimplePlanStore.ts";

/** Ключ черновика ещё не созданной Простой программы (§48.29 п. 4: черновик привязан к объекту правки). */
export const NEW_SIMPLE_DRAFT_KEY = "new:SIMPLE";

/**
 * Структурная проверка в хранилище. Соответствие полей подхода профилю упражнения проверяет конструктор:
 * профиль знает каталог упражнений (другой владелец).
 */
function assertStructure(draft: SimpleProgramDraft): void {
  if (validateDraft(draft, () => ["reps", "load", "duration", "distance"]).length > 0) throw new Error("DRAFT_INVALID");
}

type ProgramRow = Readonly<{ id: string; kind: TrainingProgram["kind"]; title: string; revision: number; createdAt: string }>;

async function programById(tx: SqliteStatementPort, workspaceId: string, id: string): Promise<TrainingProgram> {
  const row = await tx.first<ProgramRow>(`SELECT id, kind, title, revision, created_at AS createdAt
    FROM dev_training_programs WHERE workspace_id = ? AND id = ?`, [workspaceId, id]);
  if (row === null) throw new Error("TARGET_NOT_FOUND");
  const members = await tx.all<{ clientId: string }>(`SELECT client_id AS clientId FROM dev_training_program_members
    WHERE workspace_id = ? AND program_id = ? ORDER BY joined_at, rowid`, [workspaceId, id]);
  return { ...row, memberClientIds: members.map((member) => member.clientId) };
}

async function membership(tx: SqliteStatementPort, workspaceId: string, clientId: string, programId: string):
  Promise<Readonly<{ archivedAt: string | null }>> {
  const row = await tx.first<{ archivedAt: string | null }>(`SELECT archived_at AS archivedAt
    FROM dev_training_program_members WHERE workspace_id = ? AND program_id = ? AND client_id = ?`,
  [workspaceId, programId, clientId]);
  if (row === null) throw new Error("TARGET_NOT_FOUND");
  return row;
}

/**
 * Сторона тренировочных планов в PermanentlyDeleteArchivedClient (§15.7): участия и выбор клиента;
 * программа, где он был единственным участником, удаляется, общая — остаётся остальным.
 */
export const devTrainingPlansClientDeletionParticipant = {
  owner: "training.plans",
  tables: ["dev_training_client_selection", "dev_training_program_members", "dev_training_programs",
    "dev_training_workouts", "dev_training_planned_exercises", "dev_training_planned_sets", "dev_training_builder_drafts"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_training_program_members
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    const owned = await tx.all<{ id: string }>(`SELECT program_id AS id FROM dev_training_program_members m
      WHERE workspace_id = ? AND client_id = ? AND NOT EXISTS (SELECT 1 FROM dev_training_program_members o
        WHERE o.workspace_id = m.workspace_id AND o.program_id = m.program_id AND o.client_id <> m.client_id)`,
    [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_client_selection WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_program_members WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_builder_drafts WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    for (const program of owned) {
      await deleteStructure(tx, workspaceId, program.id);
      await tx.run("DELETE FROM dev_training_programs WHERE workspace_id = ? AND id = ?", [workspaceId, program.id]);
    }
  },
};

/** Явно dev-хранилище новой установки в общем dev-файле клиентов. */
export class DevTrainingPlansRepository implements TrainingPlansRepositoryPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: TrainingPlansCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
  }

  /** Хранилище клиентов инициализируется первым: схема ссылается на его таблицы. */
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
    if (!this.workspaceId.trim()) throw new Error("TRAINING_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devTrainingPlansCatalog, DEV_TRAINING_PLANS_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("TRAINING_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: TrainingPlansCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: TrainingPlansCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Наблюдатель не превращает коммит в ошибку. */ }
    }
  }

  async getLibrary(clientId: string): Promise<ClientProgramLibrary> {
    const { connection } = this.ready();
    const [cards, selection] = await Promise.all([
      connection.all<ProgramCard>(`SELECT p.id, p.kind, p.title, p.revision, p.created_at AS createdAt,
          m.archived_at AS archivedAt,
          (SELECT count(*) FROM dev_training_program_members o WHERE o.workspace_id = p.workspace_id
            AND o.program_id = p.id AND o.archived_at IS NULL) AS memberCount
        FROM dev_training_program_members m
        JOIN dev_training_programs p ON p.id = m.program_id AND p.workspace_id = m.workspace_id
        WHERE m.workspace_id = ? AND m.client_id = ?`, [this.workspaceId, clientId]),
      connection.first<{ programId: string }>(`SELECT program_id AS programId FROM dev_training_client_selection
        WHERE workspace_id = ? AND client_id = ?`, [this.workspaceId, clientId]),
    ]);
    return {
      clientId,
      active: cards.filter((card) => card.archivedAt === null).sort(compareCards),
      archived: cards.filter((card) => card.archivedAt !== null).sort(compareCards),
      selectedProgramId: selection?.programId ?? null,
    };
  }

  async getProgram(clientId: string, programId: string): Promise<TrainingProgram | null> {
    const program = await programById(this.ready().connection, this.workspaceId, programId).catch(() => null);
    return program !== null && program.memberClientIds.includes(clientId) ? program : null;
  }

  async createProgram(input: CreateProgramInput, now: Date = new Date()): Promise<TrainingProgram> {
    const valid = validateCreate(input);
    const created = await this.ready().writer.write((tx) => this.insertProgram(tx, valid, now, null));
    this.publish({ clientIds: created.memberClientIds });
    return created;
  }

  private async insertProgram(tx: SqliteStatementPort, valid: CreateProgramInput, now: Date,
    weeks: number | null): Promise<TrainingProgram> {
    {
      // Назначить можно только действующему клиенту этого рабочего пространства.
      for (const clientId of valid.clientIds) {
        const client = await tx.first<{ lifecycle: string }>(`SELECT lifecycle FROM dev_clients
          WHERE workspace_id = ? AND id = ?`, [this.workspaceId, clientId]);
        if (client?.lifecycle !== "ACTIVE") throw new Error("TARGET_NOT_FOUND");
      }
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("PROGRAM_ID_UNAVAILABLE");
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO dev_training_programs (id, workspace_id, kind, title, revision, created_at, updated_at, weeks)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?)`, [id, this.workspaceId, valid.kind, valid.title, stamp, stamp, weeks]);
      for (const clientId of valid.clientIds) {
        await tx.run(`INSERT INTO dev_training_program_members (workspace_id, program_id, client_id, joined_at)
          VALUES (?, ?, ?, ?)`, [this.workspaceId, id, clientId, stamp]);
      }
      return programById(tx, this.workspaceId, id);
    }
  }

  async getSimplePlan(clientId: string, programId: string) {
    const { connection } = this.ready();
    const program = await this.getProgram(clientId, programId);
    if (program === null || program.kind !== "SIMPLE") return null;
    const row = await connection.first<{ weeks: number | null }>("SELECT weeks FROM dev_training_programs WHERE workspace_id = ? AND id = ?",
      [this.workspaceId, programId]);
    const plan = await readStructure(connection, this.workspaceId, programId, row?.weeks ?? DEFAULT_WEEKS);
    return { program, draft: { title: program.title, plan } };
  }

  async createSimpleProgram(clientId: string, draft: SimpleProgramDraft, now: Date = new Date()): Promise<TrainingProgram> {
    const valid = validateCreate({ kind: "SIMPLE", title: draft.title, clientIds: [clientId] });
    assertStructure(draft);
    const created = await this.ready().writer.write(async (tx) => {
      const program = await this.insertProgram(tx, valid, now, draft.plan.weeks);
      await writeStructure(tx, this.workspaceId, program.id, draft.plan);
      await tx.run("DELETE FROM dev_training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, NEW_SIMPLE_DRAFT_KEY]);
      return program;
    });
    this.publish({ clientIds: created.memberClientIds });
    return created;
  }

  async saveSimplePlan(clientId: string, programId: string, expectedRevision: number, draft: SimpleProgramDraft,
    now: Date = new Date()): Promise<TrainingProgram> {
    const title = normalizeTitle(draft.title);
    assertStructure(draft);
    const saved = await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      const current = await programById(tx, this.workspaceId, programId);
      if (current.kind !== "SIMPLE") throw new Error("DRAFT_INVALID");
      const result = await tx.run(`UPDATE dev_training_programs SET title = ?, weeks = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`,
      [title, draft.plan.weeks, now.toISOString(), this.workspaceId, programId, expectedRevision]);
      if (result.changes !== 1) throw new Error("PROGRAM_REVISION_CONFLICT");
      await writeStructure(tx, this.workspaceId, programId, draft.plan);
      await tx.run("DELETE FROM dev_training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, programId]);
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: saved.memberClientIds });
    return saved;
  }

  async getBuilderDraft(clientId: string, key: string) {
    const row = await this.ready().connection.first<{ baseRevision: number | null; draftJson: string }>(`SELECT
      base_revision AS baseRevision, draft_json AS draftJson FROM dev_training_builder_drafts
      WHERE workspace_id = ? AND client_id = ? AND draft_key = ?`, [this.workspaceId, clientId, key]);
    if (row === null) return null;
    // Черновик удалённой программы не воскрешает её (§48.29 п. 7).
    if (key !== NEW_SIMPLE_DRAFT_KEY && (await this.getProgram(clientId, key)) === null) return null;
    return { baseRevision: row.baseRevision, draft: JSON.parse(row.draftJson) as SimpleProgramDraft };
  }

  async saveBuilderDraft(clientId: string, key: string, baseRevision: number | null, draft: SimpleProgramDraft): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO dev_training_builder_drafts (workspace_id, client_id, draft_key, base_revision, draft_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, draft_key) DO UPDATE SET
        base_revision = excluded.base_revision, draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, key, baseRevision, JSON.stringify(draft), new Date().toISOString()]);
    });
  }

  async clearBuilderDraft(clientId: string, key: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM dev_training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, key]);
    });
  }

  async renameProgram(programId: string, expectedRevision: number, title: string, now: Date = new Date()): Promise<TrainingProgram> {
    const value = normalizeTitle(title);
    const renamed = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_training_programs SET title = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`,
      [value, now.toISOString(), this.workspaceId, programId, expectedRevision]);
      if (result.changes !== 1) {
        await programById(tx, this.workspaceId, programId);
        throw new Error("PROGRAM_REVISION_CONFLICT");
      }
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: renamed.memberClientIds });
    return renamed;
  }

  async selectProgram(clientId: string, programId: string): Promise<void> {
    const changed = await this.ready().writer.write(async (tx) => {
      const current = await membership(tx, this.workspaceId, clientId, programId);
      if (current.archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const result = await tx.run(`INSERT INTO dev_training_client_selection (workspace_id, client_id, program_id) VALUES (?, ?, ?)
        ON CONFLICT(workspace_id, client_id) DO UPDATE SET program_id = excluded.program_id
          WHERE program_id IS NOT excluded.program_id`,
      [this.workspaceId, clientId, programId]);
      return result.changes > 0;
    });
    // Повторное открытие той же программы — не изменение: иначе экран программы перезагружает сам себя.
    if (changed) this.publish({ clientIds: [clientId] });
  }

  async archiveForClient(clientId: string, programId: string, now: Date = new Date()): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      const current = await membership(tx, this.workspaceId, clientId, programId);
      if (current.archivedAt !== null) return;
      await tx.run("DELETE FROM dev_training_client_selection WHERE workspace_id = ? AND client_id = ? AND program_id = ?",
        [this.workspaceId, clientId, programId]);
      await tx.run(`UPDATE dev_training_program_members SET archived_at = ?
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [now.toISOString(), this.workspaceId, programId, clientId]);
    });
    this.publish({ clientIds: [clientId] });
  }

  async restoreForClient(clientId: string, programId: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      await tx.run(`UPDATE dev_training_program_members SET archived_at = NULL
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [this.workspaceId, programId, clientId]);
    });
    this.publish({ clientIds: [clientId] });
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
