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
import { deleteStructure, readStructure, readWorkouts, writeStructure } from "./SimplePlanStore.ts";
import { deleteMemberMesocycles, insertMesocycle, readMesocycles, saveSelection, selectedMesocycle, writeWeek } from "./PeriodizedStore.ts";
import { MESOCYCLE_WEEKS_MAX, weekTypeLabels, type Mesocycle, type NewMesocycleInput, type PeriodizedPlan, type PlanWeek, type WeekEditInput,
  type WeekEditConflict, type WeekEditPreview, type WeekEditResult } from "../domain/PeriodizedModel.ts";
import { copyWeeks, diffWeek, newMesocycleWeeks, targetWeeks } from "../domain/PeriodizedRules.ts";
import { applyWithConflicts } from "../domain/WeekConflicts.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";
import { periodizedDraftKey, type PeriodizedDraft } from "../domain/PeriodizedDraft.ts";
import { mesocycleCreatedAt, preserveMesocycle, readMesocycleHistory } from "./StructureVersionStore.ts";
import type { MesocycleVersion } from "../domain/StructureVersion.ts";
import { simpleWorkoutDraftKey, type SimpleWorkoutDraft, type SimpleWorkoutEdit } from "../domain/SimpleWorkoutEdit.ts";
import { assertSimpleIdentities, preserveSimple, readSimpleHistory, readSimpleWeeks, writeSimpleOverride } from "./SimpleWeekStore.ts";
import { independentWeeks, weekRowCount, type CopyMesocycleInput } from "../domain/PlanCopy.ts";
import type { WeekPlansParticipant, WeekCopyRequest } from "../domain/WeekCopy.ts";
import type { WeekSwapPlansParticipant } from "../domain/WeekSwap.ts";
import { templateMesocycle, weeksFromTemplate, workoutsFromTemplate, type ProgramTemplate, type TemplateKind,
  type TemplatePayload } from "../domain/TemplateModel.ts";

type TemplateRow = Readonly<{ id: string; kind: TemplateKind; title: string; revision: number; createdAt: string;
  updatedAt: string; payloadJson: string }>;

const TEMPLATE_COLUMNS = `id, kind, title, revision, created_at AS createdAt, updated_at AS updatedAt, payload_json AS payloadJson`;

