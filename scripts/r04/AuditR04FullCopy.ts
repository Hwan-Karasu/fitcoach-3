import { DatabaseSync } from "node:sqlite";
import { inspectLegacyBackup } from "../r02/LegacyBackupInspector.ts";
import { summarizeArchiveSource, type ArchiveSourcePreflightReport } from "./ArchiveSourcePreflightReport.ts";
import { summarizeLegacyArchiveSets } from "./LegacyArchiveSetInventory.ts";
import { readLegacyFactLedgerInSnapshot, summarizeLegacyFactLedger } from "./LegacyFactLedger.ts";
import { summarizeLegacyQuestionnaire } from "./LegacyQuestionnaireSourceReader.ts";
import { projectLegacyMeasurementInputs, summarizeLegacyMeasurementProjection } from "./LegacyMeasurementProjection.ts";
import { summarizeCalendarSource, type CalendarSourcePreflightReport } from "./CalendarSourcePreflightReport.ts";
import { summarizeClientDaySource, type ClientDaySourcePreflightReport } from "./ClientDaySourcePreflightReport.ts";
import { summarizeLegacyClientIdentity,
  type ClientIdentityPreflightReport } from "./LegacyClientIdentitySourceReader.ts";
import { summarizeLegacyClientCards } from "./LegacyClientCardProjection.ts";
import { inventoryLegacyClientReferencesInSnapshot,
  type LegacyClientReferenceInventory } from "./LegacyClientReferenceInventory.ts";
import { triangulateUnpairedCompletedCurrentSets,
  type CurrentHistoryTriangulationReport } from "./CurrentHistoryTriangulation.ts";
import { summarizeCurrentSetLinks, type CurrentSetLinkPreflightReport } from "./CurrentSetLinkPreflightReport.ts";
import { summarizeHistoryLinks, type HistoryLinkPreflightReport } from "./HistoryLinkPreflightReport.ts";
import { readLegacyEvidenceInSnapshot } from "./LegacyEvidenceReader.ts";
import { summarizeMeasurementSource, type MeasurementSourcePreflightReport } from "./MeasurementSourcePreflightReport.ts";
import { buildMeasurementValueCandidates, summarizeMeasurementValueCandidates,
  type MeasurementCandidateSummary } from "./MeasurementValueCandidates.ts";
import { buildDailyWeightCandidates, reconcileLegacyWeightSources,
  type WeightSourceReconciliationReport } from "./LegacyWeightSourceReconciliation.ts";
import { summarizeNutritionSource, type NutritionSourcePreflightReport } from "./NutritionSourcePreflightReport.ts";
import { summarizeNutritionEntryIdentity, type NutritionEntryIdentityReport } from "./NutritionEntryIdentityReport.ts";
import { summarizeProgramBooks, type ProgramBookPreflightReport } from "./ProgramBookPreflightReport.ts";
import { preflightProgramLinksInSnapshot,
  type ProgramLinkPreflightReport } from "./ProgramLinkPreflight.ts";
import { readSessionProgramLinkCandidatesInSnapshot,
  summarizeSessionProgramLinkCandidates,
  type SessionProgramLinkCandidateSummary } from "./SessionProgramLinkCandidates.ts";
import { triangulateSessionWorkoutOriginsInSnapshot,
  type SessionWorkoutOriginReport } from "./SessionWorkoutOriginTriangulation.ts";
import { auditLegacyTableCoverage, observedBuild120Tables,
  type CoverageRegistry, type LegacyTableCoverage } from "./LegacyTableCoverage.ts";
import { summarizeSourceFactPreflight, type SourceFactPreflightReport } from "./SourceFactPreflightReport.ts";
import { summarizeLegacySetMetrics, type LegacySetMetricReport } from "./LegacySetMetricCandidates.ts";
import { summarizeLegacyExercises } from "./LegacyExerciseReferencePreflight.ts";
import { summarizeLegacyProgramStructure } from "./LegacyProgramStructureSourceReader.ts";

