import type { Answers, QuestionField, QuestionnaireSchema, QuestionSection, QuestionType } from "../QuestionnaireModel.ts";
import { allFields, validateSchema } from "../QuestionnaireRules.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import { legacyProfileQuestionnaireSchema } from "./LegacyClientProfileProjection.ts";
import { legacyQuestionnaireId, projectLegacyQuestionnaireAnswer, projectLegacyQuestionnaireSchema, type QuestionnaireProjection } from "./LegacyQuestionnaireProjection.ts";
import type { projectLegacyQuestionnaire } from "./LegacyQuestionnaireCandidates.ts";
import type { CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";

export type LegacyQuestionnaireSource = NonNullable<ReturnType<typeof projectLegacyQuestionnaire>>;
export interface ProfileAnswerSource {
  readonly sourceClientId: string; readonly targetClientId: string; readonly answers: Answers; readonly updatedAt: string;
}
export interface QuestionnaireVersionRow {
  readonly workspace_id: string; readonly version: number; readonly format_version: 1;
  readonly schema_json: string; readonly base_version: number | null; readonly published_at: string;
}
export interface QuestionnaireAnswerRow {
  readonly workspace_id: string; readonly client_id: string; readonly field_id: string;
  readonly value_json: string; readonly schema_version: number; readonly updated_at: string;
}
interface Revision {
  readonly id: string; readonly version: number; readonly status: "draft" | "published";
  readonly publishedAt: string | null; readonly schema: Record<string, unknown>;
  readonly projection: QuestionnaireProjection; readonly composed: QuestionnaireSchema;
}
function fail(code: string): never { throw new Error(`R04_ID_LEDGER_QUESTIONNAIRE_${code}`); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID");
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) return fail("INVALID"); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return fail("INVALID"); return value; }
function json(value: unknown): unknown { try { return JSON.parse(text(value)) as unknown; } catch { return fail("INVALID_JSON"); } }
function family(type: QuestionType): string { return type === "SHORT_TEXT" || type === "LONG_TEXT" ? "TEXT" : type; }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Preserve wrapper metadata/order by explicit legacySectionId, never by the section's label.
 * Missing legacy profile wrappers stay hidden; existing answers are still retained. */
function composeSchema(context: CandidateIdentityContext, raw: Record<string, unknown>, projection: QuestionnaireProjection): QuestionnaireSchema {
  const sourceWorkspaceId = context.sourceWorkspaceId;
  if (sourceWorkspaceId === null) return fail("SCOPE_MISMATCH");
  const base = legacyProfileQuestionnaireSchema();
  const extras = base.sections.find((section) => section.id === "legacy:profile:additional")!.fields;
  const systems = new Map(base.sections.filter((s) => s.origin === "SYSTEM").map((s) => [s.id, { ...s, fields: [...s.fields,
    ...extras.filter((f) => s.id === "sys:goals" ? f.id.endsWith(":successCriteriaOther") : s.id === "sys:lifestyle" && f.id.endsWith(":gymAccess"))] }]));
  const customs = new Map(projection.schema.sections.map((s) => [s.id, s]));
  const used = new Set<string>(); const sections: QuestionSection[] = [];
  for (const item of raw.sections as unknown[]) {
    const source = record(item); const sourceId = text(source.id);
    const id = legacyQuestionnaireId([context.accountScope, sourceWorkspaceId, "section", sourceId]);
    const custom = customs.get(id);
    if (source.legacySectionId === "billing" || source.legacySectionId === "notes") continue;
    const systemId = typeof source.legacySectionId === "string" ? `sys:${source.legacySectionId}` : "";
    const system = systems.get(systemId);
    if (system) {
      if (used.has(systemId)) return fail("WRAPPER_AMBIGUOUS"); used.add(systemId);
      sections.push({ ...system, title: text(source.title), help: typeof source.description === "string" ? source.description : null,
        hidden: source.hidden as boolean, fields: [...system.fields, ...(custom?.fields ?? [])] });
    } else {
      sections.push(custom ?? { id, origin: "CUSTOM", title: text(source.title), help: typeof source.description === "string" ? source.description : null,
        hidden: source.hidden as boolean, fields: [] });
    }
  }
  for (const [id, section] of systems) if (!used.has(id)) sections.push({ ...section, hidden: true });
  const result: QuestionnaireSchema = { formatVersion: 1, sections };
  if (validateSchema(result).length > 0) return fail("TARGET_SCHEMA_INVALID");
  return result;
}

