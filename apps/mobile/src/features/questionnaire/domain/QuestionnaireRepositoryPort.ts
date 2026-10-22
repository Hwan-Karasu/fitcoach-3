import type { AnswerValue, ClientAnswers, CompletionStatus, PublishedQuestionnaire, PublishSummary, QuestionnaireDraft,
  QuestionnaireSchema } from "./QuestionnaireModel.ts";

export interface QuestionnaireCommittedChange {
  readonly scope: "SCHEMA" | "ANSWERS";
  readonly clientId: string | null;
}

/**
 * Questionnaire owner (§§23, 25). Typed failures: QUESTIONNAIRE_DRAFT_STALE, QUESTIONNAIRE_STALE_BASE,
 * QUESTIONNAIRE_SCHEMA_INVALID, QUESTIONNAIRE_NOTHING_TO_PUBLISH, QUESTIONNAIRE_ANSWERED_FIELD_REMOVED,
 * QUESTIONNAIRE_ANSWERED_TYPE_CHANGED, QUESTIONNAIRE_ANSWER_INVALID, QUESTIONNAIRE_VERSION_NOT_FOUND.
 */
/** Запись ответов внутри чужой транзакции (workflow «карточка + анкета»); уведомление — после коммита. Правила те же, что у `saveAnswers`. */
export interface AnswersParticipant<Tx> {
  save(tx: Tx, clientId: string, patch: Readonly<Record<string, AnswerValue | null>>): Promise<ClientAnswers>;
  notify(clientId: string): void;
}

export interface QuestionnaireRepositoryPort {
  getPublished(): Promise<PublishedQuestionnaire>;
  listVersions(): Promise<readonly Readonly<{ version: number; publishedAt: string }>[]>;
  getVersion(version: number): Promise<PublishedQuestionnaire>;
  getDraft(): Promise<QuestionnaireDraft>;
  /** Autosave of the single draft; an older save never overwrites a newer one (CAS on revision). */
  saveDraft(expectedRevision: number, schema: QuestionnaireSchema): Promise<QuestionnaireDraft>;
  previewPublish(): Promise<PublishSummary>;
  /** Atomic: a new immutable version and a clean draft, or nothing changes (§25.5). */
  publishDraft(expectedRevision: number): Promise<PublishedQuestionnaire>;
  /** §25.18.1: the draft becomes the current published structure again. */
  discardDraft(): Promise<QuestionnaireDraft>;
  /** §25.18 / §25.19: a draft from a historical version or the standard schema; publish is still explicit. */
  draftFromVersion(version: number | "DEFAULT"): Promise<QuestionnaireDraft>;
  getAnswers(clientId: string): Promise<ClientAnswers>;
  /** Patch by stable field ID; null clears one answer. Hidden fields keep their answers. */
  saveAnswers(clientId: string, patch: Readonly<Record<string, AnswerValue | null>>): Promise<ClientAnswers>;
  completion(clientId: string): Promise<CompletionStatus>;
  subscribeCommittedChanges(listener: (change: QuestionnaireCommittedChange) => void): () => void;
}
