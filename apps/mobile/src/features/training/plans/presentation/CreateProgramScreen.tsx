import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StickyEditorFooter, TrainingEditorLayout, SelectionChip, TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ProgramKind } from "../domain/ProgramModel.ts";
import { PROGRAM_TITLE_MAX, programKindLabels } from "../domain/ProgramRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";

/** Клиент, которому можно назначить программу (только поля отображения, из владельца Clients). */
export interface TrainingParticipantCandidate {
  readonly id: string;
  readonly displayName: string;
}

const errors: Readonly<Record<string, string>> = {
  DRAFT_INVALID: `Введите название программы (до ${PROGRAM_TITLE_MAX} символов).`,
  PARTICIPANT_CONFLICT: "Простая программа — только для одного клиента.",
  TARGET_NOT_FOUND: "Клиент не найден или в архиве. Обновите список участников.",
};

/**
 * Создание программы (T01): название и, у расширенной, участники. Структура программы — в конструкторе
 * (T02 простой, T04 расширенный); после сохранения сразу открывается созданная программа (§48.4.5).
 */
export function CreateProgramScreen({ clientId, kind, repository, listCandidates, onCreated, onCancel }: Readonly<{
  clientId: string;
  kind: ProgramKind;
  repository: TrainingPlansRepositoryPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  onCreated: (programId: string) => void;
  onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState<readonly string[]>([clientId]);
  const [candidates, setCandidates] = useState<readonly TrainingParticipantCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (kind !== "PERIODIZED") return undefined;
    let active = true;
    listCandidates().then((rows) => { if (active) setCandidates(rows); }).catch(() => undefined);
    return () => { active = false; };
  }, [kind, listCandidates]);

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const program = await repository.createProgram({ kind, title, clientIds: members });
      onCreated(program.id);
    } catch (failure) {
      setError(errors[failure instanceof Error ? failure.message : ""] ?? "Не удалось создать программу. Попробуйте ещё раз.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const toggle = (id: string) => setMembers((current) => current.includes(id)
    ? current.filter((member) => member !== id) : [...current, id]);

  return (
    <TrainingEditorLayout>
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
        {`${programKindLabels[kind]} программа`}
      </Text>
      <TextField label="Название" required value={title} onChangeText={setTitle} placeholder="Например, «Силовой блок»" />
      {kind === "PERIODIZED" ? <>
        <Text style={[styles.group, { color: colors.textPrimary }]}>Участники</Text>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Каждый получит свою копию плана; результаты тренировок у всех свои.
        </Text>
        <View style={styles.chips}>
          {candidates.filter((candidate) => candidate.id !== clientId).length === 0 ? (
            <Text style={[styles.note, { color: colors.textMuted }]}>Других активных клиентов нет.</Text>
          ) : null}
          {candidates.map((candidate) => (
            <SelectionChip key={candidate.id} group="Участники" label={candidate.displayName}
              selected={members.includes(candidate.id)}
              onPress={() => { if (candidate.id !== clientId) toggle(candidate.id); }} />
          ))}
        </View>
      </> : (
        <Text style={[styles.note, { color: colors.textSecondary }]}>Простая программа — только для этого клиента.</Text>
      )}
    </ScrollView>
    <StickyEditorFooter actionLabel="Создать программу" busy={busy} disabled={title.trim().length === 0}
      onAction={() => { void save(); }} onCancel={onCancel} message={error} messageKind="error" />
    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  group: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, marginTop: 4 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