export type R04FullReport = Readonly<{
  status: "requires-semantic-review";
  coverage: LegacyTableCoverage;
  sourceFacts: SourceFactPreflightReport;
  setMetrics: LegacySetMetricReport;
  exercises: ReturnType<typeof summarizeLegacyExercises> | null;
  programBooks: ProgramBookPreflightReport;
  programStructure: ReturnType<typeof summarizeLegacyProgramStructure>;
  programLinks: ProgramLinkPreflightReport;
  sessionProgramCandidates: SessionProgramLinkCandidateSummary;
  sessionWorkoutOrigin: SessionWorkoutOriginReport;
  history: HistoryLinkPreflightReport;
  currentSets: CurrentSetLinkPreflightReport;
  currentHistoryTriangulation: CurrentHistoryTriangulationReport | null;
  archives: ArchiveSourcePreflightReport | null;
  archiveSets: ReturnType<typeof summarizeLegacyArchiveSets> | null;
  factLedger: ReturnType<typeof summarizeLegacyFactLedger>;
  questionnaire: ReturnType<typeof summarizeLegacyQuestionnaire> | null;
  nutritionDays: NutritionSourcePreflightReport | null;
  nutritionEntryIdentity: NutritionEntryIdentityReport | null;
  measurements: MeasurementSourcePreflightReport | null;
  measurementValueCandidates: MeasurementCandidateSummary | null;
  measurementProjection: ReturnType<typeof summarizeLegacyMeasurementProjection> | null;
  calendar: CalendarSourcePreflightReport | null;
  clientDays: ClientDaySourcePreflightReport | null;
  clientIdentity: ClientIdentityPreflightReport | null;
  clientCards: ReturnType<typeof summarizeLegacyClientCards> | null;
  clientReferences: LegacyClientReferenceInventory;
  weightSources: WeightSourceReconciliationReport | null;
}> | Readonly<{ status: "blocked"; reasons: readonly string[] }>;

