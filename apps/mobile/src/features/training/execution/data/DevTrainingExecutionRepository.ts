import { runMigrations } from "../../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from "../../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../../shared/db/WriterCoordinator.ts";
import { DEFAULT_CONFIRMATION_MODE, NOTE_MAX, SET_TYPES, type ActiveWorkout, type ConfirmationMode, type PreviousQuery, type PreviousSet,
  type SessionStatus, type SetFact, type SetType, type SetValues, type WorkoutExecution, type WorkoutOutcome,
  type WorkoutSession, type WorkoutSlot } from "../domain/ExecutionModel.ts";
import { assertDropStructure, confirmationAfterSave, isInstant, isLocalDate, localDateOf, matchPrevious, sidesAfterSave, toggleConfirmation,
  toggleSide, validateContent, validateSides, workoutStatus, type ConfirmationChange, type SetContent,
  type SidesChange } from "../domain/ExecutionRules.ts";
import type { SaveSetInput, SetIdentity, SetSaveResult, TrainingExecutionCommittedChange,
  TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import type { RestTimerStorePort } from "../domain/RestTimerPorts.ts";
import type { RestTimer } from "../domain/RestTimerRules.ts";
import { DEV_TRAINING_EXECUTION_LEDGER, devTrainingExecutionCatalog } from "./DevTrainingExecutionCatalog.ts";
import { readStoredJson } from "../../../../shared/db/StoredJson.ts";
import { storedOrigin } from "../domain/StoredOriginShape.ts";
import { navigationPerformance } from "../../../../shared/diagnostics/NavigationPerformance.ts";
import type { WeekExecutionParticipant, WorkoutCopyMapping } from "../domain/WeekCopyParticipant.ts";
import type { WeekRenumberParticipant } from "../domain/WeekRenumberParticipant.ts";
import type { ExecutionCleanupParticipant } from "../domain/ExecutionCleanupParticipant.ts";

const OUTCOMES: readonly WorkoutOutcome[] = ["COMPLETED", "MISSED", "CANCELLED"];

/**
 * §48.34: тренировка начата, если есть значение, введённое тренером, или засчитанный подход (сессия `s`). Значения,
 * перенесённые копированием недели («Нет»), — предварительные и тренировку не начинают (§48.24, §48.34 п. 3).
 */
const STARTED_SQL = `EXISTS (SELECT 1 FROM training_performed_sets f WHERE f.workspace_id = s.workspace_id
  AND f.session_id = s.id AND f.removed_at IS NULL AND (f.confirmed_at IS NOT NULL
    OR (f.origin <> 'COPY' AND (COALESCE(f.reps, f.load_grams, f.duration_sec, f.distance_m) IS NOT NULL
      OR EXISTS (SELECT 1 FROM training_performed_sides d WHERE d.workspace_id = f.workspace_id AND d.set_id = f.id
        AND COALESCE(d.reps, d.load_grams, d.duration_sec, d.distance_m) IS NOT NULL)))))`;

const SESSION_COLUMNS = `id, client_id AS clientId, program_id AS programId, week_index AS weekIndex,
  planned_workout_id AS plannedWorkoutId, outcome, actual_date AS actualDate, started_at AS startedAt, finished_at AS finishedAt, revision`;

const FACT_COLUMNS = `id, planned_set_id AS plannedSetId, planned_exercise_id AS plannedExerciseId,
  exercise_id AS exerciseId, position, set_type AS setType, reps, load_grams AS loadGrams,
  duration_sec AS durationSec, distance_m AS distanceM, rpe, confirmed_at AS confirmedAt, revision, extra,
  removed_at AS removedAt, sided, origin`;

type FactRow = Readonly<{
  id: string; plannedSetId: string; plannedExerciseId: string; exerciseId: string; position: number;
  setType: SetType; reps: number | null; loadGrams: number | null; durationSec: number | null; distanceM: number | null;
  rpe: number | null; confirmedAt: string | null; revision: number; extra: number; removedAt: string | null; sided: number;
  origin: SetFact["origin"];
}>;

type SideRow = Readonly<{ setId: string; side: "L" | "R"; reps: number | null; loadGrams: number | null;
  durationSec: number | null; distanceM: number | null; confirmedAt: string | null }>;
type StoredSides = Readonly<{ L?: SideRow; R?: SideRow }>;

/** Стороны односторонних подходов; ключ — ID факта. */
async function sidesWhere(port: SqliteStatementPort, workspaceId: string, condition: string, params: readonly SqlValue[]):
  Promise<ReadonlyMap<string, StoredSides>> {
  const result = new Map<string, { L?: SideRow; R?: SideRow }>();
  const rows = await port.all<SideRow>(`SELECT set_id AS setId, side, reps, load_grams AS loadGrams, duration_sec AS durationSec,
    distance_m AS distanceM, confirmed_at AS confirmedAt FROM training_performed_sides
    WHERE workspace_id = ? AND ${condition}`, [workspaceId, ...params]);
  for (const row of rows) result.set(row.setId, { ...result.get(row.setId), [row.side]: row });
  return result;
}

async function sidesOf(port: SqliteStatementPort, workspaceId: string, setIds: readonly string[]):
  Promise<ReadonlyMap<string, StoredSides>> {
  if (setIds.length === 0) return new Map();
  return sidesWhere(port, workspaceId, `set_id IN (${setIds.map(() => "?").join(", ")})`, setIds);
}

const EMPTY_SIDE: SetValues = { reps: null, loadGrams: null, durationSec: null, distanceM: null };

function factSides(row: FactRow, stored: StoredSides | undefined): SetFact["sides"] {
  if (row.sided !== 1) return null;
  const side = (value: SideRow | undefined) => ({ values: value === undefined ? EMPTY_SIDE : valuesOf(value),
    confirmed: value?.confirmedAt != null });
  return { left: side(stored?.L), right: side(stored?.R) };
}

function valuesOf(row: SetValues): SetValues {
  return { reps: row.reps, loadGrams: row.loadGrams, durationSec: row.durationSec, distanceM: row.distanceM };
}

function toFact(row: FactRow, drops: readonly SetValues[], sides: SetFact["sides"] = null): SetFact {
  return { id: row.id, plannedSetId: row.plannedSetId, plannedExerciseId: row.plannedExerciseId, exerciseId: row.exerciseId,
    position: row.position, setType: row.setType, values: valuesOf(row), drops, sides, rpe: row.rpe,
    confirmed: row.confirmedAt !== null, extra: row.extra === 1, origin: row.origin, revision: row.revision };
}

type DropRow = Readonly<{ setId: string; reps: number | null; loadGrams: number | null; durationSec: number | null;
  distanceM: number | null }>;

/** Мини-сеты подходов по порядку; ключ — ID факта. */
async function dropsWhere(port: SqliteStatementPort, workspaceId: string, condition: string, params: readonly SqlValue[]):
  Promise<ReadonlyMap<string, readonly SetValues[]>> {
  const result = new Map<string, SetValues[]>();
  const rows = await port.all<DropRow>(`SELECT set_id AS setId, reps, load_grams AS loadGrams, duration_sec AS durationSec,
    distance_m AS distanceM FROM training_performed_drops
    WHERE workspace_id = ? AND ${condition} ORDER BY set_id, position`, [workspaceId, ...params]);
  for (const row of rows) result.set(row.setId, [...(result.get(row.setId) ?? []), valuesOf(row)]);
  return result;
}

async function dropsOf(port: SqliteStatementPort, workspaceId: string, setIds: readonly string[]):
  Promise<ReadonlyMap<string, readonly SetValues[]>> {
  if (setIds.length === 0) return new Map();
  return dropsWhere(port, workspaceId, `set_id IN (${setIds.map(() => "?").join(", ")})`, setIds);
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

/** Подход засчитан, если засчитана хотя бы одна сторона (§48.80); новый переход любой стороны — новый переход. */
function mergeSides(change: SidesChange): ConfirmationChange {
  return { confirmed: change.left.confirmed || change.right.confirmed,
    confirmedNow: change.left.confirmedNow || change.right.confirmedNow };
}

/** Сторона дневника в PermanentlyDeleteArchivedClient (§15.7): выполнения и факты подходов клиента. */
export const devTrainingExecutionClientDeletionParticipant = {
  owner: "training.execution",
  tables: ["training_exercise_notes", "training_performed_sides", "training_performed_drops", "training_performed_sets", "training_sessions",
    "training_rest_timers"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const row = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM training_sessions
      WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    return row?.n ?? 0;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run(`DELETE FROM training_exercise_notes WHERE workspace_id = ? AND session_id IN
      (SELECT id FROM training_sessions WHERE workspace_id = ? AND client_id = ?)`, [workspaceId, workspaceId, clientId]);
    await tx.run(`DELETE FROM training_performed_sides WHERE workspace_id = ? AND set_id IN
      (SELECT f.id FROM training_performed_sets f JOIN training_sessions s ON s.id = f.session_id
        WHERE s.workspace_id = ? AND s.client_id = ?)`, [workspaceId, workspaceId, clientId]);
    await tx.run(`DELETE FROM training_performed_drops WHERE workspace_id = ? AND set_id IN
      (SELECT f.id FROM training_performed_sets f JOIN training_sessions s ON s.id = f.session_id
        WHERE s.workspace_id = ? AND s.client_id = ?)`, [workspaceId, workspaceId, clientId]);
    await tx.run(`DELETE FROM training_performed_sets WHERE workspace_id = ? AND session_id IN
      (SELECT id FROM training_sessions WHERE workspace_id = ? AND client_id = ?)`, [workspaceId, workspaceId, clientId]);
    await tx.run("DELETE FROM training_sessions WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM training_rest_timers WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
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

  private publish(slot: Pick<WorkoutSlot, "clientId" | "programId">): void {
    for (const listener of this.listeners) {
      try { listener({ clientId: slot.clientId, programId: slot.programId }); } catch { /* Наблюдатель не превращает коммит в ошибку. */ }
    }
  }

  private async modeOf(port: SqliteStatementPort): Promise<ConfirmationMode> {
    const row = await port.first<{ mode: ConfirmationMode }>(`SELECT confirmation_mode AS mode
      FROM training_execution_settings WHERE workspace_id = ?`, [this.workspaceId]);
    return row?.mode ?? DEFAULT_CONFIRMATION_MODE;
  }

  getConfirmationMode(): Promise<ConfirmationMode> {
    return this.modeOf(this.ready().connection);
  }

  async setConfirmationMode(mode: ConfirmationMode): Promise<void> {
    if (mode !== "AUTO" && mode !== "MANUAL") throw new Error("INVALID_METRIC");
    await this.ready().writer.write((tx) => tx.run(`INSERT INTO training_execution_settings (workspace_id, confirmation_mode)
      VALUES (?, ?) ON CONFLICT (workspace_id) DO UPDATE SET confirmation_mode = excluded.confirmation_mode`,
    [this.workspaceId, mode]));
  }

  private sessionOf(port: SqliteStatementPort, slot: WorkoutSlot): Promise<WorkoutSession | null> {
    return port.first<WorkoutSession>(`SELECT ${SESSION_COLUMNS} FROM training_sessions
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
    await tx.run(`INSERT INTO training_sessions (id, workspace_id, client_id, program_id, week_index, planned_workout_id,
      actual_date, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, this.workspaceId, slot.clientId, slot.programId, slot.weekIndex, slot.plannedWorkoutId, localDateOf(now), stamp, stamp]);
    return { ...slot, id, outcome: null, actualDate: localDateOf(now), startedAt: null, finishedAt: null, revision: 1 };
  }

  private factOf(port: SqliteStatementPort, sessionId: string, plannedSetId: string): Promise<FactRow | null> {
    return port.first<FactRow>(`SELECT ${FACT_COLUMNS} FROM training_performed_sets
      WHERE workspace_id = ? AND session_id = ? AND planned_set_id = ?`, [this.workspaceId, sessionId, plannedSetId]);
  }

  async getWorkout(slot: WorkoutSlot): Promise<WorkoutExecution> {
    return this.readWorkout(this.ready().connection, slot);
  }

  private async readWorkout(connection: SqliteStatementPort, slot: WorkoutSlot): Promise<WorkoutExecution> {
    const session = await this.sessionOf(connection, slot);
    if (session === null) return { session: null, facts: new Map(), notes: new Map() };
    const rows = await connection.all<FactRow>(`SELECT ${FACT_COLUMNS} FROM training_performed_sets
      WHERE workspace_id = ? AND session_id = ? AND removed_at IS NULL`, [this.workspaceId, session.id]);
    const drops = await dropsOf(connection, this.workspaceId, rows.filter((row) => row.setType === "DROP").map((row) => row.id));
    const sides = await sidesOf(connection, this.workspaceId, rows.filter((row) => row.sided === 1).map((row) => row.id));
    const notes = await connection.all<{ plannedExerciseId: string; note: string }>(`SELECT planned_exercise_id AS plannedExerciseId,
      note FROM training_exercise_notes WHERE workspace_id = ? AND session_id = ?`, [this.workspaceId, session.id]);
    return { session, facts: new Map(rows.map((row) => [row.plannedSetId,
      toFact(row, drops.get(row.id) ?? [], factSides(row, sides.get(row.id)))])),
    notes: new Map(notes.map((item) => [item.plannedExerciseId, item.note])) };
  }

  listActiveWorkouts(): Promise<readonly ActiveWorkout[]> {
    return this.ready().connection.all<ActiveWorkout>(`SELECT s.client_id AS clientId, s.program_id AS programId,
        s.week_index AS weekIndex, s.planned_workout_id AS plannedWorkoutId, s.actual_date AS actualDate
      FROM training_sessions s
      WHERE s.workspace_id = ? AND s.outcome IS NULL AND ${STARTED_SQL}
      ORDER BY (SELECT max(f.updated_at) FROM training_performed_sets f WHERE f.workspace_id = s.workspace_id
        AND f.session_id = s.id AND f.removed_at IS NULL) DESC`, [this.workspaceId]);
  }

  /**
   * Выполнения клиента (всей программы или всех программ) пакетом: занятия, подходы, мини-сеты, стороны и заметки — по одному
   * запросу на вид, а не по пять на каждое занятие. `sessionsWhere` выбирает занятия (псевдоним `s`).
   */
  private async readExecutions(connection: SqliteStatementPort, sessionsWhere: string, params: readonly SqlValue[]) {
    const ws = this.workspaceId;
    const sessions = await connection.all<WorkoutSession & { originJson: string | null }>(
      `SELECT ${SESSION_COLUMNS}, origin_json AS originJson FROM training_sessions s WHERE s.workspace_id = ? AND ${sessionsWhere}`, [ws, ...params]);
    if (sessions.length === 0) return [];
    const inSessions = `SELECT s.id FROM training_sessions s WHERE s.workspace_id = ? AND ${sessionsWhere}`;
    const setIds = `SELECT id FROM training_performed_sets WHERE workspace_id = ? AND removed_at IS NULL AND session_id IN (${inSessions})`;
    const facts = await connection.all<FactRow & { sessionId: string }>(`SELECT ${FACT_COLUMNS}, session_id AS sessionId
      FROM training_performed_sets WHERE workspace_id = ? AND removed_at IS NULL AND session_id IN (${inSessions})`, [ws, ws, ...params]);
    const drops = await dropsWhere(connection, ws, `set_id IN (${setIds})`, [ws, ws, ...params]);
    const sides = await sidesWhere(connection, ws, `set_id IN (${setIds})`, [ws, ws, ...params]);
    const notes = await connection.all<{ sessionId: string; plannedExerciseId: string; note: string }>(`SELECT session_id AS sessionId,
      planned_exercise_id AS plannedExerciseId, note FROM training_exercise_notes
      WHERE workspace_id = ? AND session_id IN (${inSessions})`, [ws, ws, ...params]);
    const factsBySession = new Map<string, FactRow[]>();
    for (const { sessionId, ...row } of facts) factsBySession.set(sessionId, [...(factsBySession.get(sessionId) ?? []), row]);
    const notesBySession = new Map<string, Map<string, string>>();
    for (const item of notes) notesBySession.set(item.sessionId, (notesBySession.get(item.sessionId) ?? new Map()).set(item.plannedExerciseId, item.note));
    return sessions.map(({ originJson, ...session }) => ({ session, originJson,
      execution: { session, facts: new Map((factsBySession.get(session.id) ?? []).map((row) => [row.plannedSetId,
        toFact(row, drops.get(row.id) ?? [], factSides(row, sides.get(row.id)))])),
      notes: notesBySession.get(session.id) ?? new Map<string, string>() } satisfies WorkoutExecution }));
  }

  async listProgramExecutions(clientId: string, programId: string) {
    const rows = await this.readExecutions(this.ready().connection, "s.client_id = ? AND s.program_id = ? AND s.plan_deleted_at IS NULL", [clientId, programId]);
    return rows.map(({ session, execution }) => ({ weekIndex: session.weekIndex, plannedWorkoutId: session.plannedWorkoutId, execution }));
  }

  async listClientExecutions(clientId: string) {
    const rows = await this.readExecutions(this.ready().connection, "s.client_id = ?", [clientId]);
    return rows.flatMap(({ session, originJson, execution }) => {
      const origin = originJson === null ? null : readStoredJson(originJson, storedOrigin, `training_sessions:${session.id}`);
      if (originJson !== null && origin === null) return [];
      return [{ programId: session.programId, weekIndex: session.weekIndex, plannedWorkoutId: session.plannedWorkoutId, origin, execution }];
    });
  }

  async getProgramStatuses(clientId: string, programId: string): Promise<readonly SessionStatus[]> {
    const rows = await this.ready().connection.all<{ weekIndex: number; plannedWorkoutId: string;
      outcome: WorkoutOutcome | null; started: number }>(`SELECT s.week_index AS weekIndex,
        s.planned_workout_id AS plannedWorkoutId, s.outcome,
        ${STARTED_SQL} AS started
      FROM training_sessions s WHERE s.workspace_id = ? AND s.client_id = ? AND s.program_id = ? AND s.plan_deleted_at IS NULL`,
    [this.workspaceId, clientId, programId]);
    return rows.map((row) => ({ weekIndex: row.weekIndex, plannedWorkoutId: row.plannedWorkoutId,
      status: workoutStatus(row.outcome, row.started === 1) }));
  }

  async getPrevious(slot: WorkoutSlot, queries: readonly PreviousQuery[], _now?: Date):
    Promise<ReadonlyMap<string, PreviousSet>> {
    assertSlot(slot);
    if (slot.weekIndex <= 1 || queries.length === 0 || queries.every((query) => query.source === null)) return new Map();
    const current = await this.getWorkout(slot);
    return this.previousOf(slot, queries, current);
  }

  async getWorkoutWithPrevious(slot: WorkoutSlot, queries: readonly PreviousQuery[] | Promise<readonly PreviousQuery[]>, _now?: Date) {
    assertSlot(slot);
    const endCurrent = navigationPerformance.phase("execution");
    const [current, requested] = await Promise.all([this.getWorkout(slot).finally(endCurrent), queries]);
    const warmups = [...current.facts.values()].filter((fact) => fact.extra).sort((a, b) => a.position - b.position);
    const expanded = requested.map((query) => ({ ...query, plannedSetIds: [...new Set([
      ...warmups.filter((fact) => fact.plannedExerciseId === query.plannedExerciseId).map((fact) => fact.plannedSetId),
      ...query.plannedSetIds])] }));
    const endPrevious = navigationPerformance.phase("previous");
    try { return { current, previous: await this.previousOf(slot, expanded, current) }; }
    finally { endPrevious(); }
  }

  /** Owner correction 2026-10-24: only the same workout in the preceding week of this cycle; no history fallback. */
  private async previousOf(slot: WorkoutSlot, queries: readonly PreviousQuery[], current: WorkoutExecution):
    Promise<ReadonlyMap<string, PreviousSet>> {
    const { connection } = this.ready();
    if (slot.weekIndex <= 1 || queries.length === 0 || queries.every((query) => query.source === null)) return new Map();
    const requested = queries.map((query) => ({ exerciseId: query.exerciseId,
      sourceWorkoutId: query.source === null ? null : query.source?.plannedWorkoutId ?? slot.plannedWorkoutId,
      sourceExerciseId: query.source === null ? null : query.source?.plannedExerciseId ?? query.plannedExerciseId }));
    // A single bounded query for all requested exercises. There is exactly one source slot per query.
    const rows = await connection.all<FactRow & { queryIndex: number; date: string }>(`WITH requested AS (
        SELECT CAST(key AS INTEGER) AS queryIndex, json_extract(value, '$.exerciseId') AS exerciseId,
          json_extract(value, '$.sourceWorkoutId') AS sourceWorkoutId,
          json_extract(value, '$.sourceExerciseId') AS sourceExerciseId FROM json_each(?)
      ), sourceFacts AS (
        SELECT f.*, q.queryIndex, s.actual_date AS date
        FROM requested q JOIN training_sessions s ON s.planned_workout_id = q.sourceWorkoutId
          JOIN training_performed_sets f ON f.session_id = s.id AND f.workspace_id = s.workspace_id
            AND f.planned_exercise_id = q.sourceExerciseId AND f.exercise_id = q.exerciseId
        WHERE s.workspace_id = ? AND s.client_id = ? AND s.program_id = ? AND s.week_index = ?
          AND s.plan_deleted_at IS NULL AND f.confirmed_at IS NOT NULL AND f.removed_at IS NULL
      ) SELECT ${FACT_COLUMNS}, queryIndex, date FROM sourceFacts ORDER BY queryIndex, position`,
    [JSON.stringify(requested), this.workspaceId, slot.clientId, slot.programId, slot.weekIndex - 1]);
    const [drops, sides] = await Promise.all([
      dropsOf(connection, this.workspaceId, [...new Set(rows.filter((row) => row.setType === "DROP").map((row) => row.id))]),
      sidesOf(connection, this.workspaceId, [...new Set(rows.filter((row) => row.sided === 1).map((row) => row.id))]),
    ]);
    const sources = new Map<number, { setType: SetType; value: PreviousSet }[]>();
    const confirmedSide = (value: SideRow | undefined) => value?.confirmedAt != null ? valuesOf(value) : null;
    for (const row of rows) {
      const source = sources.get(row.queryIndex) ?? [];
      source.push({ setType: row.setType, value: { values: valuesOf(row), drops: drops.get(row.id) ?? [], date: row.date,
        sides: row.sided === 1 ? { left: confirmedSide(sides.get(row.id)?.L), right: confirmedSide(sides.get(row.id)?.R) } : null } });
      sources.set(row.queryIndex, source);
    }
    const result = new Map<string, PreviousSet>();
    for (const [index, query] of queries.entries()) {
      const source = sources.get(index);
      if (source === undefined) continue;
      const matched = matchPrevious(query.plannedSetIds.map((plannedSetId) => ({ plannedSetId,
        setType: current.facts.get(plannedSetId)?.setType ?? "NORMAL" })), source);
      for (const [plannedSetId, set] of matched) result.set(plannedSetId, set);
    }
    return result;
  }

  /** Записать факт по выбранному переходу подтверждения; ревизия проверяется в той же транзакции. */
  private async writeFact(tx: SqliteStatementPort, identity: SetIdentity, now: Date,
    next: (existing: FactRow | null, existingDrops: readonly SetValues[], mode: ConfirmationMode, existingSides: StoredSides) =>
      Readonly<{ content: SetContent; rpe: number | null; change: ConfirmationChange;
        sides: Readonly<{ pair: Readonly<{ left: SetValues; right: SetValues }>; change: SidesChange }> | null }>,
    /** Копирование недели не проводит занятие: начало ставится только вводом тренера (§48.24 п. 3). */
    markStart = true):
    Promise<SetSaveResult> {
    const mode = await this.modeOf(tx);
    const session = await this.ensureSession(tx, identity.slot, now);
    const existing = await this.factOf(tx, session.id, identity.plannedSetId);
    if (existing?.removedAt != null) throw new Error("FACT_NOT_FOUND");
    if ((existing?.revision ?? null) !== identity.expectedRevision) throw new Error("STALE_SESSION");
    if (existing !== null && existing.exerciseId !== identity.exerciseId) throw new Error("WRONG_CLIENT_SCOPE");
    const existingDrops = existing === null ? [] : (await dropsOf(tx, this.workspaceId, [existing.id])).get(existing.id) ?? [];
    const existingSides = existing === null ? {} : (await sidesOf(tx, this.workspaceId, [existing.id])).get(existing.id) ?? {};
    const { content, rpe, change, sides } = next(existing, existingDrops, mode, existingSides);
    if (existing !== null) {
      assertDropStructure({ confirmed: existing.confirmedAt !== null, setType: existing.setType, dropCount: existingDrops.length },
        content);
    }
    const { values, setType } = content;
    if (existing?.extra === 1 && setType !== "WARMUP") throw new Error("INVALID_METRIC");
    const stamp = now.toISOString();
    const confirmedAt = !change.confirmed ? null : change.confirmedNow ? stamp : existing?.confirmedAt ?? stamp;
    const params = [identity.plannedExerciseId, identity.position, setType, values.reps, values.loadGrams, values.durationSec,
      values.distanceM, rpe, confirmedAt, stamp, sides === null ? 0 : 1];
    if (existing === null) {
      const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!id) throw new Error("FACT_ID_UNAVAILABLE");
      await tx.run(`INSERT INTO training_performed_sets (planned_exercise_id, position, set_type, reps, load_grams,
        duration_sec, distance_m, rpe, confirmed_at, updated_at, sided, id, workspace_id, session_id, planned_set_id, exercise_id,
        origin, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INPUT', 1)`,
      [...params, id, this.workspaceId, session.id, identity.plannedSetId, identity.exerciseId]);
    } else {
      await tx.run(`UPDATE training_performed_sets SET planned_exercise_id = ?, position = ?, set_type = ?, reps = ?,
        load_grams = ?, duration_sec = ?, distance_m = ?, rpe = ?, confirmed_at = ?, updated_at = ?, sided = ?, origin = 'INPUT',
        revision = revision + 1 WHERE workspace_id = ? AND id = ?`, [...params, this.workspaceId, existing.id]);
    }
    const saved = await this.factOf(tx, session.id, identity.plannedSetId);
    if (saved === null) throw new Error("FACT_NOT_FOUND");
    // Мини-сеты — часть того же факта: переписываются целиком после строки подхода (триггер проверяет тип).
    await tx.run("DELETE FROM training_performed_drops WHERE workspace_id = ? AND set_id = ?", [this.workspaceId, saved.id]);
    for (const [index, drop] of content.drops.entries()) {
      await tx.run(`INSERT INTO training_performed_drops (workspace_id, set_id, position, reps, load_grams, duration_sec,
        distance_m) VALUES (?, ?, ?, ?, ?, ?, ?)`, [this.workspaceId, saved.id, index + 2, drop.reps, drop.loadGrams,
        drop.durationSec, drop.distanceM]);
    }
    // Стороны — тоже часть того же факта: у каждой своя отметка выполнения (§48.76).
    await tx.run("DELETE FROM training_performed_sides WHERE workspace_id = ? AND set_id = ?", [this.workspaceId, saved.id]);
    if (sides !== null) {
      const sideStamp = (sideChange: ConfirmationChange, before: SideRow | undefined) =>
        !sideChange.confirmed ? null : sideChange.confirmedNow ? stamp : before?.confirmedAt ?? stamp;
      for (const [side, sideValues, sideChange, before] of [["L", sides.pair.left, sides.change.left, existingSides.L],
        ["R", sides.pair.right, sides.change.right, existingSides.R]] as const) {
        await tx.run(`INSERT INTO training_performed_sides (workspace_id, set_id, side, reps, load_grams, duration_sec,
          distance_m, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [this.workspaceId, saved.id, side, sideValues.reps,
          sideValues.loadGrams, sideValues.durationSec, sideValues.distanceM, sideStamp(sideChange, before)]);
      }
    }
    const storedSides = (await sidesOf(tx, this.workspaceId, [saved.id])).get(saved.id);
    // PC §48.86.13: первое подтверждение подхода в этой тренировке ставит предполагаемое начало занятия (правится вручную). Ревизию выполнения
    // не меняем: ввод подходов не должен конфликтовать с правкой исхода и даты.
    let started = session;
    if (markStart && change.confirmedNow && session.startedAt === null) {
      await tx.run(`UPDATE training_sessions SET started_at = ? WHERE workspace_id = ? AND id = ? AND started_at IS NULL`,
        [stamp, this.workspaceId, session.id]);
      started = { ...session, startedAt: stamp };
    }
    return { fact: toFact(saved, content.drops, factSides(saved, storedSides)), session: started, confirmedNow: change.confirmedNow };
  }

  async saveSet(input: SaveSetInput, now: Date = new Date()): Promise<SetSaveResult> {
    assertIdentity(input);
    if (!SET_TYPES.includes(input.setType)) throw new Error("INVALID_METRIC");
    const content: SetContent = { setType: input.setType, values: input.values, drops: input.drops };
    const pair = input.sides;
    if (pair === undefined) validateContent(content, input.rpe, input.metrics);
    else validateSides(content, pair, input.rpe, input.metrics);
    const result = await this.ready().writer.write((tx) => this.writeFact(tx, input, now, (existing, _drops, mode, stored) => {
      if (pair === undefined) {
        return { content, rpe: input.rpe, sides: null,
          change: confirmationAfterSave(mode, existing?.confirmedAt != null, content, input.metrics) };
      }
      const change = sidesAfterSave(mode, { left: stored.L?.confirmedAt != null, right: stored.R?.confirmedAt != null }, pair,
        input.metrics);
      return { content, rpe: input.rpe, sides: { pair, change }, change: mergeSides(change) };
    }));
    this.publish(input.slot);
    return result;
  }

  async toggleSetConfirmation(identity: SetIdentity, now: Date = new Date(), side?: "L" | "R"): Promise<SetSaveResult> {
    assertIdentity(identity);
    const result = await this.ready().writer.write(async (tx) => {
      const session = await this.sessionOf(tx, identity.slot);
      if (session === null || await this.factOf(tx, session.id, identity.plannedSetId) === null) throw new Error("FACT_NOT_FOUND");
      return this.writeFact(tx, identity, now, (existing, drops, _mode, stored) => {
        const row = existing as FactRow;
        const content: SetContent = { setType: row.setType, values: valuesOf(row), drops };
        if (row.sided !== 1) {
          return { content, rpe: row.rpe, sides: null,
            change: toggleConfirmation(row.confirmedAt !== null, content, identity.metrics) };
        }
        if (side === undefined) throw new Error("INVALID_METRIC");
        const pair = { left: stored.L === undefined ? EMPTY_SIDE : valuesOf(stored.L),
          right: stored.R === undefined ? EMPTY_SIDE : valuesOf(stored.R) };
        const change = toggleSide({ left: stored.L?.confirmedAt != null, right: stored.R?.confirmedAt != null }, pair, side,
          identity.metrics);
        return { content, rpe: row.rpe, sides: { pair, change }, change: mergeSides(change) };
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
      const count = await tx.first<{ n: number }>(`SELECT count(*) AS n FROM training_performed_sets
        WHERE workspace_id = ? AND session_id = ? AND planned_exercise_id = ? AND extra = 1`,
      [this.workspaceId, session.id, where.plannedExerciseId]);
      const plannedSetId = `extra-${id}`;
      await tx.run(`INSERT INTO training_performed_sets (id, workspace_id, session_id, planned_set_id, planned_exercise_id,
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
      await tx.run(`UPDATE training_performed_sets SET removed_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ?`, [now.toISOString(), now.toISOString(), this.workspaceId, fact.id]);
    });
    this.publish(slot);
  }

  async saveExerciseNote(slot: WorkoutSlot, plannedExerciseId: string, text: string, now: Date = new Date()): Promise<void> {
    assertSlot(slot);
    const note = text.trim();
    if (!plannedExerciseId || note.length > NOTE_MAX) throw new Error("INVALID_METRIC");
    await this.ready().writer.write(async (tx) => {
      if (note === "") {
        const session = await this.sessionOf(tx, slot);
        if (session !== null) await tx.run(`DELETE FROM training_exercise_notes WHERE workspace_id = ? AND session_id = ?
          AND planned_exercise_id = ?`, [this.workspaceId, session.id, plannedExerciseId]);
        return;
      }
      const session = await this.ensureSession(tx, slot, now);
      await tx.run(`INSERT INTO training_exercise_notes (workspace_id, session_id, planned_exercise_id, note, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT (workspace_id, session_id, planned_exercise_id)
        DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      [this.workspaceId, session.id, plannedExerciseId, note, now.toISOString()]);
    });
    this.publish(slot);
  }

  async deleteWorkoutExecution(slot: WorkoutSlot, expectedRevision: number): Promise<void> {
    assertSlot(slot);
    await this.ready().writer.write(async (tx) => {
      const session = await this.sessionOf(tx, slot);
      if (session === null) throw new Error("FACT_NOT_FOUND");
      if (session.revision !== expectedRevision) throw new Error("STALE_SESSION");
      await this.deleteSession(tx, session.id);
    });
    this.publish(slot);
  }

  private async deleteSession(tx: SqliteStatementPort, sessionId: string): Promise<void> {
      const facts = `SELECT id FROM training_performed_sets WHERE workspace_id = ? AND session_id = ?`;
      await tx.run(`DELETE FROM training_performed_sides WHERE workspace_id = ? AND set_id IN (${facts})`,
        [this.workspaceId, this.workspaceId, sessionId]);
      await tx.run(`DELETE FROM training_performed_drops WHERE workspace_id = ? AND set_id IN (${facts})`,
        [this.workspaceId, this.workspaceId, sessionId]);
      await tx.run("DELETE FROM training_performed_sets WHERE workspace_id = ? AND session_id = ?", [this.workspaceId, sessionId]);
      await tx.run("DELETE FROM training_exercise_notes WHERE workspace_id = ? AND session_id = ?", [this.workspaceId, sessionId]);
      await tx.run("DELETE FROM training_sessions WHERE workspace_id = ? AND id = ?", [this.workspaceId, sessionId]);
  }

  private async copyWorkoutFacts(tx: SqliteStatementPort, mapping: WorkoutCopyMapping, confirm: boolean, now: Date) {
    const source = await this.readWorkout(tx, mapping.source);
    for (const exercise of mapping.exercises) {
      const sourceFacts = [...source.facts.values()].filter((fact) => fact.plannedExerciseId === exercise.sourceId
        && (fact.extra || exercise.sets.some((set) => set.sourceId === fact.plannedSetId)));
      for (const fact of sourceFacts) {
        const newExtra = fact.extra ? (await tx.first<{ id: string }>(UUID_V4_SQL))?.id : undefined;
        // Тот же вид ID, что у добавленной в дневнике разминки (`extra-<uuid>`).
        const plannedSetId = fact.extra ? (newExtra ? `extra-${newExtra}` : undefined)
          : exercise.sets.find((set) => set.sourceId === fact.plannedSetId)?.targetId;
        if (!plannedSetId || fact.exerciseId !== exercise.exerciseId) throw new Error("WRONG_CLIENT_SCOPE");
        const content = { setType: fact.setType, values: fact.values, drops: fact.drops };
        const pair = fact.sides ? { left: fact.sides.left.values, right: fact.sides.right.values } : null;
        if (pair) validateSides(content, pair, fact.rpe, exercise.metrics);
        else validateContent(content, fact.rpe, exercise.metrics);
        const copied = await this.writeFact(tx, { slot: mapping.target, plannedExerciseId: exercise.targetId,
          exerciseId: exercise.exerciseId, plannedSetId, position: fact.position, metrics: exercise.metrics, expectedRevision: null },
        now, () => {
          const mode = confirm ? "AUTO" : "MANUAL";
          if (!pair) return { content, rpe: fact.rpe, sides: null,
            change: confirmationAfterSave(mode, false, content, exercise.metrics) };
          const change = sidesAfterSave(mode, { left: false, right: false }, pair, exercise.metrics);
          return { content, rpe: fact.rpe, sides: { pair, change }, change: mergeSides(change) };
        }, false);
        await tx.run("UPDATE training_performed_sets SET origin = 'COPY', extra = ? WHERE workspace_id = ? AND id = ?",
          [fact.extra ? 1 : 0, this.workspaceId, copied.fact.id]);
      }
    }
  }

  /** §48.11, §50.3: выполнения и факты клиента в программе (или только перечисленных тренировок) удаляются. */
  readonly cleanupParticipant: ExecutionCleanupParticipant<SqliteStatementPort> = {
    remove: async (tx, clientId, programId, plannedWorkoutIds) => {
      if (plannedWorkoutIds !== null && plannedWorkoutIds.length === 0) return;
      const filter = plannedWorkoutIds === null ? "" : ` AND planned_workout_id IN (${plannedWorkoutIds.map(() => "?").join(", ")})`;
      // Выполнения со снимком «план удалён» — явно сохранённая история (§50.3): отдельное удаление программы их не трогает.
      const sessions = await tx.all<{ id: string }>(`SELECT id FROM training_sessions
        WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND plan_deleted_at IS NULL${filter}`,
      [this.workspaceId, clientId, programId, ...(plannedWorkoutIds ?? [])]);
      for (const session of sessions) await this.deleteSession(tx, session.id);
    },
    keepAsHistory: async (tx, clientId, programId, originOf, now, plannedWorkoutIds = null) => {
      if (plannedWorkoutIds !== null && plannedWorkoutIds.length === 0) return;
      const filter = plannedWorkoutIds === null ? "" : ` AND planned_workout_id IN (${plannedWorkoutIds.map(() => "?").join(", ")})`;
      const sessions = await tx.all<{ id: string; weekIndex: number; plannedWorkoutId: string }>(`SELECT id, week_index AS weekIndex,
        planned_workout_id AS plannedWorkoutId FROM training_sessions
        WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND plan_deleted_at IS NULL${filter}`,
      [this.workspaceId, clientId, programId, ...(plannedWorkoutIds ?? [])]);
      for (const session of sessions) {
        await tx.run("UPDATE training_sessions SET origin_json = ?, plan_deleted_at = ? WHERE workspace_id = ? AND id = ?",
          [JSON.stringify(originOf(session.weekIndex, session.plannedWorkoutId)), now.toISOString(), this.workspaceId, session.id]);
      }
    },
    notify: (clientId, programId) => this.publish({ clientId, programId }),
  };

  /** §48.21 п. 6: выполнения переставленных недель получают новый номер недели — те же факты, без копий. */
  readonly weekRenumberParticipant: WeekRenumberParticipant<SqliteStatementPort> = {
    renumber: async (tx, input, now) => {
      for (const [ids, from, to] of [[input.toSecond, input.first, input.second], [input.toFirst, input.second, input.first]] as const) {
        if (ids.length === 0) continue;
        // Ревизия растёт: открытый дневник с прежним номером недели получит конфликт, а не запишет в чужую неделю.
        await tx.run(`UPDATE training_sessions SET week_index = ?, revision = revision + 1, updated_at = ?
          WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND week_index = ?
            AND planned_workout_id IN (${ids.map(() => "?").join(", ")})`,
        [to, now.toISOString(), this.workspaceId, input.clientId, input.programId, from, ...ids]);
      }
    },
    notify: (clientId, programId) => this.publish({ clientId, programId }),
  };

  readonly weekCopyParticipant: WeekExecutionParticipant<SqliteStatementPort> = {
    read: async (tx, slots) => {
      const values: WorkoutExecution[] = [];
      for (const slot of slots) { assertSlot(slot); values.push(await this.readWorkout(tx, slot)); }
      return values;
    },
    replace: async (tx, targets, mappings, mode, now) => {
      for (const slot of targets) {
        assertSlot(slot);
        const session = await this.sessionOf(tx, slot);
        if (session) await this.deleteSession(tx, session.id);
      }
      if (mode !== "PLAN") for (const mapping of mappings) await this.copyWorkoutFacts(tx, mapping, mode === "CONFIRM", now);
    },
    notify: (clientId, programId) => this.publish({ clientId, programId }),
  };

  async setOutcome(slot: WorkoutSlot, outcome: WorkoutOutcome | null, expectedRevision: number | null,
    now: Date = new Date()): Promise<WorkoutSession> {
    assertSlot(slot);
    if (outcome !== null && !OUTCOMES.includes(outcome)) throw new Error("INVALID_METRIC");
    const saved = await this.ready().writer.write(async (tx) => {
      const existing = await this.sessionOf(tx, slot);
      if ((existing?.revision ?? null) !== expectedRevision) throw new Error("STALE_SESSION");
      // Исход у ещё не начатой тренировки (например, «Пропущена») создаёт выполнение без фактов.
      const session = existing ?? await this.ensureSession(tx, slot, now);
      // PC §48.86.13: «Завершить» записывает окончание, если его ещё нет; отмена завершения и повторное завершение отметки не стирают и не переписывают.
      await tx.run(`UPDATE training_sessions SET outcome = ?, finished_at = CASE WHEN ? = 'COMPLETED' THEN COALESCE(finished_at, ?) ELSE finished_at END,
        revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ?`,
      [outcome, outcome, now.toISOString(), now.toISOString(), this.workspaceId, session.id]);
      return await this.sessionOf(tx, slot) as WorkoutSession;
    });
    this.publish(slot);
    return saved;
  }

  async setActualDate(slot: WorkoutSlot, date: string, expectedRevision: number, now: Date = new Date()): Promise<WorkoutSession> {
    assertSlot(slot);
    if (!isLocalDate(date)) throw new Error("INVALID_METRIC");
    // Отметки времени (§48.86.13) едут вместе с датой на ту же разницу в днях: время суток и длительность сохраняются.
    const shifted = (column: string) => `CASE WHEN ${column} IS NULL OR actual_date IS NULL THEN ${column}
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, CAST(round(julianday(?) - julianday(actual_date)) AS INTEGER) || ' days') END`;
    const saved = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE training_sessions SET started_at = ${shifted("started_at")}, finished_at = ${shifted("finished_at")},
        actual_date = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND week_index = ? AND planned_workout_id = ?
          AND revision = ?`, [date, date, date, now.toISOString(), this.workspaceId, slot.clientId, slot.programId, slot.weekIndex,
        slot.plannedWorkoutId, expectedRevision]);
      if (result.changes !== 1) throw new Error("STALE_SESSION");
      return await this.sessionOf(tx, slot) as WorkoutSession;
    });
    this.publish(slot);
    return saved;
  }

  async setTimes(slot: WorkoutSlot, times: Readonly<{ startedAt: string | null; finishedAt: string | null }>, expectedRevision: number,
    now: Date = new Date()): Promise<WorkoutSession> {
    assertSlot(slot);
    for (const value of [times.startedAt, times.finishedAt]) if (value !== null && !isInstant(value)) throw new Error("INVALID_METRIC");
    const saved = await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE training_sessions SET started_at = ?, finished_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND client_id = ? AND program_id = ? AND week_index = ? AND planned_workout_id = ? AND revision = ?`,
      [times.startedAt, times.finishedAt, now.toISOString(), this.workspaceId, slot.clientId, slot.programId, slot.weekIndex,
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
      signal_id AS signalId, program_id AS programId, week_index AS weekIndex, planned_workout_id AS plannedWorkoutId,
      paused_left_ms AS pausedLeftMs FROM training_rest_timers WHERE workspace_id = ? ORDER BY end_at`, [this.workspaceId]);
  }

  async putTimer(timer: RestTimer, replacedIds: readonly string[]): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      for (const replacedId of replacedIds) {
        await tx.run("DELETE FROM training_rest_timers WHERE workspace_id = ? AND id = ?", [this.workspaceId, replacedId]);
      }
      await tx.run(`INSERT INTO training_rest_timers (id, workspace_id, client_id, client_name, exercise_key, exercise_name,
        started_at, end_at, signal_id, program_id, week_index, planned_workout_id, paused_left_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET end_at = excluded.end_at, signal_id = excluded.signal_id, paused_left_ms = excluded.paused_left_ms`,
      [timer.id, this.workspaceId, timer.clientId, timer.clientName, timer.exerciseKey, timer.exerciseName, timer.startedAt,
        timer.endAt, timer.signalId, timer.programId, timer.weekIndex, timer.plannedWorkoutId, timer.pausedLeftMs]);
    });
  }

  async removeTimer(id: string): Promise<void> {
    await this.ready().writer.write((tx) => tx.run("DELETE FROM training_rest_timers WHERE workspace_id = ? AND id = ?",
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
