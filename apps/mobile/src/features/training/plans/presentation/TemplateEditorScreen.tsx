import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { Minus, Plus } from "lucide-react-native";
import { AppIconButton, InlineNotice, LoadingState, SelectionChip, StickyEditorFooter, TextField,
  TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { MESOCYCLE_WEEKS_MAX, WEEK_TYPES, weekTypeLabels } from "../domain/PeriodizedModel.ts";
import { WEEKS_MAX, WEEKS_MIN, type PlannedWorkout, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { validateDraft } from "../domain/SimplePlanRules.ts";
import { templateKindLabels, type ProgramTemplate, type TemplateMesocycle, type TemplatePayload } from "../domain/TemplateModel.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { WorkoutsEditor } from "./WorkoutsEditor.tsx";

const cyclesOf = (payload: TemplatePayload): readonly TemplateMesocycle[] =>
  payload.kind === "MESOCYCLE" ? [payload.mesocycle] : payload.kind === "PERIODIZED" ? payload.mesocycles : [];

/** Новое содержимое мезоциклов в том же типе шаблона. */
function withCycles(payload: TemplatePayload, cycles: readonly TemplateMesocycle[]): TemplatePayload {
  if (payload.kind === "MESOCYCLE") return { kind: "MESOCYCLE", mesocycle: cycles[0] ?? payload.mesocycle };
  if (payload.kind === "PERIODIZED") return { kind: "PERIODIZED", mesocycles: cycles };
  return payload;
}

/**
 * Правка шаблона (§48.16 п. 3): Простой — недели и тренировки; мезоцикл и Расширенная — выбор мезоцикла и недели,
 * тип недели и тренировки тем же редактором. Сохраняется только сам шаблон; программы, созданные по нему
 * раньше, не меняются (§48.16 п. 4). До «Сохранить» ничего не записывается.
 */
export function TemplateEditorScreen({ templateId, repository, exercises, picked, onPickExercise, onSaved, onCancel }: Readonly<{
  templateId: string;
  repository: TrainingPlansRepositoryPort;
  exercises: ExerciseLookupPort;
  picked: PickedExercise | null;
  onPickExercise: (workoutId: string, replace?: string) => void;
  onSaved: () => void;
  onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [template, setTemplate] = useState<ProgramTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [payload, setPayload] = useState<TemplatePayload | null>(null);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [weekIndex, setWeekIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  useEffect(() => {
    let active = true;
    repository.getTemplate(templateId).then((loaded) => {
      if (!active) return;
      if (loaded === null) { setMessage("Шаблон не найден."); return; }
      setTemplate(loaded); setTitle(loaded.title); setPayload(loaded.payload);
    }).catch(() => { if (active) setMessage("Не удалось открыть шаблон."); });
    return () => { active = false; };
  }, [repository, templateId]);

  const cycles = payload === null ? [] : cyclesOf(payload);
  const cycle = cycles[cycleIndex];
  const week = cycle?.weeks[weekIndex];

  // Редактируемая часть в форме черновика конструктора: у Простого — весь план, иначе — открытая неделя.
  const draft: SimpleProgramDraft | null = payload === null ? null : payload.kind === "SIMPLE"
    ? { title, plan: { weeks: payload.weeks, workouts: payload.workouts } }
    : week === undefined ? null : { title: cycle?.title ?? title, plan: { weeks: 1, workouts: week.workouts } };

  const change = useCallback((next: SimpleProgramDraft) => {
    setPayload((current) => {
      if (current === null) return current;
      if (current.kind === "SIMPLE") return { kind: "SIMPLE", weeks: next.plan.weeks, workouts: next.plan.workouts };
      return withCycles(current, cyclesOf(current).map((item, index) => index !== cycleIndex ? item : { ...item,
        weeks: item.weeks.map((entry, position) => position !== weekIndex ? entry
          : { ...entry, workouts: next.plan.workouts as readonly PlannedWorkout[] }) }));
    });
  }, [cycleIndex, weekIndex]);
  usePickedExercise(picked, draft, lookup, change);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => draft === null || lookup === null ? [] : validateDraft(draft, metricsOf), [draft, lookup, metricsOf]);

  if (template === null || payload === null || lookup === null || draft === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем шаблон…" />}
    </View>;
  }

  const setCycle = (patch: Partial<TemplateMesocycle>) => setPayload((current) => current === null ? current
    : withCycles(current, cyclesOf(current).map((item, index) => index === cycleIndex ? { ...item, ...patch } : item)));
  const resizeCycle = (count: number) => {
    if (cycle === undefined || count < 1 || count > MESOCYCLE_WEEKS_MAX) return;
    // Новые недели — копия последней (как «первая неделя → во все» при создании), лишние — с конца.
    const last = cycle.weeks[cycle.weeks.length - 1];
    const weeks = count < cycle.weeks.length ? cycle.weeks.slice(0, count)
      : [...cycle.weeks, ...Array.from({ length: count - cycle.weeks.length }, () => last ?? { type: "base" as const, workouts: [] })];
    setCycle({ weeks });
    setWeekIndex((current) => Math.min(current, count - 1));
  };

  const save = async () => {
    setShowIssues(true);
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте шаблон."); return; }
    setBusy(true); setMessage(null);
    try {
      await repository.updateTemplate(template.id, template.revision, title, payload);
      onSaved();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "TEMPLATE_REVISION_CONFLICT" ? "Шаблон изменился в другом месте. Откройте его заново."
        : code === "DRAFT_INVALID" ? "Шаблон не сохранился: проверьте название, недели и тренировки."
          : "Не удалось сохранить шаблон. Он не изменён.");
    } finally { setBusy(false); }
  };

  return (
    <TrainingEditorLayout>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${templateKindLabels[template.kind]} · только план, без результатов`}</Text>
        <TextField label="Название шаблона" required value={title} onChangeText={setTitle} />
        {payload.kind === "SIMPLE" ? (
          <View style={[styles.stepper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.grow, styles.section, { color: colors.textPrimary }]}>Недель в программе</Text>
            <AppIconButton compact label="Меньше недель" disabled={payload.weeks <= WEEKS_MIN}
              icon={<Minus size={18} color={colors.textPrimary} strokeWidth={2} />}
              onPress={() => setPayload({ ...payload, weeks: payload.weeks - 1 })} />
            <Text style={[styles.value, { color: colors.textPrimary }]}>{payload.weeks}</Text>
            <AppIconButton compact label="Больше недель" disabled={payload.weeks >= WEEKS_MAX}
              icon={<Plus size={18} color={colors.textPrimary} strokeWidth={2} />}
              onPress={() => setPayload({ ...payload, weeks: payload.weeks + 1 })} />
          </View>
        ) : <>
          {payload.kind === "PERIODIZED" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {cycles.map((item, index) => (
                <SelectionChip key={index} group="Мезоцикл" label={item.title} selected={index === cycleIndex}
                  onPress={() => { setCycleIndex(index); setWeekIndex(0); }} />
              ))}
            </ScrollView>
          ) : null}
          {cycle !== undefined ? <>
            <TextField label="Название мезоцикла" required value={cycle.title} onChangeText={(value) => setCycle({ title: value })} />
            <View style={[styles.stepper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.grow, styles.section, { color: colors.textPrimary }]}>Недель в мезоцикле</Text>
              <AppIconButton compact label="Меньше недель" disabled={cycle.weeks.length <= 1}
                icon={<Minus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => resizeCycle(cycle.weeks.length - 1)} />
              <Text style={[styles.value, { color: colors.textPrimary }]}>{cycle.weeks.length}</Text>
              <AppIconButton compact label="Больше недель" disabled={cycle.weeks.length >= MESOCYCLE_WEEKS_MAX}
                icon={<Plus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => resizeCycle(cycle.weeks.length + 1)} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {cycle.weeks.map((_, index) => (
                <SelectionChip key={index} group="Неделя" label={`Неделя ${index + 1}`} selected={index === weekIndex}
                  onPress={() => setWeekIndex(index)} />
              ))}
            </ScrollView>
            {week !== undefined ? <>
              <Text style={[styles.section, { color: colors.textPrimary }]}>{`Тип недели ${weekIndex + 1}`}</Text>
              <View style={styles.wrap}>
                {WEEK_TYPES.map((type) => (
                  <SelectionChip key={type} group="Тип недели" label={weekTypeLabels[type]} selected={week.type === type}
                    onPress={() => setCycle({ weeks: cycle.weeks.map((entry, index) => index === weekIndex ? { ...entry, type } : entry) })} />
                ))}
              </View>
            </> : null}
          </> : null}
        </>}
        <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={issues} showIssues={showIssues} scrollRef={scrollRef}
          onPickExercise={(workoutId) => onPickExercise(workoutId)}
          onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
      </Animated.ScrollView>
      <StickyEditorFooter actionLabel="Сохранить шаблон" busy={busy} onAction={() => { void save(); }} onCancel={onCancel}
        message={message} messageKind="error" note="Программы, уже созданные по шаблону, не изменятся" />
    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  section: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  value: { minWidth: 28, textAlign: "center", fontFamily: fonts.semibold, fontSize: 16 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 12, paddingLeft: 14, paddingRight: 4,
    paddingVertical: 8 },
  grow: { flex: 1, minWidth: 0 },
  chips: { gap: 8, paddingRight: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
