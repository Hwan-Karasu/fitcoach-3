import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { AppButton, InlineNotice, LoadingState, SelectionChip, StickyEditorFooter, TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { WEEK_SCOPES, WEEK_TYPES, weekScopeLabels, weekTypeLabels, type Mesocycle, type WeekScope,
  type WeekEditPreview, type WeekType } from "../domain/PeriodizedModel.ts";
import { targetWeeks } from "../domain/PeriodizedRules.ts";
import type { SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import { StructureEditPreview } from "./StructureEditPreview.tsx";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { WorkoutsEditor } from "./WorkoutsEditor.tsx";
import { useRecoveryDraftSave } from "./useRecoveryDraftSave.ts";
import type { PeriodizedDraft } from "../domain/PeriodizedDraft.ts";
import { REBASED_NOTICE, rebaseDraft } from "../domain/DraftRebase.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";
import { newPlanId } from "./WorkoutsEditor.tsx";

const errors: Readonly<Record<string, string>> = {
  DRAFT_INVALID: "Неделя не сохранилась: проверьте тренировки.",
  PROGRAM_REVISION_CONFLICT: "Программа изменилась в другом месте. Откройте неделю заново.",
  PROGRAM_ARCHIVED: "У кого-то из выбранных участников программа в архиве — снимите отметку.",
  TARGET_NOT_FOUND: "Неделя или участник не найдены.",
};

/**
 * Правка недели мезоцикла (§48.6): тренировки, упражнения и подходы — тем же редактором, что в Простом
 * конструкторе; тип недели; перед сохранением — область применения (4 варианта) и участники. Открытая
 * неделя сохраняется как есть, остальным неделям и участникам — та же правка по родству; факты не копируются.
 */
export function WeekEditorScreen({ clientId, programId, mesocycleId, weekIndex, repository, exercises, listCandidates, picked,
  onPickExercise, onSaved, onCancel }: Readonly<{
  clientId: string;
  programId: string;
  mesocycleId: string;
  weekIndex: number;
  repository: TrainingPlansRepositoryPort;
  exercises: ExerciseLookupPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  picked: PickedExercise | null;
  onPickExercise: (workoutId: string, replace?: string) => void;
  onSaved: () => void;
  onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [mesocycle, setMesocycle] = useState<Mesocycle | null>(null);
  const [draft, setDraft] = useState<SimpleProgramDraft | null>(null);
  const [type, setType] = useState<WeekType>("base");
  const [scope, setScope] = useState<WeekScope>("CURRENT");
  const [revision, setRevision] = useState<number | null>(null);
  const [members, setMembers] = useState<readonly string[]>([]);
  // §48.6.3: правка только своей недели не заставляет выбирать других клиентов.
  const [selected, setSelected] = useState<readonly string[]>([clientId]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<WeekEditPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [replaceConflicts, setReplaceConflicts] = useState<readonly string[]>([]);
  const [baseWorkouts, setBaseWorkouts] = useState<readonly PlannedWorkout[]>([]);
  const [rebased, setRebased] = useState(false);
  const recovery = useRecoveryDraftSave<PeriodizedDraft>((value) => repository.savePeriodizedDraft(clientId, programId, value));
  const { schedule } = recovery;
  useEffect(() => {
    if (dirty && draft !== null && revision !== null) schedule({ kind: "WEEK", baseRevision: revision, draft, clientIds: selected,
      mesocycleId, weekIndex, type, scope, replaceConflicts, baseWorkouts });
  }, [dirty, draft, revision, selected, mesocycleId, weekIndex, type, scope, replaceConflicts, baseWorkouts, schedule]);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getPeriodizedPlan(clientId, programId), repository.getPeriodizedDraft(clientId, programId,
      `week:${mesocycleId}:${weekIndex}`)]).then(([plan, saved]) => {
      if (!active) return;
      const found = plan?.mesocycles.find((item) => item.id === mesocycleId);
      const week = found?.weeks.find((item) => item.index === weekIndex);
      if (plan === null || found === undefined || week === undefined) { setMessage("Неделя не найдена."); return; }
      setMesocycle(found);
      const week0 = saved?.kind === "WEEK" ? saved : null;
      const stale = week0 !== null && week0.baseRevision !== plan.program.revision && week0.baseWorkouts !== undefined;
      setRebased(stale);
      setDirty(stale);
      setBaseWorkouts(stale || week0?.baseWorkouts === undefined ? week.workouts : week0.baseWorkouts);
      setRevision(stale ? plan.program.revision : saved?.baseRevision ?? plan.program.revision);
      setMembers(plan.program.memberClientIds);
      setType(saved?.kind === "WEEK" ? saved.type : week.type);
      setScope(saved?.kind === "WEEK" ? saved.scope : "CURRENT");
      setReplaceConflicts(saved?.kind === "WEEK" && !stale ? saved.replaceConflicts ?? [] : []);
      setSelected(saved?.clientIds ?? [clientId]);
      setDraft(saved === null ? { title: found.title, plan: { weeks: 1, workouts: week.workouts } }
        : stale && week0?.baseWorkouts !== undefined
          ? { ...saved.draft, plan: { ...saved.draft.plan, workouts: rebaseDraft(week0.baseWorkouts, saved.draft.plan.workouts,
            week.workouts, () => newPlanId("r")) } }
          : saved.draft);
      setRestored(saved !== null);
    }).catch(() => { if (active) setMessage("Не удалось открыть неделю."); });
    listCandidates().then((rows) => { if (active) setNames(new Map(rows.map((row) => [row.id, row.displayName]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [clientId, listCandidates, mesocycleId, programId, repository, weekIndex]);

  const change = useCallback((next: SimpleProgramDraft) => { setDirty(true); setDraft(next); setReplaceConflicts([]); }, []);
  usePickedExercise(picked, draft, lookup, change);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => draft === null || lookup === null ? [] : validateDraft(draft, metricsOf), [draft, lookup, metricsOf]);
  // Область считается по сохранённому типу открытой недели — так же, как при сохранении.
  const affected = useMemo(() => mesocycle === null ? [] : targetWeeks(mesocycle.weeks, weekIndex, scope), [mesocycle, scope, weekIndex]);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError(null);
    if (!draft || revision === null || issues.length > 0) return;
    const timer = setTimeout(() => {
      void repository.previewWeekEdit(clientId, programId, revision, { mesocycleId, weekIndex,
        workouts: draft.plan.workouts, type, scope, clientIds: selected }).then((value) => { if (active) setPreview(value); })
        .catch((error: unknown) => { if (active) setPreviewError(errors[error instanceof Error ? error.message : ""] ?? "Не удалось проверить изменения."); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [clientId, programId, mesocycleId, weekIndex, draft, revision, scope, type, selected, repository, issues.length]);

  if (draft === null || lookup === null || revision === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем неделю…" />}
    </View>;
  }

  const save = async () => {
    setShowIssues(true);
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте неделю."); return; }
    if (preview === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await recovery.beforePublish();
      await repository.saveWeek(clientId, programId, revision, { mesocycleId, weekIndex, workouts: draft.plan.workouts,
        type, scope, clientIds: selected, replaceConflicts });
      onSaved();
    } catch (error) {
      recovery.resume();
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить. Неделя не изменена.");
    }
    setBusy(false);
  };
  const discard = async () => {
    setBusy(true);
    try {
      const plan = await repository.getPeriodizedPlan(clientId, programId);
      const cycle = plan?.mesocycles.find((item) => item.id === mesocycleId);
      const week = cycle?.weeks.find((item) => item.index === weekIndex);
      if (!plan || !cycle || !week) throw new Error("TARGET_NOT_FOUND");
      await recovery.beforePublish();
      await repository.clearPeriodizedDraft(clientId, programId, `week:${mesocycleId}:${weekIndex}`);
      setDirty(false); setMesocycle(cycle); setRevision(plan.program.revision); setBaseWorkouts(week.workouts); setRebased(false);
      setDraft({ title: cycle.title, plan: { weeks: 1, workouts: week.workouts } });
      setType(week.type); setScope("CURRENT"); setSelected([clientId]); setReplaceConflicts([]); setRestored(false); setMessage(null);
    } catch { setMessage("Не удалось загрузить сохранённую неделю. Изменения остаются в редакторе."); }
    finally { recovery.resume(); setBusy(false); }
  };

  return (
    <TrainingEditorLayout>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {restored ? <InlineNotice kind="info">{rebased ? REBASED_NOTICE : "Восстановлены несохранённые изменения недели."}</InlineNotice> : null}
        {restored || previewError ? <AppButton variant="secondary" label="Отменить несохранённые изменения" disabled={busy}
          onPress={() => { void discard(); }} /> : null}
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
          {`${mesocycle?.title ?? ""} · Неделя ${weekIndex}`}
        </Text>
        <Text style={[styles.section, { color: colors.textPrimary }]}>Тип недели</Text>
        <View style={styles.chips}>
          {WEEK_TYPES.map((item) => (
            <SelectionChip key={item} group="Тип недели" label={weekTypeLabels[item]} selected={item === type}
              onPress={() => { setDirty(true); setType(item); setReplaceConflicts([]); }} />
          ))}
        </View>
        <View style={[styles.application, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.section, { color: colors.textPrimary }]}>Применить правки</Text>
        <View style={styles.chips}>
          {WEEK_SCOPES.map((item) => (
            <SelectionChip key={item} group="Область" label={weekScopeLabels[item]} selected={item === scope}
              onPress={() => { setDirty(true); setScope(item); setReplaceConflicts([]); }} />
          ))}
        </View>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {`Изменятся недели: ${affected.join(", ")}. Результаты тренировок не переносятся.`}
        </Text>
        <ParticipantChips clientId={clientId} memberIds={members} names={names} selected={selected}
          onChange={(ids) => { setDirty(true); setSelected(ids); setReplaceConflicts([]); }}
          note="Правка у выбранных — в их собственных копиях этого мезоцикла." />
        {previewError ? <InlineNotice kind="error">{previewError}</InlineNotice> : preview === null
          ? <Text style={[styles.meta, { color: colors.textMuted }]}>{issues.length > 0 ? "Исправьте поля для проверки изменений." : "Проверяем персональные отличия…"}</Text>
          : <StructureEditPreview preview={preview} names={names} lookup={lookup} replace={replaceConflicts}
            onChange={(keys) => { setDirty(true); setReplaceConflicts(keys); }} />}
        </View>
        <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={issues} showIssues={showIssues} scrollRef={scrollRef}
          onPickExercise={(workoutId) => onPickExercise(workoutId)}
          onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
      </Animated.ScrollView>
      <StickyEditorFooter actionLabel="Сохранить неделю" busy={busy} disabled={preview === null} onAction={() => { void save(); }}
        onCancel={onCancel}
        message={recovery.error ?? message} messageKind={message?.startsWith("Сохранено") === true ? "info" : "error"}
        note={selected.length > 1 ? "Тип недели меняется у этой недели — у вас и у выбранных участников" : "Тип недели меняется только у этой недели"} />
    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  application: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  section: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, marginTop: 4 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
