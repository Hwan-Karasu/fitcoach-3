import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { CalendarDays, Minus, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, pickDate, SelectionChip, SegmentedControl, StickyEditorFooter, TextField,
  TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { readableInk, withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { statusToneColor, type StatusTone } from "../../../../shared/ui/theme/statusTone.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { applyBuilderScope, cleanBuilderWeeks, copyWeekPlan, CYCLE_TYPES, resizeBuilderWeeks, restForNewExercises, retuneBuilderRest, revertBuilderWeek, type BuilderWeek, type CycleType } from "../domain/MesocycleBuilder.ts";
import type { MesocycleSavePort } from "../domain/MesocycleSave.ts";
import { diffWeek, targetWeeks } from "../domain/PeriodizedRules.ts";
import { ScopeMenu } from "./ScopeMenu.tsx";
import { useRecoveryDraftSave } from "./useRecoveryDraftSave.ts";
import { BuilderDraftExitDialog } from "./BuilderDraftExitDialog.tsx";
import type { MesocycleBuilderDraft } from "../domain/PeriodizedDraft.ts";
import { importedFactRows, isValidFactPatch, setImportedFact, type ImportedFactPatch } from "../domain/ImportedFacts.ts";
import type { RemovedResultsAction } from "../domain/WeekEditSave.ts";
import { REBASED_NOTICE, rebaseBuilderWeeks } from "../domain/DraftRebase.ts";
import { PlacementRows } from "./PlacementRows.tsx";
import type { ClientPlacementOptions, Placement, PlacementTarget } from "../domain/Placement.ts";
import { MESOCYCLE_WEEKS_MAX, WEEK_TYPES, weekTypeLabels, type WeekType } from "../domain/PeriodizedModel.ts";
import { PROGRAM_TITLE_MAX } from "../domain/ProgramRules.ts";
import { setRepsRange } from "../domain/SimplePlanEdits.ts";
import { REST_DEFAULT_SEC, type PlannedWorkout, type PlanRange, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { formatRange, parseRange, setFieldsOf, validateDraft, type PlanIssue } from "../domain/SimplePlanRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingParticipantCandidate } from "../domain/ParticipantCandidate.ts";
import { ParticipantAssignments } from "./ParticipantAssignments.tsx";
import { useExerciseLookupState } from "./useExerciseLookup.ts";
import { usePickedExercise, type PickedExercise } from "./usePickedExercise.ts";
import { weekTypeTone } from "./weekTypeTone.ts";
import { newPlanId, WorkoutsEditor } from "./WorkoutsEditor.tsx";
import { weeksFromTemplate } from "../domain/TemplateModel.ts";
import type { BuilderExcelDraft, BuilderWorkbookCycle, BuilderWorkbookState } from "../domain/BuilderExcelDraft.ts";
import type { BuilderWorkbookSavePort } from "../domain/BuilderWorkbookSave.ts";

const NEW_CYCLE = "__new-cycle__";

const errors: Readonly<Record<string, string>> = {
  NAVIGATION_GROUP_CONFLICT: "Группа выбранного цикла изменилась. Выберите цикл ещё раз.",
  NAVIGATION_REASSIGNMENT_REQUIRED: "Подтвердите перенос выбранного цикла из другой группы.",
  DRAFT_INVALID: `Проверьте названия (до ${PROGRAM_TITLE_MAX} символов), повторения и тренировки — хотя бы одна неделя с упражнениями.`,
  TARGET_NOT_FOUND: "Клиент не найден или в архиве. Обновите список участников.",
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
const NO_ISSUES: readonly PlanIssue[] = [];
const restOfType = (type: CycleType) => CYCLE_TYPES.find((item) => item.id === type)?.restSec ?? REST_DEFAULT_SEC;

/** Статус сохранённой недели в редакторе: подпись, значок и смысл цвета (подаёт навигация из данных выполнения). */
export type BuilderWeekStatus = Readonly<{ label: string; marker: string | null; tone: StatusTone }>;

function WeekStatusLine({ status }: Readonly<{ status: BuilderWeekStatus }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const tone = statusToneColor(status.tone, colors);
  const ink = tone === null ? colors.textSecondary : readableInk(tone, [colors.surface, colors.surfaceRaised], colors.textPrimary);
  return <Text style={[styles.weekStatus, { color: ink }]}>{status.marker === null ? status.label : `${status.marker} ${status.label}`}</Text>;
}
function PeriodizedBuilderBody({ clientId, programId, mesocycleId, templateId, onSwitchCycle, onCycleShown, knownCycles, onCycles, initialWeek, mesocycleSave, repository, exercises, listCandidates, picked,
  onPickExercise, onCreated, onSaved, onCancel, renderTemplates, renderExcel, workbookSave, loadWeekStatuses }: Readonly<{
  workbookSave?: BuilderWorkbookSavePort;
  /** Правка: подписи статуса недель сохранённого мезоцикла («Не начата», «В работе», …) в порядке `weeks`; номер — неделя программы. */
  loadWeekStatuses?: (programId: string, weeks: readonly Readonly<{ index: number; workoutIds: readonly string[] }>[]) => Promise<readonly BuilderWeekStatus[]>;
  renderExcel?: (onApply: (draft: BuilderExcelDraft) => void, targetTitle?: string) => ReactNode;
  clientId: string;
  /** Существующая программа: «+ Мезоцикл» или правка (`mesocycleId`). */
  programId?: string;
  mesocycleId?: string;
  /** Новая программа по шаблону из одного мезоцикла: недели и название берутся из него, если нет несохранённого черновика. */
  templateId?: string;
  /** Правка и «+ Мезоцикл» существующей программы: переход к другому циклу (`undefined` — новый); несохранённое спрашивает защита выхода. */
  onSwitchCycle?: (mesocycleId: string | undefined) => void;
  /** Циклы программы, уже известные предыдущему экрану: полоса видна сразу, пока грузится выбранный цикл. */
  knownCycles?: readonly Readonly<{ id: string; title: string }>[];
  /** Экран показал этот цикл (`undefined` — новый): навигация запоминает его для выхода из конструктора (программа откроется на нём). */
  onCycleShown?: (mesocycleId: string | undefined) => void;
  /** Циклы программы загружены: обёртка хранит их между переключениями, полоса не мигает. */
  onCycles?: (cycles: readonly Readonly<{ id: string; title: string }>[]) => void;
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
  // Статусы недель сохранённого мезоцикла по порядку недель; правки структуры их не меняют, новые недели без подписи.
  const [weekStatuses, setWeekStatuses] = useState<readonly BuilderWeekStatus[]>([]);
  const [dirty, setDirty] = useState(false);
  const [workbook, setWorkbook] = useState<BuilderWorkbookState | null>(null);
  const initialCycleKey = useRef(mesocycleId ? `existing:${mesocycleId}` : newPlanId("cycle"));
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
  /** Циклы этого клиента в существующей программе: полоса переключения над настройками. */
  const [programCycles, setProgramCycles] = useState<readonly Readonly<{ id: string; title: string }>[]>(knownCycles ?? []);
  const cycleShownRef = useRef(onCycleShown); cycleShownRef.current = onCycleShown;
  useEffect(() => { cycleShownRef.current?.(mesocycleId); }, [mesocycleId]);
  const cyclesRef = useRef(onCycles); cyclesRef.current = onCycles;
  useEffect(() => { if (programCycles.length > 0) cyclesRef.current?.(programCycles); }, [programCycles]);
  /** Переключение цикла на месте: с несохранённой правкой сначала спрашивает (сохранить черновик / отбросить / остаться). */
  const [pendingSwitch, setPendingSwitch] = useState<Readonly<{ to: string | undefined }> | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  // Состав группы в правке (UI-OWN-042): убрать — с подтверждением; добавить — с выбором, чей план копировать.
  const [leaving, setLeaving] = useState<string | null>(null);
  const [joining, setJoining] = useState<Readonly<{ ids: readonly string[]; source: string }> | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  // UI-OWN-044: группа мезоцикла в правке и размещение копии у добавляемых клиентов (как в 2.0).
  const [group, setGroup] = useState<readonly string[]>([clientId]);
  const [groupCycles, setGroupCycles] = useState<ReadonlyMap<string, string>>(new Map());
  const [placementOptions, setPlacementOptions] = useState<ReadonlyMap<string, ClientPlacementOptions>>(new Map());
  const [placements, setPlacements] = useState<ReadonlyMap<string, PlacementTarget>>(new Map());
  const refreshGroup = useCallback(async () => {
    if (programId === undefined || mesocycleId === undefined) return;
    const copies = await repository.getMesocycleGroup(clientId, programId, { mesocycleId });
    setGroup(copies.map((copy) => copy.clientId));
    setGroupCycles(new Map(copies.map((copy) => [copy.clientId, copy.mesocycleId])));
  }, [clientId, mesocycleId, programId, repository]);

  // Recovery Draft (§48.29): несохранённая работа переживает «Назад», выгрузку экрана и смерть процесса; публикация — только «Сохранить».
  const scope = useMemo(() => ({ programId: programId ?? null, mesocycleId: mesocycleId ?? null }), [programId, mesocycleId]);
  const recovery = useRecoveryDraftSave<MesocycleBuilderDraft>((value) => repository.saveMesocycleBuilderDraft(clientId, scope, value),
    { hasDraft: dirty, busy: busy !== null, remove: () => repository.clearMesocycleBuilderDraft(clientId, scope) });
  const { schedule } = recovery;
  const baseWeeks = useRef<readonly BuilderWeek[] | null>(null);
  const weeksRef = useRef(weeks);
  weeksRef.current = weeks;
  const [restored, setRestored] = useState(false);
  const [rebased, setRebased] = useState(false);
  const [confirmResults, setConfirmResults] = useState(false);
  const restoreDone = useRef(false);
  const loadedRevision = program !== null && program !== "ERROR" ? program.revision : null;
  const currentCycle = (): BuilderWorkbookCycle => ({
    ...workbook?.cycles.find((c) => c.key === workbook.activeKey), key: workbook?.activeKey ?? initialCycleKey.current,
    title, editing, repsText, settings: { cycleType, repRange: parseRange(repsText) === "invalid" ? null : parseRange(repsText) as PlanRange | null, startDate: startDate || null }, weeks,
  });
  const currentWorkbook = (): BuilderWorkbookState | undefined => workbook ? { ...workbook,
    cycles: workbook.cycles.map((c) => c.key === workbook.activeKey ? currentCycle() : c) } : undefined;
  useEffect(() => {
    if (dirty) schedule({ baseRevision: loadedRevision, programTitle, title, cycleType, repsText, startDate, weeks, editing, members, placements: [...placements].map(([clientId, target]) => ({ clientId, target })),
      baseWeeks: baseWeeks.current, ...(workbook ? { workbook: currentWorkbook() } : {}) });
  }, [dirty, schedule, loadedRevision, programTitle, title, cycleType, repsText, startDate, weeks, editing, members, placements, workbook]);
  useEffect(() => {
    if (restoreDone.current || (mode !== "create" && (program === null || program === "ERROR"))) return;
    restoreDone.current = true;
    repository.getMesocycleBuilderDraft(clientId, scope).then((saved) => {
      if (saved === null) return;
      // Мезоцикл изменился после черновика: правки тренера переносятся на текущий план, а не затирают его.
      const stale = mode === "edit" && (!saved.workbook || saved.workbook.activeKey === initialCycleKey.current) && saved.baseWeeks !== null && saved.baseRevision !== loadedRevision;
      const nextWeeks = stale ? rebaseBuilderWeeks(saved.baseWeeks!, saved.weeks, weeksRef.current, () => newPlanId("r")) : saved.weeks;
      setProgramTitle(saved.programTitle); setTitle(saved.title); setCycleType(saved.cycleType); setRepsText(saved.repsText);
      if (saved.workbook) setWorkbook(saved.baseRevision !== loadedRevision && saved.baseWeeks ? { ...saved.workbook,
        cycles: saved.workbook.cycles.map((c) => c.key === initialCycleKey.current ? { ...c, weeks: rebaseBuilderWeeks(saved.baseWeeks!, c.weeks, weeksRef.current, () => newPlanId("r")) } : c) } : saved.workbook);
      setStartDate(saved.startDate); setWeeks(nextWeeks); setEditing(Math.min(saved.editing, nextWeeks.length - 1));
      setPlacements(new Map((saved.placements ?? []).map((item) => [item.clientId, item.target])));
      setMembers(saved.members.includes(clientId) ? saved.members : [clientId, ...saved.members]);
      // Восстановленное считается уже выбранной областью: меню области не всплывает само.
      baselines.current = new Map(nextWeeks.map((week, index) => [index, week.workouts]));
      setDirty(true); setRestored(true); setRebased(stale);
    }).catch(() => undefined);
  }, [clientId, loadedRevision, mode, program, repository, scope]);

  useEffect(() => {
    if (programId === undefined) return undefined;
    let active = true;
    repository.getPeriodizedPlan(clientId, programId).then((plan) => {
      if (!active) return;
      const cycle = plan?.mesocycles.find((item) => item.id === mesocycleId);
      if (plan === null || (mesocycleId !== undefined && cycle === undefined)) { setProgram("ERROR"); return; }
      setProgram({ revision: plan.program.revision, title: plan.program.title, members: plan.program.memberClientIds });
      setProgramCycles(plan.mesocycles.map((item) => ({ id: item.id, title: item.title })));
      // «+ Мезоцикл» — только у этого участника; остальных тренер добавляет сам (решение владельца).
      setMembers([clientId]);
      void refreshGroup().catch(() => undefined);
      if (cycle === undefined) { setTitle(`Мезоцикл ${plan.mesocycles.length + 1}`); return; }
      setTitle(cycle.title);
      if (cycle.cycleType != null) setCycleType(cycle.cycleType);
      setRepsText(cycle.repRange == null ? "" : formatRange(cycle.repRange).replace("–", "-"));
      if (cycle.startDate != null) setStartDate(cycle.startDate);
      setWeeks(cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts })));
      if (loadWeekStatuses !== undefined && mesocycleId !== undefined) {
        loadWeekStatuses(programId, cycle.weeks.map((week) => ({ index: week.index, workoutIds: week.workouts.map((workout) => workout.id) })))
          .then((labels) => { if (active) setWeekStatuses(labels); }).catch(() => undefined);
      }
      baselines.current = new Map(cycle.weeks.map((week, index) => [index, week.workouts]));
      baseWeeks.current = cycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts }));
      if (initialWeek !== undefined) setEditing(Math.min(Math.max(initialWeek - 1, 0), cycle.weeks.length - 1));
    }).catch(() => { if (active) setProgram("ERROR"); });
    return () => { active = false; };
  }, [clientId, initialWeek, loadWeekStatuses, mesocycleId, programId, refreshGroup, repository]);
  // Добавленные клиенты вне этой программы: куда ляжет их копия.
  const outsiders = useMemo(() => mode === "edit" ? joining?.ids ?? []
    : members.filter((id) => id !== clientId),
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
    target: placements.get(id) ?? placementOptions.get(id)?.preferred ?? { kind: "new" } }));
  const placementRows = (hostTitle: string) => <PlacementRows hostTitle={hostTitle}
    options={outsiders.filter((id) => placements.get(id)?.kind !== "existing").flatMap((id) => placementOptions.get(id) ?? [])} values={placements}
    names={new Map(candidates.map((item) => [item.id, item.displayName]))}
    onChange={(id, target) => { setPlacements((current) => new Map(current).set(id, target)); touch(); }} />;

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
  const templateApplied = useRef(false);
  useEffect(() => {
    if (templateId === undefined || mode !== "create" || templateApplied.current) return;
    templateApplied.current = true;
    void (async () => {
      // Несохранённый черновик важнее: его восстанавливает отдельный эффект выше, шаблон поверх него не ложится.
      if (await repository.getMesocycleBuilderDraft(clientId, scope) !== null) return;
      const template = (await repository.listTemplates()).find((item) => item.id === templateId);
      if (template?.payload.kind !== "PERIODIZED" || template.payload.mesocycles.length === 0) return;
      const cycles = template.payload.mesocycles.map((mesocycle) => ({ key: newPlanId("tpl"), title: mesocycle.title,
        weeks: weeksFromTemplate(mesocycle, () => newPlanId("t")).map((week) => ({ type: week.type, workouts: week.workouts })) }));
      // Несколько мезоциклов — тот же интерфейс «Циклы программы», что у импорта книги Excel: вкладки-циклы, общее сохранение.
      if (cycles.length > 1) { applyWorkbook({ title: template.title, weeks: cycles[0]!.weeks, cycles }); return; }
      const cycle = template.payload.mesocycles[0]!;
      const next = cycles[0]!.weeks;
      setProgramTitle(template.title); setTitle(cycle.title); setWeeks(next); setEditing(0);
      baselines.current = new Map(next.map((week, index) => [index, week.workouts]));
      setDirty(true); setSaved(null); setMessage(null);
    })().catch(() => setMessage("Не удалось открыть шаблон. Конструктор пуст."));
  }, [clientId, mode, repository, scope, templateId]);
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
    // Отдых новых упражнений — по типу цикла (гипертрофия 2:00, сила 3:00 …); заданный вручную не трогается.
    result = restForNewExercises(result, (id) => !before.has(id), restOfType(cycleType));
    updateWeek(editing, { type: week.type, workouts: result.plan.workouts });
  }, [cycleType, editing, lookup, reps, updateWeek, week.type, week.workouts]);
  usePickedExercise(picked, draft, lookup, change);
  const latest = useRef({ weeks, editing });
  latest.current = { weeks, editing };
  const keyboardOpen = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkScope = useCallback(() => {
    if (workbook && workbook.activeKey !== initialCycleKey.current) return;
    if (mode !== "edit") return;
    const { weeks: current, editing: at } = latest.current;
    const baseline = baselines.current.get(at) ?? [];
    if (diffWeek(baseline, current[at]?.workouts ?? []).length > 0) setScopeFor(at);
  }, [mode, workbook]);
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
  // Нажатие вне меню области: правка недели откатывается к состоянию до неё (защита от случайного промаха).
  const dismissScope = () => {
    const at = scopeFor ?? editing;
    setWeeks((current) => revertBuilderWeek(current, at, baselines.current.get(at) ?? []));
    setScopeFor(null);
  };
  // Стабильные колбэки: редактор недели (memo) не перерисовывается из-за несвязанных обновлений экрана.
  const pickRef = useRef(onPickExercise); pickRef.current = onPickExercise;
  const pickExercise = useCallback((workoutId: string) => pickRef.current(workoutId), []);
  const replaceExercise = useCallback((workoutId: string, plannedId: string) => pickRef.current(workoutId, plannedId), []);
  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  // BUILDER-FACTS: результаты импортированного цикла видны и правятся в карточках до сохранения; sourceHash не меняется.
  const imported = workbook?.cycles.find((c) => c.key === workbook.activeKey)?.imported;
  const facts = useMemo(() => imported ? importedFactRows(imported.sessions) : undefined, [imported]);
  const editFact = useCallback((factId: string, patch: ImportedFactPatch) => {
    if (!isValidFactPatch(patch)) return false;
    setWorkbook((state) => state && { ...state, cycles: state.cycles.map((c) => c.key === state.activeKey && c.imported
      ? { ...c, imported: { ...c.imported, sessions: setImportedFact(c.imported.sessions, factId, patch) } } : c) });
    setDirty(true); setSaved(null); setMessage(null);
    return true;
  }, []);
  // Плановые значения, которых профиль упражнения не отслеживает (вес из Excel у «только повторов»), в редакторе не видны:
  // проверяются и сохраняются уже очищенными, чтобы их нельзя было не заметить и не исправить.
  const cleanWeeks = useMemo(() => lookup === null ? weeks : cleanBuilderWeeks(weeks, metricsOf), [lookup, metricsOf, weeks]);
  const issues = useMemo(() => lookup === null ? [] : cleanWeeks.flatMap((item) => item.workouts.length === 0 ? []
    : validateDraft({ title: title || "Мезоцикл", plan: { weeks: 1, workouts: item.workouts } }, metricsOf)), [cleanWeeks, lookup, metricsOf, title]);
  const weekIssues = useMemo(() => lookup === null || week.workouts.length === 0 ? NO_ISSUES
    : validateDraft({ title: draft.title, plan: { weeks: 1, workouts: cleanWeeks[editing]?.workouts ?? week.workouts } }, metricsOf),
  [cleanWeeks, draft.title, editing, lookup, metricsOf, week.workouts]);

  if (program === "ERROR") {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <InlineNotice kind="error">Не удалось открыть мезоцикл. Вернитесь к программе и повторите.</InlineNotice>
    </View>;
  }
  if (lookup === null && lookupState.failed) return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <InlineNotice kind="error">Справочник упражнений не загрузился. Данные не изменены.</InlineNotice>
      <AppButton variant="secondary" label="Повторить" onPress={lookupState.retry} />
    </View>;
  // Полоса циклов не пропадает при переключении: пока грузится выбранный цикл, она остаётся на месте, а загрузка — под ней.
  const requestSwitch = (to: string | undefined) => {
    if (busy !== null) return;
    if (dirty) setPendingSwitch({ to }); else onSwitchCycle?.(to);
  };
  const finishSwitch = async (save: boolean) => {
    if (pendingSwitch === null || switchBusy) return;
    setSwitchBusy(true); setMessage(null);
    try {
      if (save) await recovery.beforePublish(); else await recovery.discard(() => repository.clearMesocycleBuilderDraft(clientId, scope));
      const { to } = pendingSwitch; setPendingSwitch(null); onSwitchCycle?.(to);
    } catch { setMessage(save ? "Не удалось сохранить черновик. Повторите." : "Не удалось удалить черновик. Повторите."); recovery.resume(); }
    finally { setSwitchBusy(false); }
  };
  const cycleStrip = !workbook && onSwitchCycle !== undefined && programId !== undefined && programCycles.length > 0 ? (
    <SegmentedControl scroll wrap items={[...programCycles.map((c) => ({ id: c.id, label: c.id === mesocycleId && program !== null ? title || c.title : c.title })),
      { id: NEW_CYCLE, label: "+ Новый цикл" }]}
      selectedId={mesocycleId ?? NEW_CYCLE} onSelect={(id) => { if (id !== (mesocycleId ?? NEW_CYCLE)) requestSwitch(id === NEW_CYCLE ? undefined : id); }} />
  ) : null;
  if (lookup === null || (mode !== "create" && program === null)) {
    return <View style={[styles.fill, { backgroundColor: colors.canvas }]}>
      {cycleStrip !== null ? <View style={styles.loadingStrip}>{cycleStrip}</View> : null}
      <View style={styles.center}><LoadingState label="Открываем конструктор…" /></View>
    </View>;
  }

  const input = () => ({ title, cycleType, repRange: reps === "invalid" ? null : reps, startDate, weeks: cleanWeeks });
  const openCycle = (cycle: BuilderWorkbookCycle, state = currentWorkbook()) => {
    if (state) setWorkbook({ ...state, activeKey: cycle.key });
    setTitle(cycle.title); setWeeks(cycle.weeks); setEditing(Math.min(cycle.editing ?? 0, cycle.weeks.length - 1));
    setCycleType(cycle.settings?.cycleType ?? "custom"); setRepsText(cycle.repsText ?? (cycle.settings?.repRange ? formatRange(cycle.settings.repRange) : ""));
    setStartDate(cycle.settings?.startDate ?? ""); setScopeFor(null);
    baselines.current = new Map(cycle.weeks.map((w, at) => [at, w.workouts]));
  };
  const applyWorkbook = (imported: BuilderExcelDraft) => {
    const incoming = imported.cycles ?? [{ key: newPlanId("excel"), title: imported.title, settings: imported.settings, weeks: imported.weeks }];
    const meaningful = mode === "edit" || weeks.some((w) => w.workouts.length || w.type !== "base") || weeks.length !== 4
      || !/^Мезоцикл \d+$/u.test(title) || cycleType !== "hypertrophy" || repsText !== "8-12" || startDate !== today();
    const base = currentWorkbook()?.cycles ?? (meaningful ? [currentCycle()] : []);
    const result = [...base];
    for (const cycle of incoming) {
      const existing = result.find((c) => c.key === cycle.key);
      if (existing) {
        if (existing.imported?.sourceHash !== cycle.imported?.sourceHash) throw new Error(`Конфликт цикла «${cycle.title}». Существующий черновик не перезаписан.`);
      } else result.push(cycle);
    }
    const state: BuilderWorkbookState = { version: 1, cycles: result, activeKey: incoming[0]!.key };
    setWorkbook(state); openCycle(result.find((c) => c.key === state.activeKey)!, state);
    if (mode === "create" && !programTitle.trim()) setProgramTitle(imported.title);
    setShowIssues(false); touch();
  };
  const saveWorkbook = async (resultsAction?: RemovedResultsAction) => {
    if (reps === "invalid") { setMessage("Проверьте диапазон повторений текущего цикла."); return; }
    if (!workbookSave || !workbook) { setMessage("Сохранение книги недоступно."); return; }
    const current = currentWorkbook()!;
    const state: BuilderWorkbookState = { ...current, cycles: current.cycles.map((c) => ({ ...c, weeks: cleanBuilderWeeks(c.weeks, metricsOf) })) };
    const invalid = state.cycles.find((c) => !c.title.trim() || c.title.length > PROGRAM_TITLE_MAX || (c.repsText !== undefined && parseRange(c.repsText) === "invalid") || !c.weeks.some((w) => w.workouts.length)
      || c.weeks.some((w) => w.workouts.length > 0 && validateDraft({ title: c.title, plan: { weeks: 1, workouts: w.workouts } }, metricsOf).length > 0));
    if (invalid) { openCycle(invalid, state); setShowIssues(true); setMessage(`Проверьте цикл «${invalid.title}».`); return; }
    if (mode === "create" && !programTitle.trim()) { setMessage("Введите название программы."); return; }
    setBusy("create"); setMessage(null);
    try {
      await recovery.beforePublish();
      const result = await workbookSave.saveBuilderWorkbook({ clientId, scope, expectedRevision: loadedRevision,
        programTitle: mode === "create" ? programTitle : program !== null ? program.title : programTitle,
        cycles: state.cycles, existingCycleKey: mesocycleId ? initialCycleKey.current : null,
        clientIds: mode === "edit" ? [clientId] : [clientId, ...members.filter((id) => id !== clientId)], placements: mode === "edit" ? [] : placementsFor(outsiders),
        ...(resultsAction ? { resultsAction } : {}) });
      setDirty(false); if (mode === "create") onCreated(result.programId); else onSaved?.(result.mesocycleId);
    } catch (cause) {
      recovery.resume();
      if (cause instanceof Error && cause.message === "WEEK_HAS_RESULTS") setConfirmResults(true);
      else setMessage(cause instanceof Error ? errors[cause.message] ?? cause.message : "Книга не сохранена. Черновик на месте.");
    } finally { setBusy(null); }
  };
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
  const saveMesocycle = async (resultsAction?: RemovedResultsAction) => {
    if (workbook) { await saveWorkbook(resultsAction); return; }
    if (!check() || programId === undefined || program === null || mesocycleSave === undefined) return;
    setBusy("create"); setMessage(null);
    try {
      await recovery.beforePublish();
      const result = await mesocycleSave.save({ clientId, programId, expectedRevision: program.revision,
        mesocycleId: mesocycleId ?? null, clientIds: mode === "edit" ? [clientId] : [clientId, ...members.filter((id) => id !== clientId)],
        mesocycle: input(), placements: mode === "edit" ? [] : placementsFor(outsiders), ...(resultsAction === undefined ? {} : { resultsAction }) });
      setDirty(false);
      await repository.clearMesocycleBuilderDraft(clientId, scope).catch(() => undefined);
      onSaved?.(result.mesocycleId);
    } catch (error) {
      recovery.resume();
      // В убираемой или заменяемой тренировке есть результаты: тренер выбирает — удалить окончательно или оставить в истории.
      if (error instanceof Error && error.message === "WEEK_HAS_RESULTS") setConfirmResults(true);
      else setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить мезоцикл. Изменения на экране.");
    } finally { setBusy(null); }
  };
  const create = async () => {
    if (workbook) { await saveWorkbook(); return; }
    if (mode !== "create") { await saveMesocycle(); return; }
    if (!check()) return;
    if (programTitle.trim().length === 0) { setMessage("Введите название программы."); return; }
    setBusy("create"); setMessage(null);
    try {
      await recovery.beforePublish();
      const program = await repository.createPeriodizedProgram({ title: programTitle, clientIds: [clientId, ...members.filter((id) => id !== clientId)],
        mesocycle: input(), placements: placementsFor(outsiders) });
      setDirty(false);
      await repository.clearMesocycleBuilderDraft(clientId, scope).catch(() => undefined);
      onCreated(program.id);
    } catch (error) {
      recovery.resume();
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось создать программу. Черновик на месте.");
    } finally { setBusy(null); }
  };
  /** Отбросить черновик и выйти: на экране остаётся сохранённый план. */
  const discard = async () => {
    setBusy("create"); setMessage(null);
    try {
      await recovery.discard(() => repository.clearMesocycleBuilderDraft(clientId, scope));
      setDirty(false);
      onCancel();
    } catch {
      recovery.resume();
      setMessage("Не удалось отбросить черновик. Изменения остаются на экране.");
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
      <Animated.ScrollView ref={scrollRef} pointerEvents={busy !== null ? "none" : "auto"} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {renderExcel?.(applyWorkbook, mode === "create" ? programTitle || undefined : program?.title)}
        {cycleStrip !== null ? <Section title={`Циклы программы · ${programCycles.length}`}>{cycleStrip}</Section> : null}
        {workbook && <Section title={`Циклы программы · ${workbook.cycles.length}`}>
          <SegmentedControl scroll wrap items={workbook.cycles.map((c) => ({ id: c.key, label: c.key === workbook.activeKey ? title : c.title }))}
            selectedId={workbook.activeKey} onSelect={(key) => { const state = currentWorkbook()!; openCycle(state.cycles.find((c) => c.key === key)!, state); touch(); }} />
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Все циклы сохранятся общей кнопкой конструктора.{workbook.cycles.some((c) => c.imported) ? " Результаты Excel относятся только к этому клиенту." : ""}</Text>
        </Section>}
        {restored ? <InlineNotice kind="info">{rebased ? REBASED_NOTICE : "Восстановлен несохранённый черновик."}</InlineNotice> : null}
        {restored ? <AppButton compact variant="secondary" label="Отбросить черновик и выйти" disabled={busy !== null} onPress={() => { void discard(); }} /> : null}
        {dirty ? <Text style={[styles.dirty, { color: colors.warning }]}>Есть несохранённые изменения</Text> : null}
        <Section title="Настройки мезоцикла">
          {mode === "create" ? <TextField label="Название программы" required value={programTitle} placeholder="Например, «Подготовка к лету»"
            onChangeText={(value) => { setProgramTitle(value); touch(); }} />
            : <Text style={[styles.hint, { color: colors.textSecondary }]}>{`Программа «${program?.title ?? ""}»`}</Text>}
          {mode === "edit" ? <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Правка меняет только цикл этого клиента. У остальных участников сохраняются собственные планы и результаты.
          </Text> : null}
          <TextField label="Название мезоцикла" required value={title} onChangeText={(value) => { setTitle(value); touch(); }} />
          <Text style={[styles.label, { color: colors.textPrimary }]}>Тип цикла</Text>
          <View style={styles.grid}>
            {CYCLE_TYPES.map((item) => (
              <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: cycleType === item.id }}
                accessibilityLabel={item.reps ? `${item.label}, повторения ${formatRange(item.reps)}` : `${item.label}, повторения не заданы`}
                onPress={() => {
                  // Отдых упражнений следует типу цикла: не менявшийся вручную переходит на отдых нового типа во всех неделях.
                  const next = retuneBuilderRest(weeks, restOfType(cycleType), item.restSec);
                  if (next !== weeks) { setWeeks(next); baselines.current = new Map(next.map((value, at) => [at, value.workouts])); }
                  setCycleType(item.id); setRepsText(formatRange(item.reps).replace("–", "-")); touch();
                }}
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
            <ParticipantAssignments repository={repository} hostProgramId={programId ?? null} values={placements} currentCycles={groupCycles}
              onAssign={(id, target) => {
                setPlacements((current) => new Map(current).set(id, target)); touch();
                if (mode === "edit") setJoining((current) => ({ ids: [...new Set([...(current?.ids ?? []), id])], source: current?.source ?? clientId }));
              }} clientId={clientId} memberIds={[...group,
              ...candidates.map((item) => item.id).filter((id) => !group.includes(id))]}
              names={new Map(candidates.map((item) => [item.id, item.displayName]))} selected={[...new Set([...group, ...(joining?.ids ?? [])])]}
              note="Убранный участник сохранит программу, план и результаты — он лишь выйдет из группы."
              onChange={(ids) => {
                const removed = group.find((id) => !ids.includes(id));
                if (removed !== undefined) { setLeaving(removed); return; }
                const added = ids.filter((id) => !group.includes(id) || joining?.ids.includes(id));
                if (added.length === 0) setJoining(null);
                if (added.length > 0) setJoining({ ids: added, source: joining?.source ?? clientId });
              }} />
            {joining !== null ? <View style={[styles.join, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                {`Подключить: ${joining.ids.map(nameOf).join(", ")}. Источник плана для новых копий:`}
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
                <View style={styles.grow}><AppButton compact label="Применить участников" busy={memberBusy}
                  onPress={() => { void changeMembers((revision) => repository.addParticipants(clientId, programId!, revision,
                    mesocycleId!, joining.source, placementsFor(joining.ids))); }} /></View>
              </View>
            </View> : null}
          </> : mode === "edit" ? null : <>
            <ParticipantAssignments repository={repository} hostProgramId={programId ?? null} values={placements}
              onAssign={(id, target) => {
                setPlacements((current) => new Map(current).set(id, target)); touch();

              }} clientId={clientId} memberIds={[clientId, ...candidates.map((item) => item.id).filter((id) => id !== clientId)]}
              names={new Map(candidates.map((item) => [item.id, item.displayName]))} selected={members}
              onChange={(ids) => { setMembers(ids); touch(); }} note="Копия создаст независимый цикл. Нажмите на участника, чтобы подключить существующий." />
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
                  accessibilityLabel={`Неделя ${index + 1}, ${weekTypeLabels[item.type]}${weekStatuses[index] !== undefined ? `, ${weekStatuses[index]!.label}` : ""}${item.workouts.length === 0 ? ", пусто" : ""}`}
                  onPress={() => openWeek(index)}
                  style={[styles.weekCard, { borderColor: selected ? tone : withAlpha(tone, 0.45), borderWidth: selected ? 2 : 1,
                    backgroundColor: withAlpha(tone, selected ? 0.14 : 0.06) }]}>
                  <Text style={[styles.weekTitle, { color: colors.textPrimary }]}>{`Неделя ${index + 1}`}</Text>
                  <Text style={[styles.weekType, { color: tone }]}>{weekTypeLabels[item.type]}</Text>
                  {weekStatuses[index] !== undefined ? <WeekStatusLine status={weekStatuses[index]!} /> : null}
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
            onPickExercise={pickExercise} onReplaceExercise={replaceExercise} {...(facts ? { facts, onFact: editFact } : {})} />
        </Section>
      </Animated.ScrollView>
      <ConfirmDialog visible={leaving !== null} destructive confirmBusy={memberBusy}
        title={`Убрать «${leaving === null ? "" : nameOf(leaving)}» из группы?`}
        description="Программа, план и результаты у него останутся. Из переключателя участников и групповых правок он пропадёт; вернуть можно, добавив снова."
        confirmLabel="Убрать" onCancel={() => setLeaving(null)}
        onConfirm={() => { const id = leaving; if (id !== null) void changeMembers((revision) => repository.leaveGroup(clientId, programId!, revision, mesocycleId!, id)); }} />
      <ConfirmDialog visible={confirmResults} destructive confirmBusy={busy !== null} title="В убираемых тренировках есть результаты"
        description="Тренировки с выполненными подходами исчезнут из плана. Удалить результаты окончательно или сохранить их в истории (в программе они будут недоступны, останутся в истории и статистике)?"
        confirmLabel="Удалить с результатами" tertiaryLabel="Сохранить в истории" cancelLabel="Отмена"
        onCancel={() => setConfirmResults(false)}
        onConfirm={() => { setConfirmResults(false); void saveMesocycle("DELETE"); }}
        onTertiary={() => { setConfirmResults(false); void saveMesocycle("KEEP_HISTORY"); }} />
      <ScopeMenu visible={scopeFor !== null} weekIndex={(scopeFor ?? 0) + 1} onPick={pickScope} onDismiss={dismissScope}
        weeksOf={(scope) => targetWeeks(weeks.map((item, index) => ({ index: index + 1, type: item.type })), (scopeFor ?? 0) + 1, scope)} />
      <StickyEditorFooter actionLabel={mode === "edit" ? "Сохранить" : mode === "add" ? "Добавить" : "Создать"} busy={busy === "create"} onCancel={onCancel}
        secondaryAction={{ label: "В шаблон", busy: busy === "template", onPress: () => { void saveTemplate(); } }}
        onAction={() => { void create(); }} message={recovery.error ?? message ?? saved} messageKind={recovery.error !== null || message !== null ? "error" : "success"} />
      <BuilderDraftExitDialog visible={pendingSwitch !== null} busy={switchBusy} error={message}
        onSave={() => { void finishSwitch(true); }} onDiscard={() => { void finishSwitch(false); }} onContinue={() => setPendingSwitch(null)} />
      <BuilderDraftExitDialog visible={recovery.exitVisible} busy={recovery.exitBusy} error={recovery.error}
        onSave={recovery.saveAndLeave} onDiscard={recovery.discardAndLeave} onContinue={recovery.cancelExit} />
    </TrainingEditorLayout>
  );
}

type BuilderProps = ComponentProps<typeof PeriodizedBuilderBody>;

/**
 * Конструктор расширенной программы. Переключение между циклами существующей программы идёт на месте (CYCLE-STRIP): обёртка помнит выбранный цикл и
 * список циклов, а экран цикла пересоздаётся по ключу — без нового экрана навигации и перехода; состояние цикла сбрасывается целиком.
 */
export function PeriodizedBuilderScreen(props: BuilderProps) {
  const [cycle, setCycle] = useState(props.mesocycleId);
  const [cycles, setCycles] = useState(props.knownCycles);
  return <PeriodizedBuilderBody key={cycle ?? "new"} {...props} mesocycleId={cycle} knownCycles={cycles} onCycles={setCycles}
    onSwitchCycle={props.programId === undefined ? undefined : setCycle} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  fill: { flex: 1 },
  loadingStrip: { paddingHorizontal: 16, paddingTop: 12 },
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
  weekStatus: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 15 },
  dots: { flexDirection: "row", gap: 6, marginTop: 6 },
  dot: { flex: 1, maxWidth: 22, aspectRatio: 1, borderRadius: 999 },
  copyRow: { gap: 6 },
  copyChip: { minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, justifyContent: "center" },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  join: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
});
