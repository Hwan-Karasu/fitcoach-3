import { runMigrations } from "../../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_BATCH_SQL, UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../../shared/db/WriterCoordinator.ts";
import type { ClientProgramLibrary, CreateProgramInput, ProgramCard, TrainingProgram } from "../domain/ProgramModel.ts";
import { compareLibrary, normalizeTitle, validateCreate, validateOrder } from "../domain/ProgramRules.ts";
import type { TrainingPlansCommittedChange, TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { DEFAULT_WEEKS, REST_MAX_SEC, REST_MIN_SEC, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import { withRestDefaults } from "../domain/SimplePlanEdits.ts";
import { DEV_TRAINING_PLANS_LEDGER, devTrainingPlansCatalog } from "./DevTrainingPlansCatalog.ts";
import { readStoredJson } from "../../../../shared/db/StoredJson.ts";
import { reportReadIssue } from "../../../../shared/diagnostics/ReadIssues.ts";
import { storedBuilderDraft, storedMesocycleBuilder, storedPeriodizedDraft, storedTemplate, storedWorkoutDraft } from "../domain/StoredPlanShape.ts";
import { deleteStructure, readStructure, readWorkouts, writeStructure, writeWorkouts } from "./SimplePlanStore.ts";
import type { MesocycleSavePlansParticipant, MesocycleSaveRequest } from "../domain/MesocycleSave.ts";
import type { SimplePlanSavePlansParticipant } from "../domain/SimplePlanSave.ts";
import type { WeekEditSavePlansParticipant } from "../domain/WeekEditSave.ts";
import type { MesocycleDeleteRequest, PlanDeletePlansParticipant } from "../domain/PlanDeletion.ts";
import { preferredPlacement, type ClientPlacementOptions, type GroupCopy, type Placement, type PlacementProgram,
  type PlacementTarget } from "../domain/Placement.ts";
import { navigationGroup as groupOfCopy, navigationGroupId, moveNavigationMember, putNavigationMember } from "./NavigationGroupStore.ts";
import { findCopy, readCopy } from "./MesocycleGroupStore.ts";
import { deleteMemberMesocycles, insertMesocycle, readMesocycle, readMesocycles, saveSelection, selectedMesocycle, writeWeek } from "./PeriodizedStore.ts";
import { MESOCYCLE_WEEKS_MAX, weekTypeLabels, type Mesocycle, type NewMesocycleInput, type NewPeriodizedProgramInput, type BuilderMesocycleInput, type PeriodizedPlan, type PlanWeek, type WeekEditInput,
  type WeekEditConflict, type WeekEditPreview, type WeekEditResult } from "../domain/PeriodizedModel.ts";
import { copyWeeks, diffWeek, newMesocycleWeeks, opsNeedIds, targetWeeks, withLineage } from "../domain/PeriodizedRules.ts";
import { fillEmptyWeeks, type MesocycleSettings } from "../domain/MesocycleBuilder.ts";
import { applyWithConflicts } from "../domain/WeekConflicts.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";
import { mesocycleBuilderDraftKey, periodizedDraftKey, type MesocycleBuilderDraft, type MesocycleBuilderScope, type PeriodizedDraft } from "../domain/PeriodizedDraft.ts";
import { mesocycleCreatedAt, preserveMesocycle, readMesocycleHistory } from "./StructureVersionStore.ts";
import type { MesocycleVersion } from "../domain/StructureVersion.ts";
import { simpleWorkoutDraftKey, type SimpleWorkoutDraft, type SimpleWorkoutEdit } from "../domain/SimpleWorkoutEdit.ts";
import { assertSimpleIdentities, parseOverride, preserveSimple, readSimpleHistory, readSimpleWeeks, writeSimpleOverride } from "./SimpleWeekStore.ts";
import { independentWeeks, weekRowCount, type CopyMesocycleInput } from "../domain/PlanCopy.ts";
import type { WeekPlansParticipant, WeekCopyRequest } from "../domain/WeekCopy.ts";
import type { WeekSwapPlansParticipant } from "../domain/WeekSwap.ts";
import { templateMesocycle, weeksFromTemplate, workoutsFromTemplate, type ProgramTemplate, type TemplateKind,
  type TemplatePayload } from "../domain/TemplateModel.ts";

type TemplateRow = Readonly<{ id: string; kind: TemplateKind; title: string; revision: number; createdAt: string;
  updatedAt: string; payloadJson: string }>;

const TEMPLATE_COLUMNS = `id, kind, title, revision, created_at AS createdAt, updated_at AS updatedAt, payload_json AS payloadJson`;

function templateOf(row: TemplateRow): ProgramTemplate | null {
  const { payloadJson, ...rest } = row;
  const payload = readStoredJson(payloadJson, storedTemplate, `training_templates:${row.id}`);
  if (payload === null) return null;
  if (payload.kind !== row.kind) { reportReadIssue(`training_templates:${row.id}`); return null; }
  return { ...rest, payload };
}

/** Черновик Простого конструктора с базой для перебазирования (без базы хранится как есть — прежний вид). */
type BuilderDraftEnvelope = Readonly<{ envelope: 2; draft: SimpleProgramDraft; base: SimpleProgramDraft | null }>;

/** Ключ черновика ещё не созданной Простой программы (§48.29 п. 4: черновик привязан к объекту правки). */
export const NEW_SIMPLE_DRAFT_KEY = "new:SIMPLE";
/** Черновик правки Простого шаблона: `template:<id>`; программой не проверяется. */
export const TEMPLATE_DRAFT_PREFIX = "template:";

/**
 * Структурная проверка в хранилище. Соответствие полей подхода профилю упражнения проверяет конструктор:
 * профиль знает каталог упражнений (другой владелец).
 */
function assertStructure(draft: SimpleProgramDraft): void {
  if (validateDraft(draft, () => ["reps", "load", "duration", "distance"]).length > 0) throw new Error("DRAFT_INVALID");
}

/** Настройки мезоцикла (UI-OWN-038): повторения 1–100, верх не меньше низа; дата — YYYY-MM-DD. */
function assertSettings(settings: MesocycleSettings): void {
  const reps = settings.repRange;
  if (reps !== null && (!Number.isInteger(reps.min) || reps.min < 1 || reps.min > 100
    || (reps.max !== null && (!Number.isInteger(reps.max) || reps.max < reps.min || reps.max > 100)))) throw new Error("DRAFT_INVALID");
  if (settings.startDate !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(settings.startDate)) throw new Error("DRAFT_INVALID");
}

/** Неделя Расширенной программы проверяется теми же правилами, что и тренировки Простой. */
function assertWeek(title: string, workouts: readonly PlannedWorkout[]): void {
  assertStructure({ title, plan: { weeks: 1, workouts } });
}

type ProgramRow = Readonly<{ id: string; kind: TrainingProgram["kind"]; title: string; revision: number; createdAt: string }>;

async function programById(tx: SqliteStatementPort, workspaceId: string, id: string): Promise<TrainingProgram> {
  const row = await tx.first<ProgramRow>(`SELECT id, kind, title, revision, created_at AS createdAt
    FROM training_programs WHERE workspace_id = ? AND id = ?`, [workspaceId, id]);
  if (row === null) throw new Error("TARGET_NOT_FOUND");
  const members = await tx.all<{ clientId: string }>(`SELECT client_id AS clientId FROM training_program_members
    WHERE workspace_id = ? AND program_id = ? ORDER BY joined_at, rowid`, [workspaceId, id]);
  return { ...row, memberClientIds: members.map((member) => member.clientId) };
}

async function membership(tx: SqliteStatementPort, workspaceId: string, clientId: string, programId: string):
  Promise<Readonly<{ archivedAt: string | null }>> {
  const row = await tx.first<{ archivedAt: string | null }>(`SELECT archived_at AS archivedAt
    FROM training_program_members WHERE workspace_id = ? AND program_id = ? AND client_id = ?`,
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
  tables: ["training_client_selection", "training_program_members", "training_programs",
    "training_workouts", "training_planned_exercises", "training_planned_sets", "training_builder_drafts",
    "training_mesocycles", "training_weeks", "training_mesocycle_selection", "training_periodized_drafts",
    "training_structure_versions", "training_simple_overrides", "training_simple_versions",
    "training_navigation_groups", "training_navigation_members"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM training_program_members
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    const owned = await tx.all<{ id: string }>(`SELECT program_id AS id FROM training_program_members m
      WHERE workspace_id = ? AND client_id = ? AND NOT EXISTS (SELECT 1 FROM training_program_members o
        WHERE o.workspace_id = m.workspace_id AND o.program_id = m.program_id AND o.client_id <> m.client_id)`,
    [workspaceId, clientId]);
    // Свои мезоциклы клиента уходят и из общих программ: у остальных участников — их собственные копии.
    await tx.run("DELETE FROM training_periodized_drafts WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM training_structure_versions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM training_simple_overrides WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM training_simple_versions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const programs = await tx.all<{ id: string }>(`SELECT program_id AS id FROM training_program_members
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    for (const program of programs) await deleteMemberMesocycles(tx, workspaceId, program.id, clientId);
    await tx.run("DELETE FROM training_client_selection WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM training_program_members WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    for (const program of owned) {
      await deleteStructure(tx, workspaceId, program.id);
      await tx.run("DELETE FROM training_programs WHERE workspace_id = ? AND id = ?", [workspaceId, program.id]);
    }
  },
};

/** Явно dev-хранилище новой установки в общем dev-файле клиентов. */
export class DevTrainingPlansRepository implements TrainingPlansRepositoryPort {
  notifyTransfer(clientId: string): void { this.publish({ clientIds: [clientId] }); }
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

  private readonly planCache = new Map<string, Promise<PeriodizedPlan | null>>();
  private readonly planReads = new Map<string, Promise<PeriodizedPlan | null>>();
  private readonly programReads = new Map<string, Promise<TrainingProgram | null>>();
  private readonly groupReads = new Map<string, Promise<readonly GroupCopy[]>>();

  private readOnce<T>(reads: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const existing = reads.get(key);
    if (existing !== undefined) return existing;
    const pending = load();
    reads.set(key, pending);
    const clear = () => { if (reads.get(key) === pending) reads.delete(key); };
    void pending.then(clear, clear);
    return pending;
  }

  private publish(change: TrainingPlansCommittedChange): void {
    this.planCache.clear();
    this.planReads.clear();
    this.programReads.clear();
    this.groupReads.clear();
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Наблюдатель не превращает коммит в ошибку. */ }
    }
  }

  async getLibrary(clientId: string): Promise<ClientProgramLibrary> {
    const { connection } = this.ready();
    const [cards, selection] = await Promise.all([
      connection.all<ProgramCard>(`SELECT p.id, p.kind, p.title, p.revision, p.created_at AS createdAt,
          m.archived_at AS archivedAt, m.sort_position AS sortPosition,
          (SELECT count(*) FROM training_program_members o WHERE o.workspace_id = p.workspace_id
            AND o.program_id = p.id AND o.archived_at IS NULL) AS memberCount
        FROM training_program_members m
        JOIN training_programs p ON p.id = m.program_id AND p.workspace_id = m.workspace_id
        WHERE m.workspace_id = ? AND m.client_id = ?`, [this.workspaceId, clientId]),
      connection.first<{ programId: string }>(`SELECT program_id AS programId FROM training_client_selection
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
    return this.readOnce(this.programReads, JSON.stringify([clientId, programId]), async () => {
      const program = await programById(this.ready().connection, this.workspaceId, programId).catch((error: unknown) => {
        if (error instanceof Error && error.message === "TARGET_NOT_FOUND") return null;
        throw error;
      });
      return program !== null && program.memberClientIds.includes(clientId) ? program : null;
    });
  }

  async createProgram(input: CreateProgramInput, now: Date = new Date()): Promise<TrainingProgram> {
    const valid = validateCreate(input);
    const created = await this.ready().writer.write((tx) => this.insertProgram(tx, valid, now, null));
    this.publish({ clientIds: created.memberClientIds });
    return created;
  }

  async createPeriodizedProgram(input: NewPeriodizedProgramInput, now: Date = new Date()): Promise<TrainingProgram> {
    const placements = new Map((input.placements ?? []).map((item) => [item.clientId, item.target]));
    // Участники новой программы — открывший и те, кому выбрано «в эту программу»; остальным — копия в их программу.
    const memberIds = input.clientIds.filter((id, index) => index === 0 || (placements.get(id)?.kind ?? "join") === "join");
    const placed = input.clientIds.filter((id) => !memberIds.includes(id));
    const valid = validateCreate({ kind: "PERIODIZED", title: input.title, clientIds: memberIds });
    const { mesocycle } = input;
    const title = normalizeTitle(mesocycle.title);
    assertSettings(mesocycle);
    if (mesocycle.weeks.length < 1 || mesocycle.weeks.length > MESOCYCLE_WEEKS_MAX) throw new Error("DRAFT_INVALID");
    // Временные ID только для заполнения; настоящие выдаются ниже вместе с новым родством.
    let local = 0;
    const filled = fillEmptyWeeks(mesocycle.weeks, () => `fill:${local++}`);
    if (filled.some((week) => week.workouts.length === 0)) throw new Error("DRAFT_INVALID");
    for (const week of filled) assertWeek(title, week.workouts);
    const weeks: readonly PlanWeek[] = filled.map((week, index) => ({ id: `week:${index}`, index: index + 1, type: week.type,
      workouts: withLineage(week.workouts) }));
    const created = await this.ready().writer.write(async (tx) => {
      await this.validateAttachments(tx, input.placements ?? []);
      const program = await this.insertProgram(tx, valid, now, null);
      const rows = weekRowCount(weeks);
      const take = await this.idPool(tx, 1 + 2 * rows + input.clientIds.length * (1 + rows));
      const lineageId = take();
      const template = independentWeeks(weeks, take);
      const settings = { cycleType: mesocycle.cycleType, repRange: mesocycle.repRange, startDate: mesocycle.startDate };
      for (const [index, memberId] of valid.clientIds.entries()) {
        const id = take();
        await insertMesocycle(tx, this.workspaceId, program.id, memberId, { id, lineageId, title, ...settings,
          weeks: index === 0 ? template : copyWeeks(template, take) }, now);
        await saveSelection(tx, this.workspaceId, program.id, memberId, id);
      }
      for (const memberId of placed) {
        if (placements.get(memberId)?.kind === "existing") {
          await this.attachExisting(tx, memberId, placements.get(memberId)!, `copy:${lineageId}`); continue;
        }
        await this.placeCopy(tx, memberId, placements.get(memberId)!, program.id,
          { id: take(), lineageId, title, ...settings, weeks: copyWeeks(template, take) }, now);
      }
      return program;
    });
    this.publish({ clientIds: input.clientIds });
    return created;
  }

  /** Shared transaction participant for a builder containing several imported cycles. */
  readonly workbookSaveParticipant = {
    create: async (tx: SqliteStatementPort, input: Readonly<{ title: string; clientIds: readonly string[]; placements: readonly Placement[] }>, now: Date) => {
      await this.validateAttachments(tx, input.placements);
      const targets = new Map(input.placements.map((p) => [p.clientId, p.target]));
      const members = input.clientIds.filter((id, at) => at === 0 || (targets.get(id)?.kind ?? "join") === "join");
      return this.insertProgram(tx, validateCreate({ kind: "PERIODIZED", title: input.title, clientIds: members }), now, null);
    },
    check: async (tx: SqliteStatementPort, clientId: string, programId: string, expectedRevision: number) => {
      await this.assertTargets(tx, clientId, programId, [clientId]);
      const p = await programById(tx, this.workspaceId, programId);
      if (p.revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      if (p.kind !== "PERIODIZED") throw new Error("DRAFT_INVALID");
      return p;
    },
    append: async (tx: SqliteStatementPort, input: Readonly<{ clientId: string; programId: string; cycle: Mesocycle;
      clientIds: readonly string[]; placements: readonly Placement[]; first: boolean; imported: boolean }>, now: Date) => {
      const { clientId, programId } = input;
      const cycle = input.imported ? input.cycle : { ...input.cycle, weeks: (await this.builderWeeks(tx, {
        title: input.cycle.title, cycleType: input.cycle.cycleType ?? null, repRange: input.cycle.repRange ?? null, startDate: input.cycle.startDate ?? null,
        weeks: input.cycle.weeks })).map((w, at) => ({ ...w, id: input.cycle.weeks[at]!.id })) };
      const title = normalizeTitle(cycle.title);
      if (!cycle.weeks.length || cycle.weeks.length > 52 || !cycle.weeks.some((w) => w.workouts.length)) throw new Error("DRAFT_INVALID");
      assertSettings({ cycleType: cycle.cycleType ?? null, repRange: cycle.repRange ?? null, startDate: cycle.startDate ?? null });
      for (const week of cycle.weeks) if (week.workouts.length) assertWeek(title, week.workouts);
      await this.validateAttachments(tx, input.placements);
      await insertMesocycle(tx, this.workspaceId, programId, clientId, { ...cycle, title }, now);
      const targets = new Map(input.placements.map((p) => [p.clientId, p.target]));
      const others = input.clientIds.filter((id) => id !== clientId);
      const resolved: Placement[] = [];
      const take = await this.idPool(tx, Math.max(1, others.length * (1 + weekRowCount(cycle.weeks))));
      for (const memberId of others) {
        const target = targets.get(memberId) ?? { kind: "join" as const };
        if (target.kind === "existing" && input.first) {
          await this.attachExisting(tx, memberId, target, `copy:${cycle.lineageId}`);
          resolved.push({ clientId: memberId, target: target.programId === programId ? { kind: "join" } : { kind: "program", programId: target.programId } }); continue;
        }
        const destination = await this.placeCopy(tx, memberId, target.kind === "existing" ? { kind: "program", programId: target.programId } : target,
          programId, { ...cycle, id: take(), weeks: copyWeeks(cycle.weeks, take) }, now);
        resolved.push({ clientId: memberId, target: destination === programId ? { kind: "join" } : { kind: "program", programId: destination } });
      }
      if (input.first) await saveSelection(tx, this.workspaceId, programId, clientId, cycle.id);
      return resolved;
    },
    bump: async (tx: SqliteStatementPort, programId: string, revision: number, now: Date) => this.bumpRevision(tx, programId, revision, now),
    clear: async (tx: SqliteStatementPort, clientId: string, scope: MesocycleBuilderScope) => {
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id=? AND client_id=? AND draft_key=?", [this.workspaceId, clientId, mesocycleBuilderDraftKey(scope)]);
    },
  };

  async saveBuilderAsTemplate(input: Readonly<{ title: string; mesocycle: BuilderMesocycleInput }>, now: Date = new Date()): Promise<ProgramTemplate> {
    const title = normalizeTitle(input.mesocycle.title);
    let local = 0;
    const filled = fillEmptyWeeks(input.mesocycle.weeks, () => `fill:${local++}`);
    if (filled.length === 0 || filled.some((week) => week.workouts.length === 0)) throw new Error("DRAFT_INVALID");
    for (const week of filled) assertWeek(title, week.workouts);
    return this.ready().writer.write((tx) => this.insertTemplate(tx, input.title, { kind: "PERIODIZED",
      mesocycles: [{ title, weeks: filled.map((week) => ({ type: week.type, workouts: week.workouts })) }] }, now));
  }

  private async insertProgram(tx: SqliteStatementPort, valid: CreateProgramInput, now: Date,
    weeks: number | null): Promise<TrainingProgram> {
    {
      // Назначить можно только действующему клиенту этого рабочего пространства.
      for (const clientId of valid.clientIds) {
        const client = await tx.first<{ lifecycle: string }>(`SELECT lifecycle FROM clients
          WHERE workspace_id = ? AND id = ?`, [this.workspaceId, clientId]);
        if (client?.lifecycle !== "ACTIVE") throw new Error("TARGET_NOT_FOUND");
      }
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("PROGRAM_ID_UNAVAILABLE");
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO training_programs (id, workspace_id, kind, title, revision, created_at, updated_at, weeks)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?)`, [id, this.workspaceId, valid.kind, valid.title, stamp, stamp, weeks]);
      for (const clientId of valid.clientIds) {
        await tx.run(`INSERT INTO training_program_members (workspace_id, program_id, client_id, joined_at)
          VALUES (?, ?, ?, ?)`, [this.workspaceId, id, clientId, stamp]);
      }
      return programById(tx, this.workspaceId, id);
    }
  }

  async getSimplePlan(clientId: string, programId: string) {
    const { connection } = this.ready();
    const program = await this.getProgram(clientId, programId);
    if (program === null || program.kind !== "SIMPLE") return null;
    const row = await connection.first<{ weeks: number | null }>("SELECT weeks FROM training_programs WHERE workspace_id = ? AND id = ?",
      [this.workspaceId, programId]);
    const plan = await readStructure(connection, this.workspaceId, programId, row?.weeks ?? DEFAULT_WEEKS);
    return { program, draft: { title: program.title, plan } };
  }

  async getSimpleWeeks(clientId: string, programId: string) {
    const plan = await this.getSimplePlan(clientId, programId);
    return plan === null ? [] : readSimpleWeeks(this.ready().connection, this.workspaceId, clientId, programId, plan.draft.plan);
  }

  async getSimpleVersions(clientId: string, programId: string) {
    const plan = await this.getSimplePlan(clientId, programId);
    if (plan === null) return [];
    const { connection } = this.ready();
    const history = await readSimpleHistory(connection, this.workspaceId, clientId, programId);
    const weeks = await readSimpleWeeks(connection, this.workspaceId, clientId, programId, plan.draft.plan);
    return [{ id: "current", validFrom: history[0]?.validTo ?? plan.program.createdAt, validTo: null,
      title: plan.program.title, weeks }, ...history];
  }

  private async prepareSimpleWorkout(tx: SqliteStatementPort, clientId: string, programId: string, expectedRevision: number,
    input: SimpleWorkoutEdit, allocate: (count: number) => Promise<() => string>) {
    if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
    const program = await programById(tx, this.workspaceId, programId);
    if (program.revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
    if (program.kind !== "SIMPLE" || !["CURRENT", "FOLLOWING", "ALL"].includes(input.scope)
      || input.workoutId !== input.workout.id) throw new Error("DRAFT_INVALID");
    assertWeek(program.title, [input.workout]);
    const row = await tx.first<{ weeks: number }>("SELECT weeks FROM training_programs WHERE workspace_id = ? AND id = ?",
      [this.workspaceId, programId]);
    const base = await readStructure(tx, this.workspaceId, programId, row!.weeks);
    const before = await readSimpleWeeks(tx, this.workspaceId, clientId, programId, base);
    const source = before.find((week) => week.index === input.weekIndex)?.workouts.find((workout) => workout.id === input.workoutId);
    if (!source) throw new Error("TARGET_NOT_FOUND");
    await assertSimpleIdentities(tx, this.workspaceId, clientId, programId, input.workout,
      [...base.workouts, ...before.flatMap((week) => week.workouts)].filter((workout) => workout.id === input.workoutId));
    const targets = before.filter((week) => input.scope === "ALL" || (input.scope === "CURRENT"
      ? week.index === input.weekIndex : week.index >= input.weekIndex));
    const conflicts: WeekEditConflict[] = [];
    const outputs: { index: number; workout: PlannedWorkout; changed: boolean }[] = [];
    const rows = 1 + input.workout.exercises.reduce((sum, exercise) => sum + 1 + exercise.sets.length, 0);
    for (const week of targets) {
      const current = week.workouts.find((workout) => workout.id === input.workoutId)!;
      const applied = week.index === input.weekIndex ? { workouts: [input.workout], conflicts: [] }
        : applyWithConflicts([source], [input.workout], [current], clientId, week.index,
          input.replaceConflicts ?? [], await allocate(rows * 2));
      conflicts.push(...applied.conflicts);
      outputs.push({ index: week.index, workout: applied.workouts[0]!, changed: diffWeek([current], applied.workouts).length > 0 });
    }
    if (input.replaceConflicts?.some((key) => !conflicts.some((conflict) => conflict.key === key))) throw new Error("DRAFT_INVALID");
    return { program, base, before, outputs, preview: { conflicts,
      affectedWeeks: [{ clientId, weeks: targets.map((week) => week.index) }] } };
  }

  async previewSimpleWorkout(clientId: string, programId: string, expectedRevision: number, input: SimpleWorkoutEdit) {
    return this.ready().writer.write(async (tx) => {
      let next = 0;
      return (await this.prepareSimpleWorkout(tx, clientId, programId, expectedRevision, input,
        async () => () => `preview:${next++}`)).preview;
    });
  }

  async saveSimpleWorkout(clientId: string, programId: string, expectedRevision: number, input: SimpleWorkoutEdit, now = new Date()) {
    const saved = await this.ready().writer.write(async (tx) => {
      const prepared = await this.prepareSimpleWorkout(tx, clientId, programId, expectedRevision, input, (count) => this.idPool(tx, count));
      if (prepared.outputs.some((output) => output.changed)) {
        await this.bumpRevision(tx, programId, expectedRevision, now);
        if (input.scope === "ALL") {
          await preserveSimple(tx, this.workspaceId, clientId, programId, prepared.program.createdAt,
            prepared.program.title, prepared.before, now);
          await writeStructure(tx, this.workspaceId, programId, { ...prepared.base,
            workouts: prepared.base.workouts.map((workout) => workout.id === input.workoutId ? input.workout : workout) });
        }
        for (const output of prepared.outputs) {
          if (output.changed || input.scope === "ALL") await writeSimpleOverride(tx, this.workspaceId, clientId, programId, output.index, output.workout);
        }
      }
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, simpleWorkoutDraftKey(programId, input.weekIndex, input.workoutId)]);
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: [clientId] });
    return saved;
  }

  async getSimpleWorkoutDraft(clientId: string, programId: string, weekIndex: number, workoutId: string): Promise<SimpleWorkoutDraft | null> {
    if ((await this.getProgram(clientId, programId))?.kind !== "SIMPLE") return null;
    const row = await this.ready().connection.first<{ json: string }>(`SELECT draft_json AS json FROM training_builder_drafts
      WHERE workspace_id = ? AND client_id = ? AND draft_key = ?`, [this.workspaceId, clientId, simpleWorkoutDraftKey(programId, weekIndex, workoutId)]);
    return row === null ? null : readStoredJson(row.json, storedWorkoutDraft, `training_workout_draft:${clientId}:${workoutId}`);
  }

  async saveSimpleWorkoutDraft(clientId: string, programId: string, draft: SimpleWorkoutDraft): Promise<void> {
    if (!Number.isInteger(draft.baseRevision) || draft.baseRevision < 1) throw new Error("DRAFT_INVALID");
    await this.ready().writer.write(async (tx) => {
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const program = await programById(tx, this.workspaceId, programId);
      if (program.kind !== "SIMPLE") throw new Error("DRAFT_INVALID");
      const key = simpleWorkoutDraftKey(programId, draft.input.weekIndex, draft.input.workoutId);
      await tx.run(`INSERT INTO training_builder_drafts(workspace_id, client_id, draft_key, base_revision, draft_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, draft_key) DO UPDATE SET
        base_revision = excluded.base_revision, draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, key, draft.baseRevision, JSON.stringify(draft), new Date().toISOString()]);
    });
  }

  async createSimpleProgram(clientId: string, draft: SimpleProgramDraft, now: Date = new Date()): Promise<TrainingProgram> {
    const valid = validateCreate({ kind: "SIMPLE", title: draft.title, clientIds: [clientId] });
    assertStructure(draft);
    const created = await this.ready().writer.write(async (tx) => {
      const program = await this.insertProgram(tx, valid, now, draft.plan.weeks);
      for (const workout of draft.plan.workouts) await assertSimpleIdentities(tx, this.workspaceId, clientId, program.id, workout, []);
      await writeStructure(tx, this.workspaceId, program.id, draft.plan);
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, NEW_SIMPLE_DRAFT_KEY]);
      return program;
    });
    this.publish({ clientIds: created.memberClientIds });
    return created;
  }

  async saveSimplePlan(clientId: string, programId: string, expectedRevision: number, draft: SimpleProgramDraft,
    now: Date = new Date()): Promise<TrainingProgram> {
    const saved = await this.ready().writer.write((tx) => this.saveSimplePlanIn(tx, clientId, programId, expectedRevision, draft, now));
    this.publish({ clientIds: saved.memberClientIds });
    return saved;
  }

  /** Сохранение структуры Простой программы в чужой транзакции (workflow вместе с проверкой результатов убираемых недель). */
  private async saveSimplePlanIn(tx: SqliteStatementPort, clientId: string, programId: string, expectedRevision: number,
    draft: SimpleProgramDraft, now: Date): Promise<TrainingProgram> {
    const title = normalizeTitle(draft.title);
    assertStructure(draft);
    {
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const current = await programById(tx, this.workspaceId, programId);
      if (current.kind !== "SIMPLE") throw new Error("DRAFT_INVALID");
      const oldCount = await tx.first<{ weeks: number }>("SELECT weeks FROM training_programs WHERE workspace_id = ? AND id = ?",
        [this.workspaceId, programId]);
      const previous = await readStructure(tx, this.workspaceId, programId, oldCount!.weeks);
      const weeks = await readSimpleWeeks(tx, this.workspaceId, clientId, programId, previous);
      for (const workout of draft.plan.workouts) await assertSimpleIdentities(tx, this.workspaceId, clientId, programId, workout,
        [...previous.workouts, ...weeks.flatMap((week) => week.workouts)].filter((item) => item.id === workout.id));
      const result = await tx.run(`UPDATE training_programs SET title = ?, weeks = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`,
      [title, draft.plan.weeks, now.toISOString(), this.workspaceId, programId, expectedRevision]);
      if (result.changes !== 1) throw new Error("PROGRAM_REVISION_CONFLICT");
      if (previous.weeks !== draft.plan.weeks || diffWeek(previous.workouts, draft.plan.workouts).length > 0) {
        await preserveSimple(tx, this.workspaceId, clientId, programId, current.createdAt, current.title, weeks, now);
      }
      await writeStructure(tx, this.workspaceId, programId, draft.plan);
      const overrides = await tx.all<{ week: number; workoutId: string }>(`SELECT week_index AS week, workout_id AS workoutId
        FROM training_simple_overrides WHERE workspace_id = ? AND client_id = ? AND program_id = ?`, [this.workspaceId, clientId, programId]);
      for (const override of overrides) {
        const old = previous.workouts.find((workout) => workout.id === override.workoutId);
        const next = draft.plan.workouts.find((workout) => workout.id === override.workoutId);
        const personal = weeks.find((week) => week.index === override.week)?.workouts.find((workout) => workout.id === override.workoutId);
        if (!next || !old || !personal || override.week > draft.plan.weeks) {
          await tx.run(`DELETE FROM training_simple_overrides WHERE workspace_id = ? AND client_id = ? AND program_id = ?
            AND week_index = ? AND workout_id = ?`, [this.workspaceId, clientId, programId, override.week, override.workoutId]);
          continue;
        }
        const rows = 1 + next.exercises.reduce((sum, exercise) => sum + 1 + exercise.sets.length, 0);
        const take = opsNeedIds(diffWeek([old], [next])) ? await this.idPool(tx, rows * 2) : () => { throw new Error("PROGRAM_ID_UNAVAILABLE"); };
        const applied = applyWithConflicts([old], [next], [personal], clientId, override.week, [], take);
        await writeSimpleOverride(tx, this.workspaceId, clientId, programId, override.week, applied.workouts[0]!);
      }
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, programId]);
      return programById(tx, this.workspaceId, programId);
    }
  }

  /** Сохранение структуры Простой программы из конструктора (вызывает workflow вместе с дневником). */
  readonly simplePlanSaveParticipant: SimplePlanSavePlansParticipant<SqliteStatementPort> = {
    removedWorkouts: async (tx, request) => {
      if ((await membership(tx, this.workspaceId, request.clientId, request.programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const program = await programById(tx, this.workspaceId, request.programId);
      if (program.kind !== "SIMPLE") throw new Error("DRAFT_INVALID");
      const row = await tx.first<{ weeks: number }>("SELECT weeks FROM training_programs WHERE workspace_id = ? AND id = ?",
        [this.workspaceId, request.programId]);
      const current = await readStructure(tx, this.workspaceId, request.programId, row!.weeks);
      const kept = new Set(request.draft.plan.workouts.map((workout) => workout.id));
      // Исчезнут: все недели, которых больше нет, и тренировки, убранные из базового плана (во всех неделях).
      return Array.from({ length: current.weeks }, (_, at) => at + 1).flatMap((weekIndex) => current.workouts
        .filter((workout) => weekIndex > request.draft.plan.weeks || !kept.has(workout.id))
        .map((workout) => ({ weekIndex, plannedWorkoutId: workout.id })));
    },
    save: (tx, request, now) => this.saveSimplePlanIn(tx, request.clientId, request.programId, request.expectedRevision, request.draft, now),
    notify: (clientIds) => this.publish({ clientIds }),
  };

  async setExerciseRest(clientId: string, programId: string, plannedExerciseId: string, restSec: number | null,
    now: Date = new Date()): Promise<TrainingProgram> {
    if (restSec !== null && (!Number.isInteger(restSec) || restSec < REST_MIN_SEC || restSec > REST_MAX_SEC)) {
      throw new Error("DRAFT_INVALID");
    }
    const saved = await this.ready().writer.write(async (tx) => {
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const result = await tx.run(`UPDATE training_planned_exercises SET rest_sec = ?
        WHERE workspace_id = ? AND id = ? AND workout_id IN
          (SELECT w.id FROM training_workouts w WHERE w.workspace_id = ? AND w.program_id = ? AND
            (w.week_id IS NULL OR EXISTS (SELECT 1 FROM training_weeks k JOIN training_mesocycles m
              ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id WHERE k.id = w.week_id AND m.client_id = ?)))`,
      [restSec, this.workspaceId, plannedExerciseId, this.workspaceId, programId, clientId]);
      const overrides = await tx.all<{ week: number; workoutId: string; json: string }>(`SELECT week_index AS week, workout_id AS workoutId, workout_json AS json
        FROM training_simple_overrides WHERE workspace_id = ? AND client_id = ? AND program_id = ?`, [this.workspaceId, clientId, programId]);
      let changed = result.changes;
      for (const row of overrides) {
        const workout = parseOverride(row.json, row.workoutId);
        if (workout === null || !workout.exercises.some((exercise) => exercise.id === plannedExerciseId)) continue;
        await writeSimpleOverride(tx, this.workspaceId, clientId, programId, row.week,
          { ...workout, exercises: workout.exercises.map((exercise) => exercise.id === plannedExerciseId ? { ...exercise, restSec } : exercise) });
        changed += 1;
      }
      if (changed === 0) throw new Error("TARGET_NOT_FOUND");
      await tx.run("UPDATE training_programs SET revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [now.toISOString(), this.workspaceId, programId]);
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: saved.memberClientIds });
    return saved;
  }

  async findWorkout(clientId: string, programId: string, plannedWorkoutId: string, weekIndex?: number) {
    const { connection } = this.ready();
    const program = await this.getProgram(clientId, programId);
    if (program === null) return null;
    if (program.kind === "SIMPLE" && weekIndex !== undefined) {
      const weeks = await this.getSimpleWeeks(clientId, programId);
      const workout = weeks.find((week) => week.index === weekIndex)?.workouts.find((item) => item.id === plannedWorkoutId);
      const previousWorkout = weekIndex <= 1 ? null : weeks.find((week) => week.index === weekIndex - 1)
        ?.workouts.find((item) => item.id === plannedWorkoutId) ?? null;
      return workout ? { program, workout, previousWorkout } : null;
    }
    if (program.kind === "PERIODIZED") {
      const plan = await this.getPeriodizedPlan(clientId, programId);
      const cycle = plan?.mesocycles.find((cycle) => cycle.weeks.some((week) => (weekIndex === undefined || week.index === weekIndex)
        && week.workouts.some((item) => item.id === plannedWorkoutId)));
      const workout = cycle?.weeks
        .filter((week) => weekIndex === undefined || week.index === weekIndex)
        .flatMap((week) => week.workouts).find((item) => item.id === plannedWorkoutId);
      if (workout === undefined || plan === null) return null;
      const previous = weekIndex === undefined || weekIndex <= 1 ? [] : cycle?.weeks.find((week) => week.index === weekIndex - 1)
        ?.workouts.filter((item) => (item.lineageId ?? item.id) === (workout.lineageId ?? workout.id)) ?? [];
      return { program: plan.program, workout, previousWorkout: previous.length === 1 ? previous[0]! : null };
    }
    // Simple program without an explicit week (navigation): read its base workout.
    const row = await connection.first<{ weekId: string | null }>(`SELECT w.week_id AS weekId FROM training_workouts w
      WHERE w.workspace_id = ? AND w.program_id = ? AND w.id = ? AND (w.week_id IS NULL OR EXISTS (SELECT 1
        FROM training_weeks k JOIN training_mesocycles m ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id
        WHERE k.id = w.week_id AND k.workspace_id = w.workspace_id AND m.client_id = ?))`,
    [this.workspaceId, programId, plannedWorkoutId, clientId]);
    if (row === null) return null;
    const workout = (await readWorkouts(connection, this.workspaceId, programId, row.weekId)).find((item) => item.id === plannedWorkoutId);
    return workout === undefined ? null : { program, workout };
  }

  /**
   * Чтение плана одного участника кэшируется до следующей записи: экран программы, переключатель участников, навигация
   * недель и история читают его по нескольку раз. Любая запись планов оповещает подписчиков через `publish`, и кэш там
   * сбрасывается; чтение, начатое до записи, в кэш не попадает (запись убирает и его). Окончательное удаление клиента
   * стирает планы без оповещения плана, поэтому при чтении из кэша сверяется членство клиента в программе (один запрос).
   */
  async getPeriodizedPlan(clientId: string, programId: string): Promise<PeriodizedPlan | null> {
    return this.readOnce(this.planReads, JSON.stringify([clientId, programId]), () => this.cachedPeriodizedPlan(clientId, programId));
  }

  private async cachedPeriodizedPlan(clientId: string, programId: string): Promise<PeriodizedPlan | null> {
    const key = `${clientId}:${programId}`;
    const cached = this.planCache.get(key);
    if (cached !== undefined) {
      const member = await this.ready().connection.first<{ present: number }>(`SELECT 1 AS present FROM training_program_members
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [this.workspaceId, programId, clientId]);
      if (member !== null) return cached;
      this.planCache.delete(key);
      return null;
    }
    const pending = this.readPeriodizedPlan(clientId, programId);
    this.planCache.set(key, pending);
    pending.catch(() => { if (this.planCache.get(key) === pending) this.planCache.delete(key); });
    return pending;
  }

  private async readPeriodizedPlan(clientId: string, programId: string): Promise<PeriodizedPlan | null> {
    const { connection } = this.ready();
    const program = await this.getProgram(clientId, programId);
    if (program === null || program.kind !== "PERIODIZED") return null;
    const mesocycles = await readMesocycles(connection, this.workspaceId, programId, clientId);
    const selected = await selectedMesocycle(connection, this.workspaceId, programId, clientId);
    return { program, mesocycles, selectedMesocycleId: selected ?? mesocycles[0]?.id ?? null };
  }

  async getMesocycleVersions(clientId: string, programId: string, mesocycleId: string): Promise<readonly MesocycleVersion[]> {
    const plan = await this.getPeriodizedPlan(clientId, programId);
    const structure = plan?.mesocycles.find((cycle) => cycle.id === mesocycleId);
    if (!structure) return [];
    const { connection } = this.ready();
    const history = await readMesocycleHistory(connection, this.workspaceId, clientId, programId, mesocycleId);
    const validFrom = history[0]?.validTo ?? await mesocycleCreatedAt(connection, this.workspaceId, clientId, programId, mesocycleId);
    return [{ id: "current", validFrom, validTo: null, structure }, ...history];
  }

  async getWorkoutWeekNavigation(clientId: string, programId: string, plannedWorkoutId: string) {
    const program = await this.getProgram(clientId, programId);
    if (program === null) return null;
    if (program.kind === "SIMPLE") {
      const found = await this.findWorkout(clientId, programId, plannedWorkoutId);
      if (found === null) return null;
      const plan = await this.getSimplePlan(clientId, programId);
      if (plan === null) return null;
      return { programTitle: found.program.title, mesocycleId: null,
        weeks: Array.from({ length: plan.draft.plan.weeks }, (_, index) => ({ index: index + 1, caption: null, workoutId: plannedWorkoutId,
          workoutIds: plan.draft.plan.workouts.map((workout) => workout.id) })) };
    }
    const plan = await this.getPeriodizedPlan(clientId, programId);
    const cycle = plan?.mesocycles.find((item) => item.weeks.some((week) => week.workouts.some((workout) => workout.id === plannedWorkoutId)));
    if (!cycle) return null;
    const found = cycle.weeks.flatMap((week) => week.workouts).find((workout) => workout.id === plannedWorkoutId)!;
    const lineage = found.lineageId ?? found.id;
    return { programTitle: program.title, mesocycleId: cycle.id,
      weeks: cycle.weeks.map((week) => {
        const matches = week.workouts.filter((workout) => (workout.lineageId ?? workout.id) === lineage);
        return { index: week.index, caption: weekTypeLabels[week.type], type: week.type, workoutId: matches.length === 1 ? matches[0]!.id : null,
          workoutIds: week.workouts.map((workout) => workout.id) };
      }) };
  }

  /** CAS по ревизии программы: структурная правка любого участника меняет ревизию общей программы. */
  private async bumpRevision(tx: SqliteStatementPort, programId: string, expectedRevision: number, now: Date): Promise<void> {
    const result = await tx.run(`UPDATE training_programs SET revision = revision + 1, updated_at = ?
      WHERE workspace_id = ? AND id = ? AND revision = ?`, [now.toISOString(), this.workspaceId, programId, expectedRevision]);
    if (result.changes !== 1) throw new Error("PROGRAM_REVISION_CONFLICT");
  }

  /** Выбранные участники — действующие участники программы, открывший клиент среди них. */
  private async assertTargets(tx: SqliteStatementPort, clientId: string, programId: string, clientIds: readonly string[]) {
    const program = await programById(tx, this.workspaceId, programId);
    if (program.kind !== "PERIODIZED" || !clientIds.includes(clientId) || new Set(clientIds).size !== clientIds.length
      || clientIds.some((id) => !program.memberClientIds.includes(id))) {
      throw new Error("DRAFT_INVALID");
    }
    for (const id of clientIds) {
      if ((await membership(tx, this.workspaceId, id, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
    }
  }

  /** Запас новых ID: функции домена синхронные, ID для них берутся заранее. */
  private async idPool(tx: SqliteStatementPort, count: number): Promise<() => string> {
    // Одним запросом: правка «все недели» у нескольких участников требует тысячи ID.
    const pool = count < 1 ? [] : (await tx.all<{ id: string }>(UUID_V4_BATCH_SQL, [count])).map((row) => row.id);
    if (pool.length !== Math.max(0, count) || new Set(pool).size !== pool.length) throw new Error("PROGRAM_ID_UNAVAILABLE");
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
      await tx.run("DELETE FROM training_periodized_drafts WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, programId, "new:MESOCYCLE"]);
      return { program: await programById(tx, this.workspaceId, programId), mesocycleId: ownId };
    });
    this.publish({ clientIds: input.clientIds });
    return created;
  }

  async copyMesocycle(clientId: string, programId: string, expectedRevision: number, input: CopyMesocycleInput,
    now: Date = new Date()) {
    const title = normalizeTitle(input.title);
    const created = await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      const target = await programById(tx, this.workspaceId, programId);
      if (target.revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      await membership(tx, this.workspaceId, input.sourceClientId, input.sourceProgramId);
      const sourceProgram = await programById(tx, this.workspaceId, input.sourceProgramId);
      if (sourceProgram.revision !== input.sourceRevision) throw new Error("SOURCE_REVISION_CONFLICT");
      const source = (await readMesocycle(tx, this.workspaceId, input.sourceProgramId, input.sourceClientId, input.sourceMesocycleId));
      if (!source || sourceProgram.kind !== "PERIODIZED") throw new Error("TARGET_NOT_FOUND");
      await this.assertTargets(tx, clientId, programId, input.clientIds);
      for (const week of source.weeks) assertWeek(title, week.workouts);
      await this.bumpRevision(tx, programId, expectedRevision, now);
      const take = await this.idPool(tx, 1 + input.clientIds.length + weekRowCount(source.weeks) * (input.clientIds.length + 1));
      const lineageId = take();
      const template = independentWeeks(source.weeks, take);
      let ownId = "";
      for (const [index, memberId] of input.clientIds.entries()) {
        const cycle = { id: take(), lineageId, title, weeks: index === 0 ? template : copyWeeks(template, take) };
        await insertMesocycle(tx, this.workspaceId, programId, memberId, cycle, now);
        if (memberId === clientId) ownId = cycle.id;
      }
      await saveSelection(tx, this.workspaceId, programId, clientId, ownId);
      return { program: await programById(tx, this.workspaceId, programId), mesocycleId: ownId };
    });
    this.publish({ clientIds: input.clientIds });
    return created;
  }

  private async weekCopyContext(tx: SqliteStatementPort, request: WeekCopyRequest) {
    const { clientId, programId, mesocycleId, sourceWeek, targetWeek, expectedRevision } = request;
    await this.assertTargets(tx, clientId, programId, [clientId]);
    const program = await programById(tx, this.workspaceId, programId);
    if (program.revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
    const cycle = (await readMesocycle(tx, this.workspaceId, programId, clientId, mesocycleId));
    const source = cycle?.weeks.find((week) => week.index === sourceWeek);
    const target = cycle?.weeks.find((week) => week.index === targetWeek);
    if (!cycle || !source || !target || source.id === target.id) throw new Error("TARGET_NOT_FOUND");
    return { cycle, source, target };
  }

  /** §48.21 п. 5: две недели меняются позициями; прежняя структура — в истории мезоцикла (§48.21 п. 8). */
  readonly weekSwapParticipant: WeekSwapPlansParticipant<SqliteStatementPort> = {
    swap: async (tx, request, now) => {
      const { clientId, programId, mesocycleId, first, second, expectedRevision } = request;
      if (first === second) throw new Error("DRAFT_INVALID");
      await this.assertTargets(tx, clientId, programId, [clientId]);
      if ((await programById(tx, this.workspaceId, programId)).revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      const cycle = (await readMesocycle(tx, this.workspaceId, programId, clientId, mesocycleId));
      const a = cycle?.weeks.find((week) => week.index === first);
      const b = cycle?.weeks.find((week) => week.index === second);
      if (!cycle || !a || !b) throw new Error("TARGET_NOT_FOUND");
      await this.bumpRevision(tx, programId, expectedRevision, now);
      await preserveMesocycle(tx, this.workspaceId, clientId, programId, cycle, now);
      // UNIQUE(мезоцикл, позиция) проверяется построчно: одна неделя сначала уходит на свободную позицию.
      const used = new Set(cycle.weeks.map((week) => week.index - 1));
      const free = Array.from({ length: MESOCYCLE_WEEKS_MAX }, (_, index) => index).find((position) => !used.has(position));
      if (free === undefined) throw new Error("WEEK_SWAP_NO_SLOT");
      const move = (id: string, position: number) => tx.run("UPDATE training_weeks SET position = ? WHERE workspace_id = ? AND id = ?",
        [position, this.workspaceId, id]);
      await move(a.id, free);
      await move(b.id, first - 1);
      await move(a.id, second - 1);
      return { toSecond: a.workouts.map((workout) => workout.id), toFirst: b.workouts.map((workout) => workout.id) };
    },
    notify: (clientId) => this.publish({ clientIds: [clientId] }),
  };

  readonly weekCopyParticipant: WeekPlansParticipant<SqliteStatementPort> = {
    read: async (tx, request) => this.weekCopyContext(tx, request),
    replace: async (tx, request, now) => {
      const { cycle, source, target } = await this.weekCopyContext(tx, request);
      const take = await this.idPool(tx, weekRowCount([source]));
      const copied = copyWeeks([source], take)[0]!;
      const replacement = { ...copied, id: target.id, index: target.index };
      await this.bumpRevision(tx, request.programId, request.expectedRevision, now);
      await preserveMesocycle(tx, this.workspaceId, request.clientId, request.programId, cycle, now);
      await writeWeek(tx, this.workspaceId, request.programId, replacement);
      return { source, target: replacement };
    },
    notify: (clientId) => this.publish({ clientIds: [clientId] }),
  };

  /** Недели конструктора: пустые получают план ближайшей заполненной (новые ID из пула), проверка как у недели. */
  private async builderWeeks(tx: SqliteStatementPort, input: BuilderMesocycleInput): Promise<readonly PlanWeek[]> {
    const title = normalizeTitle(input.title);
    assertSettings(input);
    if (input.weeks.length < 1 || input.weeks.length > MESOCYCLE_WEEKS_MAX) throw new Error("DRAFT_INVALID");
    const largest = Math.max(...input.weeks.map((week) => weekRowCount([{ id: "", index: 1, type: week.type, workouts: week.workouts }])));
    const empty = input.weeks.filter((week) => week.workouts.length === 0).length;
    const filled = fillEmptyWeeks(input.weeks, await this.idPool(tx, largest * empty));
    if (filled.some((week) => week.workouts.length === 0)) throw new Error("DRAFT_INVALID");
    for (const week of filled) assertWeek(title, week.workouts);
    return filled.map((week, index) => ({ id: `week:${index}`, index: index + 1, type: week.type, workouts: withLineage(week.workouts) }));
  }

  private async ownMesocycle(tx: SqliteStatementPort, request: MesocycleSaveRequest): Promise<Mesocycle> {
    const cycle = request.mesocycleId === null ? undefined
      : await readMesocycle(tx, this.workspaceId, request.programId, request.clientId, request.mesocycleId);
    if (cycle === undefined) throw new Error("TARGET_NOT_FOUND");
    return cycle;
  }

  /** UI-OWN-041: «+ Мезоцикл» и правка мезоцикла из конструктора (вызывает workflow вместе с дневником). */
  readonly mesocycleSaveParticipant: MesocycleSavePlansParticipant<SqliteStatementPort> = {
    removedWorkouts: async (tx, request) => {
      if (request.mesocycleId === null) return [];
      const cycle = await this.ownMesocycle(tx, request);
      // Тренировка, которой нет в новой структуре своей недели (убранная неделя, замена копией, пустая неделя, удалённая тренировка),
      // исчезнет из плана: её результаты нельзя оставлять без привязки (§48.21.1 п. 7, §48.5.7).
      const programTitle = (await programById(tx, this.workspaceId, request.programId)).title;
      return cycle.weeks.flatMap((week) => {
        const kept = new Set(request.mesocycle.weeks[week.index - 1]?.workouts.map((workout) => workout.id) ?? []);
        return week.workouts.filter((workout) => !kept.has(workout.id))
          .map((workout) => ({ weekIndex: week.index, plannedWorkoutId: workout.id, programTitle, mesocycleTitle: cycle.title,
            workoutTitle: workout.title }));
      });
    },
    save: async (tx, request, now) => {
      const { clientId, programId, expectedRevision } = request;
      const title = normalizeTitle(request.mesocycle.title);
      if (request.mesocycleId !== null && (request.clientIds.length !== 1 || request.clientIds[0] !== clientId)) throw new Error("DRAFT_INVALID");
      if (request.clientIds[0] !== clientId || new Set(request.clientIds).size !== request.clientIds.length) throw new Error("DRAFT_INVALID");
      await this.assertTargets(tx, clientId, programId, [clientId]);
      await this.validateAttachments(tx, request.placements ?? []);
      const weeks = await this.builderWeeks(tx, request.mesocycle);
      const settings = { cycleType: request.mesocycle.cycleType, repRange: request.mesocycle.repRange, startDate: request.mesocycle.startDate };
      if (request.mesocycleId === null) {
        await this.bumpRevision(tx, programId, expectedRevision, now);
        const rows = weekRowCount(weeks);
        const take = await this.idPool(tx, 1 + 2 * rows + request.clientIds.length * (1 + rows));
        const lineageId = take();
        const template = independentWeeks(weeks, take);
        const ownId = take();
        await insertMesocycle(tx, this.workspaceId, programId, clientId, { id: ownId, lineageId, title, ...settings, weeks: template }, now);
        const placements = new Map((request.placements ?? []).map((item) => [item.clientId, item.target]));
        for (const memberId of request.clientIds.slice(1)) {
          const target = placements.get(memberId);
          if (target?.kind === "existing") {
            await this.attachExisting(tx, memberId, target, `copy:${lineageId}`); continue;
          }
          const member = await tx.first<{ archivedAt: string | null }>(`SELECT archived_at AS archivedAt FROM training_program_members
            WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [this.workspaceId, programId, memberId]);
          await this.placeCopy(tx, memberId, target ?? (member !== null && member.archivedAt === null ? { kind: "join" } : { kind: "new" }),
            programId, { id: take(), lineageId, title, ...settings, weeks: copyWeeks(template, take) }, now);
        }
        await saveSelection(tx, this.workspaceId, programId, clientId, ownId);
        return { program: await programById(tx, this.workspaceId, programId), mesocycleId: ownId };
      }
      const cycle = await this.ownMesocycle(tx, request);
      // Правка существующего мезоцикла применяется к нему же: историческая версия — только при реальной структурной разнице (§48.9.1 п. 4),
      // название и настройки версию не создают, а без единого изменения ничего не пишется и ревизия не растёт.
      const structureChanged = weeks.length !== cycle.weeks.length || weeks.some((week) => {
        const existing = cycle.weeks[week.index - 1];
        return existing === undefined || existing.type !== week.type
          || existing.workouts.length !== week.workouts.length || existing.workouts.some((workout, at) => workout.id !== week.workouts[at]?.id)
          || diffWeek(existing.workouts, week.workouts).length > 0;
      });
      const settingsChanged = title !== cycle.title || settings.cycleType !== (cycle.cycleType ?? null)
        || JSON.stringify(settings.repRange) !== JSON.stringify(cycle.repRange ?? null) || settings.startDate !== (cycle.startDate ?? null);
      if (!structureChanged && !settingsChanged) {
        if ((await programById(tx, this.workspaceId, programId)).revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
        return { program: await programById(tx, this.workspaceId, programId), mesocycleId: cycle.id };
      }
      await this.bumpRevision(tx, programId, expectedRevision, now);
      if (structureChanged) await preserveMesocycle(tx, this.workspaceId, clientId, programId, cycle, now);
      await tx.run(`UPDATE training_mesocycles SET title = ?, cycle_type = ?, rep_min = ?, rep_max = ?, start_date = ?
        WHERE workspace_id = ? AND id = ? AND client_id = ?`, [title, settings.cycleType, settings.repRange?.min ?? null,
        settings.repRange?.max ?? null, settings.startDate, this.workspaceId, cycle.id, clientId]);
      if (!structureChanged) return { program: await programById(tx, this.workspaceId, programId), mesocycleId: cycle.id };
      const take = await this.idPool(tx, Math.max(0, weeks.length - cycle.weeks.length));
      for (const week of weeks) {
        const existing = cycle.weeks.find((item) => item.index === week.index);
        if (existing !== undefined) { await writeWeek(tx, this.workspaceId, programId, { ...week, id: existing.id }); continue; }
        const id = take();
        await tx.run(`INSERT INTO training_weeks (id, workspace_id, mesocycle_id, position, week_type) VALUES (?, ?, ?, ?, ?)`,
          [id, this.workspaceId, cycle.id, week.index - 1, week.type]);
        await writeWeek(tx, this.workspaceId, programId, { ...week, id });
      }
      for (const week of cycle.weeks.filter((item) => item.index > weeks.length)) {
        await writeWorkouts(tx, this.workspaceId, programId, week.id, []);
        await tx.run("DELETE FROM training_weeks WHERE workspace_id = ? AND id = ?", [this.workspaceId, week.id]);
      }
      return { program: await programById(tx, this.workspaceId, programId), mesocycleId: cycle.id };
    },
    notify: (clientIds) => this.publish({ clientIds }),
  };

  private async deletableMesocycle(tx: SqliteStatementPort, request: MesocycleDeleteRequest) {
    await this.assertTargets(tx, request.clientId, request.programId, [request.clientId]);
    if ((await programById(tx, this.workspaceId, request.programId)).revision !== request.expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
    const cycles = await readMesocycles(tx, this.workspaceId, request.programId, request.clientId);
    const cycle = cycles.find((item) => item.id === request.mesocycleId);
    if (cycle === undefined) throw new Error("TARGET_NOT_FOUND");
    // §48.11: удаляется, только если у клиента в программе больше одного мезоцикла.
    if (cycles.length < 2) throw new Error("LAST_MESOCYCLE");
    return { cycles, cycle };
  }

  /** §48.11, §50.3: удаление мезоцикла и программы у этого клиента (вызывают workflow вместе с дневником). */
  readonly deleteParticipant: PlanDeletePlansParticipant<SqliteStatementPort> = {
    mesocycleWorkouts: async (tx, request) => (await this.deletableMesocycle(tx, request)).cycle.weeks
      .flatMap((week) => week.workouts.map((workout) => workout.id)),
    deleteMesocycle: async (tx, request, now) => {
      const { cycles, cycle } = await this.deletableMesocycle(tx, request);
      const { clientId, programId } = request;
      await this.bumpRevision(tx, programId, request.expectedRevision, now);
      // Выбор переходит к ближайшему: следующему, а если удалён последний — предыдущему (§48.11.1 п. 6).
      const at = cycles.findIndex((item) => item.id === cycle.id);
      const nearest = (cycles[at + 1] ?? cycles[at - 1])!;
      const selected = await selectedMesocycle(tx, this.workspaceId, programId, clientId);
      const next = selected === null || selected === cycle.id ? nearest.id : selected;
      await saveSelection(tx, this.workspaceId, programId, clientId, next);
      await tx.run("DELETE FROM training_structure_versions WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND mesocycle_id = ?",
        [this.workspaceId, clientId, programId, cycle.id]);
      await tx.run("DELETE FROM training_periodized_drafts WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key LIKE ?",
        [this.workspaceId, clientId, programId, `week:${cycle.id}:%`]);
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, mesocycleBuilderDraftKey({ programId, mesocycleId: cycle.id })]);
      for (const week of cycle.weeks) {
        await writeWorkouts(tx, this.workspaceId, programId, week.id, []);
        await tx.run("DELETE FROM training_weeks WHERE workspace_id = ? AND id = ?", [this.workspaceId, week.id]);
      }
      await tx.run("DELETE FROM training_mesocycles WHERE workspace_id = ? AND id = ?", [this.workspaceId, cycle.id]);
      return next;
    },
    planOrigins: async (tx, request) => {
      const { clientId, programId } = request;
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt === null) throw new Error("PROGRAM_NOT_ARCHIVED");
      const program = await programById(tx, this.workspaceId, programId);
      if (program.revision !== request.expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      const slots = new Map<string, Readonly<{ mesocycleTitle: string | null; workoutTitle: string }>>();
      if (program.kind === "PERIODIZED") {
        for (const cycle of await readMesocycles(tx, this.workspaceId, programId, clientId)) {
          for (const week of cycle.weeks) for (const workout of week.workouts) {
            slots.set(`${week.index}:${workout.id}`, { mesocycleTitle: cycle.title, workoutTitle: workout.title });
          }
        }
      } else {
        const row = await tx.first<{ weeks: number | null }>("SELECT weeks FROM training_programs WHERE workspace_id = ? AND id = ?",
          [this.workspaceId, programId]);
        const base = await readStructure(tx, this.workspaceId, programId, row?.weeks ?? DEFAULT_WEEKS);
        for (const week of await readSimpleWeeks(tx, this.workspaceId, clientId, programId, base)) {
          for (const workout of week.workouts) slots.set(`${week.index}:${workout.id}`, { mesocycleTitle: null, workoutTitle: workout.title });
        }
      }
      return { programTitle: program.title, programKind: program.kind, slots };
    },
    deleteProgram: async (tx, request, now) => {
      const { clientId, programId } = request;
      await membership(tx, this.workspaceId, clientId, programId);
      await this.bumpRevision(tx, programId, request.expectedRevision, now);
      const scoped = [this.workspaceId, clientId, programId];
      for (const table of ["training_periodized_drafts", "training_structure_versions", "training_simple_overrides",
        "training_simple_versions", "training_client_selection"]) {
        await tx.run(`DELETE FROM ${table} WHERE workspace_id = ? AND client_id = ? AND program_id = ?`, scoped);
      }
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND (draft_key = ? OR draft_key LIKE ? OR draft_key LIKE ?)",
        [this.workspaceId, clientId, programId, `workout:${programId}:%`, `builder:${programId}:%`]);
      await deleteMemberMesocycles(tx, this.workspaceId, programId, clientId);
      await tx.run("DELETE FROM training_program_members WHERE workspace_id = ? AND program_id = ? AND client_id = ?",
        [this.workspaceId, programId, clientId]);
      const left = await tx.first<{ n: number }>("SELECT count(*) AS n FROM training_program_members WHERE workspace_id = ? AND program_id = ?",
        [this.workspaceId, programId]);
      if ((left?.n ?? 0) === 0) {
        // Последний участник — программа удаляется целиком.
        await deleteStructure(tx, this.workspaceId, programId);
        await tx.run("DELETE FROM training_programs WHERE workspace_id = ? AND id = ?", [this.workspaceId, programId]);
      }
    },
    notify: (clientIds) => this.publish({ clientIds }),
  };

  private async prepareWeekEdit(tx: SqliteStatementPort, clientId: string, programId: string, expectedRevision: number,
    input: WeekEditInput, allocate: (count: number) => Promise<() => string>) {
      await this.assertTargets(tx, clientId, programId, [clientId]);
      if (input.clientIds.length !== 1 || input.clientIds[0] !== clientId) throw new Error("DRAFT_INVALID");
      if ((await programById(tx, this.workspaceId, programId)).revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      const own = (await readMesocycle(tx, this.workspaceId, programId, clientId, input.mesocycleId));
      const open = own?.weeks.find((week) => week.index === input.weekIndex);
      if (own === undefined || open === undefined) throw new Error("TARGET_NOT_FOUND");
      assertWeek(own.title, input.workouts);
      const rows = input.workouts.reduce((sum, workout) => sum + 1
        + workout.exercises.reduce((inner, exercise) => inner + 1 + exercise.sets.length, 0), 0);
      // Правка отдыха, указания, порядка и т. п. новых ID не требует (явная замена конфликта — требует).
      const needIds = opsNeedIds(diffWeek(open.workouts, input.workouts)) || (input.replaceConflicts?.length ?? 0) > 0;
      const noIds = () => { throw new Error("PROGRAM_ID_UNAVAILABLE"); };
      let skipped = 0;
      const conflicts: WeekEditConflict[] = [];
      const affectedWeeks: { clientId: string; weeks: readonly number[] }[] = [];
      const changes: { clientId: string; programId: string; mesocycle: Mesocycle; weeks: PlanWeek[] }[] = [];
      for (const memberId of input.clientIds) {
        const copyProgram = programId;
        const mesocycle = own;
        const changedWeeks: PlanWeek[] = [];
        const indices = targetWeeks(mesocycle.weeks, input.weekIndex, input.scope, open.type);
        affectedWeeks.push({ clientId: memberId, weeks: indices });
        for (const index of indices) {
          const week = mesocycle.weeks.find((item) => item.index === index) as PlanWeek;
          // Открытая неделя открывшего клиента сохраняется ровно такой, какой её отредактировали.
          if (memberId === clientId && index === input.weekIndex) {
            if (week.type !== input.type || diffWeek(week.workouts, input.workouts).length > 0) {
              changedWeeks.push({ ...week, type: input.type, workouts: input.workouts });
            }
            continue;
          }
          const applied = applyWithConflicts(open.workouts, input.workouts, week.workouts, memberId, index,
            input.replaceConflicts ?? [], needIds ? await allocate(rows * 2) : noIds);
          skipped += applied.skipped;
          conflicts.push(...applied.conflicts);
          let type = week.type;
          if (index === input.weekIndex && input.type !== open.type) {
            if (week.type !== open.type && week.type !== input.type) {
              const key = `${memberId}/${index}/type`;
              conflicts.push({ key, clientId: memberId, weekIndex: index, exerciseId: null,
                workoutTitle: `${weekTypeLabels[week.type]} → ${weekTypeLabels[input.type]}`,
                operation: "Тип недели", reason: "PERSONAL_CHANGE", canReplace: true });
              if (input.replaceConflicts?.includes(key)) type = input.type;
              else skipped += 1;
            } else type = input.type;
          }
          if (week.type !== type || diffWeek(week.workouts, applied.workouts).length > 0) {
            changedWeeks.push({ ...week, type, workouts: applied.workouts });
          }
        }
        if (changedWeeks.length > 0) changes.push({ clientId: memberId, programId: copyProgram, mesocycle, weeks: changedWeeks });
      }
      if (input.replaceConflicts?.some((key) => !conflicts.some((conflict) => conflict.key === key && conflict.canReplace))) {
        throw new Error("DRAFT_INVALID");
      }
      return { changes, skipped, preview: { conflicts, affectedWeeks } };
  }

  async previewWeekEdit(clientId: string, programId: string, expectedRevision: number, input: WeekEditInput): Promise<WeekEditPreview> {
    // Предпросмотр идёт через очередь записи: одна согласованная ревизия, без записей и уведомлений.
    return this.ready().writer.write(async (tx) => {
      let next = 0;
      return (await this.prepareWeekEdit(tx, clientId, programId, expectedRevision, input,
        async () => () => `preview:${next++}`)).preview;
    });
  }

  async saveWeek(clientId: string, programId: string, expectedRevision: number, input: WeekEditInput,
    now: Date = new Date()): Promise<WeekEditResult> {
    const saved = await this.ready().writer.write((tx) => this.saveWeekIn(tx, clientId, programId, expectedRevision, input, now));
    this.publish({ clientIds: input.clientIds });
    return saved;
  }

  /** Правка недели в чужой транзакции (workflow вместе с проверкой результатов убираемых тренировок, ADR-031). */
  readonly weekEditSaveParticipant: WeekEditSavePlansParticipant<SqliteStatementPort> = {
    removedWorkouts: async (tx, request) => {
      let next = 0;
      const prepared = await this.prepareWeekEdit(tx, request.clientId, request.programId, request.expectedRevision, request.input,
        async () => () => `preview:${next++}`);
      const titles = new Map<string, string>();
      for (const change of prepared.changes) titles.set(change.programId, (await programById(tx, this.workspaceId, change.programId)).title);
      return prepared.changes.flatMap((change) => change.weeks.flatMap((week) => {
        const kept = new Set(week.workouts.map((workout) => workout.id));
        return (change.mesocycle.weeks.find((item) => item.index === week.index)?.workouts ?? []).filter((workout) => !kept.has(workout.id))
          .map((workout) => ({ clientId: change.clientId, programId: change.programId, weekIndex: week.index, plannedWorkoutId: workout.id,
            programTitle: titles.get(change.programId) ?? "", mesocycleTitle: change.mesocycle.title, workoutTitle: workout.title }));
      }));
    },
    save: (tx, request, now) => this.saveWeekIn(tx, request.clientId, request.programId, request.expectedRevision, request.input, now),
    notify: (clientIds) => this.publish({ clientIds }),
  };

  private async saveWeekIn(tx: SqliteStatementPort, clientId: string, programId: string, expectedRevision: number, input: WeekEditInput,
    now: Date): Promise<WeekEditResult> {
    {
      const prepared = await this.prepareWeekEdit(tx, clientId, programId, expectedRevision, input, (count) => this.idPool(tx, count));
      await this.bumpRevision(tx, programId, expectedRevision, now);
      for (const change of prepared.changes) {
        await preserveMesocycle(tx, this.workspaceId, change.clientId, change.programId, change.mesocycle, now);
        for (const week of change.weeks) await writeWeek(tx, this.workspaceId, change.programId, week,
          change.mesocycle.weeks.find((item) => item.index === week.index));
        if (change.programId !== programId) await this.touchRevision(tx, change.programId, now);
      }
      await tx.run("DELETE FROM training_periodized_drafts WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, programId, `week:${input.mesocycleId}:${input.weekIndex}`]);
      return { program: await programById(tx, this.workspaceId, programId), skipped: prepared.skipped };
    }
  }

  async listTemplates(): Promise<readonly ProgramTemplate[]> {
    const rows = await this.ready().connection.all<TemplateRow>(`SELECT ${TEMPLATE_COLUMNS} FROM training_templates
      WHERE workspace_id = ? ORDER BY updated_at DESC, title`, [this.workspaceId]);
    return rows.flatMap((row) => { const template = templateOf(row); return template === null ? [] : [template]; });
  }

  private async templateById(tx: SqliteStatementPort, templateId: string): Promise<ProgramTemplate> {
    const row = await tx.first<TemplateRow>(`SELECT ${TEMPLATE_COLUMNS} FROM training_templates
      WHERE workspace_id = ? AND id = ?`, [this.workspaceId, templateId]);
    if (row === null) throw new Error("TARGET_NOT_FOUND");
    const template = templateOf(row);
    if (template === null) throw new Error("TRAINING_JSON_INVALID");
    return template;
  }

  private async insertTemplate(tx: SqliteStatementPort, title: string, payload: TemplatePayload, now: Date): Promise<ProgramTemplate> {
    const take = await this.idPool(tx, 1);
    const id = take();
    const stamp = now.toISOString();
    await tx.run(`INSERT INTO training_templates (id, workspace_id, kind, title, payload_json, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`, [id, this.workspaceId, payload.kind, normalizeTitle(title), JSON.stringify(payload), stamp, stamp]);
    return this.templateById(tx, id);
  }

  async saveProgramAsTemplate(clientId: string, programId: string, title: string, now: Date = new Date()): Promise<ProgramTemplate> {
    return this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      const program = await programById(tx, this.workspaceId, programId);
      if (program.kind === "SIMPLE") {
        const row = await tx.first<{ weeks: number }>("SELECT weeks FROM training_programs WHERE workspace_id = ? AND id = ?",
          [this.workspaceId, programId]);
        // §48.14.1 п. 3: повторяющийся план Простой программы; разовые отличия недель в шаблон не входят.
        const plan = await readStructure(tx, this.workspaceId, programId, row?.weeks ?? DEFAULT_WEEKS);
        return this.insertTemplate(tx, title, { kind: "SIMPLE", weeks: plan.weeks, workouts: plan.workouts }, now);
      }
      // §48.15: мезоциклы открытого участника, а не смесь участников.
      const mesocycles = await readMesocycles(tx, this.workspaceId, programId, clientId);
      if (mesocycles.length === 0) throw new Error("DRAFT_INVALID");
      return this.insertTemplate(tx, title, { kind: "PERIODIZED", mesocycles: mesocycles.map(templateMesocycle) }, now);
    });
  }

  async saveSimpleDraftAsTemplate(draft: SimpleProgramDraft, now: Date = new Date()): Promise<ProgramTemplate> {
    assertStructure(draft);
    return this.ready().writer.write((tx) => this.insertTemplate(tx, draft.title,
      { kind: "SIMPLE", weeks: draft.plan.weeks, workouts: draft.plan.workouts }, now));
  }

  async saveMesocycleAsTemplate(clientId: string, programId: string, mesocycleId: string, title: string,
    now: Date = new Date()): Promise<ProgramTemplate> {
    return this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      const mesocycle = (await readMesocycle(tx, this.workspaceId, programId, clientId, mesocycleId));
      if (mesocycle === undefined) throw new Error("TARGET_NOT_FOUND");
      return this.insertTemplate(tx, title, { kind: "MESOCYCLE", mesocycle: templateMesocycle(mesocycle) }, now);
    });
  }

  async renameTemplate(templateId: string, expectedRevision: number, title: string, now: Date = new Date()): Promise<ProgramTemplate> {
    const value = normalizeTitle(title);
    return this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE training_templates SET title = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`, [value, now.toISOString(), this.workspaceId, templateId, expectedRevision]);
      if (result.changes !== 1) {
        await this.templateById(tx, templateId);
        throw new Error("TEMPLATE_REVISION_CONFLICT");
      }
      return this.templateById(tx, templateId);
    });
  }

  async getTemplate(templateId: string): Promise<ProgramTemplate | null> {
    return this.templateById(this.ready().connection, templateId).catch(() => null);
  }

  async updateTemplate(templateId: string, expectedRevision: number, title: string, payload: TemplatePayload,
    now: Date = new Date()): Promise<ProgramTemplate> {
    const value = normalizeTitle(title);
    // План шаблона проверяется теми же правилами, что и рабочий план; пустых мезоцикла и недель не бывает.
    const weeks = payload.kind === "SIMPLE" ? [payload.workouts]
      : (payload.kind === "MESOCYCLE" ? [payload.mesocycle] : payload.mesocycles).flatMap((cycle) => {
        if (cycle.weeks.length === 0 || cycle.weeks.length > MESOCYCLE_WEEKS_MAX) throw new Error("DRAFT_INVALID");
        normalizeTitle(cycle.title);
        return cycle.weeks.map((week) => week.workouts);
      });
    if (payload.kind === "PERIODIZED" && payload.mesocycles.length === 0) throw new Error("DRAFT_INVALID");
    if (payload.kind === "SIMPLE") assertStructure({ title: value, plan: { weeks: payload.weeks, workouts: payload.workouts } });
    else for (const workouts of weeks) assertWeek(value, workouts);
    return this.ready().writer.write(async (tx) => {
      const current = await this.templateById(tx, templateId);
      if (current.kind !== payload.kind) throw new Error("DRAFT_INVALID");
      const result = await tx.run(`UPDATE training_templates SET title = ?, payload_json = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`,
      [value, JSON.stringify(payload), now.toISOString(), this.workspaceId, templateId, expectedRevision]);
      if (result.changes !== 1) throw new Error("TEMPLATE_REVISION_CONFLICT");
      return this.templateById(tx, templateId);
    });
  }

  async duplicateTemplate(templateId: string, title: string, now: Date = new Date()): Promise<ProgramTemplate> {
    return this.ready().writer.write(async (tx) => this.insertTemplate(tx, title, (await this.templateById(tx, templateId)).payload, now));
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM training_templates WHERE workspace_id = ? AND id = ?", [this.workspaceId, templateId]);
      // Черновики правки этого шаблона (простой и расширенный) у любых клиентов недостижимы без него.
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND draft_key IN (?, ?)",
        [this.workspaceId, `${TEMPLATE_DRAFT_PREFIX}${templateId}`, mesocycleBuilderDraftKey({ programId: null, mesocycleId: `${TEMPLATE_DRAFT_PREFIX}${templateId}` })]);
    });
  }

  async createMesocycleFromTemplate(clientId: string, programId: string, expectedRevision: number,
    input: Readonly<{ templateId: string; mesocycleIndex: number; title: string; clientIds: readonly string[] }>,
    now: Date = new Date()) {
    const title = normalizeTitle(input.title);
    const created = await this.ready().writer.write(async (tx) => {
      const { payload } = await this.templateById(tx, input.templateId);
      // Шаблон Простой программы — не мезоцикл (§48.14.2 п. 4); у Расширенной — только выбранный мезоцикл.
      const source = payload.kind === "MESOCYCLE" ? payload.mesocycle
        : payload.kind === "PERIODIZED" ? payload.mesocycles[input.mesocycleIndex] : undefined;
      if (source === undefined) throw new Error("DRAFT_INVALID");
      await this.assertTargets(tx, clientId, programId, input.clientIds);
      if ((await programById(tx, this.workspaceId, programId)).revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      for (const week of source.weeks) assertWeek(title, week.workouts);
      await this.bumpRevision(tx, programId, expectedRevision, now);
      const rows = source.weeks.reduce((sum, week) => sum + 1 + week.workouts.reduce((inner, workout) => inner + 1
        + workout.exercises.reduce((n, exercise) => n + 1 + exercise.sets.length, 0), 0), 0);
      const take = await this.idPool(tx, 1 + input.clientIds.length + rows * (input.clientIds.length + 1));
      const lineageId = take();
      const template = weeksFromTemplate(source, take);
      let ownId = "";
      for (const [index, memberId] of input.clientIds.entries()) {
        const mesocycle = { id: take(), lineageId, title, weeks: index === 0 ? template : copyWeeks(template, take) };
        await insertMesocycle(tx, this.workspaceId, programId, memberId, mesocycle, now);
        if (memberId === clientId) ownId = mesocycle.id;
      }
      await saveSelection(tx, this.workspaceId, programId, clientId, ownId);
      return { program: await programById(tx, this.workspaceId, programId), mesocycleId: ownId };
    });
    this.publish({ clientIds: input.clientIds });
    return created;
  }

  async createPeriodizedFromSimple(clientId: string, simpleProgramId: string,
    input: Readonly<{ title: string; mesocycleTitle: string; clientIds: readonly string[] }>, now: Date = new Date()): Promise<TrainingProgram> {
    const mesocycleTitle = normalizeTitle(input.mesocycleTitle);
    const created = await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, simpleProgramId);
      const source = await programById(tx, this.workspaceId, simpleProgramId);
      if (source.kind !== "SIMPLE") throw new Error("DRAFT_INVALID");
      const valid = validateCreate({ kind: "PERIODIZED", title: input.title, clientIds: input.clientIds });
      const row = await tx.first<{ weeks: number }>("SELECT weeks FROM training_programs WHERE workspace_id = ? AND id = ?",
        [this.workspaceId, simpleProgramId]);
      // Действующий план по неделям (с разовыми отличиями); история версий новыми мезоциклами не становится (§48.17.1 п. 7).
      const weeks = await readSimpleWeeks(tx, this.workspaceId, clientId, simpleProgramId,
        await readStructure(tx, this.workspaceId, simpleProgramId, row?.weeks ?? DEFAULT_WEEKS));
      const cycle = { title: mesocycleTitle, weeks: weeks.map((week) => ({ type: "base" as const, workouts: week.workouts })) };
      for (const week of cycle.weeks) assertWeek(mesocycleTitle, week.workouts);
      const program = await this.insertProgram(tx, valid, now, null);
      const rows = cycle.weeks.reduce((sum, week) => sum + 1 + week.workouts.reduce((inner, workout) => inner + 1
        + workout.exercises.reduce((n, exercise) => n + 1 + exercise.sets.length, 0), 0), 0);
      const take = await this.idPool(tx, 1 + valid.clientIds.length + rows * (valid.clientIds.length + 1));
      const lineageId = take();
      const template = weeksFromTemplate(cycle, take);
      for (const [index, memberId] of valid.clientIds.entries()) {
        await insertMesocycle(tx, this.workspaceId, program.id, memberId, { id: take(), lineageId, title: mesocycleTitle,
          weeks: index === 0 ? template : copyWeeks(template, take) }, now);
      }
      return programById(tx, this.workspaceId, program.id);
    });
    this.publish({ clientIds: created.memberClientIds });
    return created;
  }

  async createProgramFromTemplate(templateId: string, input: Readonly<{ title: string; clientIds: readonly string[] }>,
    now: Date = new Date()): Promise<TrainingProgram> {
    const created = await this.ready().writer.write(async (tx) => {
      const template = await this.templateById(tx, templateId);
      const { payload } = template;
      if (payload.kind === "MESOCYCLE") throw new Error("DRAFT_INVALID");
      const valid = validateCreate({ kind: payload.kind, title: input.title, clientIds: input.clientIds });
      if (payload.kind === "SIMPLE") {
        const rows = payload.workouts.reduce((sum, workout) => sum + 1
          + workout.exercises.reduce((inner, exercise) => inner + 1 + exercise.sets.length, 0), 0);
        const workouts = workoutsFromTemplate(payload.workouts, await this.idPool(tx, rows + 2));
        const draft = { title: valid.title, plan: { weeks: payload.weeks, workouts } };
        assertStructure(draft);
        const program = await this.insertProgram(tx, valid, now, payload.weeks);
        await writeStructure(tx, this.workspaceId, program.id, draft.plan);
        return program;
      }
      const program = await this.insertProgram(tx, valid, now, null);
      for (const cycle of payload.mesocycles) {
        const rows = cycle.weeks.reduce((sum, week) => sum + 1 + week.workouts.reduce((inner, workout) => inner + 1
          + workout.exercises.reduce((n, exercise) => n + 1 + exercise.sets.length, 0), 0), 0);
        const take = await this.idPool(tx, 1 + valid.clientIds.length + rows * (valid.clientIds.length + 1));
        const lineageId = take();
        const template = weeksFromTemplate(cycle, take);
        for (const week of template) assertWeek(cycle.title, week.workouts);
        for (const [index, memberId] of valid.clientIds.entries()) {
          await insertMesocycle(tx, this.workspaceId, program.id, memberId, { id: take(), lineageId, title: cycle.title,
            weeks: index === 0 ? template : copyWeeks(template, take) }, now);
        }
      }
      return programById(tx, this.workspaceId, program.id);
    });
    this.publish({ clientIds: created.memberClientIds });
    return created;
  }

  async reorderPrograms(clientId: string, programIds: readonly string[]): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      const current = await tx.all<{ id: string }>(`SELECT program_id AS id FROM training_program_members
        WHERE workspace_id = ? AND client_id = ? AND archived_at IS NULL`, [this.workspaceId, clientId]);
      validateOrder(current.map((item) => item.id), programIds);
      for (const [index, programId] of programIds.entries()) {
        const result = await tx.run(`UPDATE training_program_members SET sort_position = ?
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
      const current = await tx.all<{ id: string }>(`SELECT id FROM training_mesocycles
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [this.workspaceId, programId, clientId]);
      validateOrder(current.map((item) => item.id), mesocycleIds);
      for (const [index, mesocycleId] of mesocycleIds.entries()) {
        const result = await tx.run(`UPDATE training_mesocycles SET position = ?
          WHERE workspace_id = ? AND program_id = ? AND client_id = ? AND id = ?`,
        [index, this.workspaceId, programId, clientId, mesocycleId]);
        if (result.changes !== 1) throw new Error("TARGET_NOT_FOUND");
      }
    });
    this.publish({ clientIds: [clientId], orderOnly: true });
  }

  async selectMesocycle(clientId: string, programId: string, mesocycleId: string): Promise<void> {
    const changed = await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      return saveSelection(tx, this.workspaceId, programId, clientId, mesocycleId);
    });
    if (changed) this.publish({ clientIds: [clientId], selectionOnly: true });
  }

  async getBuilderDraft(clientId: string, key: string) {
    const row = await this.ready().connection.first<{ baseRevision: number | null; draftJson: string }>(`SELECT
      base_revision AS baseRevision, draft_json AS draftJson FROM training_builder_drafts
      WHERE workspace_id = ? AND client_id = ? AND draft_key = ?`, [this.workspaceId, clientId, key]);
    if (row === null) return null;
    // Черновик удалённой программы не воскрешает её (§48.29 п. 7).
    if (key !== NEW_SIMPLE_DRAFT_KEY && !key.startsWith(TEMPLATE_DRAFT_PREFIX) && (await this.getProgram(clientId, key)) === null) return null;
    const stored = readStoredJson(row.draftJson, storedBuilderDraft, `training_builder_drafts:${clientId}:${key}`);
    if (stored === null) return null;
    const envelope = "envelope" in stored && stored.envelope === 2 ? stored : null;
    return { baseRevision: row.baseRevision, draft: withRestDefaults(envelope === null ? stored as SimpleProgramDraft : envelope.draft),
      base: envelope?.base == null ? null : withRestDefaults(envelope.base) };
  }

  async getPeriodizedDraft(clientId: string, programId: string, key: string): Promise<PeriodizedDraft | null> {
    if (await this.getProgram(clientId, programId) === null) return null;
    const row = await this.ready().connection.first<{ json: string }>(`SELECT draft_json AS json FROM training_periodized_drafts
      WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?`, [this.workspaceId, clientId, programId, key]);
    return row === null ? null : readStoredJson(row.json, storedPeriodizedDraft, `training_periodized_drafts:${clientId}:${key}`);
  }

  async savePeriodizedDraft(clientId: string, programId: string, draft: PeriodizedDraft): Promise<void> {
    if (!Number.isInteger(draft.baseRevision) || draft.baseRevision < 1 || !draft.clientIds.includes(clientId)) throw new Error("DRAFT_INVALID");
    await this.ready().writer.write(async (tx) => {
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      if ((await programById(tx, this.workspaceId, programId)).kind !== "PERIODIZED") throw new Error("DRAFT_INVALID");
      if (draft.kind === "WEEK") {
        const cycle = (await readMesocycle(tx, this.workspaceId, programId, clientId, draft.mesocycleId));
        if (!cycle?.weeks.some((week) => week.index === draft.weekIndex)) throw new Error("TARGET_NOT_FOUND");
      }
      await tx.run(`INSERT INTO training_periodized_drafts(workspace_id, client_id, program_id, draft_key, draft_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, program_id, draft_key)
        DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, programId, periodizedDraftKey(draft), JSON.stringify(draft), new Date().toISOString()]);
    });
  }

  async getMesocycleBuilderDraft(clientId: string, scope: MesocycleBuilderScope): Promise<MesocycleBuilderDraft | null> {
    if (scope.programId !== null && await this.getProgram(clientId, scope.programId) === null) return null;
    const row = await this.ready().connection.first<{ json: string }>(`SELECT draft_json AS json FROM training_builder_drafts
      WHERE workspace_id = ? AND client_id = ? AND draft_key = ?`, [this.workspaceId, clientId, mesocycleBuilderDraftKey(scope)]);
    return row === null ? null : readStoredJson(row.json, storedMesocycleBuilder, `training_mesocycle_draft:${clientId}`);
  }

  async saveMesocycleBuilderDraft(clientId: string, scope: MesocycleBuilderScope, draft: MesocycleBuilderDraft): Promise<void> {
    if (!storedMesocycleBuilder(draft)) throw new Error("DRAFT_INVALID");
    await this.ready().writer.write(async (tx) => {
      if (scope.programId !== null) {
        if ((await membership(tx, this.workspaceId, clientId, scope.programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
        if ((await programById(tx, this.workspaceId, scope.programId)).kind !== "PERIODIZED") throw new Error("DRAFT_INVALID");
      }
      await tx.run(`INSERT INTO training_builder_drafts (workspace_id, client_id, draft_key, base_revision, draft_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, draft_key) DO UPDATE SET
        base_revision = excluded.base_revision, draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, mesocycleBuilderDraftKey(scope), draft.baseRevision, JSON.stringify(draft), new Date().toISOString()]);
    });
  }

  async clearMesocycleBuilderDraft(clientId: string, scope: MesocycleBuilderScope): Promise<void> {
    await this.clearBuilderDraft(clientId, mesocycleBuilderDraftKey(scope));
  }

  async promoteSimpleBuilderDraft(clientId: string, draft: MesocycleBuilderDraft): Promise<void> {
    if (!storedMesocycleBuilder(draft)) throw new Error("DRAFT_INVALID");
    await this.ready().writer.write(async (tx) => {
      const prior = await tx.first("SELECT 1 AS present FROM training_builder_drafts WHERE workspace_id=? AND client_id=? AND draft_key='new:PERIODIZED'", [this.workspaceId, clientId]);
      if (prior) throw new Error("PERIODIZED_DRAFT_EXISTS");
      await tx.run("INSERT INTO training_builder_drafts(workspace_id,client_id,draft_key,base_revision,draft_json,updated_at) VALUES(?,?,'new:PERIODIZED',NULL,?,?)",
        [this.workspaceId, clientId, JSON.stringify(draft), new Date().toISOString()]);
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id=? AND client_id=? AND draft_key='new:SIMPLE'", [this.workspaceId, clientId]);
    });
  }

  async clearPeriodizedDraft(clientId: string, programId: string, key: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM training_periodized_drafts WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, programId, key]);
    });
  }

  async saveBuilderDraft(clientId: string, key: string, baseRevision: number | null, draft: SimpleProgramDraft,
    base: SimpleProgramDraft | null = null): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO training_builder_drafts (workspace_id, client_id, draft_key, base_revision, draft_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, draft_key) DO UPDATE SET
        base_revision = excluded.base_revision, draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, key, baseRevision, JSON.stringify(base === null ? draft : { envelope: 2, draft, base } satisfies BuilderDraftEnvelope),
        new Date().toISOString()]);
    });
  }

  async clearBuilderDraft(clientId: string, key: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, key]);
    });
  }

  async renameProgram(programId: string, expectedRevision: number, title: string, now: Date = new Date()): Promise<TrainingProgram> {
    const value = normalizeTitle(title);
    const renamed = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE training_programs SET title = ?, revision = revision + 1, updated_at = ?
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
      const result = await tx.run(`INSERT INTO training_client_selection (workspace_id, client_id, program_id) VALUES (?, ?, ?)
        ON CONFLICT(workspace_id, client_id) DO UPDATE SET program_id = excluded.program_id
          WHERE program_id IS NOT excluded.program_id`,
      [this.workspaceId, clientId, programId]);
      return result.changes > 0;
    });
    // Повторное открытие той же программы — не изменение: иначе экран программы перезагружает сам себя.
    if (changed) this.publish({ clientIds: [clientId], selectionOnly: true });
  }

  async archiveForClient(clientId: string, programId: string, now: Date = new Date()): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      const current = await membership(tx, this.workspaceId, clientId, programId);
      if (current.archivedAt !== null) return;
      await tx.run("DELETE FROM training_client_selection WHERE workspace_id = ? AND client_id = ? AND program_id = ?",
        [this.workspaceId, clientId, programId]);
      await tx.run(`UPDATE training_program_members SET archived_at = ?
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [now.toISOString(), this.workspaceId, programId, clientId]);
    });
    this.publish({ clientIds: [clientId] });
  }

  /** Ревизия программы, которую задела правка из другой программы (копия участника группы), без CAS. */
  private async touchRevision(tx: SqliteStatementPort, programId: string, now: Date): Promise<void> {
    await tx.run("UPDATE training_programs SET revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ?",
      [now.toISOString(), this.workspaceId, programId]);
  }

  /**
   * UI-OWN-044 (как в 2.0): копия мезоцикла клиенту — в его Расширенную программу, участием в программе `hostProgramId`
   * или в новую программу с тем же названием. Копия становится выбранным мезоциклом той программы.
   */
  private async validateAttachments(tx: SqliteStatementPort, placements: readonly Placement[], destinationGroupId?: string): Promise<void> {
    for (const { clientId, target } of placements) {
      if (target.kind !== "existing") continue;
      const copy = await readCopy(tx, this.workspaceId, target.mesocycleId);
      const client = await tx.first<{ lifecycle: string }>("SELECT lifecycle FROM clients WHERE workspace_id = ? AND id = ?", [this.workspaceId, clientId]);
      if (copy === null || copy.clientId !== clientId || copy.programId !== target.programId || client?.lifecycle !== "ACTIVE") throw new Error("TARGET_NOT_FOUND");
      if ((await membership(tx, this.workspaceId, clientId, target.programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      if ((await programById(tx, this.workspaceId, target.programId)).revision !== target.expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      const groupId = await navigationGroupId(tx, this.workspaceId, target.mesocycleId);
      if (groupId !== target.expectedGroupId) throw new Error("NAVIGATION_GROUP_CONFLICT");
      const count = groupId === null ? 0 : (await tx.first<{ n: number }>("SELECT count(*) AS n FROM training_navigation_members WHERE workspace_id = ? AND group_id = ?", [this.workspaceId, groupId]))?.n ?? 0;
      if (count > 1 && groupId !== destinationGroupId && target.confirmReassignment !== true) throw new Error("NAVIGATION_REASSIGNMENT_REQUIRED");
    }
  }

  private async attachExisting(tx: SqliteStatementPort, clientId: string, target: PlacementTarget, groupId: string): Promise<void> {
    if (target.kind !== "existing") throw new Error("DRAFT_INVALID");
    await moveNavigationMember(tx, this.workspaceId, groupId, { clientId, programId: target.programId, mesocycleId: target.mesocycleId });
  }

  private async placeCopy(tx: SqliteStatementPort, memberId: string, target: PlacementTarget, hostProgramId: string,
    cycle: Mesocycle, now: Date): Promise<string> {
    if (target.kind === "existing") throw new Error("DRAFT_INVALID");
    const client = await tx.first<{ lifecycle: string }>("SELECT lifecycle FROM clients WHERE workspace_id = ? AND id = ?",
      [this.workspaceId, memberId]);
    if (client?.lifecycle !== "ACTIVE") throw new Error("TARGET_NOT_FOUND");
    if ((await findCopy(tx, this.workspaceId, memberId, cycle.lineageId)) !== null) throw new Error("DRAFT_INVALID");
    let programId = hostProgramId;
    if (target.kind === "program") {
      const program = await programById(tx, this.workspaceId, target.programId);
      if (program.kind !== "PERIODIZED" || (await membership(tx, this.workspaceId, memberId, program.id)).archivedAt !== null) {
        throw new Error("DRAFT_INVALID");
      }
      programId = program.id;
      await this.touchRevision(tx, programId, now);
    } else if (target.kind === "new") {
      const host = await programById(tx, this.workspaceId, hostProgramId);
      programId = (await this.insertProgram(tx, { kind: "PERIODIZED", title: host.title, clientIds: [memberId] }, now, null)).id;
    } else {
      const member = await tx.first<{ archivedAt: string | null }>(`SELECT archived_at AS archivedAt FROM training_program_members
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [this.workspaceId, hostProgramId, memberId]);
      if (member?.archivedAt != null) throw new Error("PROGRAM_ARCHIVED");
      if (member === null) {
        await tx.run(`INSERT INTO training_program_members (workspace_id, program_id, client_id, joined_at) VALUES (?, ?, ?, ?)`,
          [this.workspaceId, hostProgramId, memberId, now.toISOString()]);
      }
    }
    await insertMesocycle(tx, this.workspaceId, programId, memberId, cycle, now);
    await saveSelection(tx, this.workspaceId, programId, memberId, cycle.id);
    return programId;
  }

  /** Копия открывшего клиента: `mesocycleId` или мезоцикл тренировки `workoutId` в этой программе. */
  private async viewerCopy(tx: SqliteStatementPort, clientId: string, programId: string,
    ref: Readonly<{ mesocycleId: string } | { workoutId: string }>) {
    const mesocycleId = "mesocycleId" in ref ? ref.mesocycleId : (await tx.first<{ id: string }>(`SELECT w.mesocycle_id AS id
      FROM training_workouts o JOIN training_weeks w ON w.workspace_id = o.workspace_id AND w.id = o.week_id
      WHERE o.workspace_id = ? AND o.id = ? AND o.program_id = ?`, [this.workspaceId, ref.workoutId, programId]))?.id;
    const copy = mesocycleId === undefined ? null : await readCopy(tx, this.workspaceId, mesocycleId);
    return copy !== null && copy.clientId === clientId && copy.programId === programId ? copy : null;
  }

  async getMesocycleGroup(clientId: string, programId: string,
    ref: Readonly<{ mesocycleId: string } | { workoutId: string }>): Promise<readonly GroupCopy[]> {
    return this.readOnce(this.groupReads, JSON.stringify([clientId, programId, ref]), async () => {
      const { connection } = this.ready();
      const copy = await this.viewerCopy(connection, clientId, programId, ref);
      if (copy === null) return [];
      const group = await groupOfCopy(connection, this.workspaceId, copy.mesocycleId);
      if (!("workoutId" in ref)) return group;
      const slot = await connection.first<{ weekPosition: number; ordinal: number }>(`SELECT k.position AS weekPosition,
        (SELECT count(*) FROM training_workouts previous WHERE previous.workspace_id = w.workspace_id AND previous.week_id = w.week_id AND previous.position < w.position) AS ordinal
        FROM training_workouts w JOIN training_weeks k ON k.workspace_id = w.workspace_id AND k.id = w.week_id
        WHERE w.workspace_id = ? AND w.id = ?`, [this.workspaceId, ref.workoutId]);
      if (slot === null) return [];
      const available: GroupCopy[] = [];
      for (const member of group) {
        const row = await connection.first<{ n: number }>(`SELECT count(*) AS n FROM training_workouts w
          JOIN training_weeks k ON k.workspace_id = w.workspace_id AND k.id = w.week_id
          WHERE k.workspace_id = ? AND k.mesocycle_id = ? AND k.position = ?`, [this.workspaceId, member.mesocycleId, slot.weekPosition]);
        if ((row?.n ?? 0) > slot.ordinal) available.push(member);
      }
      return available;
    });
  }

  async getPlacementOptions(clientIds: readonly string[], hostProgramId: string | null): Promise<readonly ClientPlacementOptions[]> {
    const { connection } = this.ready();
    const result: ClientPlacementOptions[] = [];
    for (const clientId of clientIds) {
      const programs = await connection.all<PlacementProgram>(`SELECT p.id, p.kind, p.title, p.created_at AS createdAt
        FROM training_program_members m JOIN training_programs p ON p.workspace_id = m.workspace_id AND p.id = m.program_id
        WHERE m.workspace_id = ? AND m.client_id = ? AND m.archived_at IS NULL`, [this.workspaceId, clientId]);
      const selected = (await connection.first<{ id: string }>(`SELECT program_id AS id FROM training_client_selection
        WHERE workspace_id = ? AND client_id = ?`, [this.workspaceId, clientId]))?.id ?? null;
      const cycles = await connection.all<{ programId: string; programTitle: string; mesocycleId: string; title: string; revision: number; groupId: string | null; memberCount: number }>(`SELECT p.id AS programId, p.title AS programTitle, m.id AS mesocycleId, m.title, p.revision,
        n.group_id AS groupId, (SELECT count(*) FROM training_navigation_members other WHERE other.workspace_id = n.workspace_id AND other.group_id = n.group_id) AS memberCount
        FROM training_mesocycles m JOIN training_programs p ON p.workspace_id = m.workspace_id AND p.id = m.program_id
        JOIN training_program_members pm ON pm.workspace_id = m.workspace_id AND pm.program_id = m.program_id AND pm.client_id = m.client_id
        LEFT JOIN training_navigation_members n ON n.workspace_id = m.workspace_id AND n.mesocycle_id = m.id
        WHERE m.workspace_id = ? AND m.client_id = ? AND pm.archived_at IS NULL ORDER BY p.created_at DESC, m.position`, [this.workspaceId, clientId]);
      result.push({ clientId, cycles: cycles.map(({ memberCount, ...cycle }) => ({ ...cycle, grouped: memberCount > 1 })), preferred: preferredPlacement(programs, selected, hostProgramId),
        programs: programs.filter((program) => program.kind === "PERIODIZED" && program.id !== hostProgramId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((program) => ({ id: program.id, title: program.title, current: program.id === selected })) });
    }
    return result;
  }

  async leaveGroup(clientId: string, programId: string, expectedRevision: number, mesocycleId: string, memberId: string,
    now: Date = new Date()): Promise<TrainingProgram> {
    const result = await this.ready().writer.write(async (tx) => {
      await this.assertTargets(tx, clientId, programId, [clientId]);
      const own = await this.viewerCopy(tx, clientId, programId, { mesocycleId });
      const member = own === null ? undefined : (await groupOfCopy(tx, this.workspaceId, own.mesocycleId))
        .find((item) => item.clientId === memberId);
      if (own === null || member === undefined || memberId === clientId) throw new Error("DRAFT_INVALID");
      await this.bumpRevision(tx, programId, expectedRevision, now);
      await tx.run("DELETE FROM training_navigation_members WHERE workspace_id = ? AND mesocycle_id = ?",
        [this.workspaceId, member.mesocycleId]);
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: [clientId, memberId] });
    return result;
  }

  async addParticipants(clientId: string, programId: string, expectedRevision: number, mesocycleId: string, sourceClientId: string,
    placements: readonly Placement[], now: Date = new Date()): Promise<TrainingProgram> {
    const ids = placements.map((item) => item.clientId);
    if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error("DRAFT_INVALID");
    const result = await this.ready().writer.write(async (tx) => {
      await this.assertTargets(tx, clientId, programId, [clientId]);
      const own = await this.viewerCopy(tx, clientId, programId, { mesocycleId });
      const source = own === null ? undefined : (await groupOfCopy(tx, this.workspaceId, own.mesocycleId))
        .find((item) => item.clientId === sourceClientId);
      const cycle = source === undefined ? undefined : (await readMesocycle(tx, this.workspaceId, source.programId, sourceClientId, source.mesocycleId));
      if (own === null || cycle === undefined) throw new Error("DRAFT_INVALID");
      if (ids.includes(clientId)) throw new Error("DRAFT_INVALID");
      const groupId = await navigationGroupId(tx, this.workspaceId, own.mesocycleId) ?? `cycle:${own.mesocycleId}`;
      await this.validateAttachments(tx, placements, groupId);
      if (await navigationGroupId(tx, this.workspaceId, own.mesocycleId) === null) await putNavigationMember(tx, this.workspaceId, groupId, own);
      await this.bumpRevision(tx, programId, expectedRevision, now);
      for (const placement of placements) {
        await tx.run("DELETE FROM training_navigation_members WHERE workspace_id = ? AND group_id = ? AND client_id = ?", [this.workspaceId, groupId, placement.clientId]);
        if (placement.target.kind === "existing") {
          await this.attachExisting(tx, placement.clientId, placement.target, groupId); continue;
        }
        const take = await this.idPool(tx, 2 + weekRowCount(cycle.weeks));
        const newId = take();
        // A newly created copy has its own ancestry; navigation is linked explicitly below.
        await this.placeCopy(tx, placement.clientId, placement.target, programId,
          { ...cycle, id: newId, lineageId: take(), weeks: copyWeeks(cycle.weeks, take) }, now);
        const copy = await readCopy(tx, this.workspaceId, newId);
        if (copy === null) throw new Error("TARGET_NOT_FOUND");
        await moveNavigationMember(tx, this.workspaceId, groupId, copy);
      }
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: [clientId, ...ids] });
    return result;
  }

  async restoreForClient(clientId: string, programId: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      await tx.run(`UPDATE training_program_members SET archived_at = NULL
        WHERE workspace_id = ? AND program_id = ? AND client_id = ?`, [this.workspaceId, programId, clientId]);
    });
    this.publish({ clientIds: [clientId] });
  }

  async close(): Promise<void> {
    this.planCache.clear();
    this.planReads.clear();
    this.programReads.clear();
    this.groupReads.clear();
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