function templateOf(row: TemplateRow): ProgramTemplate {
  const { payloadJson, ...rest } = row;
  return { ...rest, payload: JSON.parse(payloadJson) as TemplatePayload };
}

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
    "dev_training_mesocycles", "dev_training_weeks", "dev_training_mesocycle_selection", "dev_training_periodized_drafts",
    "dev_training_structure_versions", "dev_training_simple_overrides", "dev_training_simple_versions"] as const,
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
    await tx.run("DELETE FROM dev_training_periodized_drafts WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_structure_versions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_simple_overrides WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_simple_versions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
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
    const row = await tx.first<{ weeks: number }>("SELECT weeks FROM dev_training_programs WHERE workspace_id = ? AND id = ?",
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
      await tx.run("DELETE FROM dev_training_builder_drafts WHERE workspace_id = ? AND client_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, simpleWorkoutDraftKey(programId, input.weekIndex, input.workoutId)]);
      return programById(tx, this.workspaceId, programId);
    });
    this.publish({ clientIds: [clientId] });
    return saved;
  }

  async getSimpleWorkoutDraft(clientId: string, programId: string, weekIndex: number, workoutId: string): Promise<SimpleWorkoutDraft | null> {
    if ((await this.getProgram(clientId, programId))?.kind !== "SIMPLE") return null;
    const row = await this.ready().connection.first<{ json: string }>(`SELECT draft_json AS json FROM dev_training_builder_drafts
      WHERE workspace_id = ? AND client_id = ? AND draft_key = ?`, [this.workspaceId, clientId, simpleWorkoutDraftKey(programId, weekIndex, workoutId)]);
    return row === null ? null : JSON.parse(row.json) as SimpleWorkoutDraft;
  }

  async saveSimpleWorkoutDraft(clientId: string, programId: string, draft: SimpleWorkoutDraft): Promise<void> {
    if (!Number.isInteger(draft.baseRevision) || draft.baseRevision < 1) throw new Error("DRAFT_INVALID");
    await this.ready().writer.write(async (tx) => {
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const program = await programById(tx, this.workspaceId, programId);
      if (program.kind !== "SIMPLE") throw new Error("DRAFT_INVALID");
      const key = simpleWorkoutDraftKey(programId, draft.input.weekIndex, draft.input.workoutId);
      await tx.run(`INSERT INTO dev_training_builder_drafts(workspace_id, client_id, draft_key, base_revision, draft_json, updated_at)
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
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const current = await programById(tx, this.workspaceId, programId);
      if (current.kind !== "SIMPLE") throw new Error("DRAFT_INVALID");
      const oldCount = await tx.first<{ weeks: number }>("SELECT weeks FROM dev_training_programs WHERE workspace_id = ? AND id = ?",
        [this.workspaceId, programId]);
      const previous = await readStructure(tx, this.workspaceId, programId, oldCount!.weeks);
      const weeks = await readSimpleWeeks(tx, this.workspaceId, clientId, programId, previous);
      for (const workout of draft.plan.workouts) await assertSimpleIdentities(tx, this.workspaceId, clientId, programId, workout,
        [...previous.workouts, ...weeks.flatMap((week) => week.workouts)].filter((item) => item.id === workout.id));
      const result = await tx.run(`UPDATE dev_training_programs SET title = ?, weeks = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`,
      [title, draft.plan.weeks, now.toISOString(), this.workspaceId, programId, expectedRevision]);
      if (result.changes !== 1) throw new Error("PROGRAM_REVISION_CONFLICT");
      if (previous.weeks !== draft.plan.weeks || diffWeek(previous.workouts, draft.plan.workouts).length > 0) {
        await preserveSimple(tx, this.workspaceId, clientId, programId, current.createdAt, current.title, weeks, now);
      }
      await writeStructure(tx, this.workspaceId, programId, draft.plan);
      const overrides = await tx.all<{ week: number; workoutId: string }>(`SELECT week_index AS week, workout_id AS workoutId
        FROM dev_training_simple_overrides WHERE workspace_id = ? AND client_id = ? AND program_id = ?`, [this.workspaceId, clientId, programId]);
      for (const override of overrides) {
        const old = previous.workouts.find((workout) => workout.id === override.workoutId);
        const next = draft.plan.workouts.find((workout) => workout.id === override.workoutId);
        const personal = weeks.find((week) => week.index === override.week)?.workouts.find((workout) => workout.id === override.workoutId);
        if (!next || !old || !personal || override.week > draft.plan.weeks) {
          await tx.run(`DELETE FROM dev_training_simple_overrides WHERE workspace_id = ? AND client_id = ? AND program_id = ?
            AND week_index = ? AND workout_id = ?`, [this.workspaceId, clientId, programId, override.week, override.workoutId]);
          continue;
        }
        const rows = 1 + next.exercises.reduce((sum, exercise) => sum + 1 + exercise.sets.length, 0);
        const applied = applyWithConflicts([old], [next], [personal], clientId, override.week, [], await this.idPool(tx, rows * 2));
        await writeSimpleOverride(tx, this.workspaceId, clientId, programId, override.week, applied.workouts[0]!);
      }
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
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      const result = await tx.run(`UPDATE dev_training_planned_exercises SET rest_sec = ?
        WHERE workspace_id = ? AND id = ? AND workout_id IN
          (SELECT w.id FROM dev_training_workouts w WHERE w.workspace_id = ? AND w.program_id = ? AND
            (w.week_id IS NULL OR EXISTS (SELECT 1 FROM dev_training_weeks k JOIN dev_training_mesocycles m
              ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id WHERE k.id = w.week_id AND m.client_id = ?)))`,
      [restSec, this.workspaceId, plannedExerciseId, this.workspaceId, programId, clientId]);
      const overrides = await tx.all<{ week: number; json: string }>(`SELECT week_index AS week, workout_json AS json
        FROM dev_training_simple_overrides WHERE workspace_id = ? AND client_id = ? AND program_id = ?`, [this.workspaceId, clientId, programId]);
      let changed = result.changes;
      for (const row of overrides) {
        const workout = JSON.parse(row.json) as PlannedWorkout;
        if (!workout.exercises.some((exercise) => exercise.id === plannedExerciseId)) continue;
        await writeSimpleOverride(tx, this.workspaceId, clientId, programId, row.week,
          { ...workout, exercises: workout.exercises.map((exercise) => exercise.id === plannedExerciseId ? { ...exercise, restSec } : exercise) });
        changed += 1;
      }
      if (changed === 0) throw new Error("TARGET_NOT_FOUND");
      await tx.run("UPDATE dev_training_programs SET revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ?",
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
      const workout = (await this.getSimpleWeeks(clientId, programId)).find((week) => week.index === weekIndex)
        ?.workouts.find((item) => item.id === plannedWorkoutId);
      return workout ? { program, workout } : null;
    }
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
    const found = await this.findWorkout(clientId, programId, plannedWorkoutId);
    if (found === null) return null;
    if (found.program.kind === "SIMPLE") {
      const plan = await this.getSimplePlan(clientId, programId);
      if (plan === null) return null;
      return { programTitle: found.program.title, mesocycleId: null,
        weeks: Array.from({ length: plan.draft.plan.weeks }, (_, index) => ({ index: index + 1, caption: null, workoutId: plannedWorkoutId })) };
    }
    const plan = await this.getPeriodizedPlan(clientId, programId);
    const cycle = plan?.mesocycles.find((item) => item.weeks.some((week) => week.workouts.some((workout) => workout.id === plannedWorkoutId)));
    if (!cycle) return null;
    const lineage = found.workout.lineageId ?? found.workout.id;
    return { programTitle: found.program.title, mesocycleId: cycle.id,
      weeks: cycle.weeks.map((week) => {
        const matches = week.workouts.filter((workout) => (workout.lineageId ?? workout.id) === lineage);
        return { index: week.index, caption: weekTypeLabels[week.type], workoutId: matches.length === 1 ? matches[0]!.id : null };
      }) };
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
      await tx.run("DELETE FROM dev_training_periodized_drafts WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?",
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
      const source = (await readMesocycles(tx, this.workspaceId, input.sourceProgramId, input.sourceClientId))
        .find((item) => item.id === input.sourceMesocycleId);
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
    const cycle = (await readMesocycles(tx, this.workspaceId, programId, clientId)).find((item) => item.id === mesocycleId);
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
      const cycle = (await readMesocycles(tx, this.workspaceId, programId, clientId)).find((item) => item.id === mesocycleId);
      const a = cycle?.weeks.find((week) => week.index === first);
      const b = cycle?.weeks.find((week) => week.index === second);
      if (!cycle || !a || !b) throw new Error("TARGET_NOT_FOUND");
      await this.bumpRevision(tx, programId, expectedRevision, now);
      await preserveMesocycle(tx, this.workspaceId, clientId, programId, cycle, now);
      // UNIQUE(мезоцикл, позиция) проверяется построчно: одна неделя сначала уходит на свободную позицию.
      const used = new Set(cycle.weeks.map((week) => week.index - 1));
      const free = Array.from({ length: MESOCYCLE_WEEKS_MAX }, (_, index) => index).find((position) => !used.has(position));
      if (free === undefined) throw new Error("WEEK_SWAP_NO_SLOT");
      const move = (id: string, position: number) => tx.run("UPDATE dev_training_weeks SET position = ? WHERE workspace_id = ? AND id = ?",
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

  private async prepareWeekEdit(tx: SqliteStatementPort, clientId: string, programId: string, expectedRevision: number,
    input: WeekEditInput, allocate: (count: number) => Promise<() => string>) {
      await this.assertTargets(tx, clientId, programId, input.clientIds);
      if ((await programById(tx, this.workspaceId, programId)).revision !== expectedRevision) throw new Error("PROGRAM_REVISION_CONFLICT");
      const own = (await readMesocycles(tx, this.workspaceId, programId, clientId)).find((item) => item.id === input.mesocycleId);
      const open = own?.weeks.find((week) => week.index === input.weekIndex);
      if (own === undefined || open === undefined) throw new Error("TARGET_NOT_FOUND");
      assertWeek(own.title, input.workouts);
      const rows = input.workouts.reduce((sum, workout) => sum + 1
        + workout.exercises.reduce((inner, exercise) => inner + 1 + exercise.sets.length, 0), 0);
      let skipped = 0;
      const conflicts: WeekEditConflict[] = [];
      const affectedWeeks: { clientId: string; weeks: readonly number[] }[] = [];
      const changes: { clientId: string; mesocycle: Mesocycle; weeks: PlanWeek[] }[] = [];
      for (const memberId of input.clientIds) {
        const mesocycle = memberId === clientId ? own
          : (await readMesocycles(tx, this.workspaceId, programId, memberId)).find((item) => item.lineageId === own.lineageId);
        if (mesocycle === undefined) {
          conflicts.push({ key: `${memberId}/missing-cycle`, clientId: memberId, weekIndex: input.weekIndex,
            workoutTitle: own.title, exerciseId: null, operation: "Изменить мезоцикл", reason: "MISSING_MESOCYCLE", canReplace: false });
          skipped += 1; continue;
        }
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
            input.replaceConflicts ?? [], await allocate(rows * 2));
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
        if (changedWeeks.length > 0) changes.push({ clientId: memberId, mesocycle, weeks: changedWeeks });
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
    const saved = await this.ready().writer.write(async (tx) => {
      const prepared = await this.prepareWeekEdit(tx, clientId, programId, expectedRevision, input, (count) => this.idPool(tx, count));
      await this.bumpRevision(tx, programId, expectedRevision, now);
      for (const change of prepared.changes) {
        await preserveMesocycle(tx, this.workspaceId, change.clientId, programId, change.mesocycle, now);
        for (const week of change.weeks) await writeWeek(tx, this.workspaceId, programId, week);
      }
      await tx.run("DELETE FROM dev_training_periodized_drafts WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, programId, `week:${input.mesocycleId}:${input.weekIndex}`]);
      return { program: await programById(tx, this.workspaceId, programId), skipped: prepared.skipped };
    });
    this.publish({ clientIds: input.clientIds });
    return saved;
  }

  async listTemplates(): Promise<readonly ProgramTemplate[]> {
    const rows = await this.ready().connection.all<TemplateRow>(`SELECT ${TEMPLATE_COLUMNS} FROM dev_training_templates
      WHERE workspace_id = ? ORDER BY updated_at DESC, title`, [this.workspaceId]);
    return rows.map(templateOf);
  }

  private async templateById(tx: SqliteStatementPort, templateId: string): Promise<ProgramTemplate> {
    const row = await tx.first<TemplateRow>(`SELECT ${TEMPLATE_COLUMNS} FROM dev_training_templates
      WHERE workspace_id = ? AND id = ?`, [this.workspaceId, templateId]);
    if (row === null) throw new Error("TARGET_NOT_FOUND");
    return templateOf(row);
  }

  private async insertTemplate(tx: SqliteStatementPort, title: string, payload: TemplatePayload, now: Date): Promise<ProgramTemplate> {
    const take = await this.idPool(tx, 1);
    const id = take();
    const stamp = now.toISOString();
    await tx.run(`INSERT INTO dev_training_templates (id, workspace_id, kind, title, payload_json, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`, [id, this.workspaceId, payload.kind, normalizeTitle(title), JSON.stringify(payload), stamp, stamp]);
    return this.templateById(tx, id);
  }

  async saveProgramAsTemplate(clientId: string, programId: string, title: string, now: Date = new Date()): Promise<ProgramTemplate> {
    return this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      const program = await programById(tx, this.workspaceId, programId);
      if (program.kind === "SIMPLE") {
        const row = await tx.first<{ weeks: number }>("SELECT weeks FROM dev_training_programs WHERE workspace_id = ? AND id = ?",
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

  async saveMesocycleAsTemplate(clientId: string, programId: string, mesocycleId: string, title: string,
    now: Date = new Date()): Promise<ProgramTemplate> {
    return this.ready().writer.write(async (tx) => {
      await membership(tx, this.workspaceId, clientId, programId);
      const mesocycle = (await readMesocycles(tx, this.workspaceId, programId, clientId)).find((item) => item.id === mesocycleId);
      if (mesocycle === undefined) throw new Error("TARGET_NOT_FOUND");
      return this.insertTemplate(tx, title, { kind: "MESOCYCLE", mesocycle: templateMesocycle(mesocycle) }, now);
    });
  }

  async renameTemplate(templateId: string, expectedRevision: number, title: string, now: Date = new Date()): Promise<ProgramTemplate> {
    const value = normalizeTitle(title);
    return this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_training_templates SET title = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?`, [value, now.toISOString(), this.workspaceId, templateId, expectedRevision]);
      if (result.changes !== 1) {
        await this.templateById(tx, templateId);
        throw new Error("TEMPLATE_REVISION_CONFLICT");
      }
      return this.templateById(tx, templateId);
    });
  }

  async duplicateTemplate(templateId: string, title: string, now: Date = new Date()): Promise<ProgramTemplate> {
    return this.ready().writer.write(async (tx) => this.insertTemplate(tx, title, (await this.templateById(tx, templateId)).payload, now));
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM dev_training_templates WHERE workspace_id = ? AND id = ?", [this.workspaceId, templateId]);
    });
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

  async getPeriodizedDraft(clientId: string, programId: string, key: string): Promise<PeriodizedDraft | null> {
    if (await this.getProgram(clientId, programId) === null) return null;
    const row = await this.ready().connection.first<{ json: string }>(`SELECT draft_json AS json FROM dev_training_periodized_drafts
      WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?`, [this.workspaceId, clientId, programId, key]);
    return row === null ? null : JSON.parse(row.json) as PeriodizedDraft;
  }

  async savePeriodizedDraft(clientId: string, programId: string, draft: PeriodizedDraft): Promise<void> {
    if (!Number.isInteger(draft.baseRevision) || draft.baseRevision < 1 || !draft.clientIds.includes(clientId)) throw new Error("DRAFT_INVALID");
    await this.ready().writer.write(async (tx) => {
      if ((await membership(tx, this.workspaceId, clientId, programId)).archivedAt !== null) throw new Error("PROGRAM_ARCHIVED");
      if ((await programById(tx, this.workspaceId, programId)).kind !== "PERIODIZED") throw new Error("DRAFT_INVALID");
      if (draft.kind === "WEEK") {
        const cycle = (await readMesocycles(tx, this.workspaceId, programId, clientId)).find((item) => item.id === draft.mesocycleId);
        if (!cycle?.weeks.some((week) => week.index === draft.weekIndex)) throw new Error("TARGET_NOT_FOUND");
      }
      await tx.run(`INSERT INTO dev_training_periodized_drafts(workspace_id, client_id, program_id, draft_key, draft_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id, program_id, draft_key)
        DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, programId, periodizedDraftKey(draft), JSON.stringify(draft), new Date().toISOString()]);
    });
  }

  async clearPeriodizedDraft(clientId: string, programId: string, key: string): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM dev_training_periodized_drafts WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND draft_key = ?",
        [this.workspaceId, clientId, programId, key]);
    });
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
