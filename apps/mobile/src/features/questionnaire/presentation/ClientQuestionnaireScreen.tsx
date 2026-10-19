import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState, StatusTag } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { CompletionStatus } from "../domain/QuestionnaireModel.ts";
import type { QuestionnaireRepositoryPort } from "../domain/QuestionnaireRepositoryPort.ts";
import { QuestionnaireForm } from "./QuestionnaireForm.tsx";
import { useAnswersForm } from "./useAnswersForm.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

export const completionTag: Readonly<Record<CompletionStatus, Readonly<{ kind: "neutral" | "warning" | "success"; label: string }>>> = {
  NOT_STARTED: { kind: "neutral", label: "Анкета не начата" },
  IN_PROGRESS: { kind: "warning", label: "Анкета заполнена не полностью" },
  COMPLETE: { kind: "success", label: "Анкета заполнена" },
};

export function fieldsWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} полей`;
  if (count % 10 === 1) return `${count} поле`;
  return count % 10 >= 2 && count % 10 <= 4 ? `${count} поля` : `${count} полей`;
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
  const form = useAnswersForm(repository, clientId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  if (form.published === null) {
    return <PrototypeScreen>
      {form.status === "failed" ? <InlineNotice kind="error">Анкета не загрузилась. Ответы клиента не изменены.</InlineNotice>
        : <LoadingState label="Открываем анкету…" />}
    </PrototypeScreen>;
  }

  const tag = completionTag[form.completion];
  const save = async () => {
    if (busy) return;
    const patch = form.prepare();
    if (patch === null) { setNotice(null); return; }
    setBusy(true);
    try {
      await form.commit(clientId, patch);
      setNotice("Ответы сохранены.");
    } catch {
      setNotice(null);
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const problemCount = Object.keys(form.errors).length;
  return (
    <PrototypeScreen>
      <View style={styles.head}>
        <StatusTag kind={tag.kind} label={tag.label} />
        <Text style={[styles.version, { color: colors.textMuted }]}>{`Версия анкеты ${form.published.version}`}</Text>
      </View>
      {form.schemaUpdated ? <InlineNotice kind="info">
        Анкета обновилась: вопросы показаны по новой версии, введённые ответы сохранены в форме.
      </InlineNotice> : null}
      {saveFailed ? <InlineNotice kind="error">Не удалось сохранить. Ответы в форме остались, попробуйте ещё раз.</InlineNotice> : null}
      {problemCount > 0 ? <InlineNotice kind="error">
        {`Проверьте ответы: ${fieldsWord(problemCount)} с ошибкой отмечены ниже.`}
      </InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      <QuestionnaireForm schema={form.published.schema} inputs={form.inputs} errors={form.errors}
        onChange={(fieldId, value) => { setNotice(null); form.onChange(fieldId, value); }} disabled={busy} />
      <AppButton label={form.dirtyIds.length > 0 ? `Сохранить ответы (${form.dirtyIds.length})` : "Ответы сохранены"}
        busy={busy} disabled={form.dirtyIds.length === 0} onPress={() => { setSaveFailed(false); void save(); }} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  version: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
