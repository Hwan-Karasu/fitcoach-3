import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import { assertSteps, validateCalcProfile, type CalcActivity, type CalcGoal, type CalcIntensity, type CalcProfile } from "../domain/CalcRules.ts";
import { assertDate } from "../domain/DiaryRules.ts";
import type { CalcCommittedChange, CalcProfileParticipant, NutritionCalcPort, StepsDay, StoredCalcProfile, WorkoutMark } from "../domain/NutritionCalcPort.ts";
import { DEV_NUTRITION_LEDGER, devNutritionCatalog } from "./DevNutritionCatalog.ts";

interface ProfileRow {
  readonly goal: CalcGoal;
  readonly activity: CalcActivity;
  readonly workouts: number;
  readonly minutes: number;
  readonly intensity: CalcIntensity;
  readonly stepKcal: number;
  readonly revision: number;
}

const columns = `goal, activity, workouts_per_week AS workouts, workout_minutes AS minutes, intensity, step_kcal AS stepKcal, revision`;

const toStored = (row: ProfileRow): StoredCalcProfile => ({ revision: row.revision, profile: {
  goal: row.goal, activity: row.activity, workoutsPerWeek: row.workouts, minutes: row.minutes, intensity: row.intensity, stepKcal: row.stepKcal } });

async function load(reader: SqliteStatementPort, workspaceId: string, clientId: string): Promise<StoredCalcProfile | null> {
  const row = await reader.first<ProfileRow>(`SELECT ${columns} FROM nutrition_calc_profiles WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
  return row === null ? null : toStored(row);
}

/** Создание (`expectedRevision: null`) или правка по revision; та же запись для порта и для участника workflow. */
async function writeProfile(tx: SqliteStatementPort, workspaceId: string, clientId: string, valid: CalcProfile, expectedRevision: number | null, stamp: string): Promise<StoredCalcProfile> {
  if (expectedRevision === null) {
    const exists = await tx.first<{ n: number }>("SELECT count(*) AS n FROM nutrition_calc_profiles WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    if ((exists?.n ?? 0) > 0) throw new Error("CALC_STALE");
    await tx.run(`INSERT INTO nutrition_calc_profiles (workspace_id, client_id, goal, activity, workouts_per_week, workout_minutes,
        intensity, step_kcal, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [workspaceId, clientId, valid.goal, valid.activity, valid.workoutsPerWeek, valid.minutes, valid.intensity, valid.stepKcal, stamp]);
  } else {
    const result = await tx.run(`UPDATE nutrition_calc_profiles SET goal = ?, activity = ?, workouts_per_week = ?, workout_minutes = ?,
        intensity = ?, step_kcal = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND client_id = ? AND revision = ?`,
    [valid.goal, valid.activity, valid.workoutsPerWeek, valid.minutes, valid.intensity, valid.stepKcal, stamp, workspaceId, clientId, expectedRevision]);
    if (result.changes !== 1) throw new Error("CALC_STALE");
  }
  return (await load(tx, workspaceId, clientId)) as StoredCalcProfile;
}

