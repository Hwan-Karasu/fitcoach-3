import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { CalendarDays, Minus, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, pickDate, SelectionChip, SegmentedControl, StickyEditorFooter, TextField,
  TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { applyBuilderScope, copyWeekPlan, CYCLE_TYPES, resizeBuilderWeeks, type BuilderWeek, type CycleType } from "../domain/MesocycleBuilder.ts";
import type { MesocycleSavePort } from "../domain/MesocycleSave.ts";
import { diffWeek, targetWeeks } from "../domain/PeriodizedRules.ts";
import { ScopeMenu } from "./ScopeMenu.tsx";
import { PlacementRows } from "./PlacementRows.tsx";
import type { ClientPlacementOptions, Placement, PlacementTarget } from "../domain/Placement.ts";
import { MESOCYCLE_WEEKS_MAX, WEEK_TYPES, weekTypeLabels, type WeekType } from "../domain/PeriodizedModel.ts";
import { PROGRAM_TITLE_MAX } from "../domain/ProgramRules.ts";
import { setRepsRange } from "../domain/SimplePlanEdits.ts";
import type { PlannedWorkout, PlanRange, SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { formatRange, parseRange, setFieldsOf, validateDraft } from "../domain/SimplePlanRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";
import { useExerciseLookupState } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { weekTypeTone } from "./weekTypeTone.ts";
import { newPlanId, WorkoutsEditor } from "./WorkoutsEditor.tsx";

const errors: Readonly<Record<string, string>> = {
  DRAFT_INVALID: `Проверьте названия (до ${PROGRAM_TITLE_MAX} символов), повторения и тренировки — хотя бы одна неделя с упражнениями.`,
  TARGET_NOT_FOUND: "Клиент не найден или в архиве. Обновите список участников.",
  WEEK_HAS_RESULTS: "В убираемых или заменяемых тренировках есть результаты — такой план не сохраняется. Верните тренировки или сначала удалите результаты в дневнике.",
  PROGRAM_REVISION_CONFLICT: "Программа изменилась в другом месте. Откройте конструктор ещё раз.",
  PROGRAM_ARCHIVED: "У одного из участников программа в архиве.",
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
 * создаются одной записью. Тот же конструктор открывает «Изменить» (мезоцикл этого клиента целиком) и
 * «+ Мезоцикл» (UI-OWN-041); в правке после изменения недели всплывает меню области.
 */
export function PeriodizedBuilderScreen({ clientId, programId, mesocycleId, initialWeek, mesocycleSave, repository, exercises, listCandidates, picked,
  onPickExercise, onCreated, onSaved, onCancel, renderTemplates }: Readonly<{
  clientId: string;
  /** Существующая программа: «+ Мезоцикл» или правка (`mesocycleId`). */
  programId?: string;
  mesocycleId?: string;
  /** Правка: открыть эту неделю (номер с 1). */
  initialWeek?: number;
  mesocycleSave?: MesocycleSavePort;
  /** Мезоцикл сохранён (правка или «+ Мезоцикл»). */
  onSaved?: (mesocycleId: string) => void;
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
  const lookupState = useExerciseLookupState(exercises);
  const lookup = lookupState.lookup;
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
  const mode = programId === undefined ? "create" : mesocycleId === undefined ? "add" : "edit";
  // Существующая программа: ревизия и участники; `null` — загружается, "ERROR" — не загрузилась.
  const [program, setProgram] = useState<Readonly<{ revision: number; title: string; members: readonly string[] }> | null | "ERROR">(null);
  // Меню области (только в правке): неделя «до» правки и признак открытого меню.
  const baselines = useRef(new Map<number, readonly PlannedWorkout[]>());
  const [scopeFor, setScopeFor] = useState<number | null>(null);
  // Состав группы в правке (UI-OWN-042): убрать — с подтверждением; добавить — с выбором, чей план копировать.
  const [leaving, setLeaving] = useState<string | null>(null);
  const [joining, setJoining] = useState<Readonly<{ ids: readonly string[]; source: string }> | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  // UI-OWN-044: группа мезоцикла в правке и размещение копии у добавляемых клиентов (как в 2.0).
  const [group, setGroup] = useState<readonly string[]>([clientId]);
  const [placementOptions, setPlacementOptions] = useState<ReadonlyMap<string, ClientPlacementOptions>>(new Map());
  const [placements, setPlacements] = useState<ReadonlyMap<string, PlacementTarget>>(new Map());
  const refreshGroup = useCallback(async () => {
    if (programId === undefined || mesocycleId === undefined) return;
    const copies = await repository.getMesocycleGroup(clientId, programId, { mesocycleId });
    setGroup(copies.map((copy) => copy.clientId));
  }, [clientId, mesocycleId, programId, repository]);

  useEffect(() => {
    if (programId === undefined) return undefined;
    let active = true;
    repository.getPeriodizedPlan(clientId, programId).then((plan) => {
      if (!active) return;
      const cycle = plan?.mesocycles.find((item) => item.id === mesocycleId);
      if (plan === null || (mesocycleId !== undefined && cycle === undefined)) { setProgram("ERROR"); return; }
      setProgram({ revision: plan.program.revision, title: plan.program.title, members: plan.program.memberClientIds });
      // «+ Мезоцикл» — только у этого участника; остальных тренер добавляет сам (решение владельца).
      setMembers([clientId]);
      void refreshGroup().catch(() => undefined);
      if (cycle === undefined) { setTitle(`Мезоцикл ${plan.mesocycles.length + 1}`); return; }
      setTitle(cycle.title);
      if (cycle.cycleType != null) setCycleType(cycle.cycleType);
      setRepsText(cycle.repRange == null ? "" : formatRange(cycle.repRange).replace("–", "-"));
      if (cycle.startDate != null) setStartDate(cycle.startDate);
      setWeeks(cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts })));
      baselines.current = new Map(cycle.weeks.map((week, index) => [index, week.workouts]));
      if (initialWeek !== undefined) setEditing(Math.min(Math.max(initialWeek - 1, 0), cycle.weeks.length - 1));
    }).catch(() => { if (active) setProgram("ERROR"); });
    return () => { active = false; };
  }, [clientId, initialWeek, mesocycleId, programId, refreshGroup, repository]);
  // Добавленные клиенты вне этой программы: куда ляжет их копия.
  const outsiders = useMemo(() => mode === "edit" ? joining?.ids ?? []
    : members.filter((id) => id !== clientId && !(mode === "add" && program !== null && program !== "ERROR" && program.members.includes(id))),
  [clientId, joining, members, mode, program]);
  useEffect(() => {
    const missing = outsiders.filter((id) => !placementOptions.has(id));
    if (missing.length === 0) return undefined;
    let active = true;
    repository.getPlacementOptions(missing, programId ?? null).then((rows) => {
      if (active) setPlacementOptions((current) => new Map([...current, ...rows.map((row) => [row.clientId, row] as const)]));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [outsiders, placementOptions, programId, repository]);
  const placementsFor = (ids: readonly string[]): readonly Placement[] => ids.map((id) => ({ clientId: id,
    target: placements.get(id) ?? placementOptions.get(id)?.preferred ?? { kind: "join" } }));
  const placementRows = (hostTitle: string) => <PlacementRows hostTitle={hostTitle}
    options={outsiders.flatMap((id) => placementOptions.get(id) ?? [])} values={placements}
    names={new Map(candidates.map((item) => [item.id, item.displayName]))}
    onChange={(id, target) => setPlacements((current) => new Map(current).set(id, target))} />;

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
  const latest = useRef({ weeks, editing });
  latest.current = { weeks, editing };
  const keyboardOpen = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkScope = useCallback(() => {
    if (mode !== "edit") return;
    const { weeks: current, editing: at } = latest.current;
    const baseline = baselines.current.get(at) ?? [];
    if (diffWeek(baseline, current[at]?.workouts ?? []).length > 0) setScopeFor(at);
  }, [mode]);
  const scheduleScope = useCallback((delay: number) => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = setTimeout(() => { pending.current = null; if (!keyboardOpen.current) checkScope(); }, delay);
  }, [checkScope]);
  useEffect(() => {
    if (mode !== "edit") return undefined;
    const show = Keyboard.addListener("keyboardDidShow", () => {
      keyboardOpen.current = true;
      if (pending.current !== null) { clearTimeout(pending.current); pending.current = null; }
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => { keyboardOpen.current = false; scheduleScope(300); });
    return () => { show.remove(); hide.remove(); if (pending.current !== null) clearTimeout(pending.current); };
  }, [mode, scheduleScope]);
  useEffect(() => { if (mode === "edit" && !keyboardOpen.current) scheduleScope(500); }, [mode, scheduleScope, week.workouts]);
  // Переход к другой неделе без выбора области — правка остаётся только в этой неделе.
  const openWeek = (index: number) => {
    if (pending.current !== null) { clearTimeout(pending.current); pending.current = null; }
    baselines.current.set(editing, week.workouts);
    setEditing(index);
  };
  const pickScope = (scope: Parameters<typeof applyBuilderScope>[3]) => {
    const at = scopeFor ?? editing;
    const baseline = baselines.current.get(at) ?? [];
    const next = scope === "CURRENT" ? weeks : applyBuilderScope(weeks, at, baseline, scope, () => newPlanId("s"));
    setWeeks(next);
    // Новая точка отсчёта: изменённые недели считаются «до» следующей правки.
    next.forEach((item, index) => { if (index === at || item !== weeks[index]) baselines.current.set(index, item.workouts); });
    setScopeFor(null);
  };
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => lookup === null ? [] : weeks.flatMap((item) => item.workouts.length === 0 ? []
    : validateDraft({ title: title || "Мезоцикл", plan: { weeks: 1, workouts: item.workouts } }, metricsOf)), [lookup, metricsOf, title, weeks]);
  const weekIssues = useMemo(() => lookup === null || week.workouts.length === 0 ? [] : validateDraft(draft, metricsOf),
    [draft, lookup, metricsOf, week.workouts.length]);

  if (program === "ERROR") {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <InlineNotice kind="error">Не удалось открыть мезоцикл. Вернитесь к программе и повторите.</InlineNotice>
    </View>;
  }
  if (lookup === null && lookupState.failed) return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <InlineNotice kind="error">Справочник упражнений не загрузился. Данные не изменены.</InlineNotice>
      <AppButton variant="secondary" label="Повторить" onPress={lookupState.retry} />
    </View>;
  if (lookup === null || (mode !== "create" && program === null)) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем конструктор…" /></View>;
  }

  const input = () => ({ title, cycleType, repRange: reps === "invalid" ? null : reps, startDate, weeks });
  const check = () => {
    setShowIssues(true);
    if (reps === "invalid") { setMessage("Повторения: число или диапазон, например 8-12."); return false; }
    if (weeks.every((item) => item.workouts.length === 0)) { setMessage("Добавьте тренировку хотя бы в одну неделю."); return false; }
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте тренировки."); return false; }
    return true;
  };
  const nameOf = (id: string) => candidates.find((item) => item.id === id)?.displayName ?? "Клиент";
  const changeMembers = async (run: (revision: number) => Promise<Readonly<{ revision: number; memberClientIds: readonly string[] }>>) => {
    if (program === null) return;
    setMemberBusy(true); setMessage(null);
    try {
      const next = await run(program.revision);
      setProgram({ ...program, revision: next.revision, members: next.memberClientIds });
      await refreshGroup();
      setLeaving(null); setJoining(null);
    } catch (error) {
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось изменить участников. Состав прежний.");
      setLeaving(null);
    } finally { setMemberBusy(false); }
  };
  const saveMesocycle = async () => {
    if (!check() || programId === undefined || program === null || mesocycleSave === undefined) return;
    setBusy("create"); setMessage(null);
    try {
      const result = await mesocycleSave.save({ clientId, programId, expectedRevision: program.revision,
        mesocycleId: mesocycleId ?? null, clientIds: mode === "edit" ? [clientId] : [clientId, ...members.filter((id) => id !== clientId)],
        mesocycle: input(), placements: mode === "edit" ? [] : placementsFor(outsiders) });
      setDirty(false);
      onSaved?.(result.mesocycleId);
    } catch (error) {
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить мезоцикл. Изменения на экране.");
    } finally { setBusy(null); }
  };
  const create = async () => {
    if (mode !== "create") { await saveMesocycle(); return; }
    if (!check()) return;
    if (programTitle.trim().length === 0) { setMessage("Введите название программы."); return; }
    setBusy("create"); setMessage(null);
    try {
      const program = await repository.createPeriodizedProgram({ title: programTitle, clientIds: [clientId, ...members.filter((id) => id !== clientId)],
        mesocycle: input(), placements: placementsFor(outsiders) });
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

  const tabs = renderTemplates !== undefined && mode === "create" ? (
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
          {mode === "create" ? <TextField label="Название программы" required value={programTitle} placeholder="Например, «Подготовка к лету»"
            onChangeText={(value) => { setProgramTitle(value); touch(); }} />
            : <Text style={[styles.hint, { color: colors.textSecondary }]}>{`Программа «${program?.title ?? ""}»`}</Text>}
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
          {mode === "edit" && program !== null ? <>
            <ParticipantChips clientId={clientId} memberIds={[...group,
              ...candidates.map((item) => item.id).filter((id) => !group.includes(id))]}
              names={new Map(candidates.map((item) => [item.id, item.displayName]))} selected={group}
              note="Убранный участник сохранит программу, план и результаты — он лишь выйдет из группы."
              onChange={(ids) => {
                const removed = group.find((id) => !ids.includes(id));
                if (removed !== undefined) { setLeaving(removed); return; }
                const added = ids.filter((id) => !group.includes(id));
                if (added.length > 0) setJoining({ ids: added, source: joining?.source ?? clientId });
              }} />
            {joining !== null ? <View style={[styles.join, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                {`План для «${joining.ids.map(nameOf).join("», «")}» скопировать у:`}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.copyRow}>
                {group.map((id) => <SelectionChip key={id} group="Источник плана" label={nameOf(id)}
                  selected={joining.source === id} onPress={() => setJoining({ ...joining, source: id })} />)}
              </ScrollView>
              {placementRows(program.title)}
              <Text style={[styles.hint, { color: colors.textSecondary }]}>Результаты не копируются; планы остальных не меняются.</Text>
              <View style={styles.row}>
                <View style={styles.grow}><AppButton compact variant="secondary" label="Отмена" disabled={memberBusy}
                  onPress={() => setJoining(null)} /></View>
                <View style={styles.grow}><AppButton compact label="Добавить" busy={memberBusy}
                  onPress={() => { void changeMembers((revision) => repository.addParticipants(clientId, programId!, revision,
                    mesocycleId!, joining.source, placementsFor(joining.ids))); }} /></View>
              </View>
            </View> : null}
          </> : mode === "edit" ? null : <>
            <ParticipantChips clientId={clientId} memberIds={[clientId, ...candidates.map((item) => item.id).filter((id) => id !== clientId)]}
              names={new Map(candidates.map((item) => [item.id, item.displayName]))} selected={members}
              onChange={(ids) => { setMembers(ids); touch(); }} note="Каждый получит свою копию; результаты у всех свои." />
            {placementRows(mode === "add" && program !== null ? program.title : programTitle)}
          </>}
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
                  onPress={() => openWeek(index)}
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
              {editing === 0 ? "Добавьте тренировку — пустые недели при сохранении получат копию."
                : "Пустая неделя при сохранении получит копию ближайшей заполненной."}
            </Text>
          ) : null}
          <WorkoutsEditor draft={draft} change={change} lookup={lookup} issues={weekIssues} showIssues={showIssues} scrollRef={scrollRef}
            onPickExercise={(workoutId) => onPickExercise(workoutId)}
            onReplaceExercise={(workoutId, plannedId) => onPickExercise(workoutId, plannedId)} />
        </Section>
      </Animated.ScrollView>
      <ConfirmDialog visible={leaving !== null} destructive confirmBusy={memberBusy}
        title={`Убрать «${leaving === null ? "" : nameOf(leaving)}» из группы?`}
        description="Программа, план и результаты у него останутся. Из переключателя участников и групповых правок он пропадёт; вернуть можно, добавив снова."
        confirmLabel="Убрать" onCancel={() => setLeaving(null)}
        onConfirm={() => { const id = leaving; if (id !== null) void changeMembers((revision) => repository.leaveGroup(clientId, programId!, revision, mesocycleId!, id)); }} />
      <ScopeMenu visible={scopeFor !== null} weekIndex={(scopeFor ?? 0) + 1} onPick={pickScope}
        weeksOf={(scope) => targetWeeks(weeks.map((item, index) => ({ index: index + 1, type: item.type })), (scopeFor ?? 0) + 1, scope)} />
      <StickyEditorFooter actionLabel={mode === "edit" ? "Сохранить" : mode === "add" ? "Добавить" : "Создать"} busy={busy === "create"} onCancel={onCancel}
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
  soonBadge: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
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
  join: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
});
