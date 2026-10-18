import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { CalendarDays, Minus, Plus } from "lucide-react-native";
import { AppIconButton, LoadingState, pickDate, SegmentedControl, StickyEditorFooter, TextField,
  TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { copyWeekPlan, CYCLE_TYPES, resizeBuilderWeeks, type BuilderWeek, type CycleType } from "../domain/MesocycleBuilder.ts";
import { MESOCYCLE_WEEKS_MAX, WEEK_TYPES, weekTypeLabels, type WeekType } from "../domain/PeriodizedModel.ts";
import { PROGRAM_TITLE_MAX } from "../domain/ProgramRules.ts";
import { setRepsRange } from "../domain/SimplePlanEdits.ts";
import type { PlanRange, SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { formatRange, parseRange, setFieldsOf, validateDraft } from "../domain/SimplePlanRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { weekTypeTone } from "./weekTypeTone.ts";
import { newPlanId, WorkoutsEditor } from "./WorkoutsEditor.tsx";

const errors: Readonly<Record<string, string>> = {
  DRAFT_INVALID: `Проверьте названия (до ${PROGRAM_TITLE_MAX} символов), повторения и тренировки — хотя бы одна неделя с упражнениями.`,
  TARGET_NOT_FOUND: "Клиент не найден или в архиве. Обновите список участников.",
};

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const shortDate = (date: string) => date.split("-").reverse().join(".");

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.eyebrow, { color: colors.accentInk }]}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Конструктор Расширенной программы (UI-OWN-038, компоновка и поведение 2.0): настройки мезоцикла, структура недель
 * с типами, программа выбранной недели, «Скопировать из недели». При первом создании вопросов об области нет;
 * пустые недели заполняются при сохранении копией ближайшей заполненной. Программа, участники и мезоцикл
 * создаются одной записью.
 */
