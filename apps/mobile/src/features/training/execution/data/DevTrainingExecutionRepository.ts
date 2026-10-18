import { runMigrations } from "../../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../../shared/db/WriterCoordinator.ts";
import { DEFAULT_CONFIRMATION_MODE, SET_TYPES, type ConfirmationMode, type PreviousQuery, type PreviousSet,
  type SessionStatus, type SetFact, type SetType, type SetValues, type WorkoutExecution, type WorkoutOutcome,
  type WorkoutSession, type WorkoutSlot } from "../domain/ExecutionModel.ts";
import { assertDropStructure, confirmationAfterSave, isLocalDate, localDateOf, matchPrevious, toggleConfirmation,
  validateContent, workoutStatus, type ConfirmationChange, type SetContent } from "../domain/ExecutionRules.ts";
import type { SaveSetInput, SetIdentity, SetSaveResult, TrainingExecutionCommittedChange,
  TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import type { RestTimerStorePort } from "../domain/RestTimerPorts.ts";
import type { RestTimer } from "../domain/RestTimerRules.ts";
import { DEV_TRAINING_EXECUTION_LEDGER, devTrainingExecutionCatalog } from "./DevTrainingExecutionCatalog.ts";

const OUTCOMES: readonly WorkoutOutcome[] = ["COMPLETED", "MISSED", "CANCELLED"];

const SESSION_COLUMNS = `id, client_id AS clientId, program_id AS programId, week_index AS weekIndex,
  planned_workout_id AS plannedWorkoutId, outcome, actual_date AS actualDate, revision`;

const FACT_COLUMNS = `id, planned_set_id AS plannedSetId, planned_exercise_id AS plannedExerciseId,
  exercise_id AS exerciseId, position, set_type AS setType, reps, load_grams AS loadGrams,
  duration_sec AS durationSec, distance_m AS distanceM, rpe, confirmed_at AS confirmedAt, revision, extra,
  removed_at AS removedAt`;

type FactRow = Readonly<{
  id: string; plannedSetId: string; plannedExerciseId: string; exerciseId: string; position: number;
  setType: SetType; reps: number | null; loadGrams: number | null; durationSec: number | null; distanceM: number | null;
  rpe: number | null; confirmedAt: string | null; revision: number; extra: number; removedAt: string | null;
}>;

function valuesOf(row: SetValues): SetValues {
  return { reps: row.reps, loadGrams: row.loadGrams, durationSec: row.durationSec, distanceM: row.distanceM };
}

function toFact(row: FactRow, drops: readonly SetValues[]): SetFact {
  return { id: row.id, plannedSetId: row.plannedSetId, plannedExerciseId: row.plannedExerciseId, exerciseId: row.exerciseId,
    position: row.position, setType: row.setType, values: valuesOf(row), drops, rpe: row.rpe,
    confirmed: row.confirmedAt !== null, extra: row.extra === 1, revision: row.revision };
}

type DropRow = Readonly<{ setId: string; reps: number | null; loadGrams: number | null; durationSec: number | null;
  distanceM: number | null }>;

/** Мини-сеты подходов по порядку; ключ — ID факта. */
async function dropsOf(port: SqliteStatementPort, workspaceId: string, setIds: readonly string[]):
  Promise<ReadonlyMap<string, readonly SetValues[]>> {
  const result = new Map<string, SetValues[]>();
  if (setIds.length === 0) return result;
  const rows = await port.all<DropRow>(`SELECT set_id AS setId, reps, load_grams AS loadGrams, duration_sec AS durationSec,
    distance_m AS distanceM FROM dev_training_performed_drops
    WHERE workspace_id = ? AND set_id IN (${setIds.map(() => "?").join(", ")}) ORDER BY set_id, position`,
  [workspaceId, ...setIds]);
  for (const row of rows) result.set(row.setId, [...(result.get(row.setId) ?? []), valuesOf(row)]);
  return result;
}

function assertSlot(slot: WorkoutSlot): void {
  if (!slot.clientId || !slot.programId || !slot.plannedWorkoutId || !Number.isInteger(slot.weekIndex)
    || slot.weekIndex < 1 || slot.weekIndex > 52) throw new Error("WRONG_CLIENT_SCOPE");
}

function assertIdentity(identity: SetIdentity): void {
  assertSlot(identity.slot);
  if (!identity.plannedExerciseId || !identity.plannedSetId || !Number.isInteger(identity.position) || identity.position < 0) {
    throw new Error("WRONG_CLIENT_SCOPE");
  }
}

/** Сторона дневника в PermanentlyDeleteArchivedClient (§15.7): выполнения и факты подходов клиента. */
export const devTrainingExecutionClientDeletionParticipant = {
  owner: "training.execution",
  tables: ["dev_training_performed_drops", "dev_training_performed_sets", "dev_training_sessions",
    "dev_training_rest_timers"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_training_sessions
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run(`DELETE FROM dev_training_performed_drops WHERE workspace_id = ? AND set_id IN
      (SELECT f.id FROM dev_training_performed_sets f JOIN dev_training_sessions s ON s.id = f.session_id
        WHERE s.workspace_id = ? AND s.client_id = ?)`, [workspaceId, workspaceId, clientId]);
    await tx.run(`DELETE FROM dev_training_performed_sets WHERE workspace_id = ? AND session_id IN
      (SELECT id FROM dev_training_sessions WHERE workspace_id = ? AND client_id = ?)`, [workspaceId, workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_sessions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_rest_timers WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Явно dev-хранилище новой установки в общем dev-файле клиентов. */
export class DevTrainingExecutionRepository implements TrainingExecutionPort, RestTimerStorePort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: TrainingExecutionCommittedChange) => void>();

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
      await runMigrations(writer, devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER);
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

  subscribeCommittedChanges(listener: (change: TrainingExecutionCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(slot: WorkoutSlot): void {
    for (const listener of this.listeners) {
      try { listener({ clientId: slot.clientId, programId: slot.programId }); } catch { /* Наблюдатель не превращает коммит в ошибку. */ }
    }
  }

  private async modeOf(port: SqliteStatementPort): Promise<ConfirmationMode> {
    const row = await port.first<{ mode: ConfirmationMode }>(`SELECT confirmation_mode AS mode
      FROM dev_training_execution_settings WHERE workspace_id = ?`, [this.workspaceId]);
    return row?.mode ?? DEFAULT_CONFIRMATION_MODE;
  }

  getConfirmationMode(): Promise<ConfirmationMode> {
    return this.modeOf(this.ready().connection);
  }

  async setConfirmationMode(mode: ConfirmationMode): Promise<void> {
    if (mode !== "AUTO" && mode !== "MANUAL") throw new Error("INVALID_METRIC");
    await this.ready().writer.write((tx) => tx.run(`INSERT INTO dev_training_execution_settings (workspace_id, confirmation_mode)
      VALUES (?, ?) ON CONFLICT (workspace_id) DO UPDATE SET confirmation_mode = excluded.confirmation_mode`,
    [this.workspaceId, mode]));
  }

  private sessionOf(port: SqliteStatementPort, slot: WorkoutSlot): Promise<WorkoutSession | null> {
    return port.first<WorkoutSession>(`SELECT ${SESSION_COLUMNS} FROM dev_training_sessions
      WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND week_index = ? AND planned_workout_id = ?`,
    [this.workspaceId, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId]);
  }

  /** Первый ввод создаёт выполнение слота с сегодняшней датой (§48.34, §48.84). */
  private async ensureSession(tx: SqliteStatementPort, slot: WorkoutSlot, now: Date): Promise<WorkoutSession> {
    const existing = await this.sessionOf(tx, slot);
    if (existing !== null) return existing;
    const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
    if (!id) throw new Error("SESSION_ID_UNAVAILABLE");
    const stamp = now.toISOString();
    await tx.run(`INSERT INTO dev_training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id,
      actual_date, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, this.workspaceId, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId, localDateOf(now), stamp, stamp]);
    return { ...slot, id, outcome: null, actualDate: localDateOf(now), revision: 1 };
  }

  private factOf(port: SqliteStatementPort, sessionId: string, plannedSetId: string): Promise<FactRow | null> {
    return port.first<FactRow>(`SELECT ${FACT_COLUMNS} FROM dev_training_performed_sets
      WHERE workspace_id = ? AND session_id = ? AND planned_set_id = ?`, [this.workspaceId, sessionId, plannedSetId]);
  }

  async getWorkout(slot: WorkoutSlot): Promise<WorkoutExecution> {
    const { connection } = this.ready();
    const session = await this.sessionOf(connection, slot);
    if (session === null) return { session: null, facts: new Map() };
    const rows = await connection.all<FactRow>(`SELECT ${FACT_COLUMNS} FROM dev_training_performed_sets
      WHERE workspace_id = ? AND session_id = ? AND removed_at IS NULL`, [this.workspaceId, session.id]);
    const drops = await dropsOf(connection, this.workspaceId, rows.filter((row) => row.setType === "DROP").map((row) => row.id));
    return { session, facts: new Map(rows.map((row) => [row.plannedSetId, toFact(row, drops.get(row.id) ?? [])])) };
  }

  async getProgramStatuses(clientId: string, programId: string): Promise<readonly SessionStatus[]> {
    const rows = await this.ready().connection.all<{ weekIndex: number; plannedWorkoutId: string;
      outcome: WorkoutOutcome | null; started: number }>(`SELECT s.week_index AS weekIndex,
        s.planned_workout_id AS plannedWorkoutId, s.outcome,
        EXISTS (SELECT 1 FROM dev_training_performed_sets f WHERE f.workspace_id = s.workspace_id AND f.session_id = s.id
          AND f.removed_at IS NULL AND (f.confirmed_at IS NOT NULL OR COALESCE(f.reps, f.load_grams, f.duration_sec, f.distance_m) IS NOT NULL)) AS started
      FROM dev_training_sessions s WHERE s.workspace_id = ? AND s.client_id = ? AND s.program_id = ?`,
    [this.workspaceId, clientId, programId]);
    return rows.map((row) => ({ weekIndex: row.weekIndex, plannedWorkoutId: row.plannedWorkoutId,
      status: workoutStatus(row.outcome, row.started === 1) }));
  }

  /**
   * §37.8: последнее выполнение этой программы клиента не позже даты текущего, сначала с тем же слотом
   * упражнения, затем то же упражнение в других днях. Подходы источника — только подтверждённые.
   */
  private async previousSource(port: SqliteStatementPort, slot: WorkoutSlot, date: string, startedBefore: string,
    column: "planned_exercise_id" | "exercise_id", value: string):
    Promise<Readonly<{ date: string; sets: readonly Readonly<{ setType: SetType; value: PreviousSet }>[] }> | null> {
    const session = await port.first<{ id: string; date: string }>(`SELECT s.id, s.actual_date AS date
      FROM dev_training_sessions s
      WHERE s.workspace_id = ? AND s.client_id = ? AND s.program_id = ?
        AND (s.actual_date < ? OR (s.actual_date = ? AND s.created_at < ?))
        AND NOT (s.week_index = ? AND s.planned_workout_id = ?)
        AND EXISTS (SELECT 1 FROM dev_training_performed_sets f WHERE f.workspace_id = s.workspace_id
          AND f.session_id = s.id AND f.confirmed_at IS NOT NULL AND f.removed_at IS NULL AND f.${column} = ?)
      ORDER BY s.actual_date DESC, s.week_index DESC, s.created_at DESC LIMIT 1`,
    [this.workspaceId, slot.clientId, slot.programId, date, date, startedBefore, slot.weekIndex, slot.plannedWorkoutId, value]);
    if (session === null) return null;
    const rows = await port.all<FactRow>(`SELECT ${FACT_COLUMNS} FROM dev_training_performed_sets
      WHERE workspace_id = ? AND session_id = ? AND confirmed_at IS NOT NULL AND removed_at IS NULL AND ${column} = ?
      ORDER BY rowid`,
    [this.workspaceId, session.id, value]);
    // Упражнение могло встречаться в тренировке дважды: берём одно его появление, а не смесь.
    const slotId = rows[0]?.plannedExerciseId;
    const chosen = rows.filter((row) => row.plannedExerciseId === slotId).sort((a, b) => a.position - b.position);
    const drops = await dropsOf(port, this.workspaceId, chosen.filter((row) => row.setType === "DROP").map((row) => row.id));
    const sets = chosen.map((row) => ({ setType: row.setType,
      value: { values: valuesOf(row), drops: drops.get(row.id) ?? [], date: session.date } }));
    return { date: session.date, sets };
  }

  async getPrevious(slot: WorkoutSlot, queries: readonly PreviousQuery[], now: Date = new Date()):
    Promise<ReadonlyMap<string, PreviousSet>> {
    assertSlot(slot);
    const { connection } = this.ready();
    const current = await this.getWorkout(slot);
    const date = current.session?.actualDate ?? localDateOf(now);
    // В тот же день «прошлое» — только начатое раньше текущего выполнения (ещё не начатое начнётся сейчас).
    const startedBefore = current.session === null ? now.toISOString()
      : (await connection.first<{ createdAt: string }>(`SELECT created_at AS createdAt FROM dev_training_sessions
        WHERE workspace_id = ? AND id = ?`, [this.workspaceId, current.session.id]))?.createdAt ?? now.toISOString();
    const result = new Map<string, PreviousSet>();
    for (const query of queries) {
      const source = await this.previousSource(connection, slot, date, startedBefore, "planned_exercise_id", query.plannedExerciseId)
        ?? await this.previousSource(connection, slot, date, startedBefore, "exercise_id", query.exerciseId);
      if (source === null) continue;
      const matched = matchPrevious(query.plannedSetIds.map((plannedSetId) => ({ plannedSetId,
        setType: current.facts.get(plannedSetId)?.setType ?? "NORMAL" })), source.sets);
      for (const [plannedSetId, set] of matched) result.set(plannedSetId, set);
    }
    return result;
  }

  /** Записать факт по выбранному переходу подтверждения; ревизия проверяется в той же транзакции. */
  private async writeFact(tx: SqliteStatementPort, identity: SetIdentity, now: Date,
    next: (existing: FactRow | null, existingDrops: readonly SetValues[], mode: ConfirmationMode) =>
      Readonly<{ content: SetContent; rpe: number | null; change: ConfirmationChange }>): Promise<SetSaveResult> {
    const mode = await this.modeOf(tx);
    const session = await this.ensureSession(tx, identity.slot, now);
    const existing = await this.factOf(tx, session.id, identity.plannedSetId);
    if (existing?.removedAt != null) throw new Error("FACT_NOT_FOUND");
    if ((existing?.revision ?? null) !== identity.expectedRevision) throw new Error("STALE_SESSION");
    if (existing !== null && existing.exerciseId !== identity.exerciseId) throw new Error("WRONG_CLIENT_SCOPE");
    const existingDrops = existing === null ? [] : (await dropsOf(tx, this.workspaceId, [existing.id])).get(existing.id) ?? [];
    const { content, rpe, change } = next(existing, existingDrops, mode);
    if (existing !== null) {
      assertDropStructure({ confirmed: existing.confirmedAt !== null, setType: existing.setType, dropCount: existingDrops.length },
        content);
    }
    const { values, setType } = content;
    if (existing?.extra === 1 && setType !== "WARMUP") throw new Error("INVALID_METRIC");
    const stamp = now.toISOString();
    const confirmedAt = !change.confirmed ? null : change.confirmedNow ? stamp : existing?.confirmedAt ?? stamp;
    const params = [identity.plannedExerciseId, identity.position, setType, values.reps, values.loadGrams, values.durationSec,
      values.distanceM, rpe, confirmedAt, stamp];
    if (existing === null) {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("FACT_ID_UNAVAILABLE");
      await tx.run(`INSERT INTO dev_training_performed_sets (planned_exercise_id, position, set_type, reps, load_grams,
        duration_sec, distance_m, rpe, confirmed_at, updated_at, id, workspace_id, session_id, planned_set_id, exercise_id,
        origin, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INPUT', 1)`,
      [...params, id, this.workspaceId, session.id, identity.plannedSetId, identity.exerciseId]);
    } else {
      await tx.run(`UPDATE dev_training_performed_sets SET planned_exercise_id = ?, position = ?, set_type = ?, reps = ?,
        load_grams = ?, duration_sec = ?, distance_m = ?, rpe = ?, confirmed_at = ?, updated_at = ?, origin = 'INPUT',
        revision = revision + 1 WHERE workspace_id = ? AND id = ?`, [...params, this.workspaceId, existing.id]);
    }
    const saved = await this.factOf(tx, session.id, identity.plannedSetId);
    if (saved === null) throw new Error("FACT_NOT_FOUND");
    // Мини-сеты — часть того же факта: переписываются целиком после строки подхода (триггер проверяет тип).
    await tx.run("DELETE FROM dev_training_performed_drops WHERE workspace_id = ? AND set_id = ?", [this.workspaceId, saved.id]);
    for (const [index, drop] of content.drops.entries()) {
      await tx.run(`INSERT INTO dev_training_performed_drops (workspace_id, set_id, position, reps, load_grams, duration_sec,
        distance_m) VALUES (?, ?, ?, ?, ?, ?, ?)`, [this.workspaceId, saved.id, index + 2, drop.reps, drop.loadGrams,
        drop.durationSec, drop.distanceM]);
    }
    return { fact: toFact(saved, content.drops), session, confirmedNow: change.confirmedNow };
  }

  async saveSet(input: SaveSetInput, now: Date = new Date()): Promise<SetSaveResult> {
    assertIdentity(input);
    if (!SET_TYPES.includes(input.setType)) throw new Error("INVALID_METRIC");
    const content: SetContent = { setType: input.setType, values: input.values, drops: input.drops };
    validateContent(content, input.rpe, input.metrics);
    const result = await this.ready().writer.write((tx) => this.writeFact(tx, input, now, (existing, _drops, mode) => ({
      content, rpe: input.rpe, change: confirmationAfterSave(mode, existing?.confirmedAt != null, content, input.metrics),
    })));
    this.publish(input.slot);
    return result;
  }

  async toggleSetConfirmation(identity: SetIdentity, now: Date = new Date()): Promise<SetSaveResult> {
    assertIdentity(identity);
    const result = await this.ready().writer.write(async (tx) => {
      const session = await this.sessionOf(tx, identity.slot);
      if (session === null || await this.factOf(tx, session.id, identity.plannedSetId) === null) throw new Error("FACT_NOT_FOUND");
      return this.writeFact(tx, identity, now, (existing, drops) => {
        const row = existing as FactRow;
        const content: SetContent = { setType: row.setType, values: valuesOf(row), drops };
        return { content, rpe: row.rpe, change: toggleConfirmation(row.confirmedAt !== null, content, identity.metrics) };
      });
    });
    this.publish(identity.slot);
    return result;
  }

  async addWarmupSet(slot: WorkoutSlot, where: Readonly<{ plannedExerciseId: string; exerciseId: string }>,
    now: Date = new Date()): Promise<SetSaveResult> {
    assertSlot(slot);
    if (!where.plannedExerciseId) throw new Error("WRONG_CLIENT_SCOPE");
    const result = await this.ready().writer.write(async (tx) => {
      const session = await this.ensureSession(tx, slot, now);
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("FACT_ID_UNAVAILABLE");
      const count = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_training_performed_sets
        WHERE workspace_id = ? AND session_id = ? AND planned_exercise_id = ? AND extra = 1`,
      [this.workspaceId, session.id, where.plannedExerciseId]);
      const plannedSetId = `extra-${id}`;
      await tx.run(`INSERT INTO dev_training_performed_sets (id, workspace_id, session_id, planned_set_id, planned_exercise_id,
        exercise_id, position, set_type, origin, revision, updated_at, extra) VALUES (?, ?, ?, ?, ?, ?, ?, 'WARMUP', 'INPUT', 1, ?, 1)`,
      [id, this.workspaceId, session.id, plannedSetId, where.plannedExerciseId, where.exerciseId, count?.n ?? 0,
        now.toISOString()]);
      const saved = await this.factOf(tx, session.id, plannedSetId);
      if (saved === null) throw new Error("FACT_NOT_FOUND");
      return { fact: toFact(saved, []), session, confirmedNow: false };
    });
    this.publish(slot);
    return result;
  }

  async removeWarmupSet(slot: WorkoutSlot, plannedSetId: string, expectedRevision: number, now: Date = new Date()): Promise<void> {
    assertSlot(slot);
    await this.ready().writer.write(async (tx) => {
      const session = await this.sessionOf(tx, slot);
      const fact = session === null ? null : await this.factOf(tx, session.id, plannedSetId);
      if (fact === null || fact.removedAt !== null) throw new Error("FACT_NOT_FOUND");
      if (fact.extra !== 1) throw new Error("INVALID_METRIC");
      if (fact.revision !== expectedRevision) throw new Error("STALE_SESSION");
      await tx.run(`UPDATE dev_training_performed_sets SET removed_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ?`, [now.toISOString(), now.toISOString(), this.workspaceId, fact.id]);
    });
    this.publish(slot);
  }

  async setOutcome(slot: WorkoutSlot, outcome: WorkoutOutcome | null, expectedRevision: number | null,
    now: Date = new Date()): Promise<WorkoutSession> {
    assertSlot(slot);
    if (outcome !== null && !OUTCOMES.includes(outcome)) throw new Error("INVALID_METRIC");
    const saved = await this.ready().writer.write(async (tx) => {
      const existing = await this.sessionOf(tx, slot);
      if ((existing?.revision ?? null) !== expectedRevision) throw new Error("STALE_SESSION");
      // Исход у ещё не начатой тренировки (например, «Пропущена») создаёт выполнение без фактов.
      const session = existing ?? await this.ensureSession(tx, slot, now);
      await tx.run(`UPDATE dev_training_sessions SET outcome = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ?`, [outcome, now.toISOString(), this.workspaceId, session.id]);
      return await this.sessionOf(tx, slot) as WorkoutSession;
    });
    this.publish(slot);
    return saved;
  }

  async setActualDate(slot: WorkoutSlot, date: string, expectedRevision: number, now: Date = new Date()): Promise<WorkoutSession> {
    assertSlot(slot);
    if (!isLocalDate(date)) throw new Error("INVALID_METRIC");
    const saved = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_training_sessions SET actual_date = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND week_index = ? AND planned_workout_id = ?
          AND revision = ?`, [date, now.toISOString(), this.workspaceId, slot.clientId, slot.programId, slot.weekIndex,
        slot.plannedWorkoutId, expectedRevision]);
      if (result.changes !== 1) throw new Error("STALE_SESSION");
      return await this.sessionOf(tx, slot) as WorkoutSession;
    });
    this.publish(slot);
    return saved;
  }

  listTimers(): Promise<readonly RestTimer[]> {
    return this.ready().connection.all<RestTimer>(`SELECT id, client_id AS clientId, client_name AS clientName,
      exercise_key AS exerciseKey, exercise_name AS exerciseName, started_at AS startedAt, end_at AS endAt,
      signal_id AS signalId FROM dev_training_rest_timers WHERE workspace_id = ? ORDER BY end_at`, [this.workspaceId]);
  }

  async putTimer(timer: RestTimer, replacedId: string | null): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      if (replacedId !== null) await tx.run("DELETE FROM dev_training_rest_timers WHERE workspace_id = ? AND id = ?",
        [this.workspaceId, replacedId]);
      await tx.run(`INSERT INTO dev_training_rest_timers (id, workspace_id, client_id, client_name, exercise_key, exercise_name,
        started_at, end_at, signal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET end_at = excluded.end_at, signal_id = excluded.signal_id`,
      [timer.id, this.workspaceId, timer.clientId, timer.clientName, timer.exerciseKey, timer.exerciseName, timer.startedAt,
        timer.endAt, timer.signalId]);
    });
  }

  async removeTimer(id: string): Promise<void> {
    await this.ready().writer.write((tx) => tx.run("DELETE FROM dev_training_rest_timers WHERE workspace_id = ? AND id = ?",
      [this.workspaceId, id]));
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