/** Only the migration publication/draft get retention additions. Historical source
 * publications stay exact converted views; future/current answers do not rewrite them. */
function retainAnswered(schema: QuestionnaireSchema, answers: readonly QuestionnaireAnswerRow[], history: readonly Revision[]): QuestionnaireSchema {
  const fields = new Map<string, { field: QuestionField; section: QuestionSection }>();
  for (const revision of history) for (const item of allFields(revision.composed)) fields.set(item.field.id, item);
  const sections = schema.sections.map((s) => ({ ...s, fields: [...s.fields] }));
  const needed = new Set(answers.map((a) => a.field_id));
  for (const id of [...needed].sort(compare)) {
    const saved = fields.get(id); if (!saved) return fail("ANSWER_FIELD_MISSING");
    let section = sections.find((s) => s.fields.some((f) => f.id === id));
    if (!section) {
      section = sections.find((s) => s.id === saved.section.id);
      if (!section) { section = { ...saved.section, fields: [] }; sections.push(section); }
      section.fields.push({ ...saved.field, retired: true, required: false, visibleIf: null });
    }
    const index = section.fields.findIndex((f) => f.id === id); const current = section.fields[index]!;
    if (current.type !== "SINGLE_CHOICE" && current.type !== "MULTI_CHOICE") continue;
    const used = new Set(answers.filter((a) => a.field_id === id).flatMap((a) => {
      const value = JSON.parse(a.value_json) as unknown; return Array.isArray(value) ? value as string[] : typeof value === "string" ? [value] : [];
    }));
    const options = [...current.options];
    for (const optionId of [...used].sort(compare)) if (!options.some((o) => o.id === optionId)) {
      let old: QuestionField["options"][number] | undefined;
      for (const revision of history) old = allFields(revision.composed).find((f) => f.field.id === id)?.field.options.find((o) => o.id === optionId) ?? old;
      if (!old) return fail("ANSWER_OPTION_MISSING");
      options.push({ ...old, retired: true });
    }
    section.fields[index] = { ...current, options };
  }
  const result: QuestionnaireSchema = { formatVersion: 1, sections };
  if (validateSchema(result).length > 0) return fail("TARGET_SCHEMA_INVALID");
  return result;
}

/** Pure, exact source→target plan. Numbered legacy publications keep their numbers and
 * dates; a NEW migration publication reconciles retained answers and profile fields.
 * Source draft is never promoted to published. No source normalizer or latest fallback. */
