import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { Minus, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, InlineNotice, LoadingState, StickyEditorFooter, TrainingEditorLayout,
  TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { newDraft, setTitle, setWeeks } from "../domain/SimplePlanEdits.ts";
import { WEEKS_MAX, WEEKS_MIN, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { newPlanId, WorkoutsEditor } from "./WorkoutsEditor.tsx";
import { useRecoveryDraftSave } from "./useRecoveryDraftSave.ts";

export { newPlanId } from "./WorkoutsEditor.tsx";

/** Ключ черновика ещё не созданной программы (совпадает с хранилищем). */
const NEW_KEY = "new:SIMPLE";

const errors: Readonly<Record<string, string>> = {
  DRAFT_INVALID: "Структура не сохранилась: проверьте название и тренировки.",
  PROGRAM_REVISION_CONFLICT: "Программа изменилась в другом месте. Откройте её заново — черновик сохранён.",
  TARGET_NOT_FOUND: "Программа или клиент не найдены.",
};

/**
 * Простой конструктор (§48.2, §48.4): название, число недель, тренировки базовой недели, упражнения из
 * каталога и плановые подходы. Несохранённое — в Recovery Draft (§48.29), публикация — только «Сохранить».
 */
export function SimpleProgramBuilderScreen({ clientId, programId, repository, exercises, picked, onPickExercise, onSaved, onCancel }: Readonly<{
  clientId: string;
  programId: string | null;
  repository: TrainingPlansRepositoryPort;
  exercises: ExerciseLookupPort;
  /** Упражнение, выбранное в каталоге для тренировки (передаёт навигация); `replace` — какое заменить. */
  picked: PickedExercise | null;
  /** Открыть каталог: добавить упражнение или (`replace`) заменить им имеющееся. */
  onPickExercise: (workoutId: string, replace?: string) => void;
  onSaved: (programId: string) => void;
  onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const key = programId ?? NEW_KEY;
  const [draft, setDraft] = useState<SimpleProgramDraft | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const recovery = useRecoveryDraftSave<Readonly<{ draft: SimpleProgramDraft; revision: number | null }>>(
    (value) => repository.saveBuilderDraft(clientId, key, value.revision, value.draft));
  const { schedule } = recovery;

  // Загрузка: сохранённый план и, если есть, восстановленный черновик поверх него (§48.29 п. 2).
  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = programId === null ? null : await repository.getSimplePlan(clientId, programId);
      const recovery = await repository.getBuilderDraft(clientId, key);
      if (!active) return;
      setRevision(recovery !== null ? recovery.baseRevision : saved?.program.revision ?? null);
      if (recovery !== null) { setDraft(recovery.draft); setRestored(true); }
      else setDraft(saved?.draft ?? newDraft(newPlanId("w")));
    })().catch(() => { if (active) setMessage("Не удалось открыть конструктор."); });
    return () => { active = false; };
  }, [clientId, key, programId, repository]);

  const change = useCallback((next: SimpleProgramDraft) => {
    setDraft(next);
    schedule({ draft: next, revision });
  }, [schedule, revision]);

  usePickedExercise(picked, draft, lookup, change);

  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => draft === null || lookup === null ? [] : validateDraft(draft, metricsOf), [draft, lookup, metricsOf]);

  if (draft === null || lookup === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем конструктор…" />}
    </View>;
  }

  const save = async () => {
    setShowIssues(true);
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте программу."); return; }
    setBusy(true);
    setMessage(null);
    try {
      await recovery.beforePublish();
      const program = programId === null || revision === null
        ? await repository.createSimpleProgram(clientId, draft)
        : await repository.saveSimplePlan(clientId, programId, revision, draft);
      onSaved(program.id);
    } catch (error) {
      recovery.resume();
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить. Черновик на месте.");
    } finally {
      setBusy(false);
    }
  };

  const discardRecovery = async () => {
    setBusy(true);
    try {
      const saved = programId === null ? null : await repository.getSimplePlan(clientId, programId);
      if (programId !== null && saved === null) throw new Error("TARGET_NOT_FOUND");
      await recovery.beforePublish();
      await repository.clearBuilderDraft(clientId, key);
      setDraft(saved?.draft ?? newDraft(newPlanId("w")));
      setRevision(saved?.program.revision ?? null);
      setRestored(false); setMessage(null);
    } catch { setMessage("Не удалось загрузить сохранённый план. Изменения остаются в редакторе."); }
    finally { recovery.resume(); setBusy(false); }
  };

  return (
    <TrainingEditorLayout>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {restored ? (
          <InlineNotice kind="info">Восстановлен несохранённый черновик.</InlineNotice>
        ) : null}
        {restored ? <AppButton compact variant="secondary" label="Отменить несохранённые изменения" onPress={() => { void discardRecovery(); }} /> : null}
        <TextField label="Название программы" required value={draft.title} onChangeText={(title) => change(setTitle(draft, title))} />
        {programId !== null ? <InlineNotice kind="info">При правке базового плана индивидуальные отличия недель сохраняются. Их можно изменить из дневника с выбором области.</InlineNotice> : null}
        <View style={[styles.weeks, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.grow}>
            <Text style={[styles.weeksLabel, { color: colors.textPrimary }]}>Недель в программе</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>План недели повторяется каждую неделю</Text>
          </View>
          <AppIconButton compact label="Меньше недель" disabled={draft.plan.weeks <= WEEKS_MIN}
            icon={<Minus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => change(setWeeks(draft, draft.plan.weeks - 1))} />
          <Text accessibilityLabel={`Недель: ${draft.plan.weeks}`} style={[styles.weeksValue, { color: colors.textPrimary }]}>{draft.plan.weeks}</Text>
          <AppIconButton compact label="Больше недель" disabled={draft.plan.weeks >= WEEKS_MAX}
            icon={<Plus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => change(setWeeks(draft, draft.plan.weeks + 1))} />
        </View>

        <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={issues} showIssues={showIssues}
          scrollRef={scrollRef} onPickExercise={(workoutId) => onPickExercise(workoutId)}
          onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
      </Animated.ScrollView>

      <StickyEditorFooter actionLabel={programId === null ? "Создать программу" : "Сохранить"} busy={busy}
        onCancel={onCancel}
        onAction={() => { void save(); }} message={recovery.error ?? message} messageKind="error"
        note="Несохранённые изменения хранятся в черновике и не попадают в дневник" />

    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  grow: { flex: 1, minWidth: 0 },
  weeks: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 12, paddingLeft: 14, paddingRight: 4, paddingVertical: 8 },
  weeksLabel: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  weeksValue: { minWidth: 28, textAlign: "center", fontFamily: fonts.semibold, fontSize: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
