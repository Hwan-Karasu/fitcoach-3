import { runMigrations, type MigrationStep } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { ExerciseCatalogPort } from "../domain/ExerciseCatalogPort.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS, type BodyPart, type ExerciseDefinition, type SystemCatalog,
  type SystemCatalogMeta, type TrackingProfileId } from "../domain/ExerciseModel.ts";
import { EMPTY_OVERLAY, EXERCISE_NAME_MAX, normalizeAliases, validateCustom, type CatalogEntry,
  type CustomExerciseInput, type ExerciseOverlay } from "../domain/ExerciseRules.ts";

export const DEV_EXERCISES_LEDGER = "exercises_schema_migrations";

const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(",");

/** Dev-схема своих упражнений и личного слоя. Системные упражнения — из снимка RepDB, не из таблиц. */
export const devExerciseCatalog: readonly MigrationStep[] = [{
  version: 1,
  checksum: "x01-dev-exercises-v1-custom-overlay-20261017",
  statements: [
    `CREATE TABLE dev_custom_exercises (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND ${EXERCISE_NAME_MAX}),
      body_part TEXT NOT NULL CHECK (body_part IN (${list(BODY_PARTS)})),
      equipment TEXT,
      tracking_profile TEXT NOT NULL CHECK (tracking_profile IN (${list(TRACKING_PROFILE_IDS)})),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      CHECK (id LIKE 'usr:%')
    )`,
    `CREATE TABLE dev_exercise_overlay (
      workspace_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
      display_name TEXT CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND ${EXERCISE_NAME_MAX}),
      aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, exercise_id)
    )`,
  ],
}];

type CustomRow = Readonly<{ id: string; name: string; bodyPart: BodyPart; equipment: string | null;
  trackingProfile: TrackingProfileId; revision: number }>;
type OverlayRow = Readonly<{ exerciseId: string; favorite: number; hidden: number; displayName: string | null; aliasesJson: string }>;

function customDefinition(row: CustomRow): ExerciseDefinition {
  return { id: row.id, origin: "CUSTOM", name: row.name, nameEn: null, bodyPart: row.bodyPart, primaryMuscles: [],
    secondaryMuscles: [], equipment: row.equipment, trackingProfile: row.trackingProfile, mechanic: null, difficulty: null,
    unilateral: false, variationGroup: null, instructions: [], tips: [], textLanguage: "ru", media: null, source: null };
}

function overlayOf(row: OverlayRow | undefined): ExerciseOverlay {
  if (row === undefined) return EMPTY_OVERLAY;
  const aliases = JSON.parse(row.aliasesJson) as unknown;
  return { favorite: row.favorite === 1, hidden: row.hidden === 1, displayName: row.displayName,
    aliases: Array.isArray(aliases) ? aliases.filter((item): item is string => typeof item === "string") : [] };
}

const customColumns = `id, name, body_part AS bodyPart, equipment, tracking_profile AS trackingProfile, revision`;

