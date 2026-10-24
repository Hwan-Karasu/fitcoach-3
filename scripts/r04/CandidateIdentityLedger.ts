import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { projectClientIdentityDrafts, type ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyClientIdentityCandidate } from "./LegacyClientIdentitySourceReader.ts";
import { clientsBaseline } from "../../apps/mobile/src/features/clients/data/ClientsBaseline.generated.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import { projectLegacyClientCard, type ClientCardFields, type LegacyClientCardCandidate } from "./LegacyClientCardProjection.ts";
import { createProfileRehearsalSchema, profileRehearsalObjects, stageClientProfilesInTransaction } from "./LegacyClientProfileStage.ts";
import type { LegacyQuestionnaireSource } from "./LegacyQuestionnaireComposition.ts";
import { createWorkDataRehearsalSchema, stageLegacyClientWorkDataInTransaction, workDataRehearsalObjects } from "./LegacyClientWorkDataStage.ts";
import { createExerciseRehearsalSchema, exerciseRehearsalObjects, stageLegacyExerciseCatalogInTransaction, type ExerciseStageCheckpoint } from "./LegacyExerciseCatalogStage.ts";
import { projectLegacyExerciseCatalogRow, type LegacyExerciseCatalogCandidate } from "./LegacyExerciseCatalogSourceReader.ts";
import type { LegacyExerciseReferenceCandidate } from "./LegacyExerciseReferencePreflight.ts";
import { createPlansRehearsalSchema, loadStagedPlanMappings, plansRehearsalObjects, stageLegacyPlansInTransaction, type PlanStageCheckpoint } from "./LegacyPlansStage.ts";
import type { LegacyPlansSource } from "./LegacyPlansSourceReader.ts";
import type { LegacyExecutionSource } from "./LegacyExecutionSourceReader.ts";
import { createExecutionRehearsalSchema, executionRehearsalObjects, loadStagedExecutionFacts, stageLegacyExecutionsInTransaction, type ExecutionStageCheckpoint } from "./LegacyExecutionStage.ts";
import { createMeasurementRehearsalSchema, measurementRehearsalObjects, stageLegacyMeasurementsInTransaction, loadStagedMeasurements, type MeasurementStageCheckpoint } from "./LegacyMeasurementStage.ts";
import type { LegacyMeasurementsSnapshot } from "./LegacyMeasurementSourceReader.ts";
import { isLocalDate } from "../../apps/mobile/src/features/measurements/domain/MeasurementRules.ts";
import { createNutritionRehearsalSchema, nutritionRehearsalObjects, stageLegacyNutritionInTransaction, loadStagedNutrition, type NutritionStageCheckpoint } from "./LegacyNutritionStage.ts";
import type { LegacyNutritionSource } from "./LegacyNutritionSourceReader.ts";

type FullStageCheckpoint = "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" |
  ExerciseStageCheckpoint | PlanStageCheckpoint | ExecutionStageCheckpoint | MeasurementStageCheckpoint | NutritionStageCheckpoint;

