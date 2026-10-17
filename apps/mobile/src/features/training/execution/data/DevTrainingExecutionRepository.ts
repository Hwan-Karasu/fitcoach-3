import { runMigrations } from "../../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../../shared/db/WriterCoordinator.ts";
import { DEFAULT_CONFIRMATION_MODE, SET_TYPES, type ConfirmationMode, type PreviousQuery, type PreviousSet,
  type SessionStatus, type SetFact, type SetType, type SetValues, type WorkoutExecution, type WorkoutOutcome,
  type WorkoutSession, type WorkoutSlot } from "../domain/ExecutionModel.ts";
import { confirmationAfterSave, isLocalDate, localDateOf, matchPrevious, toggleConfirmation, validateValues,
  workoutStatus, type ConfirmationChange } from "../domain/ExecutionRules.ts";
import type { SaveSetInput, SetIdentity, SetSaveResult, TrainingExecutionCommittedChange,
  TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { DEV_TRAINING_EXECUTION_LEDGER, devTrainingExecutionCatalog } from "./DevTrainingExecutionCatalog.ts";

const OUTCOMES: readonly WorkoutOutcome[] = ["COMPLETED", "MISSED", "CANCELLED"];

const SESSION_COLUMNS = `id, client_id AS clientId, program_id AS programId, week_index AS weekIndex,
  planned_workout_id AS plannedWorkoutId, outcome, actual_date AS actualDate, revision`;

const FACT_COLUMNS = `id, planned_set_id AS plannedSetId, planned_exercise_id AS plannedExerciseId,
  exercise_id AS exerciseId, position, set_type AS setType, reps, load_grams AS loadGrams,
  duration_sec AS durationSec, distance_m AS distanceM, rpe, confirmed_at AS confirmedAt, revision`;

type FactRow = Readonly<{
  id: string; plannedSetId: string; plannedExerciseId: string; exerciseId: string; position: number;
  setType: SetType; reps: number | null; loadGrams: number | null; durationSec: number | null; distanceM: number | null;
  rpe: number | null; confirmedAt: string | null; revision: number;
}>;

function valuesOf(row: SetValues): SetValues {
  return { reps: row.reps, loadGrams: row.loadGrams, durationSec: row.durationSec, distanceM: row.distanceM };
}

function toFact(row: FactRow): SetFact {
  return { id: row.id, plannedSetId: row.plannedSetId, plannedExerciseId: row.plannedExerciseId, exerciseId: row.exerciseId,
    position: row.position, setType: row.setType, values: valuesOf(row), rpe: row.rpe, confirmed: row.confirmedAt !== null,
    revision: row.revision };
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
  tables: ["dev_training_performed_sets", "dev_training_sessions"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_training_sessions
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run(`DELETE FROM dev_training_performed_sets WHERE workspace_id = ? AND session_id IN
      (SELECT id FROM dev_training_sessions WHERE workspace_id = ? AND client_id = ?)`, [workspaceId, workspaceId, clientId]);
    await tx.run("DELETE FROM dev_training_sessions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Явно dev-хранилище новой установки в общем dev-файле клиентов. */
export class DevTrainingExecutionRepository implements TrainingExecutionPort {
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
      WHERE workspace_id = ? AND session_id = ?`, [this.workspaceId, session.id]);
    return { session, facts: new Map(rows.map((row) => [row.plannedSetId, toFact(row)])) };
  }

  async getProgramStatuses(clientId: string, programId: string): Promise<readonly SessionStatus[]> {
    const rows = await this.ready().connection.all<{ weekIndex: number; plannedWorkoutId: string;
      outcome: WorkoutOutcome | null; started: number }>(`SELECT s.week_index AS weekIndex,
        s.planned_workout_id AS plannedWorkoutId, s.outcome,
        EXISTS (SELECT 1 FROM dev_training_performed_sets f WHERE f.workspace_id = s.workspace_id AND f.session_id = s.id
          AND (f.confirmed_at IS NOT NULL OR COALESCE(f.reps, f.load_grams, f.duration_sec, f.distance_m) IS NOT NULL)) AS started
      FROM dev_training_sessions s WHERE s.workspace_id = ? AND s.client_id = ? AND s.program_id = ?`,
    [this.workspaceId, clientId, programId]);
    return rows.map((row) => ({ weekIndex: row.weekIndex, plannedWorkoutId: row.plannedWorkoutId,
      status: workoutStatus(row.outcome, row.started === 1) }));
  }

  /**
   * §37.8: последнее выполнение этой программы клиента не позже даты текущего, сначала с тем же слотом
   * упражнения, затем то же упражнение в других днях. Подходы источника — только подтверждённые.
   */
  private async previousSource(port: SqliteStatementPort, slot: WorkoutSlot, date: string,
    column: "planned_exercise_id" | "exercise_id", value: string):
    Promise<Readonly<{ date: string; sets: readonly Readonly<{ setType: SetType; value: SetValues }>[] }> | null> {
    const session = await port.first<{ id: string; date: string }>(`SELECT s.id, s.actual_date AS date
      FROM dev_training_sessions s
      WHERE s.workspace_id = ? AND s.client_id = ? AND s.program_id = ? AND s.actual_date <= ?
        AND NOT (s.week_index = ? AND s.planned_workout_id = ?)
        AND EXISTS (SELECT 1 FROM dev_training_performed_sets f WHERE f.workspace_id = s.workspace_id
          AND f.session_id = s.id AND f.confirmed_at IS NOT NULL AND f.${column} = ?)
      ORDER BY s.actual_date DESC, s.week_index DESC, s.created_at DESC LIMIT 1`,
    [this.workspaceId, slot.clientId, slot.programId, date, slot.weekIndex, slot.plannedWorkoutId, value]);
    if (session === null) return null;
    const rows = await port.all<FactRow>(`SELECT ${FACT_COLUMNS} FROM dev_training_performed_sets
      WHERE workspace_id = ? AND session_id = ? AND confirmed_at IS NOT NULL AND ${column} = ? ORDER BY rowid`,
    [this.workspaceId, session.id, value]);
    // Упражнение могло встречаться в тренировке дважды: берём одно его появление, а не смесь.
    const slotId = rows[0]?.plannedExerciseId;
    const sets = rows.filter((row) => row.plannedExerciseId === slotId).sort((a, b) => a.position - b.position)
      .map((row) => ({ setType: row.setType, value: valuesOf(row) }));
    return { date: session.date, sets };
  }

  async getPrevious(slot: WorkoutSlot, queries: readonly PreviousQuery[], now: Date = new Date()):
    Promise<ReadonlyMap<string, PreviousSet>> {
    assertSlot(slot);
    const { connection } = this.ready();
    const current = await this.getWorkout(slot);
    const date = current.session?.actualDate ?? localDateOf(now);
    const result = new Map<string, PreviousSet>();
    for (const query of queries) {
      const source = await this.previousSource(connection, slot, date, "planned_exercise_id", query.plannedExerciseId)
        ?? await this.previousSource(connection, slot, date, "exercise_id", query.exerciseId);
      if (source === null) continue;
      const matched = matchPrevious(query.plannedSetIds.map((plannedSetId) => ({ plannedSetId,
        setType: current.facts.get(plannedSetId)?.setType ?? "NORMAL" })), source.sets);
      for (const [plannedSetId, values] of matched) result.set(plannedSetId, { values, date: source.date });
    }
    return result;
  }

  /** Записать факт по выбранному переходу подтверждения; ревизия проверяется в той же транзакции. */
  private async writeFact(tx: SqliteStatementPort, identity: SetIdentity, now: Date,
    next: (existing: FactRow | null, mode: ConfirmationMode) => Readonly<{ values: SetValues; rpe: number | null;
      setType: SetType; change: ConfirmationChange }>): Promise<SetSaveResult> {
    const mode = await this.modeOf(tx);
    const session = await this.ensureSession(tx, identity.slot, now);
    const existing = await this.factOf(tx, session.id, identity.plannedSetId);
    if ((existing?.revision ?? null) !== identity.expectedRevision) throw new Error("STALE_SESSION");
    if (existing !== null && existing.exerciseId !== identity.exerciseId) throw new Error("WRONG_CLIENT_SCOPE");
    const { values, rpe, setType, change } = next(existing, mode);
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
    return { fact: toFact(saved), session, confirmedNow: change.confirmedNow };
  }

  async saveSet(input: SaveSetInput, now: Date = new Date()): Promise<SetSaveResult> {
    assertIdentity(input);
    validateValues(input.values, input.rpe, input.metrics);
    if (!SET_TYPES.includes(input.setType)) throw new Error("INVALID_METRIC");
    const result = await this.ready().writer.write((tx) => this.writeFact(tx, input, now, (existing, mode) => ({
      values: input.values, rpe: input.rpe, setType: input.setType,
      change: confirmationAfterSave(mode, existing?.confirmedAt != null, input.values, input.metrics),
    })));
    this.publish(input.slot);
    return result;
  }

  async toggleSetConfirmation(identity: SetIdentity, now: Date = new Date()): Promise<SetSaveResult> {
    assertIdentity(identity);
    const result = await this.ready().writer.write(async (tx) => {
      const session = await this.sessionOf(tx, identity.slot);
      if (session === null || await this.factOf(tx, session.id, identity.plannedSetId) === null) throw new Error("FACT_NOT_FOUND");
      return this.writeFact(tx, identity, now, (existing) => {
        const row = existing as FactRow;
        return { values: valuesOf(row), rpe: row.rpe, setType: row.setType,
          change: toggleConfirmation(row.confirmedAt !== null, valuesOf(row), identity.metrics) };
      });
    });
    this.publish(identity.slot);
    return result;
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

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