/** Nutrition side of PermanentlyDeleteArchivedClient (§15.7): профиль расчёта и шаги. */
export const devNutritionCalcClientDeletionParticipant = {
  owner: "nutrition.calc",
  tables: ["nutrition_calc_profiles", "nutrition_daily_steps", "nutrition_daily_workout_marks"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    const profiles = await tx.first<{ n: number }>("SELECT count(*) AS n FROM nutrition_calc_profiles WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const steps = await tx.first<{ n: number }>("SELECT count(*) AS n FROM nutrition_daily_steps WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    const marks = await tx.first<{ n: number }>("SELECT count(*) AS n FROM nutrition_daily_workout_marks WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    return (profiles?.n ?? 0) + (steps?.n ?? 0) + (marks?.n ?? 0);
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("DELETE FROM nutrition_calc_profiles WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM nutrition_daily_steps WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
    await tx.run("DELETE FROM nutrition_daily_workout_marks WHERE workspace_id = ? AND client_id = ?", [workspaceId, clientId]);
  },
};

/** Explicitly dev-only new-install store sharing the clients dev file; the clients store must initialize first. */
export class DevNutritionCalcRepository implements NutritionCalcPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: CalcCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
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
    if (!this.workspaceId.trim()) throw new Error("NUTRITION_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devNutritionCatalog, DEV_NUTRITION_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("NUTRITION_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: CalcCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: CalcCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  getProfile(clientId: string): Promise<StoredCalcProfile | null> {
    return load(this.ready().connection, this.workspaceId, clientId);
  }

  async saveProfile(clientId: string, profile: CalcProfile, expectedRevision: number | null, now: Date = new Date()): Promise<StoredCalcProfile> {
    const valid = validateCalcProfile(profile);
    const saved = await this.ready().writer.write((tx) => writeProfile(tx, this.workspaceId, clientId, valid, expectedRevision, now.toISOString()));
    this.publish({ clientId });
    return saved;
  }

  /** Для workflow «профиль расчёта + пол и рост»: та же запись внутри общей транзакции. */
  readonly profileParticipant: CalcProfileParticipant<SqliteStatementPort> = {
    save: (tx, clientId, profile, expectedRevision, now) => writeProfile(tx, this.workspaceId, clientId, validateCalcProfile(profile), expectedRevision, now.toISOString()),
    notify: (clientId) => this.publish({ clientId }),
  };

  async listSteps(clientId: string, fromDate: string, toDate: string): Promise<readonly StepsDay[]> {
    assertDate(fromDate);
    assertDate(toDate);
    const rows = await this.ready().connection.all<StepsDay>(`SELECT local_date AS localDate, steps FROM nutrition_daily_steps
      WHERE workspace_id = ? AND client_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date`, [this.workspaceId, clientId, fromDate, toDate]);
    return rows.map((row) => ({ localDate: row.localDate, steps: row.steps }));
  }

  async setSteps(clientId: string, localDate: string, steps: number, now: Date = new Date()): Promise<StepsDay> {
    assertDate(localDate);
    assertSteps(steps);
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO nutrition_daily_steps (workspace_id, client_id, local_date, steps, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, client_id, local_date) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, localDate, steps, now.toISOString()]);
    });
    this.publish({ clientId });
    return { localDate, steps };
  }

  async clearSteps(clientId: string, localDate: string): Promise<void> {
    assertDate(localDate);
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM nutrition_daily_steps WHERE workspace_id = ? AND client_id = ? AND local_date = ?", [this.workspaceId, clientId, localDate]);
    });
    this.publish({ clientId });
  }

  async listWorkoutMarks(clientId: string, fromDate: string, toDate: string): Promise<readonly WorkoutMark[]> {
    assertDate(fromDate);
    assertDate(toDate);
    const rows = await this.ready().connection.all<{ localDate: string; done: number }>(`SELECT local_date AS localDate, done FROM nutrition_daily_workout_marks
      WHERE workspace_id = ? AND client_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date`, [this.workspaceId, clientId, fromDate, toDate]);
    return rows.map((row) => ({ localDate: row.localDate, done: row.done === 1 }));
  }

  async setWorkoutMark(clientId: string, localDate: string, done: boolean, now: Date = new Date()): Promise<WorkoutMark> {
    assertDate(localDate);
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO nutrition_daily_workout_marks (workspace_id, client_id, local_date, done, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, client_id, local_date) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at`,
      [this.workspaceId, clientId, localDate, done ? 1 : 0, now.toISOString()]);
    });
    this.publish({ clientId });
    return { localDate, done };
  }

  async clearWorkoutMark(clientId: string, localDate: string): Promise<void> {
    assertDate(localDate);
    await this.ready().writer.write(async (tx) => {
      await tx.run("DELETE FROM nutrition_daily_workout_marks WHERE workspace_id = ? AND client_id = ? AND local_date = ?", [this.workspaceId, clientId, localDate]);
    });
    this.publish({ clientId });
  }

  async averageSteps(clientId: string, fromDate: string, toDate: string): Promise<number | null> {
    const days = await this.listSteps(clientId, fromDate, toDate);
    return days.length === 0 ? null : Math.round(days.reduce((sum, day) => sum + day.steps, 0) / days.length);
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
