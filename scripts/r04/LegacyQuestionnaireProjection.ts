import { createHash } from "node:crypto";
import type { QuestionField, QuestionSection, QuestionnaireSchema, QuestionType, AnswerValue } from "../../apps/mobile/src/features/questionnaire/domain/QuestionnaireModel.ts";
import { answerProblem, validateSchema } from "../../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";

const types: Readonly<Record<string, QuestionType>> = {
  short_text: "SHORT_TEXT", long_text: "LONG_TEXT", number: "NUMBER", date: "DATE",
  single_choice: "SINGLE_CHOICE", multiple_choice: "MULTI_CHOICE", switch: "SWITCH",
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function nonblank(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
/** Candidate identity is stable across retries, question renames and option reordering. */
export function legacyQuestionnaireId(parts: readonly string[]): string {
  return `legacy:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}
export interface QuestionnaireProjection {
  readonly schema: QuestionnaireSchema;
  readonly fields: ReadonlyMap<string, QuestionField>;
  readonly legacyOptionIds: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** Does not seed defaults or normalize unknown types; caller retains the exact source JSON. */
export function projectLegacyQuestionnaireSchema(
  accountScope: string, workspaceId: string, raw: unknown,
  fieldEpochs: ReadonlyMap<string, string> = new Map(),
): QuestionnaireProjection {
  if (!accountScope.trim() || !workspaceId.trim()) throw new Error("R04_QUESTIONNAIRE_SCOPE_REQUIRED");
  const source = object(raw);
  if (source?.version !== 1 || !Array.isArray(source.sections)) throw new Error("R04_QUESTIONNAIRE_SCHEMA_INVALID");
  const seen = new Set<string>(), fields = new Map<string, QuestionField>();
  const legacyOptionIds = new Map<string, ReadonlyMap<string, string>>();
  const sections: QuestionSection[] = [];
  function unique(kind: string, value: unknown): string {
    if (!nonblank(value) || seen.has(`${kind}:${value}`)) throw new Error("R04_QUESTIONNAIRE_IDENTITY_INVALID");
    seen.add(`${kind}:${value}`); return value;
  }
  for (const sectionRaw of source.sections) {
    const section = object(sectionRaw);
    if (section === null || !nonblank(section.title) || typeof section.hidden !== "boolean"
      || !Array.isArray(section.questions)) throw new Error("R04_QUESTIONNAIRE_SCHEMA_INVALID");
    const sectionId = unique("section", section.id);
    if (section.legacySectionId !== undefined && typeof section.legacySectionId !== "string") throw new Error("R04_QUESTIONNAIRE_SCHEMA_INVALID");
    // Legacy system wrappers are not converted into editable System Client Data/Notes/Tariffs.
    if ((section.legacySectionId === "billing" || section.legacySectionId === "notes") && section.questions.length > 0) {
      throw new Error("R04_QUESTIONNAIRE_PROTECTED_SECTION");
    }
    if (section.description !== undefined && typeof section.description !== "string") throw new Error("R04_QUESTIONNAIRE_SCHEMA_INVALID");
    const projectedFields: QuestionField[] = [];
    for (const questionRaw of section.questions) {
      const question = object(questionRaw);
      if (question === null || !nonblank(question.title) || typeof question.type !== "string"
        || !Object.hasOwn(types, question.type) || typeof question.required !== "boolean"
        || typeof question.hidden !== "boolean" || question.access !== "shared" && question.access !== "trainer_only"
        || !Array.isArray(question.options) || question.options.some((option: unknown) => !nonblank(option))
        || question.description !== undefined && typeof question.description !== "string") {
        throw new Error("R04_QUESTIONNAIRE_SCHEMA_INVALID");
      }
      if (Object.keys(question).some((key) => !["id", "title", "description", "type", "required", "access", "options", "hidden"].includes(key))) {
        throw new Error("R04_QUESTIONNAIRE_UNSUPPORTED_FIELD_PROPERTIES");
      }
      const sourceId = unique("question", question.id), optionIds = new Map<string, string>();
      const epoch = fieldEpochs.get(sourceId); const suffix = epoch === undefined ? [] : ["semantic-epoch", epoch];
      for (const option of question.options as string[]) {
        if (optionIds.has(option)) throw new Error("R04_QUESTIONNAIRE_OPTIONS_AMBIGUOUS");
        optionIds.set(option, legacyQuestionnaireId([accountScope, workspaceId, "option", sourceId, option, ...suffix]));
      }
      const field: QuestionField = {
        id: legacyQuestionnaireId([accountScope, workspaceId, "question", sourceId, ...suffix]), origin: "CUSTOM", semanticKey: null,
        type: types[question.type]!, label: question.title, help: question.description as string | undefined ?? null,
        required: question.required, hidden: question.hidden, retired: false,
        options: [...optionIds].map(([label, optionId]) => ({ id: optionId, label, retired: false })),
        visibleIf: null, constraints: null,
      };
      fields.set(sourceId, field); legacyOptionIds.set(sourceId, optionIds); projectedFields.push(field);
    }
    // Empty legacy wrappers have no questionnaire fields; original metadata remains in source inventory.
    if (projectedFields.length > 0) sections.push({
      id: legacyQuestionnaireId([accountScope, workspaceId, "section", sectionId]), origin: "CUSTOM", title: section.title,
      help: section.description as string | undefined ?? null, hidden: section.hidden, fields: projectedFields,
    });
  }
  const schema: QuestionnaireSchema = { formatVersion: 1, sections };
  if (validateSchema(schema).length > 0) throw new Error("R04_QUESTIONNAIRE_TARGET_SCHEMA_INVALID");
  return { schema, fields, legacyOptionIds };
}

/** Exact type/choice conversion. Null is an explicit empty source answer, not an invented value. */
export function projectLegacyQuestionnaireAnswer(
  projection: QuestionnaireProjection, sourceQuestionId: string, value: unknown,
): { readonly fieldId: string; readonly value: AnswerValue | null } {
  const field = projection.fields.get(sourceQuestionId);
  if (!field) throw new Error("R04_QUESTIONNAIRE_ANSWER_FIELD_UNKNOWN");
  if (value === null) return { fieldId: field.id, value: null };
  let candidate: unknown = value;
  const options = projection.legacyOptionIds.get(sourceQuestionId)!;
  if (field.type === "SINGLE_CHOICE") {
    if (typeof value !== "string" || !options.has(value)) throw new Error("R04_QUESTIONNAIRE_ANSWER_OPTION_UNKNOWN");
    candidate = options.get(value);
  } else if (field.type === "MULTI_CHOICE") {
    if (!Array.isArray(value) || value.some((option: unknown) => typeof option !== "string" || !options.has(option))) {
      throw new Error("R04_QUESTIONNAIRE_ANSWER_OPTION_UNKNOWN");
    }
    // Do not silently discard duplicate source choices.
    if (new Set(value).size !== value.length) throw new Error("R04_QUESTIONNAIRE_OPTIONS_AMBIGUOUS");
    candidate = (value as string[]).map((option) => options.get(option)!);
  }
  if (candidate === undefined || answerProblem(field, candidate, undefined, "1970-01-01") !== null) {
    throw new Error("R04_QUESTIONNAIRE_ANSWER_VALUE_INVALID");
  }
  return { fieldId: field.id, value: candidate as AnswerValue };
}