export function PeriodizedBuilderScreen({ clientId, repository, exercises, listCandidates, picked, onPickExercise, onCreated, onCancel,
  renderTemplates }: Readonly<{
  clientId: string;
  repository: TrainingPlansRepositoryPort;
  exercises: ExerciseLookupPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  picked: PickedExercise | null;
  onPickExercise: (workoutId: string, replace?: string) => void;
  onCreated: (programId: string) => void;
  onCancel: () => void;
  /** Вкладка «Шаблоны» — библиотека шаблонов (подставляет навигация). */
  renderTemplates?: () => ReactNode;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [tab, setTab] = useState<"program" | "templates">("program");
  const [programTitle, setProgramTitle] = useState("");
  const [title, setTitle] = useState("Мезоцикл 1");
  const [cycleType, setCycleType] = useState<CycleType>("hypertrophy");
  const [repsText, setRepsText] = useState("8-12");
  const [startDate, setStartDate] = useState(today);
  const [members, setMembers] = useState<readonly string[]>([clientId]);
  const [candidates, setCandidates] = useState<readonly TrainingParticipantCandidate[]>([]);
  const [weeks, setWeeks] = useState<readonly BuilderWeek[]>(() => resizeBuilderWeeks([{ type: "base", workouts: [] }], 4));
  const [editing, setEditing] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"create" | "template" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  useEffect(() => {
    let active = true;
    listCandidates().then((rows) => { if (active) setCandidates(rows); }).catch(() => undefined);
    return () => { active = false; };
  }, [listCandidates]);

  const reps = useMemo((): PlanRange | null | "invalid" => {
    const parsed = parseRange(repsText.replace("–", "-"));
    return parsed;
  }, [repsText]);
  const week = weeks[editing] ?? weeks[0]!;
  const draft: SimpleProgramDraft = useMemo(() => ({ title: title || "Мезоцикл", plan: { weeks: 1, workouts: week.workouts } }),
    [title, week.workouts]);
  const touch = () => { setDirty(true); setSaved(null); setMessage(null); };
  const updateWeek = useCallback((index: number, next: BuilderWeek) => {
    setWeeks((current) => current.map((item, at) => at === index ? next : item));
    setDirty(true); setSaved(null); setMessage(null);
  }, []);
  // Новые упражнения получают повторения мезоцикла (как в 2.0), если упражнение считается повторами.
  const change = useCallback((next: SimpleProgramDraft) => {
    const before = new Set(week.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.id)));
    let result = next;
    if (reps !== "invalid" && reps !== null && lookup !== null) {
      for (const workout of next.plan.workouts) {
        for (const exercise of workout.exercises) {
          const fields = setFieldsOf(lookup.get(exercise.exerciseId)?.metrics ?? []);
          if (!before.has(exercise.id) && fields.includes("reps") && exercise.sets.every((set) => set.reps === null)) {
            result = setRepsRange(result, exercise.id, reps);
          }
        }
      }
    }
    updateWeek(editing, { type: week.type, workouts: result.plan.workouts });
  }, [editing, lookup, reps, updateWeek, week.type, week.workouts]);
  usePickedExercise(picked, draft, lookup, change);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => lookup === null ? [] : weeks.flatMap((item) => item.workouts.length === 0 ? []
    : validateDraft({ title: title || "Мезоцикл", plan: { weeks: 1, workouts: item.workouts } }, metricsOf)), [lookup, metricsOf, title, weeks]);
  const weekIssues = useMemo(() => lookup === null || week.workouts.length === 0 ? [] : validateDraft(draft, metricsOf),
    [draft, lookup, metricsOf, week.workouts.length]);

  if (lookup === null) return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем конструктор…" /></View>;

  const input = () => ({ title, cycleType, repRange: reps === "invalid" ? null : reps, startDate, weeks });
  const check = () => {
    setShowIssues(true);
    if (reps === "invalid") { setMessage("Повторения: число или диапазон, например 8-12."); return false; }
    if (weeks.every((item) => item.workouts.length === 0)) { setMessage("Добавьте тренировку хотя бы в одну неделю."); return false; }
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте тренировки."); return false; }
    return true;
  };
  const create = async () => {
    if (!check()) return;
    if (programTitle.trim().length === 0) { setMessage("Введите название программы."); return; }
    setBusy("create"); setMessage(null);
    try {
      const program = await repository.createPeriodizedProgram({ title: programTitle, clientIds: members, mesocycle: input() });
      setDirty(false);
      onCreated(program.id);
    } catch (error) {
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось создать программу. Черновик на месте.");
    } finally { setBusy(null); }
  };
  const saveTemplate = async () => {
    if (!check()) return;
    setBusy("template"); setMessage(null);
    try {
      const template = await repository.saveBuilderAsTemplate({ title: programTitle.trim() || title, mesocycle: input() });
      setSaved(`Шаблон «${template.title}» сохранён. Программа ещё не создана.`);
    } catch (error) {
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить шаблон.");
    } finally { setBusy(null); }
  };

  const tabs = renderTemplates !== undefined ? (
    <View style={styles.tabs}>
      <SegmentedControl items={[{ id: "program", label: "Программа" }, { id: "templates", label: "Шаблоны" }]} selectedId={tab} onSelect={setTab} />
    </View>
  ) : null;
  if (tab === "templates" && renderTemplates !== undefined) {
    return <View style={[styles.root, { backgroundColor: colors.canvas }]}>{tabs}{renderTemplates()}</View>;
  }

  const chip = (selected: boolean) => [styles.choice, { borderColor: selected ? colors.accentInk : colors.border,
    backgroundColor: selected ? withAlpha(colors.accentInk, 0.12) : colors.input }];
  return (
    <TrainingEditorLayout>
      {tabs}
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Импорт из Excel в V1 исключён (UI-OWN-024); место под будущую функцию, как на экране выбора конструктора. */}
        <View style={styles.row}>
          {["Импорт Excel", "Скачать шаблон"].map((label) => (
            <View key={label} accessible accessibilityLabel={`${label}. Скоро`} accessibilityState={{ disabled: true }}
              style={[styles.soon, { borderColor: colors.border }]}>
              <Text style={[styles.soonText, { color: colors.textMuted }]}>{label}</Text>
              <Text style={[styles.soonBadge, { color: colors.textMuted }]}>скоро</Text>
            </View>
          ))}
        </View>
        {dirty ? <Text style={[styles.dirty, { color: colors.warning }]}>Есть несохранённые изменения</Text> : null}
        <Section title="Настройки мезоцикла">
          <TextField label="Название программы" required value={programTitle} placeholder="Например, «Подготовка к лету»"
            onChangeText={(value) => { setProgramTitle(value); touch(); }} />
          <TextField label="Название мезоцикла" required value={title} onChangeText={(value) => { setTitle(value); touch(); }} />
          <Text style={[styles.label, { color: colors.textPrimary }]}>Тип цикла</Text>
          <View style={styles.grid}>
            {CYCLE_TYPES.map((item) => (
              <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: cycleType === item.id }}
                accessibilityLabel={`${item.label}, повторения ${formatRange(item.reps)}`}
                onPress={() => { setCycleType(item.id); setRepsText(formatRange(item.reps).replace("–", "-")); touch(); }}
                style={chip(cycleType === item.id)}>
                <Text style={[styles.choiceText, { color: cycleType === item.id ? colors.accentInk : colors.textPrimary }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <View style={[styles.grow, styles.field]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Повторения</Text>
              <TextField label="Повторения" hideLabel value={repsText} placeholder="8-12" keyboardType="numbers-and-punctuation"
                error={reps === "invalid" ? "Число или диапазон" : undefined}
                onChangeText={(value) => { setRepsText(value.replace(/[^\d\-–]/gu, "")); touch(); }} />
            </View>
            <View style={[styles.grow, styles.field]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Дата старта</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Дата старта ${shortDate(startDate)}. Изменить`}
                onPress={() => { void pickDate({ value: startDate }).then((date) => { if (date !== null) { setStartDate(date); touch(); } }); }}
                style={[styles.date, { borderColor: colors.border, backgroundColor: colors.input }]}>
                <CalendarDays size={16} color={colors.accentInk} strokeWidth={2} />
                <Text style={[styles.dateText, { color: colors.textPrimary }]}>{shortDate(startDate)}</Text>
              </Pressable>
            </View>
          </View>
          <ParticipantChips clientId={clientId} memberIds={[clientId, ...candidates.map((item) => item.id).filter((id) => id !== clientId)]}
            names={new Map(candidates.map((item) => [item.id, item.displayName]))} selected={members}
            onChange={(ids) => { setMembers(ids); touch(); }} note="Каждый получит свою копию; результаты у всех свои." />
        </Section>

        <Section title="Структура недель">
          <View style={styles.counter}>
            <AppIconButton label="Меньше недель" disabled={weeks.length <= 1}
              icon={<Minus size={18} color={colors.textPrimary} strokeWidth={2} />}
              onPress={() => { setWeeks(resizeBuilderWeeks(weeks, weeks.length - 1)); setEditing((value) => Math.min(value, weeks.length - 2)); touch(); }} />
            <Text accessibilityLabel={`Недель: ${weeks.length}`} style={[styles.count, { color: colors.textPrimary }]}>{weeks.length}</Text>
            <AppIconButton label="Больше недель" disabled={weeks.length >= MESOCYCLE_WEEKS_MAX}
              icon={<Plus size={18} color={colors.textPrimary} strokeWidth={2} />}
              onPress={() => { setWeeks(resizeBuilderWeeks(weeks, weeks.length + 1)); touch(); }} />
          </View>
          <View style={styles.weekGrid}>
            {weeks.map((item, index) => {
              const tone = weekTypeTone(item.type, colors);
              const selected = index === editing;
              return (
                <Pressable key={index} accessibilityRole="button" accessibilityState={{ selected }}
                  accessibilityLabel={`Неделя ${index + 1}, ${weekTypeLabels[item.type]}${item.workouts.length === 0 ? ", пусто" : ""}`}
                  onPress={() => setEditing(index)}
                  style={[styles.weekCard, { borderColor: selected ? tone : withAlpha(tone, 0.45), borderWidth: selected ? 2 : 1,
                    backgroundColor: withAlpha(tone, selected ? 0.14 : 0.06) }]}>
                  <Text style={[styles.weekTitle, { color: colors.textPrimary }]}>{`Неделя ${index + 1}`}</Text>
                  <Text style={[styles.weekType, { color: tone }]}>{weekTypeLabels[item.type]}</Text>
                  <View style={styles.dots}>
                    {WEEK_TYPES.map((type: WeekType) => (
                      <Pressable key={type} accessibilityRole="radio" accessibilityState={{ selected: item.type === type }}
                        accessibilityLabel={`Неделя ${index + 1}: ${weekTypeLabels[type]}`} hitSlop={5}
                        onPress={() => updateWeek(index, { ...item, type })}
                        style={[styles.dot, { backgroundColor: weekTypeTone(type, colors), opacity: item.type === type ? 1 : 0.35 }]} />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title={`Программа недели ${editing + 1}`}>
          {weeks.length > 1 ? <>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Скопировать из недели</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.copyRow}>
              {weeks.map((item, index) => index === editing ? null : (
                <Pressable key={index} accessibilityRole="button" disabled={item.workouts.length === 0}
                  accessibilityLabel={`Скопировать план и тип недели ${index + 1} в неделю ${editing + 1}`}
                  onPress={() => updateWeek(editing, copyWeekPlan(item, () => newPlanId("c")))}
                  style={[styles.copyChip, { borderColor: colors.border, opacity: item.workouts.length === 0 ? 0.4 : 1 }]}>
                  <Text style={[styles.choiceText, { color: colors.textPrimary }]}>{`Неделя ${index + 1}`}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </> : null}
          {week.workouts.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {editing === 0 ? "Добавьте тренировку — пустые недели при создании получат копию."
                : "Пустая неделя при создании получит копию ближайшей заполненной."}
            </Text>
          ) : null}
          <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={weekIssues} showIssues={showIssues} scrollRef={scrollRef}
            onPickExercise={(workoutId) => onPickExercise(workoutId)}
            onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
        </Section>
      </Animated.ScrollView>
      <StickyEditorFooter actionLabel="Создать" busy={busy === "create"} onCancel={onCancel}
        secondaryAction={{ label: "В шаблон", busy: busy === "template", onPress: () => { void saveTemplate(); } }}
        onAction={() => { void create(); }} message={message ?? saved} messageKind={message !== null ? "error" : "success"} />
    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  tabs: { paddingHorizontal: 16, paddingTop: 4 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 10 },
  row: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
  field: { gap: 6 },
  soon: { flex: 1, minHeight: 44, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, alignItems: "center", justifyContent: "center" },
  soonText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  soonBadge: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 13 },
  dirty: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: "uppercase" },
  label: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: { flexBasis: "47%", flexGrow: 1, minHeight: 40, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  choiceText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  date: { minHeight: 42, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  dateText: { fontFamily: fonts.medium, fontSize: 14 },
  counter: { flexDirection: "row", alignItems: "center", gap: 10 },
  count: { minWidth: 28, textAlign: "center", fontFamily: fonts.bold, fontSize: 18 },
  weekGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  weekCard: { width: "48.5%", borderRadius: 14, padding: 10, gap: 3 },
  weekTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18 },
  weekType: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 },
  dots: { flexDirection: "row", gap: 6, marginTop: 6 },
  dot: { flex: 1, maxWidth: 22, aspectRatio: 1, borderRadius: 999 },
  copyRow: { gap: 6 },
  copyChip: { minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, justifyContent: "center" },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
