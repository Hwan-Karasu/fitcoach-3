import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState, StatusTag } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { AnswerValue, ClientAnswers, CompletionStatus, PublishedQuestionnaire } from "../domain/QuestionnaireModel.ts";
import type { QuestionnaireRepositoryPort } from "../domain/QuestionnaireRepositoryPort.ts";
import { allFields, answerProblem, completionStatus } from "../domain/QuestionnaireRules.ts";
import { answerFromInput, answersFromInputs, inputFromAnswer, QuestionnaireForm, type FormInputs,
  type InputValue } from "./QuestionnaireForm.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const statusTag: Readonly<Record<CompletionStatus, Readonly<{ kind: "neutral" | "warning" | "success"; label: string }>>> = {
  NOT_STARTED: { kind: "neutral", label: "Анкета не начата" },
  IN_PROGRESS: { kind: "warning", label: "Анкета заполнена не полностью" },
  COMPLETE: { kind: "success", label: "Анкета заполнена" },
};

function fieldsWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} полей`;
  if (count % 10 === 1) return `${count} поле`;
  return count % 10 >= 2 && count % 10 <= 4 ? `${count} поля` : `${count} полей`;
}

function localToday(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Client Workspace «Анкета» (§§10.3, 23, 25.14): the current published schema with conditional
 * visibility, answers per stable field ID, derived completion. Saving changes only edited answers;
 * hidden and retired answers are never cleared.
 */
export function ClientQuestionnaireScreen({ clientId, repository }: Readonly<{
  clientId: string; repository: QuestionnaireRepositoryPort;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [published, setPublished] = useState<PublishedQuestionnaire | null>(null);
  const [saved, setSaved] = useState<ClientAnswers | null>(null);
  const [inputs, setInputs] = useState<FormInputs>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [schemaUpdated, setSchemaUpdated] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getPublished(), repository.getAnswers(clientId)]).then(([schema, answers]) => {
      if (!active) return;
      setPublished(schema);
      setSaved(answers);
      setInputs(Object.fromEntries(allFields(schema.schema).map((item) =>
        [item.field.id, inputFromAnswer(item.field, answers.answers[item.field.id])])));
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, repository]);

  // A newer published schema replaces the structure but keeps what the trainer typed (§25.14).
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

  if (published === null || saved === null) {
    return <PrototypeScreen>
      {failed ? <InlineNotice kind="error">Анкета не загрузилась. Ответы клиента не изменены.</InlineNotice>
        : <LoadingState label="Открываем анкету…" />}
    </PrototypeScreen>;
  }

  const live = completionStatus(published.schema, { ...saved.answers, ...answersFromInputs(published.schema, inputs) });
  const tag = statusTag[live];

  const onChange = (fieldId: string, value: InputValue) => {
    setInputs((old) => ({ ...old, [fieldId]: value }));
    setNotice(null);
    setErrors((old) => {
      if (old[fieldId] === undefined) return old;
      const next = { ...old };
      delete next[fieldId];
      return next;
    });
  };

  const save = async () => {
    if (busy) return;
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
    if (Object.keys(problems).length > 0) {
      setNotice(null);
      return;
    }
    setBusy(true);
    try {
      const next = await repository.saveAnswers(clientId, patch);
      setSaved(next);
      setInputs((old) => ({ ...old, ...Object.fromEntries(Object.keys(patch).map((id) => {
        const target = fields.get(id);
        return [id, target === undefined ? undefined : inputFromAnswer(target, next.answers[id])];
      })) }));
      setSchemaUpdated(false);
      setNotice("Ответы сохранены.");
    } catch {
      setNotice(null);
      setErrors({});
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const problemCount = Object.keys(errors).length;
  return (
    <PrototypeScreen>
      <View style={styles.head}>
        <StatusTag kind={tag.kind} label={tag.label} />
        <Text style={[styles.version, { color: colors.textMuted }]}>{`Версия анкеты ${published.version}`}</Text>
      </View>
      {schemaUpdated ? <InlineNotice kind="info">
        Анкета обновилась: вопросы показаны по новой версии, введённые ответы сохранены в форме.
      </InlineNotice> : null}
      {failed ? <InlineNotice kind="error">Не удалось сохранить. Ответы в форме остались, попробуйте ещё раз.</InlineNotice> : null}
      {problemCount > 0 ? <InlineNotice kind="error">
        {`Проверьте ответы: ${fieldsWord(problemCount)} с ошибкой отмечены ниже.`}
      </InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      <QuestionnaireForm schema={published.schema} inputs={inputs} errors={errors} onChange={onChange} disabled={busy} />
      <AppButton label={dirtyIds.length > 0 ? `Сохранить ответы (${dirtyIds.length})` : "Ответы сохранены"}
        busy={busy} disabled={dirtyIds.length === 0} onPress={() => { setFailed(false); void save(); }} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  version: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
