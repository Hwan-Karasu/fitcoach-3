import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { Minus, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, SegmentedControl, StickyEditorFooter, TrainingEditorLayout,
  TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { newDraft, setTitle, setWeeks } from "../domain/SimplePlanEdits.ts";
import { WEEKS_MAX, WEEKS_MIN, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import { REBASED_NOTICE, rebaseSimpleProgram } from "../domain/DraftRebase.ts";
import type { SimplePlanSavePort } from "../domain/SimplePlanSave.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useExerciseLookupState } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { newPlanId, WorkoutsEditor } from "./WorkoutsEditor.tsx";
import { useRecoveryDraftSave } from "./useRecoveryDraftSave.ts";
import { SimpleTemplatesPanel } from "./SimpleTemplatesPanel.tsx";
import { workoutsFromTemplate } from "../domain/TemplateModel.ts";

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
 * Компоновка 2.0 (UI-OWN-026): вкладки «Программа | Шаблоны», карточка «Настройки программы», внизу «Создать»,
 * «В шаблон» и «Отмена».
 */
export function SimpleProgramBuilderScreen({ clientId, programId, repository, simplePlanSave, exercises, picked, onPickExercise, onSaved, onCancel }: Readonly<{
  clientId: string;
  programId: string | null;
  repository: TrainingPlansRepositoryPort;
  /** Сохранение с проверкой результатов в убираемых неделях; без порта — прямая запись. */
  simplePlanSave?: SimplePlanSavePort;
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
  const lookupState = useExerciseLookupState(exercises);
  const lookup = lookupState.lookup;
  const key = programId ?? NEW_KEY;
  const [draft, setDraft] = useState<SimpleProgramDraft | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  /** План, на основе которого сделан черновик: по нему черновик переносится на изменившуюся программу. */
  const [base, setBase] = useState<SimpleProgramDraft | null>(null);
  const [rebased, setRebased] = useState(false);
  const [confirmRemoved, setConfirmRemoved] = useState(false);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [tab, setTab] = useState<"program" | "templates">("program");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templatesKey, setTemplatesKey] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const recovery = useRecoveryDraftSave<Readonly<{ draft: SimpleProgramDraft; revision: number | null; base: SimpleProgramDraft | null }>>(
    (value) => repository.saveBuilderDraft(clientId, key, value.revision, value.draft, value.base));
  const { schedule } = recovery;

  // Загрузка: сохранённый план и, если есть, восстановленный черновик поверх него (§48.29 п. 2).
  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = programId === null ? null : await repository.getSimplePlan(clientId, programId);
      const recovery = await repository.getBuilderDraft(clientId, key);
      if (!active) return;
      if (recovery === null) {
        setRevision(saved?.program.revision ?? null); setBase(saved?.draft ?? null);
        setDraft(saved?.draft ?? newDraft(newPlanId("w")));
        return;
      }
      setRestored(true);
      if (saved !== null && recovery.baseRevision !== saved.program.revision) {
        // Программа изменилась после черновика (отдых или правка из дневника): правки тренера переносятся на текущий план (§48.29 п. 5).
        setDraft(recovery.base === null ? recovery.draft : rebaseSimpleProgram(recovery.base, recovery.draft, saved.draft, () => newPlanId("s")));
        setRevision(saved.program.revision); setBase(saved.draft); setRebased(true);
        return;
      }
      setDraft(recovery.draft); setRevision(recovery.baseRevision); setBase(recovery.base ?? saved?.draft ?? null);
    })().catch(() => { if (active) setMessage("Не удалось открыть конструктор."); });
    return () => { active = false; };
  }, [clientId, key, programId, repository]);

  const change = useCallback((next: SimpleProgramDraft) => {
    setDraft(next);
    schedule({ draft: next, revision, base });
  }, [schedule, revision, base]);

  usePickedExercise(picked, draft, lookup, change);

  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => draft === null || lookup === null ? [] : validateDraft(draft, metricsOf), [draft, lookup, metricsOf]);

  if (lookup === null && lookupState.failed) return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <InlineNotice kind="error">Справочник упражнений не загрузился. Данные не изменены.</InlineNotice>
      <AppButton variant="secondary" label="Повторить" onPress={lookupState.retry} />
    </View>;
  if (draft === null || lookup === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем конструктор…" />}
    </View>;
  }

  const save = async (confirmRemovedResults = false) => {
    setShowIssues(true);
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте программу."); return; }
    setBusy(true);
    setMessage(null);
    try {
      await recovery.beforePublish();
      const program = programId === null || revision === null
        ? await repository.createSimpleProgram(clientId, draft)
        : simplePlanSave === undefined ? await repository.saveSimplePlan(clientId, programId, revision, draft)
          : await simplePlanSave.saveSimplePlan({ clientId, programId, expectedRevision: revision, draft, confirmRemovedResults });
      onSaved(program.id);
    } catch (error) {
      recovery.resume();
      if (error instanceof Error && error.message === "WEEKS_HAVE_RESULTS") { setConfirmRemoved(true); return; }
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить. Черновик на месте.");
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    setShowIssues(true);
    setSaved(null);
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте программу."); return; }
    setTemplateBusy(true);
    setMessage(null);
    try {
      const template = await repository.saveSimpleDraftAsTemplate(draft);
      setTemplatesKey((value) => value + 1);
      setSaved(`Шаблон «${template.title}» сохранён. Программа ещё не создана.`);
    } catch {
      setMessage("Не удалось сохранить шаблон. Черновик на месте.");
    } finally {
      setTemplateBusy(false);
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
      setRevision(saved?.program.revision ?? null); setBase(saved?.draft ?? null); setRebased(false);
      setRestored(false); setMessage(null);
    } catch { setMessage("Не удалось загрузить сохранённый план. Изменения остаются в редакторе."); }
    finally { recovery.resume(); setBusy(false); }
  };

  return (
    <TrainingEditorLayout>
      <View style={styles.tabs}>
        <SegmentedControl items={[{ id: "program", label: "Программа" }, { id: "templates", label: "Шаблоны" }]}
          selectedId={tab} onSelect={setTab} />
      </View>
      {tab === "templates" ? (
        <Animated.ScrollView contentContainerStyle={styles.content}>
          <SimpleTemplatesPanel repository={repository} reloadKey={templatesKey} onApply={(title, payload) => {
            change({ title, plan: { weeks: payload.weeks, workouts: workoutsFromTemplate(payload.workouts, () => newPlanId("t")) } });
            setShowIssues(false); setMessage(null); setSaved(null);
            setTab("program");
          }} />
        </Animated.ScrollView>
      ) : <>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {restored ? (
          <InlineNotice kind="info">{rebased ? REBASED_NOTICE : "Восстановлен несохранённый черновик."}</InlineNotice>
        ) : null}
        {restored ? <AppButton compact variant="secondary" label="Отменить несохранённые изменения" onPress={() => { void discardRecovery(); }} /> : null}
        {programId !== null ? <InlineNotice kind="info">При правке базового плана индивидуальные отличия недель сохраняются. Их можно изменить из дневника с выбором области.</InlineNotice> : null}
        <View style={[styles.settings, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.settingsTitle, { color: colors.textPrimary }]}>Настройки программы</Text>
        <TextField label="Название программы" hideLabel required placeholder="Название программы" value={draft.title}
          onChangeText={(title) => change(setTitle(draft, title))} />
        <View style={styles.weeks}>
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
        </View>

        <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={issues} showIssues={showIssues}
          scrollRef={scrollRef} onPickExercise={(workoutId) => onPickExercise(workoutId)}
          onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
      </Animated.ScrollView>

      <StickyEditorFooter actionLabel={programId === null ? "Создать" : "Сохранить"} busy={busy}
        onCancel={onCancel} secondaryAction={{ label: "В шаблон", busy: templateBusy, onPress: () => { void saveTemplate(); } }}
        onAction={() => { void save(); }} message={recovery.error ?? message ?? saved}
        messageKind={recovery.error ?? message ? "error" : "success"} />
      <ConfirmDialog visible={confirmRemoved} destructive confirmBusy={busy} title="В убираемых неделях есть результаты"
        description="Недели или тренировки с выполненными подходами исчезнут из плана. Результаты не удаляются: они останутся в истории и вернутся в дневник, если вернуть неделю или тренировку. Сохранить так?"
        confirmLabel="Сохранить" cancelLabel="Вернуться" onCancel={() => setConfirmRemoved(false)}
        onConfirm={() => { setConfirmRemoved(false); void save(true); }} />
      </>}

    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingTop: 10, gap: 10, paddingBottom: 24 },
  grow: { flex: 1, minWidth: 0 },
  tabs: { paddingHorizontal: 16, paddingTop: 4 },
  settings: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  settingsTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  weeks: { flexDirection: "row", alignItems: "center", gap: 4 },
  weeksLabel: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  weeksValue: { minWidth: 28, textAlign: "center", fontFamily: fonts.semibold, fontSize: 16 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
