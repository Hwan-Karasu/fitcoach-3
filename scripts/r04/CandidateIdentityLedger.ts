import { LEGACY_STAGE_UUID as uuid, legacyIdentityContextJson as contextJson, type CandidateIdentityContext, type LegacyIdentityStageBinding } from "../../apps/mobile/src/shared/migration/LegacyIdentityBinding.ts";
import { legacyInspectIdentityPlan, legacyCreateIdentityPlan, legacyReserveClientIdsPlan, legacyLoadClientIdsPlan, legacyStageClientIdentitiesPlan } from "../../apps/mobile/src/features/clients/data/legacy-import/LegacyClientStagePlan.ts";
import { runNodeLegacyWritePlan } from "./NodeLegacyWritePlan.ts";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ClientDraftIdMap } from "./ProjectClientIdentityDraft.ts";
import type { LegacyClientIdentityCandidate } from "./LegacyClientIdentitySourceReader.ts";
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
import { createNutritionRehearsalSchema, nutritionRehearsalObjects, stageLegacyNutritionInTransaction, loadStagedNutrition, loadStagedNutritionArchives, type NutritionStageCheckpoint } from "./LegacyNutritionStage.ts";
import type { LegacyNutritionSource } from "./LegacyNutritionSourceReader.ts";
import { calendarRehearsalObjects, createCalendarRehearsalSchema, loadStagedCalendar, stageLegacyCalendarInTransaction, type CalendarStageCheckpoint } from "./LegacyCalendarStage.ts";
import type { LegacyCalendarSnapshot } from "./LegacyCalendarSnapshot.ts";

type FullStageCheckpoint = "after-ids" | "after-client" | "after-profile" | "after-work-data" | "before-commit" |
  ExerciseStageCheckpoint | PlanStageCheckpoint | ExecutionStageCheckpoint | MeasurementStageCheckpoint | NutritionStageCheckpoint | CalendarStageCheckpoint;

