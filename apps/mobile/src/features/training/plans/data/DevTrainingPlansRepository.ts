import { runMigrations } from "../../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../../shared/db/WriterCoordinator.ts";
import type { ClientProgramLibrary, CreateProgramInput, ProgramCard, TrainingProgram } from "../domain/ProgramModel.ts";
import { compareLibrary, normalizeTitle, validateCreate, validateOrder } from "../domain/ProgramRules.ts";
import type { TrainingPlansCommittedChange, TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { DEFAULT_WEEKS, REST_MAX_SEC, REST_MIN_SEC, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import { withRestDefaults } from "../domain/SimplePlanEdits.ts";
import { DEV_TRAINING_PLANS_LEDGER, devTrainingPlansCatalog } from "./DevTrainingPlansCatalog.ts";
import { deleteStructure, readStructure, readWorkouts, writeStructure } from "./SimplePlanStore.ts";
import { deleteMemberMesocycles, insertMesocycle, readMesocycles, saveSelection, selectedMesocycle, writeWeek } from "./PeriodizedStore.ts";
import { MESOCYCLE_WEEKS_MAX, type Mesocycle, type NewMesocycleInput, type PeriodizedPlan, type PlanWeek, type WeekEditInput,
  type WeekEditResult } from "../domain/PeriodizedModel.ts";
import { applyWeekOps, copyWeeks, diffWeek, newMesocycleWeeks, targetWeeks } from "../domain/PeriodizedRules.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";

/** Ключ черновика ещё не созданной Простой программы (§48.29 п. 4: черновик привязан к объекту правки). */
export const NEW_SIMPLE_DRAFT_KEY = "new:SIMPLE";

/**
 * Структурная проверка в хранилище. Соответствие полей подхода профилю упражнения проверяет конструктор:
 * профиль знает каталог упражнений (другой владелец).
 */
function assertStructure(draft: SimpleProgramDraft): void {
  if (validateDraft(draft, () => ["reps", "load", "duration", "distance"]).length > 0) throw new Error("DRAFT_INVALID");
}

/** Неделя Расширенной программы проверяется теми же правилами, что и тренировки Простой. */
function assertWeek(title: string, workouts: readonly PlannedWorkout[]): void {
  assertStructure({ title, plan: { weeks: 1, workouts } });
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
    "dev_training_workouts", "dev_training_planned_exercises", "dev_training_planned_sets", "dev_training_builder_drafts",
    "dev_training_mesocycles", "dev_training_weeks", "dev_training_mesocycle_selection"] as const,
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
    // Свои мезоциклы клиента уходят и из общих программ: у остальных участников — их собственные копии.
    const programs = await tx.all<{ id: string }>(`SELECT program_id AS id FROM dev_training_program_members
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    for (const program of programs) await deleteMemberMesocycles(tx, workspaceId, program.id, clientId);
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
          m.archived_at AS archivedAt, m.sort_position AS sortPosition,
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
      active: cards.filter((card) => card.archivedAt === null).sort(compareLibrary),
      archived: cards.filter((card) => card.archivedAt !== null).sort(compareLibrary),
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

  async setExerciseRest(clientId: string, programId: string, plannedExerciseId: string, restSec: number | null,
    now: Date = new Date()): Promise<TrainingProgram> {
    if (restSec !== null && (!Number.isInteger(restSec) || restSec < REST_MIN_SEC || restSec > REST_MAX_SEC)) {
      throw new Error("DRAFT_INVALID");
    }
    const saved = await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      const result = await tx.run(`UPDATE dev_training_planned_exercises SET rest_sec = ?
        WHERE workspace_id = ? AND id = ? AND workout_id IN
          (SELECT id FROM dev_training_workouts WHERE workspace_id = ? AND program_id = ?)`,
      [restSec, this.workspaceId, plannedExerciseId, this.workspaceId, programId]);
      if (result.changes !== 1) throw new Error("TARGET_NOT_FOUND");
      await tx.run("UPDATE dev_training_programs SET revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [now.toISOString(), this.workspaceId, programId]);
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: saved.memberClientIds });
    return saved;
  }

  async findWorkout(clientId: string, programId: string, plannedWorkoutId: string) {
    const { connection } = this.ready();
    const program = await this.getProgram(clientId, programId);
    if (program === null) return null;
    // Расширенная: только тренировки своих мезоциклов этого клиента.
    const row = await connection.first<{ weekId: string | null }>(`SELECT w.week_id AS weekId FROM dev_training_workouts w
      WHERE w.workspace_id = ? AND w.program_id = ? AND w.id = ? AND (w.week_id IS NULL OR EXISTS (SELECT 1
        FROM dev_training_weeks k JOIN dev_training_mesocycles m ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id
        WHERE k.id = w.week_id AND k.workspace_id = w.workspace_id AND m.client_id = ?))`,
    [this.workspaceId, programId, plannedWorkoutId, clientId]);
    if (row === null) return null;
    const workout = (await readWorkouts(connection, this.workspaceId, programId, row.weekId)).find((item) => item.id === plannedWorkoutId);
    return workout === undefined ? null : { program, workout };
  }

  async getPeriodizedPlan(clientId: string, programId: string): Promise<PeriodizedPlan | null> {
    const { connection } = this.ready();
    const program = await this.getProgram(clientId, programId);
    if (program === null || program.kind !== "PERIODIZED") return null;
    const mesocycles = await readMesocycles(connection, this.workspaceId, programId, clientId);
    const selected = await selectedMesocycle(connection, this.workspaceId, programId, clientId);
    return { program, mesocycles, selectedMesocycleId: selected ?? mesocycles[0]?.id ?? null };
  }

  /** CAS по ревизии программы: структурная правка любого участника меняет ревизию общей программы. */
  private async bumpRevision(tx: SqliteStatementPort, programId: string, expectedRevision: number, now: Date): Promise<void> {
    const result = await tx.run(`UPDATE dev_training_programs SET revision = revision + 1, updated_at = ?
      WHERE workspace_id = ? AND id = ? AND revision = ?`, [now.toISOString(), this.workspaceId, programId, expectedRevision]);
    if (result.changes !== 1) throw new Error("PROGRAM_REVISION_CONFLICT");
  }

  /** Выбранные участники — действующие участники программы, открывший клиент среди них. */
  private async assertTargets(tx: SqliteStatementPort, clientId: string, programId: string, clientIds: readonly string[]) {
    const program = await programById(tx, this.workspaceId, programId);
    if (program.kind !== "PERIODIZED" || !clientIds.includes(clientId) || new Set(clientIds).size !== clientIds.length) {
      throw new Error("DRAFT_INVALID");
    }
    for (const id of clientIds) {
      if ((await membership(tx, this.workspaceId, id, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
    }
  }

  /** Запас новых ID: функции домена синхронные, ID для них берутся заранее. */
  private async idPool(tx: SqliteStatementPort, count: number): Promise<() => string> {
    const pool: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("PROGRAM_ID_UNAVAILABLE");
      pool.push(id);
    }
    return () => {
      const id = pool.pop();
      if (id === undefined) throw new Error("PROGRAM_ID_UNAVAILABLE");
      return id;
    };
  }

  async createMesocycle(clientId: string, programId: string, expectedRevision: number, input: NewMesocycleInput,
    now: Date = new Date()) {
    const title = normalizeTitle(input.title);
    if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > MESOCYCLE_WEEKS_MAX) throw new Error("DRAFT_INVALID");
    assertWeek(title, input.firstWeek);
    const created = await this.ready().writer.write(async (tx) => {
      await this.assertTargets(tx, clientId, programId, input.clientIds);
      await this.bumpRevision(tx, programId, expectedRevision, now);
      const rows = input.firstWeek.reduce((sum, workout) => sum + 1
        + workout.exercises.reduce((inner, exercise) => inner + 1 + exercise.sets.length, 0), 0);
      const take = await this.idPool(tx, 2 + input.clientIds.length * (1 + input.weeks * (1 + rows)));
      const lineageId = take();
      const template = newMesocycleWeeks(input.firstWeek, input.weeks, take);
      let ownId = "";
      for (const [index, memberId] of input.clientIds.entries()) {
        const mesocycle: Mesocycle = { id: take(), lineageId, title, weeks: index === 0 ? template : copyWeeks(template, take) };
        await insertMesocycle(tx, this.workspaceId, programId, memberId, mesocycle, now);
        if (memberId === clientId) ownId = mesocycle.id;
      }
      await saveSelection(tx, this.workspaceId, programId, clientId, ownId);
      return { program: await programById(tx, this.workspaceId, programId), mesocycleId: ownId };
    });
    this.publish({ clientIds: input.clientIds });
    return created;
  }

  async saveWeek(clientId: string, programId: string, expectedRevision: number, input: WeekEditInput,
    now: Date = new Date()): Promise<WeekEditResult> {
    const saved = await this.ready().writer.write(async (tx) => {
      await this.assertTargets(tx, clientId, programId, input.clientIds);
      const own = (await readMesocycles(tx, this.workspaceId, programId, clientId)).find((item) => item.id === input.mesocycleId);
      const open = own?.weeks.find((week) => week.index === input.weekIndex);
      if (own === undefined || open === undefined) throw new Error("TARGET_NOT_FOUND");
      assertWeek(own.title, input.workouts);
      await this.bumpRevision(tx, programId, expectedRevision, now);
      const ops = diffWeek(open.workouts, input.workouts);
      const rows = input.workouts.reduce((sum, workout) => sum + 1
        + workout.exercises.reduce((inner, exercise) => inner + 1 + exercise.sets.length, 0), 0);
      let skipped = 0;
      for (const memberId of input.clientIds) {
        const mesocycle = memberId === clientId ? own
          : (await readMesocycles(tx, this.workspaceId, programId, memberId)).find((item) => item.lineageId === own.lineageId);
        if (mesocycle === undefined) { skipped += 1; continue; }
        for (const index of targetWeeks(mesocycle.weeks, input.weekIndex, input.scope)) {
          const week = mesocycle.weeks.find((item) => item.index === index) as PlanWeek;
          // Открытая неделя открывшего клиента сохраняется ровно такой, какой её отредактировали.
          if (memberId === clientId && index === input.weekIndex) {
            await writeWeek(tx, this.workspaceId, programId, { ...week, type: input.type, workouts: input.workouts });
            continue;
          }
          const applied = applyWeekOps(week.workouts, ops, await this.idPool(tx, rows));
          skipped += applied.skipped;
          await writeWeek(tx, this.workspaceId, programId, { ...week,
            type: index === input.weekIndex ? input.type : week.type, workouts: applied.workouts });
        }
      }
      return { program: await programById(tx, this.workspaceId, programId), skipped };
    });
    this.publish({ clientIds: input.clientIds });
    return saved;
  }

  async reorderPrograms(clientId: string, programIds: readonly string[]): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      const current = await tx.all<{ id: string }>(`SELECT program_id AS id FROM dev_training_program_members
        WHERE workspace_id = ? AND client_id = ? AND archived_at IS NULL`, [this.workspaceId, clientId]);
      validateOrder(current.map((item) => item.id), programIds);
      for (const [index, programId] of programIds.entries()) {
        const result = await tx.run(`UPDATE dev_training_program_members SET sort_position = ?
          WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND archived_at IS NULL`,
        [index, this.workspaceId, clientId, programId]);
        if (result.changes !== 1) throw new Error("TARGET_NOT_FOUND");
      }
    });
    this.publish({ clientIds: [clientId] });
  }

  async reorderMesocycles(clientId: string, programId: string, mesocycleIds: readonly string[]): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const current = await tx.all<{ id: string }>(`SELECT id FROM dev_training_mesocycles
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [this.workspaceId, programId, clientId]);
      validateOrder(current.map((item) => item.id), mesocycleIds);
      for (const [index, mesocycleId] of mesocycleIds.entries()) {
        const result = await tx.run(`UPDATE dev_training_mesocycles SET position = ?
          WHERE workspace_id = ? AND program_id = ? AND client_id = ? AND id = ?`,
        [index, this.workspaceId, programId, clientId, mesocycleId]);
        if (result.changes !== 1) throw new Error("TARGET_NOT_FOUND");
      }
    });
    this.publish({ clientIds: [clientId] });
  }

  async selectMesocycle(clientId: string, programId: string, mesocycleId: string): Promise<void> {
    const changed = await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      return saveSelection(tx, this.workspaceId, programId, clientId, mesocycleId);
    });
    if (changed) this.publish({ clientIds: [clientId] });
  }

  async getBuilderDraft(clientId: string, key: string) {
    const row = await this.ready().connection.first<{ baseRevision: number | null; draftJson: string }>(`SELECT
      base_revision AS baseRevision, draft_json AS draftJson FROM dev_training_builder_drafts
      WHERE workspace_id = ? AND client_id = ? AND draft_key = ?`, [this.workspaceId, clientId, key]);
    if (row === null) return null;
    // Черновик удалённой программы не воскрешает её (§48.29 п. 7).
    if (key !== NEW_SIMPLE_DRAFT_KEY && (await this.getProgram(clientId, key)) === null) return null;
    return { baseRevision: row.baseRevision, draft: withRestDefaults(JSON.parse(row.draftJson) as SimpleProgramDraft) };
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
