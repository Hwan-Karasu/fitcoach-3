import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnswerValue, ClientAnswers, CompletionStatus, PublishedQuestionnaire } from "../domain/QuestionnaireModel.ts";
import type { QuestionnaireRepositoryPort } from "../domain/QuestionnaireRepositoryPort.ts";
import { allFields, answerProblem, completionStatus } from "../domain/QuestionnaireRules.ts";
import { answerFromInput, answersFromInputs, inputFromAnswer, type FormInputs, type InputValue } from "./questionnaireInputs.ts";
import { localDateText } from "../../../shared/domain/LocalDate.ts";

type Patch = Readonly<Record<string, AnswerValue | null>>;

const emptyAnswers: ClientAnswers = { answers: {}, schemaVersion: null };

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
  /** Ответы уже сохранены другим путём (общая транзакция с карточкой): обновить форму сохранёнными значениями. */
  readonly adopt: (patch: Patch, next: ClientAnswers) => void;
}

/**
 * Ответы анкеты одного клиента (или новой карточки, clientId = null): опубликованная схема, ввод,
 * проверка и сохранение только изменённых ответов. Скрытые и выведенные ответы не стираются.
 * Общая логика экрана «Анкета» и единой формы карточки клиента.
 */
export function useAnswersForm(repository: QuestionnaireRepositoryPort, clientId: string | null): AnswersForm {
  const scope = useMemo(() => ({ repository, clientId }), [repository, clientId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [loadedScope, setLoadedScope] = useState<typeof scope | null>(null);
  const [published, setPublished] = useState<PublishedQuestionnaire | null>(null);
  const latestSchema = useRef<Readonly<{ repository: QuestionnaireRepositoryPort; schema: PublishedQuestionnaire }> | null>(null);
  const [saved, setSaved] = useState<ClientAnswers | null>(null);
  const [inputs, setInputs] = useState<FormInputs>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failedScope, setFailedScope] = useState<typeof scope | null>(null);
  const [schemaUpdated, setSchemaUpdated] = useState(false);

  const acceptSchema = useCallback((schema: PublishedQuestionnaire) => {
    const current = latestSchema.current;
    if (current?.repository === repository && current.schema.version >= schema.version) return current.schema;
    latestSchema.current = { repository, schema };
    setPublished(schema);
    return schema;
  }, [repository]);

  useEffect(() => {
    let active = true;
    setFailedScope(null);
    setErrors({});
    setSchemaUpdated(false);
    void Promise.all([repository.getPublished(),
      clientId === null ? Promise.resolve(emptyAnswers) : repository.getAnswers(clientId)]).then(([schema, answers]) => {
      if (!active) return;
      const currentSchema = acceptSchema(schema);
      setSaved(answers);
      setInputs(Object.fromEntries(allFields(currentSchema.schema).map((item) =>
        [item.field.id, inputFromAnswer(item.field, answers.answers[item.field.id])])));
      setLoadedScope(scope);
    }, () => { if (active) setFailedScope(scope); });
    return () => { active = false; };
  }, [scope, clientId, repository, acceptSchema]);

  // Новая опубликованная схема заменяет структуру, но сохраняет введённое (§25.14).
  useEffect(() => {
    let active = true;
    let request = 0;
    const off = repository.subscribeCommittedChanges((change) => {
      if (change.scope !== "SCHEMA") return;
      const generation = ++request;
      void repository.getPublished().then((next) => {
        if (!active || generation !== request) return;
        const previous = latestSchema.current;
        const accepted = acceptSchema(next);
        if (previous?.repository === repository && previous.schema.version < accepted.version) setSchemaUpdated(true);
      }, () => undefined);
    });
    return () => { active = false; off(); };
  }, [repository, acceptSchema]);

  const ready = loadedScope === scope;

  const dirtyIds = useMemo(() => {
    if (!ready || published === null || saved === null) return [];
    return allFields(published.schema).filter((item) => !item.field.retired).map((item) => item.field)
      .filter((entry) => JSON.stringify(inputs[entry.id] ?? null)
        !== JSON.stringify(inputFromAnswer(entry, saved.answers[entry.id]) ?? null))
      .map((entry) => entry.id);
  }, [inputs, published, ready, saved]);

  const completion = !ready || published === null || saved === null ? "NOT_STARTED"
    : completionStatus(published.schema, answersFromInputs(published.schema, inputs));

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
    if (!ready || published === null || saved === null) return null;
    const today = localDateText();
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
    adopt(patch, await repository.saveAnswers(targetId, patch));
  };

  const adopt = (patch: Patch, next: ClientAnswers) => {
    if (published === null || currentScope.current !== scope) return;
    const fields = new Map(allFields(published.schema).map((item) => [item.field.id, item.field]));
    setSaved(next);
    setInputs((old) => ({ ...old, ...Object.fromEntries(Object.keys(patch).flatMap((id) => {
      const target = fields.get(id);
      // ACK подтверждает отправленный ввод; изменения, сделанные во время записи, остаются грязными.
      if (target === undefined || JSON.stringify(answerFromInput(target, old[id])) !== JSON.stringify(patch[id])) return [];
      return [[id, inputFromAnswer(target, next.answers[id])]];
    })) }));
    setSchemaUpdated(false);
  };

  return {
    status: failedScope === scope ? "failed" : ready ? "ready" : "loading",
    published: ready ? published : null, inputs: ready ? inputs : {}, errors: ready ? errors : {},
    dirtyIds, completion, schemaUpdated: ready && schemaUpdated, onChange, prepare, commit, adopt,
  };
}