export type { CandidateIdentityContext } from "../../apps/mobile/src/shared/migration/LegacyIdentityBinding.ts";
/** R04 isolated synthetic staging contract. Never attach this schema to a source or runtime DB. */
export function prepareCandidateIdentityLedger(db: DatabaseSync, context: CandidateIdentityContext,
  options?: { readonly clientIdentityRehearsal: { readonly createdAt: string; readonly profiles?: true; readonly questionnaires?: true; readonly workData?: true; readonly exercises?: true; readonly plans?: true; readonly templates?: true; readonly archives?: true; readonly executions?: true; readonly measurements?: { readonly referenceDay: string }; readonly nutrition?: true; readonly calendar?: true } }) {
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
  const calendarEnabled = options?.clientIdentityRehearsal.calendar === true;
  if (questionnairesEnabled && !profilesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (workDataEnabled && !questionnairesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (exercisesEnabled && !workDataEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (plansEnabled && !exercisesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (templatesEnabled && !plansEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (archivesEnabled && !templatesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (executionsEnabled && !archivesEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (options?.clientIdentityRehearsal.measurements !== undefined && (!measurementsEnabled || !isLocalDate(measurementDay) || !executionsEnabled)) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (nutritionEnabled && !measurementsEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (calendarEnabled && !nutritionEnabled) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  if (jobCreatedAt !== undefined && !isExplicitTimestamp(jobCreatedAt)) throw new Error("R04_ID_LEDGER_CONTEXT_INVALID");
  const expectedContext = jobCreatedAt === undefined ? contextJson(binding)
    : JSON.stringify([contextJson(binding), "CLIENT_IDENTITY_REHEARSAL_V1", jobCreatedAt, ...(profilesEnabled ? ["PROFILE_REHEARSAL_V1"] : []),
      ...(questionnairesEnabled ? ["QUESTIONNAIRE_COMPOSITION_V1"] : []), ...(workDataEnabled ? ["WORK_DATA_REHEARSAL_V1"] : []),
      ...(exercisesEnabled ? ["EXERCISE_REGISTRY_REHEARSAL_V1"] : []), ...(plansEnabled ? ["TRAINING_PLANS_REHEARSAL_V1"] : []),
      ...(templatesEnabled ? ["TRAINING_TEMPLATES_REHEARSAL_V1"] : []), ...(archivesEnabled ? ["TRAINING_ARCHIVES_REHEARSAL_V1"] : []),
      ...(executionsEnabled ? ["TRAINING_EXECUTIONS_REHEARSAL_V3"] : []), ...(measurementsEnabled ? ["MEASUREMENTS_REHEARSAL_V2", measurementDay] : []),
      ...(nutritionEnabled ? ["NUTRITION_REHEARSAL_V3"] : []), ...(calendarEnabled ? ["CALENDAR_REHEARSAL_V1"] : [])]);
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
  if (calendarEnabled) Object.assign(expectedObjects, calendarRehearsalObjects);
  const stageBinding: LegacyIdentityStageBinding = { context: binding, contextJson: expectedContext, createdAt: jobCreatedAt, expectedObjects };
  function inspect(): "new" | "owned" { return runNodeLegacyWritePlan(db, legacyInspectIdentityPlan(stageBinding)); }
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
    runNodeLegacyWritePlan(db, legacyCreateIdentityPlan(stageBinding));
    if (jobCreatedAt !== undefined) {
      if (profilesEnabled) createProfileRehearsalSchema(db);
      if (workDataEnabled) createWorkDataRehearsalSchema(db);
      if (exercisesEnabled) createExerciseRehearsalSchema(db);
      if (plansEnabled) createPlansRehearsalSchema(db);
      if (executionsEnabled) createExecutionRehearsalSchema(db);
      if (measurementsEnabled) createMeasurementRehearsalSchema(db);
      if (nutritionEnabled) createNutritionRehearsalSchema(db);
      if (calendarEnabled) createCalendarRehearsalSchema(db);
    }
  });
  function reserveInTransaction(sourceKeys: readonly string[], allocate: () => string): ReadonlyMap<string, string> {
    return runNodeLegacyWritePlan(db, legacyReserveClientIdsPlan(stageBinding, sourceKeys, allocate));
  }
  function reserveClientIds(sourceKeys: readonly string[], allocate: () => string = randomUUID): ReadonlyMap<string, string> {
    return transaction(() => reserveInTransaction(sourceKeys, allocate));
  }
  function loadClientDraftIds(): ClientDraftIdMap { return runNodeLegacyWritePlan(db, legacyLoadClientIdsPlan(stageBinding)); }
  function stageClientIdentities(source: readonly LegacyClientIdentityCandidate[], allocate: () => string = randomUUID,
    checkpoint: (stage: "after-ids" | "after-client" | "before-commit") => void = () => undefined,
    cards?: ReadonlyMap<string, ClientCardFields>, sourcePayloads?: ReadonlyMap<string, string>, afterClients?: () => void) {
    if (jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_REHEARSAL_NOT_ENABLED");
    return transaction(() => runNodeLegacyWritePlan(db, legacyStageClientIdentitiesPlan(stageBinding, source, allocate, cards, sourcePayloads), (phase) => {
      if (phase === "after-clients") afterClients?.();
      else if (phase === "after-profile") throw new Error("R04_ID_LEDGER_UNEXPECTED_CHECKPOINT");
      else checkpoint(phase);
    }));
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
  function stageClientNutritionWithCalendar(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    measurements: LegacyMeasurementsSnapshot, nutrition: LegacyNutritionSource, allocate: () => string = randomUUID, checkpoint: (stage: FullStageCheckpoint) => void = () => undefined,
    afterNutrition?: (snapshot: readonly LegacyClientCardCandidate[], ids: ClientDraftIdMap) => void) {
    if (!nutritionEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_NUTRITION_NOT_ENABLED");
    if (calendarEnabled !== (afterNutrition !== undefined)) throw new Error("R04_ID_LEDGER_CALENDAR_MODE_MISMATCH");
    const frozen = structuredClone(nutrition); let rows: ReturnType<typeof stageLegacyNutritionInTransaction> | null = null;
    const result = stageClientMeasurementsWithNutrition(source, questionnaire, catalog, refs, plans, executions, measurements, allocate, checkpoint, (snapshot, ids) => {
      rows = stageLegacyNutritionInTransaction(db, binding, jobCreatedAt, snapshot, ids, frozen, allocate, checkpoint);
      afterNutrition?.(snapshot, ids);
    });
    return { ...result, ...rows!, status: "nutrition-rehearsal-staged" as const };
  }
  function stageClientNutrition(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    measurements: LegacyMeasurementsSnapshot, nutrition: LegacyNutritionSource, allocate: () => string = randomUUID, checkpoint: (stage: FullStageCheckpoint) => void = () => undefined) {
    return stageClientNutritionWithCalendar(source, questionnaire, catalog, refs, plans, executions, measurements, nutrition, allocate, checkpoint);
  }
  function stageClientCalendar(source: readonly LegacyClientCardCandidate[], questionnaire: LegacyQuestionnaireSource | null,
    catalog: readonly LegacyExerciseCatalogCandidate[], refs: readonly LegacyExerciseReferenceCandidate[], plans: LegacyPlansSource, executions: LegacyExecutionSource,
    measurements: LegacyMeasurementsSnapshot, nutrition: LegacyNutritionSource, calendar: LegacyCalendarSnapshot, allocate: () => string = randomUUID,
    checkpoint: (stage: FullStageCheckpoint) => void = () => undefined) {
    if (!calendarEnabled || jobCreatedAt === undefined) throw new Error("R04_ID_LEDGER_CALENDAR_NOT_ENABLED");
    const frozen = structuredClone(calendar); let rows: ReturnType<typeof stageLegacyCalendarInTransaction> | null = null;
    const result = stageClientNutritionWithCalendar(source, questionnaire, catalog, refs, plans, executions, measurements, nutrition, allocate, checkpoint, (snapshot, ids) => {
      rows = stageLegacyCalendarInTransaction(db, binding, jobCreatedAt, snapshot, ids, frozen, allocate, checkpoint);
    });
    return { ...result, ...rows!, status: "calendar-rehearsal-staged" as const };
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
  function loadNutritionDraftArchiveWeeks(clientId: string) {
    if (!nutritionEnabled || inspect() !== "owned") throw new Error("R04_ID_LEDGER_NUTRITION_NOT_ENABLED");
    loadMeasurementDraftFacts(); return loadStagedNutritionArchives(db, binding.targetWorkspaceId, clientId);
  }
  function loadCalendarDraftAppointments() {
    if (!calendarEnabled || inspect() !== "owned") throw new Error("R04_ID_LEDGER_CALENDAR_NOT_ENABLED");
    loadNutritionDraftEntries(); return loadStagedCalendar(db);
  }
  return { reserveClientIds, loadClientDraftIds, loadExerciseDraftIds, loadPlanDraftMappings, loadExecutionDraftFacts, loadExecutionDraftContexts, loadMeasurementDraftFacts, loadNutritionDraftEntries, loadNutritionDraftArchiveWeeks, loadCalendarDraftAppointments, stageClientIdentities, stageClientCards, stageClientProfiles, stageClientQuestionnaires, stageClientWorkData, stageClientExerciseCatalog, stageClientPlans, stageClientExecutions, stageClientMeasurements, stageClientNutrition, stageClientCalendar };
}