export class DevExerciseCatalogRepository implements ExerciseCatalogPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly listeners = new Set<() => void>();
  private readonly systemById: ReadonlyMap<string, ExerciseDefinition>;
  private readonly workspaceId: string;
  private readonly system: SystemCatalog;

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string,
    system: SystemCatalog) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
    this.system = system;
    this.systemById = new Map(system.exercises.map((exercise) => [exercise.id, exercise]));
  }

  initialize(): Promise<void> {
    if (this.connection !== null) return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const opening = this.openAndMigrate();
    this.opening = opening;
    void opening.finally(() => { if (this.opening === opening) this.opening = null; }).catch(() => undefined);
    return opening;
  }

  private async openAndMigrate(): Promise<void> {
    if (!this.workspaceId.trim()) throw new Error("EXERCISE_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devExerciseCatalog, DEV_EXERCISES_LEDGER);
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("EXERCISE_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Наблюдатель не превращает коммит в ошибку. */ }
    }
  }

  meta(): SystemCatalogMeta { return this.system.meta; }

  async list(): Promise<readonly CatalogEntry[]> {
    const { connection } = this.ready();
    const [custom, overlays] = await Promise.all([
      connection.all<CustomRow>(`SELECT ${customColumns} FROM dev_custom_exercises
        WHERE workspace_id = ? AND archived_at IS NULL`, [this.workspaceId]),
      connection.all<OverlayRow>(`SELECT exercise_id AS exerciseId, favorite, hidden, display_name AS displayName,
        aliases_json AS aliasesJson FROM dev_exercise_overlay WHERE workspace_id = ?`, [this.workspaceId]),
    ]);
    const byId = new Map(overlays.map((row) => [row.exerciseId, row]));
    return [...this.system.exercises, ...custom.map(customDefinition)]
      .map((definition) => ({ definition, overlay: overlayOf(byId.get(definition.id)) }));
  }

  private async definition(tx: SqliteStatementPort, id: string): Promise<ExerciseDefinition | null> {
    const system = this.systemById.get(id);
    if (system !== undefined) return system;
    const row = await tx.first<CustomRow>(`SELECT ${customColumns} FROM dev_custom_exercises
      WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`, [this.workspaceId, id]);
    return row === null ? null : customDefinition(row);
  }

  async get(id: string): Promise<CatalogEntry | null> {
    const { connection } = this.ready();
    const definition = await this.definition(connection, id);
    if (definition === null) return null;
    const overlay = await connection.first<OverlayRow>(`SELECT exercise_id AS exerciseId, favorite, hidden,
      display_name AS displayName, aliases_json AS aliasesJson FROM dev_exercise_overlay
      WHERE workspace_id = ? AND exercise_id = ?`, [this.workspaceId, id]);
    return { definition, overlay: overlayOf(overlay ?? undefined) };
  }

  async revisionOf(id: string): Promise<number | null> {
    const row = await this.ready().connection.first<{ revision: number }>(`SELECT revision FROM dev_custom_exercises
      WHERE workspace_id = ? AND id = ?`, [this.workspaceId, id]);
    return row?.revision ?? null;
  }

  async createCustom(input: CustomExerciseInput, now: Date = new Date()): Promise<ExerciseDefinition> {
    const valid = validateCustom(input);
    const created = await this.ready().writer.write(async (tx) => {
      const uuid = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
      if (!uuid) throw new Error("EXERCISE_ID_UNAVAILABLE");
      const id = `usr:${uuid}`;
      const stamp = now.toISOString();
      await tx.run(`INSERT INTO dev_custom_exercises (id, workspace_id, name, body_part, equipment, tracking_profile,
          revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, this.workspaceId, valid.name, valid.bodyPart, valid.equipment, valid.trackingProfile, stamp, stamp]);
      const definition = await this.definition(tx, id);
      if (definition === null) throw new Error("EXERCISE_NOT_FOUND");
      return definition;
    });
    this.publish();
    return created;
  }

  async updateCustom(id: string, expectedRevision: number, input: CustomExerciseInput,
    now: Date = new Date()): Promise<ExerciseDefinition> {
    if (this.systemById.has(id)) throw new Error("EXERCISE_SYSTEM_READ_ONLY");
    const valid = validateCustom(input);
    const updated = await this.ready().writer.write(async (tx) => {
      // Профиль учёта менять можно, пока нет тренировочных фактов (§39.3); фактов в V1-dev пока нет.
      const result = await tx.run(`UPDATE dev_custom_exercises SET name = ?, body_part = ?, equipment = ?,
          tracking_profile = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND archived_at IS NULL`,
      [valid.name, valid.bodyPart, valid.equipment, valid.trackingProfile, now.toISOString(), this.workspaceId, id,
        expectedRevision]);
      if (result.changes !== 1) {
        throw new Error((await this.definition(tx, id)) === null ? "EXERCISE_NOT_FOUND" : "EXERCISE_STALE");
      }
      const definition = await this.definition(tx, id);
      if (definition === null) throw new Error("EXERCISE_NOT_FOUND");
      return definition;
    });
    this.publish();
    return updated;
  }

  async archiveCustom(id: string, now: Date = new Date()): Promise<void> {
    if (this.systemById.has(id)) throw new Error("EXERCISE_SYSTEM_READ_ONLY");
    await this.ready().writer.write(async (tx) => {
      const result = await tx.run(`UPDATE dev_custom_exercises SET archived_at = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`, [now.toISOString(), now.toISOString(), this.workspaceId, id]);
      if (result.changes !== 1) throw new Error("EXERCISE_NOT_FOUND");
    });
    this.publish();
  }

  private async patchOverlay(id: string, patch: Partial<Readonly<{ favorite: boolean; hidden: boolean;
    displayName: string | null; aliases: readonly string[] }>>): Promise<void> {
    await this.ready().writer.write(async (tx) => {
      if ((await this.definition(tx, id)) === null) throw new Error("EXERCISE_NOT_FOUND");
      const current = overlayOf((await tx.first<OverlayRow>(`SELECT exercise_id AS exerciseId, favorite, hidden,
        display_name AS displayName, aliases_json AS aliasesJson FROM dev_exercise_overlay
        WHERE workspace_id = ? AND exercise_id = ?`, [this.workspaceId, id])) ?? undefined);
      const next = { ...current, ...patch };
      await tx.run(`INSERT INTO dev_exercise_overlay (workspace_id, exercise_id, favorite, hidden, display_name,
          aliases_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, exercise_id) DO UPDATE SET favorite = excluded.favorite, hidden = excluded.hidden,
          display_name = excluded.display_name, aliases_json = excluded.aliases_json, updated_at = excluded.updated_at`,
      [this.workspaceId, id, next.favorite ? 1 : 0, next.hidden ? 1 : 0, next.displayName,
        JSON.stringify(next.aliases), new Date().toISOString()]);
    });
    this.publish();
  }

  setFavorite(id: string, favorite: boolean): Promise<void> { return this.patchOverlay(id, { favorite }); }

  setHidden(id: string, hidden: boolean): Promise<void> { return this.patchOverlay(id, { hidden }); }

  setPersonal(id: string, personal: Readonly<{ displayName: string | null; aliases: readonly string[] }>): Promise<void> {
    const displayName = personal.displayName?.trim().replace(/\s+/g, " ") || null;
    if (displayName !== null && displayName.length > EXERCISE_NAME_MAX) return Promise.reject(new Error("EXERCISE_NAME_INVALID"));
    return this.patchOverlay(id, { displayName, aliases: normalizeAliases(personal.aliases) });
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
