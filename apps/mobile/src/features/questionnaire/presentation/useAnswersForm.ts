import { useEffect, useMemo, useState } from "react";
import type { AnswerValue, ClientAnswers, CompletionStatus, PublishedQuestionnaire } from "../domain/QuestionnaireModel.ts";
import type { QuestionnaireRepositoryPort } from "../domain/QuestionnaireRepositoryPort.ts";
import { allFields, answerProblem, completionStatus } from "../domain/QuestionnaireRules.ts";
import { answerFromInput, answersFromInputs, inputFromAnswer, type FormInputs, type InputValue } from "./QuestionnaireForm.tsx";

type Patch = Readonly<Record<string, AnswerValue | null>>;

const emptyAnswers: ClientAnswers = { answers: {}, schemaVersion: null };

function localToday(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface AnswersForm {
  readonly status: "loading" | "failed" | "ready";
  readonly published: PublishedQuestionnaire | null;
  readonly inputs: FormInputs;
  readonly errors: Readonly<Record<string, string>>;
  /** Изменённые, но не сохранённые ответы. */
  readonly dirtyIds: readonly string[];
  readonly completion: CompletionStatus;
  /** Вышла новая версия анкеты, пока форма была открыта (§25.14). */
  readonly schemaUpdated: boolean;
  readonly onChange: (fieldId: string, value: InputValue) => void;
  /** Проверить изменённые ответы: ошибки — у самих вопросов; null — есть ошибки. */
  readonly prepare: () => Patch | null;
  /** Сохранить подготовленные ответы клиенту (после создания карточки — по её новому ID). */
  readonly commit: (clientId: string, patch: Patch) => Promise<void>;
}

/**
 * Ответы анкеты одного клиента (или новой карточки, clientId = null): опубликованная схема, ввод,
 * проверка и сохранение только изменённых ответов. Скрытые и выведенные ответы не стираются.
 * Общая логика экрана «Анкета» и единой формы карточки клиента.
 */
export function useAnswersForm(repository: QuestionnaireRepositoryPort, clientId: string | null): AnswersForm {
  const [published, setPublished] = useState<PublishedQuestionnaire | null>(null);
  const [saved, setSaved] = useState<ClientAnswers | null>(null);
  const [inputs, setInputs] = useState<FormInputs>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failed, setFailed] = useState(false);
  const [schemaUpdated, setSchemaUpdated] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getPublished(),
      clientId === null ? Promise.resolve(emptyAnswers) : repository.getAnswers(clientId)]).then(([schema, answers]) => {
      if (!active) return;
      setPublished(schema);
      setSaved(answers);
      setInputs(Object.fromEntries(allFields(schema.schema).map((item) =>
        [item.field.id, inputFromAnswer(item.field, answers.answers[item.field.id])])));
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, repository]);

  // Новая опубликованная схема заменяет структуру, но сохраняет введённое (§25.14).
  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.scope !== "SCHEMA") return;
    void repository.getPublished().then((next) => {
      setPublished((old) => {
        if (old !== null && old.version !== next.version) setSchemaUpdated(true);
        return next;
      });
    }, () => undefined);
  }), [repository]);

  const dirtyIds = useMemo(() => {
    if (published === null || saved === null) return [];
    return allFields(published.schema).filter((item) => !item.field.retired).map((item) => item.field)
      .filter((entry) => JSON.stringify(inputs[entry.id] ?? null)
        !== JSON.stringify(inputFromAnswer(entry, saved.answers[entry.id]) ?? null))
      .map((entry) => entry.id);
  }, [inputs, published, saved]);

  const completion = published === null || saved === null ? "NOT_STARTED"
    : completionStatus(published.schema, { ...saved.answers, ...answersFromInputs(published.schema, inputs) });

  const onChange = (fieldId: string, value: InputValue) => {
    setInputs((old) => ({ ...old, [fieldId]: value }));
    setErrors((old) => {
      if (old[fieldId] === undefined) return old;
      const next = { ...old };
      delete next[fieldId];
      return next;
    });
  };

  const prepare = (): Patch | null => {
    if (published === null || saved === null) return {};
    const today = localToday();
    const fields = new Map(allFields(published.schema).map((item) => [item.field.id, item.field]));
    const problems: Record<string, string> = {};
    const patch: Record<string, AnswerValue | null> = {};
    for (const id of dirtyIds) {
      const target = fields.get(id);
      if (target === undefined) continue;
      const raw = answerFromInput(target, inputs[id]);
      const problem = raw === "invalid-date" ? "Дата в формате ДД.ММ.ГГГГ."
        : answerProblem(target, raw, saved.answers[id], today);
      if (problem !== null) problems[id] = problem;
      else patch[id] = raw as AnswerValue | null;
    }
    setErrors(problems);
    return Object.keys(problems).length > 0 ? null : patch;
  };

  const commit = async (targetId: string, patch: Patch) => {
    if (published === null || Object.keys(patch).length === 0) return;
    const next = await repository.saveAnswers(targetId, patch);
    const fields = new Map(allFields(published.schema).map((item) => [item.field.id, item.field]));
    setSaved(next);
    setInputs((old) => ({ ...old, ...Object.fromEntries(Object.keys(patch).map((id) => {
      const target = fields.get(id);
      return [id, target === undefined ? undefined : inputFromAnswer(target, next.answers[id])];
    })) }));
    setSchemaUpdated(false);
  };

  return {
    status: failed ? "failed" : published === null || saved === null ? "loading" : "ready",
    published, inputs, errors, dirtyIds, completion, schemaUpdated, onChange, prepare, commit,
  };
}
