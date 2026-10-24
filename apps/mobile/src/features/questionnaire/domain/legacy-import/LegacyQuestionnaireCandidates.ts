import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import type { LegacyQuestionnaireSource } from "../../../../shared/migration/LegacyProfileSources.ts";
import { projectLegacyQuestionnaireSchema, projectLegacyQuestionnaireAnswer,
  type QuestionnaireProjection } from "./LegacyQuestionnaireProjection.ts";

type SourceRow = Readonly<Record<string, unknown>>;
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function parse(raw: unknown): unknown {
  if (typeof raw !== "string") throw new Error("R04_QUESTIONNAIRE_JSON_INVALID");
  try { return JSON.parse(raw) as unknown; } catch { throw new Error("R04_QUESTIONNAIRE_JSON_INVALID"); }
}
function code(error: unknown): string {
  return error instanceof Error && /^R04_QUESTIONNAIRE_[A-Z_]+$/u.test(error.message)
    ? error.message : "R04_QUESTIONNAIRE_PROJECTION_FAILED";
}
export interface QuestionnaireRevisionCandidate {
  readonly sourceKey: string;
  readonly raw: SourceRow;
  readonly projection: QuestionnaireProjection | null;
  readonly issues: readonly string[];
}
export interface QuestionnaireAnswerCandidate {
  readonly sourceKey: string;
  readonly raw: SourceRow;
  readonly projection: ReturnType<typeof projectLegacyQuestionnaireAnswer> | null;
  readonly issues: readonly string[];
}

/** Preserves all rows/versions, including deleted answers; does not choose a new active template. */
export function projectLegacyQuestionnaire(source: LegacyQuestionnaireSource) {
  const { accountScope } = source;
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const clients = new Map<string, string>();
  for (const row of source.owners) {
    const id = text(row.id), workspace = text(row.workspace_id);
    if (id === null || workspace === null || clients.has(id)) throw new Error("R04_QUESTIONNAIRE_OWNER_IDENTITY_INVALID");
    clients.set(id, workspace);
  }
  const revisions: QuestionnaireRevisionCandidate[] = [], byId = new Map<string, QuestionnaireRevisionCandidate>();
  const byVersion = new Map<string, QuestionnaireRevisionCandidate[]>();
  for (const raw of source.revisions) {
    const id = text(raw.id), workspace = text(raw.workspace_id);
    if (id === null || workspace === null || byId.has(id)) throw new Error("R04_QUESTIONNAIRE_REVISION_IDENTITY_INVALID");
    const issues: string[] = [];
    if (typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 1) issues.push("R04_QUESTIONNAIRE_REVISION_INVALID");
    if (raw.status !== "draft" && raw.status !== "published") issues.push("R04_QUESTIONNAIRE_STATUS_INVALID");
    if (!isExplicitTimestamp(raw.created_at) || raw.status === "published" && !isExplicitTimestamp(raw.published_at)) issues.push("R04_QUESTIONNAIRE_TIMESTAMP_INVALID");
    let projection: QuestionnaireProjection | null = null;
    try { projection = projectLegacyQuestionnaireSchema(accountScope, workspace, parse(raw.schema_json)); }
    catch (error) { issues.push(code(error)); }
    const candidate = { sourceKey: JSON.stringify([accountScope, "questionnaire_revisions", id]), raw, projection, issues };
    revisions.push(candidate); byId.set(id, candidate);
    const key = JSON.stringify([workspace, raw.revision]);
    const group = byVersion.get(key) ?? []; group.push(candidate); byVersion.set(key, group);
  }
  const templates: { readonly raw: SourceRow; readonly issues: readonly string[] }[] = [];
  const templateWorkspaces = new Set<string>();
  for (const raw of source.templates) {
    const workspace = text(raw.workspace_id);
    if (workspace === null || templateWorkspaces.has(workspace)) throw new Error("R04_QUESTIONNAIRE_TEMPLATE_IDENTITY_INVALID");
    templateWorkspaces.add(workspace);
    const issues: string[] = [];
    if (!isExplicitTimestamp(raw.updated_at)) issues.push("R04_QUESTIONNAIRE_TIMESTAMP_INVALID");
    for (const [column, status] of [["draft_revision_id", "draft"], ["published_revision_id", "published"]] as const) {
      const ref = text(raw[column]), revision = ref === null ? undefined : byId.get(ref);
      if (!revision || revision.raw.workspace_id !== workspace || revision.raw.status !== status) issues.push("R04_QUESTIONNAIRE_TEMPLATE_REFERENCE_INVALID");
    }
    templates.push({ raw, issues });
  }
  const answers: QuestionnaireAnswerCandidate[] = [], seenAnswers = new Set<string>();
  for (const raw of source.answers) {
    const clientId = text(raw.client_id), questionId = text(raw.question_id);
    if (clientId === null || questionId === null) throw new Error("R04_QUESTIONNAIRE_ANSWER_IDENTITY_INVALID");
    const sourceKey = JSON.stringify([accountScope, "client_questionnaire_answers", clientId, questionId]);
    if (seenAnswers.has(sourceKey)) throw new Error("R04_QUESTIONNAIRE_ANSWER_IDENTITY_INVALID");
    seenAnswers.add(sourceKey);
    const issues: string[] = [], workspace = clients.get(clientId);
    if (!isExplicitTimestamp(raw.updated_at) || raw.deleted_at !== null && !isExplicitTimestamp(raw.deleted_at)) issues.push("R04_QUESTIONNAIRE_TIMESTAMP_INVALID");
    let projection: ReturnType<typeof projectLegacyQuestionnaireAnswer> | null = null;
    if (workspace === undefined) issues.push("R04_QUESTIONNAIRE_ANSWER_OWNER_MISSING");
    const matches = workspace === undefined ? [] : byVersion.get(JSON.stringify([workspace, raw.template_revision])) ?? [];
    const revision = matches.length === 1 ? matches[0]! : undefined;
    if (!revision || revision.raw.status !== "published" || revision.issues.length > 0 || revision.projection === null) {
      issues.push("R04_QUESTIONNAIRE_ANSWER_REVISION_UNRESOLVED");
    } else {
      try { projection = projectLegacyQuestionnaireAnswer(revision.projection, questionId, parse(raw.value_json)); }
      catch (error) { issues.push(code(error)); }
    }
    answers.push({ sourceKey, raw, projection, issues });
  }
  const changes = source.changes;
  return { accountScope, templates, revisions, answers, changes };
}

export function summarizeLegacyQuestionnaire(source: ReturnType<typeof projectLegacyQuestionnaire>) {
  return {
    status: "requires-mapping" as const, templateRows: source.templates.length,
    revisionRows: source.revisions.length, answerRows: source.answers.length,
    changeRows: source.changes?.length ?? null,
    templatesRequiringReview: source.templates.filter((row) => row.issues.length > 0).length,
    revisionsRequiringReview: source.revisions.filter((row) => row.issues.length > 0).length,
    answersRequiringReview: source.answers.filter((row) => row.issues.length > 0).length,
    projectedAnswerCandidates: source.answers.filter((row) => row.projection !== null).length,
    deletedAnswerRows: source.answers.filter((row) => row.raw.deleted_at !== null).length,
    targetWrites: 0 as const,
  };
}
