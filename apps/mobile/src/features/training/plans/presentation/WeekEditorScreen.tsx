import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { InlineNotice, LoadingState, SelectionChip, StickyEditorFooter, TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { WEEK_SCOPES, WEEK_TYPES, weekScopeLabels, weekTypeLabels, type Mesocycle, type WeekScope,
  type WeekType } from "../domain/PeriodizedModel.ts";
import { targetWeeks } from "../domain/PeriodizedRules.ts";
import type { SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { WorkoutsEditor } from "./WorkoutsEditor.tsx";

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

  useEffect(() => {
    let active = true;
    void repository.getPeriodizedPlan(clientId, programId).then((plan) => {
      if (!active) return;
      const found = plan?.mesocycles.find((item) => item.id === mesocycleId);
      const week = found?.weeks.find((item) => item.index === weekIndex);
      if (plan === null || found === undefined || week === undefined) { setMessage("Неделя не найдена."); return; }
      setMesocycle(found);
      setRevision(plan.program.revision);
      setMembers(plan.program.memberClientIds);
      setType(week.type);
      setDraft({ title: found.title, plan: { weeks: 1, workouts: week.workouts } });
    }).catch(() => { if (active) setMessage("Не удалось открыть неделю."); });
    listCandidates().then((rows) => { if (active) setNames(new Map(rows.map((row) => [row.id, row.displayName]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [clientId, listCandidates, mesocycleId, programId, repository, weekIndex]);

  const change = useCallback((next: SimpleProgramDraft) => setDraft(next), []);
  usePickedExercise(picked, draft, lookup, change);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => draft === null || lookup === null ? [] : validateDraft(draft, metricsOf), [draft, lookup, metricsOf]);
  // Тип открытой недели в выборе «этого типа» — уже новый, если его меняют.
  const affected = useMemo(() => mesocycle === null ? [] : targetWeeks(mesocycle.weeks.map((week) => ({ index: week.index,
    type: week.index === weekIndex ? type : week.type })), weekIndex, scope), [mesocycle, scope, type, weekIndex]);

  if (draft === null || lookup === null || revision === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем неделю…" />}
    </View>;
  }

  const save = async () => {
    setShowIssues(true);
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте неделю."); return; }
    setBusy(true);
    setMessage(null);
    try {
      const result = await repository.saveWeek(clientId, programId, revision, { mesocycleId, weekIndex, workouts: draft.plan.workouts,
        type, scope, clientIds: selected });
      if (result.skipped > 0) {
        // §48.6.5 п. 8: где нет такого же элемента, правка не подменяет другой — об этом нужно сказать.
        setRevision(result.program.revision);
        setMessage(`Сохранено. Часть правок не применена в других неделях или у других участников (${result.skipped}): там нет такого же упражнения или тренировки.`);
        setBusy(false);
        return;
      }
      onSaved();
    } catch (error) {
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить. Неделя не изменена.");
    }
    setBusy(false);
  };

  return (
    <TrainingEditorLayout>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
          {`${mesocycle?.title ?? ""} · Неделя ${weekIndex}`}
        </Text>
        <Text style={[styles.section, { color: colors.textPrimary }]}>Тип недели</Text>
        <View style={styles.chips}>
          {WEEK_TYPES.map((item) => (
            <SelectionChip key={item} group="Тип недели" label={weekTypeLabels[item]} selected={item === type} onPress={() => setType(item)} />
          ))}
        </View>
        <View style={[styles.application, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.section, { color: colors.textPrimary }]}>Применить правки</Text>
        <View style={styles.chips}>
          {WEEK_SCOPES.map((item) => (
            <SelectionChip key={item} group="Область" label={weekScopeLabels[item]} selected={item === scope} onPress={() => setScope(item)} />
          ))}
        </View>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {`Изменятся недели: ${affected.join(", ")}. Результаты тренировок не переносятся.`}
        </Text>
        <ParticipantChips clientId={clientId} memberIds={members} names={names} selected={selected} onChange={setSelected}
          note="Правка у выбранных — в их собственных копиях этого мезоцикла." />
        </View>
        <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={issues} showIssues={showIssues} scrollRef={scrollRef}
          onPickExercise={(workoutId) => onPickExercise(workoutId)}
          onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
      </Animated.ScrollView>
      <StickyEditorFooter actionLabel="Сохранить неделю" busy={busy} onAction={() => { void save(); }}
        onCancel={onCancel}
        message={message} messageKind={message?.startsWith("Сохранено") === true ? "info" : "error"}
        note="Тип недели меняется только у этой недели" />
    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  application: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  section: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, marginTop: 4 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
