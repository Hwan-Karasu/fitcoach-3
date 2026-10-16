/** §23.5 question types V1; nothing more complex without a proven need. */
export const QUESTION_TYPES = ["SHORT_TEXT", "LONG_TEXT", "NUMBER", "DATE", "SINGLE_CHOICE", "MULTI_CHOICE", "SWITCH"] as const;
export type QuestionType = typeof QUESTION_TYPES[number];

export type FieldOrigin = "SYSTEM" | "CUSTOM";

/** §23.15 / §25.12: the answer keeps the option ID; the label may change, a used option is retired. */
export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly retired: boolean;
}

/**
 * §23.8 simple visibility: «Показывать X, если [поле] [оператор] [значение]». `value` is an option
 * ID for choice sources, "true"/"false" for a switch and plain text otherwise.
 */
export interface VisibilityRule {
  readonly sourceFieldId: string;
  readonly operator: "EQUALS" | "NOT_EQUALS" | "CONTAINS";
  readonly value: string;
}

/**
 * Per-field answer validation on top of the type check. Only the keys matching the field type are
 * used: numbers (min/max/integer), text (maxLength), dates (notFuture/notBefore).
 */
export interface FieldConstraints {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly maxLength?: number;
  readonly notFuture?: boolean;
  readonly notBefore?: string;
}

/** §23.1 one canonical field model for system and custom questions. */
export interface QuestionField {
  readonly id: string;
  readonly origin: FieldOrigin;
  readonly semanticKey: string | null;
  readonly type: QuestionType;
  readonly label: string;
  readonly help: string | null;
  readonly required: boolean;
  readonly hidden: boolean;
  /** §25.9 «Убрать из анкеты»: no new answers, history kept, ID never reused. */
  readonly retired: boolean;
  readonly options: readonly ChoiceOption[];
  readonly visibleIf: VisibilityRule | null;
  readonly constraints: FieldConstraints | null;
}

export interface QuestionSection {
  readonly id: string;
  readonly origin: FieldOrigin;
  readonly title: string;
  readonly help: string | null;
  readonly hidden: boolean;
  readonly fields: readonly QuestionField[];
}

/** `formatVersion` is the technical JSON format, never the published questionnaire version (§25.3). */
export interface QuestionnaireSchema {
  readonly formatVersion: 1;
  readonly sections: readonly QuestionSection[];
}

/** Stored per stable field ID (§25.7): text/date as string, number, switch, option ID(s). */
export type AnswerValue = string | number | boolean | readonly string[];
export type Answers = Readonly<Record<string, AnswerValue>>;

export type CompletionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";

export interface PublishedQuestionnaire {
  readonly version: number;
  readonly publishedAt: string;
  readonly schema: QuestionnaireSchema;
}

export interface QuestionnaireDraft {
  /** The published version this draft started from; a stale base never overwrites a newer one. */
  readonly baseVersion: number;
  readonly revision: number;
  readonly schema: QuestionnaireSchema;
}

export interface ClientAnswers {
  readonly answers: Answers;
  /** Published version the answers were last saved against (§25.7.1), null when none yet. */
  readonly schemaVersion: number | null;
}

/** §25.6 semantic publish summary, not a JSON diff. */
export interface PublishSummary {
  readonly added: number;
  readonly changed: number;
  readonly hidden: number;
  readonly retired: number;
  readonly removed: number;
  readonly moved: number;
  readonly sections: number;
}