export interface CandidateIdentityContext {
  readonly sourceSha256: string;
  readonly accountScope: string;
  readonly sourceWorkspaceId: string;
  readonly targetWorkspaceId: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const workspace = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/u;
function contextJson(context: CandidateIdentityContext): string {
  if (!/^[0-9a-f]{64}$/u.test(context.sourceSha256) || !context.accountScope.trim()
    || !context.sourceWorkspaceId.trim() || !workspace.test(context.targetWorkspaceId)) {
    throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  }
  return JSON.stringify([2, context.sourceSha256, context.accountScope, context.sourceWorkspaceId, context.targetWorkspaceId]);
}
function validateClientKey(key: string, scope: string): void {
  let parts: unknown;
  try { parts = JSON.parse(key) as unknown; } catch { throw new Error("R04_ID_LEDGER_SOURCE_KEY_INVALID"); }
  if (!Array.isArray(parts) || parts.length !== 2 || parts[0] !== scope
    || typeof parts[1] !== "string" || !parts[1].trim() || JSON.stringify(parts) !== key) {
    throw new Error("R04_ID_LEDGER_SOURCE_KEY_INVALID");
  }
}

/** R04 isolated synthetic staging contract. Never attach this schema to a source or runtime DB. */
export function prepareCandidateIdentityLedger(db: DatabaseSync, context: CandidateIdentityContext,
  options?: { readonly clientIdentityRehearsal: { readonly createdAt: string; readonly profiles?: true; readonly questionnaires?: true; readonly workData?: true; readonly exercises?: true; readonly plans?: true; readonly templates?: true; readonly archives?: true; readonly executions?: true; readonly measurements?: { readonly referenceDay: string }; readonly nutrition?: true } }) {
  // Snapshot caller input so a later caller mutation cannot change the ledger's binding.
  const binding = { ...context }, jobCreatedAt = options?.clientIdentityRehearsal.createdAt;
  const profilesEnabled = options?.clientIdentityRehearsal.profiles === true;
  const questionnairesEnabled = options?.clientIdentityRehearsal.questionnaires === true;
  const workDataEnabled = options?.clientIdentityRehearsal.workData === true;
  const exercisesEnabled = options?.clientIdentityRehearsal.exercises === true;
  const plansEnabled = options?.clientIdentityRehearsal.plans === true;
  const templatesEnabled = options?.clientIdentityRehearsal.templates === true;
  const archivesEnabled = options?.clientIdentityRehearsal.archives === true;
  const executionsEnabled = options?.clientIdentityRehearsal.executions === true;
  const measurementDay = options?.clientIdentityRehearsal.measurements?.referenceDay, measurementsEnabled = measurementDay !== undefined;
  const nutritionEnabled = options?.clientIdentityRehearsal.nutrition === true;
  if (questionnairesEnabled && !profilesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (workDataEnabled && !questionnairesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (exercisesEnabled && !workDataEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (plansEnabled && !exercisesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (templatesEnabled && !plansEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (archivesEnabled && !templatesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (executionsEnabled && !archivesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (options?.clientIdentityRehearsal.measurements !== undefined && (!measurementsEnabled || !isLocalDate(measurementDay) || !executionsEnabled)) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (nutritionEnabled && !measurementsEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (jobCreatedAt !== undefined && !isExplicitTimestamp(jobCreatedAt)) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  const expectedContext = jobCreatedAt === undefined ? contextJson(binding)
    : JSON.stringify([contextJson(binding), "CLIENT_IDENTITY_REHEARSAL_V1", jobCreatedAt, ...(profilesEnabled ? ["PROFILE_REHEARSAL_V1"] : []),
      ...(questionnairesEnabled ? ["QUESTIONNAIRE_COMPOSITION_V1"] : []), ...(workDataEnabled ? ["WORK_DATA_REHEARSAL_V1"] : []),
      ...(exercisesEnabled ? ["EXERCISE_REGISTRY_REHEARSAL_V1"] : []), ...(plansEnabled ? ["TRAINING_PLANS_REHEARSAL_V1"] : []),
      ...(templatesEnabled ? ["TRAINING_TEMPLATES_REHEARSAL_V1"] : []), ...(archivesEnabled ? ["TRAINING_ARCHIVES_REHEARSAL_V1"] : []),
      ...(executionsEnabled ? ["TRAINING_EXECUTIONS_REHEARSAL_V3"] : []), ...(measurementsEnabled ? ["MEASUREMENTS_REHEARSAL_V2", measurementDay] : []),
      ...(nutritionEnabled ? ["NUTRITION_REHEARSAL_V2"] : [])]);
  const workspaceKey = JSON.stringify([binding.accountScope, binding.sourceWorkspaceId]);
  function inspect(): "new" | "owned" {
    const objects = db.prepare("SELECT type,name FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_' ORDER BY name").all();
    if (objects.length === 0) return "new";
    const expectedTables = jobCreatedAt === undefined ? ["r04_candidate_identity", "r04_candidate_ids"]
      : ["r04_candidate_identity", "r04_candidate_ids", "workspaces", "clients"];
    const expectedObjects: Record<string, string> = Object.fromEntries(expectedTables.map((name) => [name, "table"]));
    if (profilesEnabled) Object.assign(expectedObjects, profileRehearsalObjects);
    if (workDataEnabled) Object.assign(expectedObjects, workDataRehearsalObjects);
    if (exercisesEnabled) Object.assign(expectedObjects, exerciseRehearsalObjects);
    if (plansEnabled) Object.assign(expectedObjects, plansRehearsalObjects);
    if (executionsEnabled) Object.assign(expectedObjects, executionRehearsalObjects);
    if (measurementsEnabled) Object.assign(expectedObjects, measurementRehearsalObjects);
    if (nutritionEnabled) Object.assign(expectedObjects, nutritionRehearsalObjects);
    if (objects.length !== Object.keys(expectedObjects).length || objects.some((row) => !Object.hasOwn(expectedObjects, String(row.name))
      || row.type !== expectedObjects[String(row.name)])) {
      throw new Error("R04_ID_LEDGER_FOREIGN_DATABASE");
    }
    const identities = db.prepare("SELECT id,context_json FROM r04_candidate_identity").all();
    if (identities.length !== 1 || identities[0]?.id !== 1 || identities[0]?.context_json !== expectedContext) {
      throw new Error("R04_ID_LEDGER_CONTEXT_MISMATCH");
    }
    const maps = db.prepare("SELECT kind,source_key,target_id FROM r04_candidate_ids").all();
    const targets = new Set<string>(), keys = new Set<string>();
    let workspaceRows = 0;
    for (const row of maps) {
      if (typeof row.source_key !== "string" || typeof row.target_id !== "string") throw new Error("R04_ID_LEDGER_CORRUPT");
      if (row.kind === "WORKSPACE") {
        workspaceRows += 1;
        if (row.source_key !== workspaceKey || row.target_id !== binding.targetWorkspaceId) throw new Error("R04_ID_LEDGER_CORRUPT");
      } else if (row.kind === "CLIENT") {
        validateClientKey(row.source_key, binding.accountScope);
        if (!uuid.test(row.target_id) || targets.has(row.target_id) || keys.has(row.source_key)) throw new Error("R04_ID_LEDGER_CORRUPT");
        targets.add(row.target_id); keys.add(row.source_key);
      } else throw new Error("R04_ID_LEDGER_CORRUPT");
    }
    if (workspaceRows !== 1) throw new Error("R04_ID_LEDGER_CORRUPT");
    if (jobCreatedAt !== undefined) {
      const workspaces = db.prepare("SELECT id,created_at FROM workspaces").all();
      if (workspaces.length !== 1 || workspaces[0]?.id !== binding.targetWorkspaceId || workspaces[0]?.created_at !== jobCreatedAt) {
        throw new Error("R04_ID_LEDGER_CORRUPT");
      }
      for (const client of db.prepare("SELECT id,workspace_id FROM clients").all()) {
        if (client.workspace_id !== binding.targetWorkspaceId || !targets.has(String(client.id))) throw new Error("R04_ID_LEDGER_CORRUPT");
      }
    }
    return "owned";
  }
  function transaction<T>(run: () => T): T {
    if (db.isTransaction) throw new Error("R04_ID_LEDGER_TRANSACTION_REQUIRED_EXCLUSIVE");
    db.exec("BEGIN IMMEDIATE");
    try { const result = run(); db.exec("COMMIT"); return result; }
    catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (error instanceof Error && /^R04_ID_LEDGER_[A-Z_]+$/u.test(error.message)) throw error;
      throw new Error("R04_ID_LEDGER_WRITE_FAILED", { cause: error });
    }
  }
  // Inspect before any mutation, then inspect again under the writer lock.
  inspect();
  if (jobCreatedAt !== undefined) {
    if (db.isTransaction) throw new Error("R04_ID_LEDGER_TRANSACTION_REQUIRED_EXCLUSIVE");
    db.exec("PRAGMA foreign_keys = ON");
    if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw new Error("R04_ID_LEDGER_FOREIGN_KEYS_DISABLED");
  }
  transaction(() => {
    if (inspect() === "owned") return;
    db.exec(`CREATE TABLE r04_candidate_identity(id INTEGER PRIMARY KEY CHECK(id=1),context_json TEXT NOT NULL);
      CREATE TABLE r04_candidate_ids(kind TEXT NOT NULL CHECK(kind IN ('WORKSPACE','CLIENT')),
        source_key TEXT NOT NULL,target_id TEXT NOT NULL,
        source_payload_json TEXT CHECK(source_payload_json IS NULL OR json_valid(source_payload_json)),
        PRIMARY KEY(kind,source_key),UNIQUE(kind,target_id));`);
    db.prepare("INSERT INTO r04_candidate_identity VALUES(1,?)").run(expectedContext);
    db.prepare("INSERT INTO r04_candidate_ids(kind,source_key,target_id) VALUES('WORKSPACE',?,?)").run(workspaceKey, binding.targetWorkspaceId);
    if (jobCreatedAt !== undefined) {
      for (const name of ["workspaces", "clients"]) {
        const sql = clientsBaseline[0]!.statements.find((statement) => statement.startsWith(`CREATE TABLE ${name} (`));
        if (!sql) throw new Error("R04_ID_LEDGER_CLIENT_SCHEMA_UNAVAILABLE");
        db.exec(sql);
      }
      db.prepare("INSERT INTO workspaces(id,display_name,created_at) VALUES(?,?,?)")
        .run(binding.targetWorkspaceId, "R04 synthetic identity rehearsal", jobCreatedAt);
      if (profilesEnabled) createProfileRehearsalSchema(db);
      if (workDataEnabled) createWorkDataRehearsalSchema(db);
      if (exercisesEnabled) createExerciseRehearsalSchema(db);
      if (plansEnabled) createPlansRehearsalSchema(db);
      if (executionsEnabled) createExecutionRehearsalSchema(db);
      if (measurementsEnabled) createMeasurementRehearsalSchema(db);
      if (nutritionEnabled) createNutritionRehearsalSchema(db);
    }
  });
  function reserveInTransaction(sourceKeys: readonly string[], allocate: () => string): ReadonlyMap<string, string> {
    const unique = new Set<string>();
    for (const key of sourceKeys) {
      validateClientKey(key, binding.accountScope);
      if (unique.has(key)) throw new Error("R04_ID_LEDGER_DUPLICATE_SOURCE_KEY");
      unique.add(key);
    }
      if (inspect() !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
      const result = new Map<string, string>();
      for (const key of [...unique].sort()) {
        const existing = db.prepare("SELECT target_id FROM r04_candidate_ids WHERE kind='CLIENT' AND source_key=?").get(key);
        if (existing) { result.set(key, String(existing.target_id)); continue; }
        const target = allocate();
        if (!uuid.test(target)) throw new Error("R04_ID_LEDGER_INVALID_TARGET_ID");
        if (db.prepare("SELECT 1 FROM r04_candidate_ids WHERE kind='CLIENT' AND target_id=?").get(target)) throw new Error("R04_ID_LEDGER_TARGET_COLLISION");
        db.prepare("INSERT INTO r04_candidate_ids(kind,source_key,target_id) VALUES('CLIENT',?,?)").run(key, target);
        result.set(key, target);
      }
      return result;
  }
  function reserveClientIds(sourceKeys: readonly string[], allocate: () => string = randomUUID): ReadonlyMap<string, string> {
    return transaction(() => reserveInTransaction(sourceKeys, allocate));
  }
  function loadClientDraftIds(): ClientDraftIdMap {
    if (inspect() !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
    const rows = db.prepare("SELECT source_key,target_id FROM r04_candidate_ids WHERE kind='CLIENT' ORDER BY source_key").all();
    return { workspaces: new Map([[workspaceKey, binding.targetWorkspaceId]]),
      clients: new Map(rows.map((row) => [String(row.source_key), String(row.target_id)])) };
  }
  function stageClientIdentities(source: readonly LegacyClientIdentityCandidate[], allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "before-commit") => void = () => undefined,
    cards?: ReadonlyMap<string, ClientCardFields>, sourcePayloads?: ReadonlyMap<string, string>, afterClients?: () => void) {
    if (jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_REHEARSAL_NOT_ENABLED");
    return transaction(() => {
      if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw new Error("R04_ID_LEDGER_FOREIGN_KEYS_DISABLED");
      if (source.some((row) => row.accountScope !== binding.accountScope || row.sourceWorkspaceId !== binding.sourceWorkspaceId)) {
        throw new Error("R04_ID_LEDGER_CLIENT_SCOPE_MISMATCH");
      }
      reserveInTransaction(source.map((row) => row.sourceIdentityKey), allocate);
      checkpoint("after-ids");
      const projection = projectClientIdentityDrafts(source, loadClientDraftIds(), binding.targetWorkspaceId);
      if (projection.status !== "projected-draft") throw new Error("R04_ID_LEDGER_CLIENT_PROJECTION_BLOCKED");
      let inserted = 0, unchanged = 0;
      for (const client of projection.rows) {
        const payload = sourcePayloads?.get(client.sourceIdentityKey);
        if (sourcePayloads !== undefined && payload === undefined) throw new Error("R04_ID_LEDGER_CLIENT_CARD_MISSING");
        const savedPayload = db.prepare("SELECT source_payload_json FROM r04_candidate_ids WHERE kind='CLIENT' AND source_key=?")
          .get(client.sourceIdentityKey)?.source_payload_json;
        if (savedPayload != null && savedPayload !== payload) throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
        const archivedAt = client.lifecycle === "ARCHIVED" ? client.sourceArchivedAt : null;
        const card = cards?.get(client.sourceIdentityKey);
        if (cards !== undefined && !card) throw new Error("R04_ID_LEDGER_CLIENT_CARD_MISSING");
        const expected = [client.id, client.workspaceId, client.displayName, client.lifecycle, 1,
          client.createdAt, client.updatedAt, archivedAt, card?.birthDate ?? null, card?.heightCmX10 ?? null,
          card?.sex ?? null, card?.emoji ?? null];
        const columns = ["id", "workspace_id", "display_name", "lifecycle", "revision", "created_at", "updated_at", "archived_at",
          "birth_date", "height_cm_x10", "sex", "emoji"];
        const existing = db.prepare("SELECT * FROM clients WHERE id=?").get(client.id);
        if (existing) {
          if (columns.some((column, index) => existing[column] !== expected[index])
            || ["contact_phone", "contact_email"].some((column) => existing[column] !== null)) {
            throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
          }
          unchanged += 1;
        } else {
          db.prepare(`INSERT INTO clients(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...expected);
          inserted += 1;
        }
        const actual = db.prepare(`SELECT ${columns.join(",")} FROM clients WHERE id=?`).get(client.id);
        if (!actual || columns.some((column, index) => actual[column] !== expected[index])) throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
        if (payload !== undefined && savedPayload === null) db.prepare("UPDATE r04_candidate_ids SET source_payload_json=? WHERE kind='CLIENT' AND source_key=?")
          .run(payload, client.sourceIdentityKey);
        checkpoint("after-client");
      }
      afterClients?.();
      if (db.prepare("SELECT count(*) AS count FROM clients").get()?.count !== projection.rows.length
        || db.prepare("PRAGMA foreign_key_check").all().length > 0
        || db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
        throw new Error("R04_ID_LEDGER_CLIENT_PARITY_MISMATCH");
      }
      checkpoint("before-commit");
      return { status: "identity-rehearsal-staged" as const, sourceRows: source.length,
        targetRows: projection.rows.length, insertedRows: inserted, unchangedRows: unchanged,
        sourceWrites: 0 as const };
    });
  }
  function stageClientCards(source: readonly LegacyClientCardCandidate[], allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "before-commit") => void = () => undefined, afterClients?: () => void) {
    const cards = new Map<string, ClientCardFields>();
    const payloads = new Map<string, string>();
    for (const row of source) {
      if (row.issues.length > 0 || row.fields === null || cards.has(row.identity.sourceIdentityKey)) throw new Error("R04_ID_LEDGER_CLIENT_CARD_BLOCKED");
      cards.set(row.identity.sourceIdentityKey, row.fields);
      payloads.set(row.identity.sourceIdentityKey, JSON.stringify(row.raw));
    }
    return stageClientIdentities(source.map((row) => row.identity), allocate, checkpoint, cards, payloads, afterClients);
  }
  function stageClientProfilesWithQuestionnaire(source: readonly LegacyClientCardCandidate[], allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "before-commit") => void = () => undefined,
    questionnaire?: LegacyQuestionnaireSource | null, afterProfiles?: (snapshot: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap) => void) {
    if (!profilesEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_PROFILE_NOT_ENABLED");
    if (questionnairesEnabled !== (questionnaire !== undefined)) throw new Error("R04_ID_LEDGER_QUESTIONNAIRE_MODE_MISMATCH");
    if (workDataEnabled !== (afterProfiles !== undefined)) throw new Error("R04_ID_LEDGER_WORK_DATA_MODE_MISMATCH");
    const questionnaireSnapshot = questionnaire === undefined ? undefined : structuredClone(questionnaire);
    const snapshot = structuredClone(source).map((row) => {
      if (row.issues.length > 0) throw new Error("R04_ID_LEDGER_CLIENT_CARD_BLOCKED");
      return projectLegacyClientCard(row.identity, row.raw);
    });
    let profiles: ReturnType<typeof stageClientProfilesInTransaction> | null = null;
    const clients = stageClientCards(snapshot, allocate, checkpoint, () => {
      profiles = stageClientProfilesInTransaction(db, binding, jobCreatedAt, snapshot, loadClientDraftIds(), () => checkpoint("after-profile"), questionnaireSnapshot);
      afterProfiles?.(snapshot, loadClientDraftIds());
    });
    return { ...clients, ...profiles!, status: "profile-rehearsal-staged" as const };
  }
  function stageClientProfiles(source: readonly LegacyClientCardCandidate[], allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "before-commit") => void = () => undefined) {
    return stageClientProfilesWithQuestionnaire(source, allocate, checkpoint);
  }
  function stageClientQuestionnaires(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    allocate: () => string = randomUUID, checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "before-commit") => void = () => undefined) {
    if (!questionnairesEnabled) throw new Error("R04_ID_LEDGER_QUESTIONNAIRE_NOT_ENABLED");
    return { ...stageClientProfilesWithQuestionnaire(source, allocate, checkpoint, questionnaire), status: "questionnaire-rehearsal-staged" as const };
  }
  function stageClientWorkDataWithExercises(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit") => void = () => undefined,
    afterWorkData?: (snapshot: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap) => void) {
    if (!workDataEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_WORK_DATA_NOT_ENABLED");
    if (exercisesEnabled !== (afterWorkData !== undefined)) throw new Error("R04_ID_LEDGER_EXERCISE_MODE_MISMATCH");
    let workData: ReturnType<typeof stageLegacyClientWorkDataInTransaction> | null = null;
    const clients = stageClientProfilesWithQuestionnaire(source, allocate, checkpoint, questionnaire, (snapshot, ids) => {
      workData = stageLegacyClientWorkDataInTransaction(db, binding, jobCreatedAt, snapshot, ids, allocate, () => checkpoint("after-work-data"));
      afterWorkData?.(snapshot, ids);
    });
    return { ...clients, ...workData!, status: "work-data-rehearsal-staged" as const };
  }
  function stageClientWorkData(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit") => void = () => undefined) {
    return stageClientWorkDataWithExercises(source, questionnaire, allocate, checkpoint);
  }
  function stageClientExerciseCatalogWithPlans(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" | ExerciseStageCheckpoint) => void = () => undefined,
    afterExercises?: (snapshot: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap) => void) {
    if (!exercisesEnabled) throw new Error("R04_ID_LEDGER_EXERCISE_NOT_ENABLED");
    if (plansEnabled !== (afterExercises !== undefined)) throw new Error("R04_ID_LEDGER_PLANS_MODE_MISMATCH");
    const catalogSnapshot = structuredClone(catalog), refsSnapshot = structuredClone(refs);
    let exercises: ReturnType<typeof stageLegacyExerciseCatalogInTransaction> | null = null;
    const clients = stageClientWorkDataWithExercises(source, questionnaire, allocate, checkpoint, (snapshot, ids) => {
      exercises = stageLegacyExerciseCatalogInTransaction(db, binding, snapshot, ids, catalogSnapshot, refsSnapshot, allocate, checkpoint);
      afterExercises?.(snapshot, ids);
    });
    return { ...clients, ...exercises!, status: "exercise-registry-rehearsal-staged" as const };
  }
  function stageClientExerciseCatalog(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" | ExerciseStageCheckpoint) => void = () => undefined) {
    return stageClientExerciseCatalogWithPlans(source, questionnaire, catalog, refs, allocate, checkpoint);
  }
  function stageClientPlansWithExecutions(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource,
    allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" | ExerciseStageCheckpoint | PlanStageCheckpoint) => void = () => undefined,
    afterPlans?: (snapshot: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap, plansSnapshot: LegacyPlansSource) => void) {
    if (!plansEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_PLANS_NOT_ENABLED");
    if (executionsEnabled !== (afterPlans !== undefined)) throw new Error("R04_ID_LEDGER_EXECUTION_MODE_MISMATCH");
    const plansSnapshot = structuredClone(plans);
    let planRows: ReturnType<typeof stageLegacyPlansInTransaction> | null = null;
    const clients = stageClientExerciseCatalogWithPlans(source, questionnaire, catalog, refs, allocate, checkpoint, (snapshot, ids) => {
      planRows = stageLegacyPlansInTransaction(db, binding, jobCreatedAt, snapshot, ids, plansSnapshot, allocate, checkpoint, templatesEnabled, archivesEnabled);
      afterPlans?.(snapshot, ids, plansSnapshot);
    });
    return { ...clients, ...planRows!, status: "training-plans-rehearsal-staged" as const };
  }
  function stageClientPlans(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource,
    allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" | ExerciseStageCheckpoint | PlanStageCheckpoint) => void = () => undefined) {
    return stageClientPlansWithExecutions(source, questionnaire, catalog, refs, plans, allocate, checkpoint);
  }
  function stageClientExecutionsWithMeasurements(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" | ExerciseStageCheckpoint | PlanStageCheckpoint | ExecutionStageCheckpoint) => void = () => undefined,
    afterExecutions?: (snapshot: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap) => void) {
    if (!executionsEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_EXECUTION_NOT_ENABLED");
    if (measurementsEnabled !== (afterExecutions !== undefined)) throw new Error("R04_ID_LEDGER_MEASUREMENTS_MODE_MISMATCH");
    const frozen = structuredClone(executions); let rows: ReturnType<typeof stageLegacyExecutionsInTransaction> | null = null;
    const result = stageClientPlansWithExecutions(source, questionnaire, catalog, refs, plans, allocate, checkpoint, (snapshot, ids, planSnapshot) => {
      rows = stageLegacyExecutionsInTransaction(db, binding, jobCreatedAt, snapshot, ids, planSnapshot, frozen, allocate, checkpoint);
      afterExecutions?.(snapshot, ids);
    });
    return { ...result, ...rows!, status: "training-executions-rehearsal-staged" as const };
  }
  function stageClientExecutions(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" | ExerciseStageCheckpoint | PlanStageCheckpoint | ExecutionStageCheckpoint) => void = () => undefined) {
    return stageClientExecutionsWithMeasurements(source, questionnaire, catalog, refs, plans, executions, allocate, checkpoint);
  }
  function stageClientMeasurementsWithNutrition(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    measurements: LegacyMeasurementsSnapshot, allocate: () => string = randomUUID,
    checkpoint: (stage: FullStageCheckpoint) => void = () => undefined,
    afterMeasurements?: (snapshot: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap) => void) {
    if (!measurementsEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_MEASUREMENTS_NOT_ENABLED");
    if (nutritionEnabled !== (afterMeasurements !== undefined)) throw new Error("R04_ID_LEDGER_NUTRITION_MODE_MISMATCH");
    const frozen = structuredClone(measurements); let rows: ReturnType<typeof stageLegacyMeasurementsInTransaction> | null = null;
    const result = stageClientExecutionsWithMeasurements(source, questionnaire, catalog, refs, plans, executions, allocate, checkpoint, (snapshot, ids) => {
      rows = stageLegacyMeasurementsInTransaction(db, binding, jobCreatedAt, measurementDay, snapshot, ids, frozen, allocate, checkpoint);
      afterMeasurements?.(snapshot, ids);
    });
    return { ...result, ...rows!, status: "measurements-rehearsal-staged" as const };
  }
  function stageClientMeasurements(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    measurements: LegacyMeasurementsSnapshot, allocate: () => string = randomUUID, checkpoint: (stage: FullStageCheckpoint) => void = () => undefined) {
    return stageClientMeasurementsWithNutrition(source, questionnaire, catalog, refs, plans, executions, measurements, allocate, checkpoint);
  }
  function stageClientNutrition(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    measurements: LegacyMeasurementsSnapshot, nutrition: LegacyNutritionSource, allocate: () => string = randomUUID, checkpoint: (stage: FullStageCheckpoint) => void = () => undefined) {
    if (!nutritionEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_NUTRITION_NOT_ENABLED");
    const frozen = structuredClone(nutrition); let rows: ReturnType<typeof stageLegacyNutritionInTransaction> | null = null;
    const result = stageClientMeasurementsWithNutrition(source, questionnaire, catalog, refs, plans, executions, measurements, allocate, checkpoint, (snapshot, ids) => {
      rows = stageLegacyNutritionInTransaction(db, binding, jobCreatedAt, snapshot, ids, frozen, allocate, checkpoint);
    });
    return { ...result, ...rows!, status: "nutrition-rehearsal-staged" as const };
  }
  function loadExerciseDraftIds(): ReadonlyMap<string, string> {
    if (!exercisesEnabled) throw new Error("R04_ID_LEDGER_EXERCISE_NOT_ENABLED");
    if (inspect() !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
    const rows = db.prepare("SELECT * FROM r04_exercise_ids ORDER BY source_key").all();
    const result = new Map<string, string>();
    for (const row of rows) {
      let raw: unknown;
      try { raw = JSON.parse(row.source_payload_json as string) as unknown; } catch { throw new Error("R04_ID_LEDGER_EXERCISE_IDENTITY_MISMATCH"); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("R04_ID_LEDGER_EXERCISE_IDENTITY_MISMATCH");
      const projected = projectLegacyExerciseCatalogRow(binding.accountScope, raw as Record<string, unknown>);
      const prefix = projected.origin === "CUSTOM" ? "usr:" : "sys:legacy-v2:";
      if (projected.issues.length > 0 || row.source_key !== projected.sourceIdentityKey || typeof row.target_id !== "string"
        || !row.target_id.startsWith(prefix) || !uuid.test(row.target_id.slice(prefix.length))) throw new Error("R04_ID_LEDGER_EXERCISE_IDENTITY_MISMATCH");
      result.set(row.source_key, row.target_id);
    }
    return result;
  }
  function loadPlanDraftMappings() {
    if (!plansEnabled) throw new Error("R04_ID_LEDGER_PLANS_NOT_ENABLED");
    if (inspect() !== "owned") throw new Error("R04_ID_LEDGER_CORRUPT");
    return loadStagedPlanMappings(db, templatesEnabled);
  }
  function loadExecutionDraftFacts() {
    if (!executionsEnabled || inspect() !== "owned") throw new Error("R04_ID_LEDGER_EXECUTION_NOT_ENABLED");
    loadStagedPlanMappings(db, true); return loadStagedExecutionFacts(db);
  }
  function loadExecutionDraftContexts() {
    loadExecutionDraftFacts(); return db.prepare("SELECT * FROM r04_execution_contexts ORDER BY source_key").all();
  }
  function loadMeasurementDraftFacts() {
    if (!measurementsEnabled || inspect() !== "owned") throw new Error("R04_ID_LEDGER_MEASUREMENTS_NOT_ENABLED");
    loadExecutionDraftFacts(); return loadStagedMeasurements(db);
  }
  function loadNutritionDraftEntries() {
    if (!nutritionEnabled || inspect() !== "owned") throw new Error("R04_ID_LEDGER_NUTRITION_NOT_ENABLED");
    loadMeasurementDraftFacts(); return loadStagedNutrition(db);
  }
  return { reserveClientIds, loadClientDraftIds, loadExerciseDraftIds, loadPlanDraftMappings, loadExecutionDraftFacts, loadExecutionDraftContexts, loadMeasurementDraftFacts, loadNutritionDraftEntries, stageClientIdentities, stageClientCards, stageClientProfiles, stageClientQuestionnaires, stageClientWorkData, stageClientExerciseCatalog, stageClientPlans, stageClientExecutions, stageClientMeasurements, stageClientNutrition };
}