export function composeLegacyQuestionnaires(context: CandidateIdentityContext, createdAt: string,
  profiles: readonly ProfileAnswerSource[], source: LegacyQuestionnaireSource) {
  const sourceWorkspaceId = context.sourceWorkspaceId;
  if (sourceWorkspaceId === null) return fail("SCOPE_MISMATCH");
  if (source.accountScope !== context.accountScope || source.templates.length !== 1 || !isExplicitTimestamp(createdAt)) return fail("SCOPE_MISMATCH");
  const changes = source.changes === null ? null : [...source.changes].sort((a, b) => compare(text(a.id), text(b.id)));
  const changeIds = new Set<string>();
  for (const row of changes ?? []) {
    const id = text(row.id);
    if (changeIds.has(id) || Object.hasOwn(row, "workspace_id") && row.workspace_id !== sourceWorkspaceId) return fail("SCOPE_MISMATCH");
    changeIds.add(id);
  }
  const template = source.templates[0]!.raw;
  if (template.workspace_id !== sourceWorkspaceId || !isExplicitTimestamp(template.updated_at)) return fail("SCOPE_MISMATCH");
  const clients = new Map(profiles.map((p) => [p.sourceClientId, p]));
  if (clients.size !== profiles.length) return fail("CLIENT_DUPLICATE");
  const epochs = new Map<string, { family: string; epoch: string | undefined }>();
  const revisionIds = new Set<string>(), revisionNumbers = new Set<number>(); const revisions: Revision[] = [];
  const rawRevisions = [...source.revisions].sort((a, b) => integer(a.raw.revision) - integer(b.raw.revision));
  for (const candidate of rawRevisions) {
    const row = candidate.raw; const id = text(row.id); const version = integer(row.revision);
    if (candidate.sourceKey !== JSON.stringify([context.accountScope, "questionnaire_revisions", id]) || row.workspace_id !== sourceWorkspaceId) return fail("SCOPE_MISMATCH");
    if (revisionIds.has(id) || revisionNumbers.has(version)) return fail("REVISION_AMBIGUOUS"); revisionIds.add(id); revisionNumbers.add(version);
    if (row.status !== "draft" && row.status !== "published" || !isExplicitTimestamp(row.created_at) ||
      (row.status === "published" ? !isExplicitTimestamp(row.published_at) : row.published_at !== null)) return fail("REVISION_INVALID");
    const raw = record(json(row.schema_json));
    let plain: QuestionnaireProjection;
    try { plain = projectLegacyQuestionnaireSchema(context.accountScope, sourceWorkspaceId, raw); } catch { return fail("SCHEMA_INVALID"); }
    for (const [key, field] of plain.fields) {
      const old = epochs.get(key); const currentFamily = family(field.type);
      epochs.set(key, { family: currentFamily, epoch: old && old.family !== currentFamily ? id : old?.epoch });
    }
    const projection = projectLegacyQuestionnaireSchema(context.accountScope, sourceWorkspaceId, raw,
      new Map([...plain.fields.keys()].flatMap((key) => epochs.get(key)?.epoch === undefined ? [] : [[key, epochs.get(key)!.epoch!]])));
    revisions.push({ id, version, status: row.status, publishedAt: row.published_at as string | null, schema: raw, projection,
      composed: composeSchema(context, raw, projection) });
  }
  const published = revisions.filter((r) => r.status === "published"); const drafts = revisions.filter((r) => r.status === "draft");
  const current = published.at(-1); const draft = drafts[0];
  if (!current || !draft || drafts.length !== 1 || current.id !== template.published_revision_id || draft.id !== template.draft_revision_id || draft.version <= current.version ||
    revisions.at(-1) !== draft || current.version >= Number.MAX_SAFE_INTEGER) return fail("TEMPLATE_POINTER_INVALID");
  const migrationVersion = current.version + 1; const answers: QuestionnaireAnswerRow[] = [];
  const answerMaps: { sourceKey: string; targetClientId: string; fieldId: string; schemaVersion: number; disposition: "ANSWER" | "DELETED" | "NULL" }[] = [];
  const answerKeys = new Set<string>();
  for (const candidate of [...source.answers].sort((a, b) => compare(a.sourceKey, b.sourceKey))) {
    const row = candidate.raw; const client = clients.get(text(row.client_id)); const questionId = text(row.question_id);
    const expectedKey = JSON.stringify([context.accountScope, "client_questionnaire_answers", row.client_id, questionId]);
    if (!client || candidate.sourceKey !== expectedKey) return fail("ANSWER_OWNER_MISMATCH");
    if (answerKeys.has(expectedKey)) return fail("ANSWER_DUPLICATE"); answerKeys.add(expectedKey);
    if (!isExplicitTimestamp(row.updated_at) || row.deleted_at !== null && !isExplicitTimestamp(row.deleted_at)) return fail("ANSWER_TIME_INVALID");
    const revision = published.find((r) => r.version === row.template_revision);
    if (!revision) return fail("ANSWER_REVISION_UNRESOLVED");
    let projected: ReturnType<typeof projectLegacyQuestionnaireAnswer>;
    try { projected = projectLegacyQuestionnaireAnswer(revision.projection, questionId, json(row.value_json)); } catch { return fail("ANSWER_INVALID"); }
    const disposition = row.deleted_at !== null ? "DELETED" : projected.value === null ? "NULL" : "ANSWER";
    answerMaps.push({ sourceKey: expectedKey, targetClientId: client.targetClientId, fieldId: projected.fieldId, schemaVersion: revision.version, disposition });
    if (disposition === "ANSWER") answers.push({ workspace_id: context.targetWorkspaceId, client_id: client.targetClientId,
      field_id: projected.fieldId, value_json: JSON.stringify(projected.value), schema_version: revision.version, updated_at: row.updated_at as string });
  }
  // Distinct source question IDs cannot merge to the same active answer key.
  if (new Set(answers.map((a) => JSON.stringify([a.client_id, a.field_id]))).size !== answers.length) return fail("ANSWER_DUPLICATE");
  const currentSchema = retainAnswered(current.composed, answers, published);
  const draftSchema = retainAnswered(draft.composed, answers, [...published, draft]);
  const versions: QuestionnaireVersionRow[] = published.map((r, index) => ({ workspace_id: context.targetWorkspaceId, version: r.version,
    format_version: 1, schema_json: JSON.stringify(r.composed), base_version: published[index - 1]?.version ?? null, published_at: r.publishedAt! }));
  versions.push({ workspace_id: context.targetWorkspaceId, version: migrationVersion, format_version: 1,
    schema_json: JSON.stringify(currentSchema), base_version: current.version, published_at: createdAt });
  for (const profile of profiles) for (const [field, value] of Object.entries(profile.answers)) answers.push({ workspace_id: context.targetWorkspaceId,
    client_id: profile.targetClientId, field_id: field, value_json: JSON.stringify(value), schema_version: migrationVersion, updated_at: profile.updatedAt });
  answers.sort((a, b) => compare(a.client_id, b.client_id) || compare(a.field_id, b.field_id));
  return { versions, drafts: [{ workspace_id: context.targetWorkspaceId, base_version: migrationVersion, revision: 1,
    schema_json: JSON.stringify(draftSchema), updated_at: template.updated_at as string }], answers,
    provenance: { revisionMaps: revisions.map((r) => ({ sourceRevisionId: r.id, sourceRevision: r.version, sourceStatus: r.status,
      targetVersion: r.status === "published" ? r.version : null, targetDraftBase: r.status === "draft" ? migrationVersion : null,
      sectionMaps: (r.schema.sections as unknown[]).map((value) => {
        const section = record(value); const legacy = section.legacySectionId;
        const system = typeof legacy === "string" && ["goals", "health", "lifestyle", "nutrition", "motivation", "extra"].includes(legacy);
        return { sourceSectionId: text(section.id), targetSectionId: legacy === "billing" || legacy === "notes" ? null
          : system ? `sys:${legacy}` : legacyQuestionnaireId([context.accountScope, sourceWorkspaceId, "section", text(section.id)]) };
      }),
      fieldMaps: [...r.projection.fields].sort(([a], [b]) => compare(a, b)).map(([sourceQuestionId, field]) => ({ sourceQuestionId, targetFieldId: field.id,
        options: [...r.projection.legacyOptionIds.get(sourceQuestionId)!].sort(([a], [b]) => compare(a, b)).map(([sourceLabel, targetId]) => ({ sourceLabel, targetId })) })) })),
      answerMaps, migrationVersion, sourceChanges: changes },
    sourceRaw: { accountScope: source.accountScope, templates: source.templates.map((r) => r.raw),
      revisions: rawRevisions.map((r) => r.raw), answers: [...source.answers].sort((a, b) => compare(a.sourceKey, b.sourceKey)).map((r) => r.raw), changes } };
}