/** One immutable SQLite view for source gate, table coverage, sets and history. */
export function auditR04FullCopy(
  path: string, registry: CoverageRegistry = observedBuild120Tables,
): R04FullReport {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    db.exec("BEGIN");
    const source = inspectLegacyBackup(db);
    if (source.status !== "candidate") return { status: "blocked", reasons: source.reasons };
    const binding = db.prepare("SELECT scope_key FROM account_database_binding").get() as
      { scope_key: string } | undefined;
    if (!binding?.scope_key?.trim()) return { status: "blocked", reasons: ["R04_ACCOUNT_SCOPE_REQUIRED"] };
    const coverage = auditLegacyTableCoverage(db, registry, binding.scope_key);
    if (coverage.status !== "requires-mapping") {
      return { status: "blocked", reasons: [coverage.status === "blocked-source-shape"
        ? "R04_SOURCE_COVERAGE_SHAPE_BLOCKED" : "R04_SOURCE_COVERAGE_IDENTITY_BLOCKED"] };
    }
    const clientReferences = inventoryLegacyClientReferencesInSnapshot(db, binding.scope_key);
    const evidence = readLegacyEvidenceInSnapshot(db, binding.scope_key);
    const currentSets = evidence.currentSets === null
      ? { status: "not-observed-in-source" as const, targetWrites: 0 as const }
      : summarizeCurrentSetLinks(evidence.currentSets, evidence.sets);
    const currentHistoryTriangulation = evidence.currentSets === null ? null
      : triangulateUnpairedCompletedCurrentSets(evidence.currentSets, evidence.sets,
        evidence.history, evidence.workoutSnapshots);
    if (currentSets.status === "requires-semantic-review"
      && currentSets.stateByLink.noSameClientSessionSet.completedOnly
        !== currentHistoryTriangulation?.candidateRows) {
      throw new Error("R04_CURRENT_HISTORY_TRIANGULATION_INCOMPLETE");
    }
    const programLinks = preflightProgramLinksInSnapshot(db, binding.scope_key,
      evidence.programBooks, evidence.sets);
    const sessionProgramLedger = readSessionProgramLinkCandidatesInSnapshot(
      db, binding.scope_key, evidence.programBooks);
    const sessionProgramCandidates = summarizeSessionProgramLinkCandidates(sessionProgramLedger);
    const sessionWorkoutOrigin = triangulateSessionWorkoutOriginsInSnapshot(
      db, binding.scope_key, sessionProgramLedger, evidence.programBooks).report;
    if (sessionProgramCandidates.physicalSessions !== programLinks.physicalSessionRows
      || sessionProgramCandidates.directSameClient !== programLinks.sessionDirectSameClientRows
      || sessionProgramCandidates.directOtherClient !== programLinks.sessionDirectOtherClientRows
      || sessionProgramCandidates.bookSameClientHints !== programLinks.sessionBookSameClientHints
      || sessionProgramCandidates.bookOtherClientHints !== programLinks.sessionBookOtherClientHints
      || sessionProgramCandidates.unresolvedKeys !== programLinks.sessionUnresolvedKeys) {
      throw new Error("R04_SESSION_PROGRAM_RECONCILIATION_INCOMPLETE");
    }
    if (sessionWorkoutOrigin.physicalSessions !== sessionProgramCandidates.physicalSessions
      || sessionWorkoutOrigin.problemProgramLinkRows
        !== sessionProgramCandidates.physicalSessions - sessionProgramCandidates.directSameClient) {
      throw new Error("R04_SESSION_WORKOUT_RECONCILIATION_INCOMPLETE");
    }
    return {
      status: "requires-semantic-review",
      coverage,
      factLedger: summarizeLegacyFactLedger(readLegacyFactLedgerInSnapshot(db, binding.scope_key, evidence)),
      questionnaire: evidence.questionnaire === null ? null : summarizeLegacyQuestionnaire(evidence.questionnaire),
      clientReferences,
      sourceFacts: summarizeSourceFactPreflight(evidence.sets),
      setMetrics: summarizeLegacySetMetrics(evidence.sets),
      exercises: evidence.exerciseCatalog === null || evidence.exerciseReferences === null ? null
        : summarizeLegacyExercises(evidence.exerciseCatalog, evidence.exerciseReferences),
      programBooks: summarizeProgramBooks(evidence.programBooks),
      programStructure: summarizeLegacyProgramStructure(evidence.programStructure),
      programLinks,
      sessionProgramCandidates,
      sessionWorkoutOrigin,
      history: summarizeHistoryLinks(evidence.history, evidence.sets),
      currentSets,
      currentHistoryTriangulation,
      archives: evidence.archives === null ? null : summarizeArchiveSource(evidence.archives),
      archiveSets: evidence.archiveSetInventory === null ? null
        : summarizeLegacyArchiveSets(evidence.archiveSetInventory, evidence.sets),
      nutritionDays: evidence.nutritionDays === null ? null
        : summarizeNutritionSource(evidence.nutritionDays),
      nutritionEntryIdentity: evidence.nutritionEntries === null ? null
        : summarizeNutritionEntryIdentity(evidence.nutritionEntries),
      measurements: evidence.measurements === null ? null
        : summarizeMeasurementSource(evidence.measurements),
      measurementValueCandidates: evidence.measurements === null ? null
        : summarizeMeasurementValueCandidates(buildMeasurementValueCandidates(evidence.measurements)),
      measurementProjection: evidence.measurements === null ? null
        : summarizeLegacyMeasurementProjection(projectLegacyMeasurementInputs(evidence.measurements, new Date())),
      calendar: evidence.calendar === null ? null
        : summarizeCalendarSource(evidence.calendar),
      clientDays: evidence.clientDays === null ? null
        : summarizeClientDaySource(evidence.clientDays),
      clientIdentity: evidence.clientIdentity === null ? null
        : summarizeLegacyClientIdentity(evidence.clientIdentity),
      clientCards: evidence.clientCards === null ? null : summarizeLegacyClientCards(evidence.clientCards),
      weightSources: evidence.clientDays === null || evidence.profileWeights === null ? null
        : reconcileLegacyWeightSources(evidence.profileWeights,
          buildDailyWeightCandidates(evidence.clientDays)),
    };
  } catch (error) {
    const code = error instanceof Error && /^R04_[A-Z_]+$/u.test(error.message)
      ? error.message : "R04_FULL_AUDIT_FAILED";
    return { status: "blocked", reasons: [code] };
  } finally {
    try { if (db?.isTransaction) db.exec("ROLLBACK"); } catch { /* No source details. */ }
    try { db?.close(); } catch { /* No source details. */ }
  }
}
