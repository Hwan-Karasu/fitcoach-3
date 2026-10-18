import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { Minus, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, InlineNotice, LoadingState, StickyEditorFooter, TextField, TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { MESOCYCLE_WEEKS_MAX } from "../domain/PeriodizedModel.ts";
import { newDraft, setTitle, setWeeks } from "../domain/SimplePlanEdits.ts";
import type { SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { newPlanId, WorkoutsEditor } from "./WorkoutsEditor.tsx";
import { useRecoveryDraftSave } from "./useRecoveryDraftSave.ts";
import type { PeriodizedDraft } from "../domain/PeriodizedDraft.ts";
import { MesocycleCopyScreen } from "./MesocycleCopyScreen.tsx";

export function MesocycleCreatorScreen(props: ComponentProps<typeof EmptyMesocycleCreator>) {
  const { palette } = usePrototypeTheme();
  const [mode, setMode] = useState<"EMPTY" | "COPY" | null>(null);
  if (mode === "EMPTY") return <EmptyMesocycleCreator {...props} />;
  if (mode === "COPY") return <MesocycleCopyScreen {...props} onCancel={() => setMode(null)} />;
  return <View style={[styles.content, { backgroundColor: palette.tokens.canvas, flex: 1 }]}>
    <AppButton label="Создать пустой мезоцикл" onPress={() => setMode("EMPTY")} />
    <Text style={[styles.meta, { color: palette.tokens.textSecondary }]}>Настройте недели и состав тренировок с нуля.</Text>
    <AppButton label="Скопировать существующий" variant="secondary" onPress={() => setMode("COPY")} />
    <Text style={[styles.meta, { color: palette.tokens.textSecondary }]}>Возьмите текущий план из программы клиента. Результаты останутся у источника.</Text>
  </View>;
}

const errors: Readonly<Record<string, string>> = {
  DRAFT_INVALID: "Мезоцикл не сохранился: проверьте название и тренировки.",
  PROGRAM_REVISION_CONFLICT: "Программа изменилась в другом месте. Откройте её заново.",
  PROGRAM_ARCHIVED: "У кого-то из выбранных участников программа в архиве — снимите отметку.",
  TARGET_NOT_FOUND: "Программа или участник не найдены.",
};

/**
 * «+ Мезоцикл» (§48.12.1 п. 1): название, число недель и план первой недели — он копируется во все недели
 * (решение владельца 2026-10-18). Выбранным участникам — по своей копии (§48.12.3 п. 1). До сохранения
 * ничего не записывается: отмена не оставляет недостроенный мезоцикл (§48.12.3 п. 5).
 */
function EmptyMesocycleCreator({ clientId, programId, repository, exercises, listCandidates, picked, onPickExercise,
  onCreated, onCancel }: Readonly<{
  clientId: string;
  programId: string;
  repository: TrainingPlansRepositoryPort;
  exercises: ExerciseLookupPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  picked: PickedExercise | null;
  onPickExercise: (workoutId: string, replace?: string) => void;
  onCreated: () => void;
  onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [draft, setDraft] = useState<SimpleProgramDraft | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [members, setMembers] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([clientId]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const recovery = useRecoveryDraftSave<PeriodizedDraft>((value) => repository.savePeriodizedDraft(clientId, programId, value));
  const { schedule } = recovery;
  useEffect(() => {
    if (dirty && draft !== null && revision !== null) schedule({ kind: "MESOCYCLE", baseRevision: revision, draft, clientIds: selected });
  }, [dirty, draft, revision, selected, schedule]);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getPeriodizedPlan(clientId, programId), repository.getPeriodizedDraft(clientId, programId, "new:MESOCYCLE")]).then(([plan, saved]) => {
      if (!active || plan === null) return;
      setRevision(plan.program.revision);
      setMembers(plan.program.memberClientIds);
      // По умолчанию — всем участникам: общий мезоцикл — обычный случай групповой программы.
      setSelected(saved?.clientIds ?? plan.program.memberClientIds);
      setDraft(saved?.draft ?? setTitle(newDraft(newPlanId("w")), `Мезоцикл ${plan.mesocycles.length + 1}`));
      setRestored(saved !== null);
    }).catch(() => { if (active) setMessage("Не удалось открыть программу."); });
    listCandidates().then((rows) => { if (active) setNames(new Map(rows.map((row) => [row.id, row.displayName]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [clientId, listCandidates, programId, repository]);

  const change = useCallback((next: SimpleProgramDraft) => { setDirty(true); setDraft(next); }, []);
  usePickedExercise(picked, draft, lookup, change);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => draft === null || lookup === null ? [] : validateDraft(draft, metricsOf), [draft, lookup, metricsOf]);

  if (draft === null || lookup === null || revision === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем…" />}
    </View>;
  }

  const save = async () => {
    setShowIssues(true);
    if (issues.length > 0) { setMessage(issues[0]?.message.replace("программы", "мезоцикла") ?? "Проверьте мезоцикл."); return; }
    setBusy(true);
    setMessage(null);
    try {
      await recovery.beforePublish();
      await repository.createMesocycle(clientId, programId, revision, { title: draft.title, weeks: draft.plan.weeks,
        firstWeek: draft.plan.workouts, clientIds: selected });
      onCreated();
    } catch (error) {
      recovery.resume();
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось создать мезоцикл. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TrainingEditorLayout>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {restored ? <InlineNotice kind="info">Восстановлен несохранённый мезоцикл.</InlineNotice> : null}
        <TextField label="Название мезоцикла" required value={draft.title} onChangeText={(title) => change(setTitle(draft, title))} />
        <View style={[styles.weeks, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.grow}>
            <Text style={[styles.weeksLabel, { color: colors.textPrimary }]}>Недель в мезоцикле</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>План первой недели скопируется во все, потом каждую можно менять</Text>
          </View>
          <AppIconButton compact label="Меньше недель" disabled={draft.plan.weeks <= 1}
            icon={<Minus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => change(setWeeks(draft, draft.plan.weeks - 1))} />
          <Text accessibilityLabel={`Недель: ${draft.plan.weeks}`} style={[styles.weeksValue, { color: colors.textPrimary }]}>{draft.plan.weeks}</Text>
          <AppIconButton compact label="Больше недель" disabled={draft.plan.weeks >= MESOCYCLE_WEEKS_MAX}
            icon={<Plus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => change(setWeeks(draft, draft.plan.weeks + 1))} />
        </View>
        <ParticipantChips clientId={clientId} memberIds={members} names={names} selected={selected}
          onChange={(ids) => { setDirty(true); setSelected(ids); }}
          note="Каждый выбранный получит свою копию мезоцикла; результаты у всех свои." />
        <Text style={[styles.section, { color: colors.textPrimary }]}>Неделя 1</Text>
        <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={issues} showIssues={showIssues} scrollRef={scrollRef}
          onPickExercise={(workoutId) => onPickExercise(workoutId)}
          onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
      </Animated.ScrollView>
      <StickyEditorFooter actionLabel="Создать мезоцикл" busy={busy} onAction={() => { void save(); }}
        onCancel={onCancel}
        message={recovery.error ?? message} messageKind="error" note="Изменения хранятся в черновике до создания мезоцикла" />
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
  section: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, marginTop: 4 },
});
