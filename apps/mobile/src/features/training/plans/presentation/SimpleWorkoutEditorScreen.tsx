import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { AppButton, InlineNotice, LoadingState, SelectionChip, StickyEditorFooter, TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { simpleWorkoutDraftKey, simpleWorkoutScopeLabels, type SimpleWorkoutDraft, type SimpleWorkoutEdit, type SimpleWorkoutScope } from "../domain/SimpleWorkoutEdit.ts";
import type { WeekEditPreview } from "../domain/PeriodizedModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import { useRecoveryDraftSave } from "./useRecoveryDraftSave.ts";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { newPlanId, WorkoutsEditor } from "./WorkoutsEditor.tsx";
import { REBASED_NOTICE, rebaseDraft } from "../domain/DraftRebase.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";
import { StructureEditPreview } from "./StructureEditPreview.tsx";

const errorText = (error: unknown) => error instanceof Error && error.message === "PROGRAM_REVISION_CONFLICT"
  ? "Программа изменилась. Введённый план остаётся в редакторе; обновите исходную программу."
  : "Не удалось применить изменения. Введённый план остаётся в редакторе.";

export function SimpleWorkoutEditorScreen({ clientId, clientName, programId, weekIndex, workoutId, repository, exercises,
  picked, onPickExercise, onSaved, onCancel }: Readonly<{
  clientId: string; clientName: string; programId: string; weekIndex: number; workoutId: string;
  repository: TrainingPlansRepositoryPort; exercises: ExerciseLookupPort; picked: PickedExercise | null;
  onPickExercise: (workoutId: string, replace?: string) => void; onSaved: () => void; onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [draft, setDraft] = useState<SimpleProgramDraft | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [scope, setScope] = useState<SimpleWorkoutScope>("CURRENT");
  const [replace, setReplace] = useState<readonly string[]>([]);
  const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<WeekEditPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [baseWorkout, setBaseWorkout] = useState<PlannedWorkout | null>(null);
  const [rebased, setRebased] = useState(false);
  const recovery = useRecoveryDraftSave<SimpleWorkoutDraft>((value) => repository.saveSimpleWorkoutDraft(clientId, programId, value));
  const { schedule } = recovery;
  const input = useMemo<SimpleWorkoutEdit | null>(() => draft ? { weekIndex, workoutId, workout: draft.plan.workouts[0]!,
    scope, replaceConflicts: replace } : null, [draft, weekIndex, workoutId, scope, replace]);
  useEffect(() => {
    if (dirty && revision !== null && input) schedule({ baseRevision: revision, input, ...(baseWorkout ? { baseWorkout } : {}) });
  }, [dirty, revision, input, baseWorkout, schedule]);
  useEffect(() => {
    let active = true;
    void Promise.all([repository.findWorkout(clientId, programId, workoutId, weekIndex),
      repository.getSimpleWorkoutDraft(clientId, programId, weekIndex, workoutId)]).then(([found, saved]) => {
      if (!active) return;
      if (!found) { setMessage("Тренировка не найдена."); return; }
      const stale = saved !== null && saved.baseRevision !== found.program.revision && saved.baseWorkout !== undefined;
      const workout = saved === null ? found.workout : stale && saved.baseWorkout !== undefined
        ? rebaseDraft([saved.baseWorkout], [saved.input.workout], [found.workout], () => newPlanId("r"))[0] ?? found.workout
        : saved.input.workout;
      setDraft({ title: found.program.title, plan: { weeks: 1, workouts: [workout] } });
      setBaseWorkout(stale || saved?.baseWorkout === undefined ? found.workout : saved.baseWorkout);
      setRebased(stale);
      setDirty(stale);
      setRevision(stale ? found.program.revision : saved?.baseRevision ?? found.program.revision);
      setScope(saved?.input.scope ?? "CURRENT");
      setReplace(stale ? [] : saved?.input.replaceConflicts ?? []);
      setRestored(saved !== null);
    }).catch(() => { if (active) setMessage("Не удалось открыть план тренировки."); });
    return () => { active = false; };
  }, [repository, clientId, programId, weekIndex, workoutId]);
  const change = useCallback((next: SimpleProgramDraft) => { setDirty(true); setDraft(next); setReplace([]); }, []);
  usePickedExercise(picked, draft, lookup, change);
  const issues = useMemo(() => draft && lookup ? validateDraft(draft, (id) => lookup.get(id)?.metrics ?? null) : [], [draft, lookup]);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError(null);
    if (!draft || revision === null || issues.length > 0) return;
    const timer = setTimeout(() => {
      void repository.previewSimpleWorkout(clientId, programId, revision,
        { weekIndex, workoutId, workout: draft.plan.workouts[0]!, scope }).then((value) => { if (active) setPreview(value); })
        .catch((error: unknown) => { if (active) setPreviewError(errorText(error)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [repository, clientId, programId, weekIndex, workoutId, draft, revision, scope, issues.length]);
  if (!draft || !lookup || revision === null) return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
    {message ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем план тренировки…" />}
  </View>;
  const save = async () => {
    if (!input || !preview || issues.length > 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await recovery.beforePublish();
      await repository.saveSimpleWorkout(clientId, programId, revision, input);
      onSaved();
    } catch (error) { recovery.resume(); setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    setBusy(true);
    try {
      const found = await repository.findWorkout(clientId, programId, workoutId, weekIndex);
      if (!found) throw new Error("TARGET_NOT_FOUND");
      await recovery.beforePublish();
      await repository.clearBuilderDraft(clientId, simpleWorkoutDraftKey(programId, weekIndex, workoutId));
      setDirty(false);
      setDraft({ title: found.program.title, plan: { weeks: 1, workouts: [found.workout] } });
      setRevision(found.program.revision); setBaseWorkout(found.workout); setRebased(false);
      setScope("CURRENT"); setReplace([]); setRestored(false); setMessage(null);
    } catch { setMessage("Не удалось загрузить сохранённый план. Изменения остаются в редакторе."); }
    finally { recovery.resume(); setBusy(false); }
  };
  return <TrainingEditorLayout>
    <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {restored ? <InlineNotice kind="info">{rebased ? REBASED_NOTICE : "Восстановлены несохранённые изменения тренировки."}</InlineNotice> : null}
      {restored || previewError ? <AppButton variant="secondary" label="Отменить несохранённые изменения" disabled={busy}
        onPress={() => { void discard(); }} /> : null}
      <Text style={[styles.heading, { color: colors.textPrimary }]}>{`${draft.title} · Неделя ${weekIndex}`}</Text>
      <View style={[styles.application, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Применить правку</Text>
        {(["CURRENT", "FOLLOWING", "ALL"] as const).map((value) => <SelectionChip key={value} group="Область" label={simpleWorkoutScopeLabels[value]}
          selected={scope === value} onPress={() => { setDirty(true); setScope(value); setReplace([]); }} />)}
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Только этот тренировочный день в выбранных неделях. Остальные дни программы не изменятся.</Text>
        {previewError ? <InlineNotice kind="error">{previewError}</InlineNotice> : preview
          ? <StructureEditPreview preview={preview} lookup={lookup} names={new Map([[clientId, clientName]])} replace={replace}
            onChange={(keys) => { setDirty(true); setReplace(keys); }} />
          : <Text style={[styles.meta, { color: colors.textSecondary }]}>{issues[0]?.message ?? "Проверяем отличия недель…"}</Text>}
      </View>
      <WorkoutsEditor singleWorkout draft={draft} change={change} lookup={lookup} issues={issues} showIssues
        scrollRef={scrollRef} onPickExercise={onPickExercise} onReplaceExercise={onPickExercise} />
    </Animated.ScrollView>
    <StickyEditorFooter actionLabel="Сохранить" busy={busy} disabled={!preview || issues.length > 0} onAction={() => { void save(); }}
      onCancel={onCancel} message={recovery.error ?? message} messageKind="error"
      note={scope === "ALL" ? "Прежний план сохранится в исторической версии" : "Изменения сохраняются только в выбранных неделях"} />
  </TrainingEditorLayout>;
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  application: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
