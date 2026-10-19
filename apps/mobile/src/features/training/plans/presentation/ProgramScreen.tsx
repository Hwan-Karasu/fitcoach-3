import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { Archive, ArrowLeftRight, Bookmark, CalendarDays, Copy, Ellipsis, LayoutGrid, Pencil, Plus, Trash2, TrendingUp } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, DropdownMenu, InlineNotice, LoadingState, SegmentedControl, TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { TrainingProgram } from "../domain/ProgramModel.ts";
import { membersWord, PROGRAM_TITLE_MAX, programKindLabels } from "../domain/ProgramRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import type { PlannedWorkout, SimplePlan } from "../domain/SimplePlanModel.ts";
import type { SimpleWeek } from "../domain/SimpleWorkoutEdit.ts";
import type { WeekCopyPort, WeekCopyRequest } from "../domain/WeekCopy.ts";
import { WeekCopyFlow } from "./WeekCopyFlow.tsx";
import type { WeekSwapPort } from "../domain/WeekSwap.ts";
import { WeekSwapPanel } from "./WeekSwapPanel.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";
import { weekTypeLabels, type PeriodizedPlan, type WeekType } from "../domain/PeriodizedModel.ts";
import { setsSummary } from "../domain/SimplePlanRules.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";
import { MesocycleBook } from "./MesocycleBook.tsx";
import { cycleTypeLabels, weekRangeLabel } from "../domain/MesocycleBuilder.ts";
import type { CounterpartRef } from "../domain/ParticipantCounterpart.ts";
import type { MesocycleDeletePort, ProgramDeletePort } from "../domain/PlanDeletion.ts";
import type { Mesocycle } from "../domain/PeriodizedModel.ts";

/** Неделя программы для панели недель (её рисует дневник — другой модуль). */
export interface ProgramWeeksView {
  /** Меняется при смене мезоцикла: панель начинает с его первой незакрытой недели. */
  readonly key: string;
  /** Мезоцикл Расширенной программы (ключ — его родство: у участников группы копии одного мезоцикла). */
  readonly mesocycleId?: string;
  readonly weeks: readonly Readonly<{ index: number; caption: string | null; type?: WeekType; workouts: readonly PlannedWorkout[] }>[];
  readonly weekActions?: (weekIndex: number) => ReactNode;
  readonly selectedWeek?: number;
  readonly onSelectWeek: (weekIndex: number) => void;
  /** UI-OWN-034: верх карточки программы (название, тип, действия) — внутри общей карточки с неделями. */
  readonly header?: (weekIndex: number) => ReactNode;
  /** Между карточкой и тренировками. */
  readonly afterCard?: ReactNode;
}

/**
 * Открытая программа клиента (T01): открытие делает её выбранной у этого клиента. Простая — недели и
 * «Изменить программу»; Расширенная — мезоциклы этого участника (выбор хранится, §48.10), недели выбранного
 * и «Изменить неделю» (T04).
 */
export function ProgramScreen({ clientId, programId, repository, listCandidates, exercises, renderWeeks, renderTemplates, renderParticipants, planDelete, onTabChange, onEditStructure,
  onAddMesocycle, onEditWeek, onArchived, requestedWeek, requestedMesocycle, weekCopy, weekSwap, onOpenProgram, onOpenMatrix }: Readonly<{
  clientId: string;
  programId: string;
  repository: TrainingPlansRepositoryPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  exercises: ExerciseLookupPort;
  /** Недели и тренировки со статусами выполнения (дневник — другой модуль, подставляет навигатор). */
  renderWeeks?: (view: ProgramWeeksView) => ReactNode;
  /** Открыть конструктор структуры (Простая — T02). */
  onEditStructure: () => void;
  /** Расширенная: «+ Мезоцикл» (T04). */
  onAddMesocycle: () => void;
  /** Расширенная: правка недели выбранного мезоцикла (T04). */
  onEditWeek: (mesocycleId: string, weekIndex: number) => void;
  onArchived: () => void;
  requestedWeek?: number;
  /** Копирование недели мезоцикла (§48.21); без порта кнопки нет. */
  weekCopy?: WeekCopyPort;
  /** Перестановка недель мезоцикла (§48.21 п. 5); без порта пункта меню нет. */
  weekSwap?: WeekSwapPort;
  /** Открыть другую программу (созданную на основе этой, §48.17). */
  onOpenProgram?: (programId: string) => void;
  /** T05: матрица недель (обзор программы). */
  onOpenMatrix?: () => void;
  /** UI-OWN-036: вкладка «Шаблоны» — библиотека шаблонов тренера (её с переходами подставляет навигация). */
  renderTemplates?: () => ReactNode;
  /** Смена вкладки — чтобы шапка показала «Программа» или «Шаблоны». */
  onTabChange?: (tab: "program" | "templates") => void;
  requestedMesocycle?: string;
  /** UI-OWN-043: полоса участников группы под шапкой; получает текущее место плана (мезоцикл и неделя). */
  renderParticipants?: (current: () => CounterpartRef) => ReactNode;
  /** §48.11, §50.3: удаление мезоцикла и программы у этого клиента; без порта пунктов нет. */
  planDelete?: MesocycleDeletePort & ProgramDeletePort;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [program, setProgram] = useState<TrainingProgram | null | undefined>(undefined);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [deletingCycle, setDeletingCycle] = useState<Mesocycle | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  // §48.17: новая Расширенная на основе этой Простой — название и участники.
  const [upgrade, setUpgrade] = useState<Readonly<{ title: string; clientIds: readonly string[] }> | null>(null);
  // §48.14–48.15: сохранение плана этого клиента как шаблона; название по умолчанию — из программы/мезоцикла.
  const [templateForm, setTemplateForm] = useState<Readonly<{ kind: "program" | "mesocycle"; mesocycleId: string | null;
    title: string }> | null>(null);
  const [copyRequest, setCopyRequest] = useState<Omit<WeekCopyRequest, "sourceWeek"> | null>(null);
  const [version, setVersion] = useState(0);
  const [plan, setPlan] = useState<SimplePlan | null>(null);
  const [simpleWeeks, setSimpleWeeks] = useState<readonly SimpleWeek[]>([]);
  const [periodized, setPeriodized] = useState<PeriodizedPlan | null>(null);
  const [orderReset, setOrderReset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<"program" | "templates">("program");
  const menuAnchor = useRef<View>(null);
  const [weeksByCycle, setWeeksByCycle] = useState<Readonly<Record<string, number>>>({});
  const scrollByCycle = useRef(new Map<string, number>());
  const cycleKey = periodized?.selectedMesocycleId ?? periodized?.mesocycles[0]?.id ?? "simple";
  // Прокрутка — по родству мезоцикла: при смене участника (своя копия того же мезоцикла) экран остаётся на месте.
  const scrollKey = periodized?.mesocycles.find((item) => item.id === cycleKey)?.lineageId ?? cycleKey;
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // Неделя, показанная в карточке Расширенной программы (её выбирает панель недель): для «Копировать неделю».
  const shownWeek = useRef(1);
  const lookup = useExerciseLookup(exercises);
  const appliedContext = useRef<string | null>(null);
  useEffect(() => {
    if (requestedWeek === undefined || program == null) return;
    const key = requestedMesocycle ?? (program.kind === "SIMPLE" ? "simple" : cycleKey);
    const context = `${key}:${requestedWeek}`;
    if (context === appliedContext.current || (program.kind === "PERIODIZED" && periodized === null)) return;
    appliedContext.current = context;
    setWeeksByCycle((current) => ({ ...current, [key]: requestedWeek }));
    if (key !== "simple" && periodized?.selectedMesocycleId !== key) {
      void repository.selectMesocycle(clientId, programId, key).catch(() => setMessage("Не удалось выбрать мезоцикл."));
    }
  }, [requestedWeek, requestedMesocycle, program, periodized, cycleKey, repository, clientId, programId]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: scrollByCycle.current.get(scrollKey) ?? 0, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [scrollKey, scrollRef]);
  const selectWeek = (key: string, week: number) => setWeeksByCycle((current) => ({ ...current, [key]: week }));

  useEffect(() => { setMessage(null); setNotice(null); }, [clientId, programId]);

  useEffect(() => {
    let active = true;
    repository.getProgram(clientId, programId).then(async (next) => {
      if (!active) return;
      setProgram(next);
      if (next !== null) void repository.selectProgram(clientId, programId).catch(() => undefined);
      if (next?.kind === "SIMPLE") {
        const loaded = await repository.getSimplePlan(clientId, programId);
        const weeks = await repository.getSimpleWeeks(clientId, programId);
        if (active) { setPlan(loaded?.draft.plan ?? null); setSimpleWeeks(weeks); }
      }
      if (next?.kind === "PERIODIZED") {
        const loaded = await repository.getPeriodizedPlan(clientId, programId);
        if (active) setPeriodized(loaded);
      }
    }).catch(() => {
      if (active) { setProgram((current) => current === undefined ? null : current); setMessage("Не удалось загрузить структуру программы."); }
    });
    return () => { active = false; };
  }, [clientId, programId, repository, version]);

  useEffect(() => {
    let active = true;
    listCandidates().then((rows) => { if (active) setNames(new Map(rows.map((row) => [row.id, row.displayName]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [listCandidates]);

  // UI-OWN-044: участники — группа выбранного мезоцикла (копии в любых программах), а не участники программы.
  const [groupSize, setGroupSize] = useState(1);
  useEffect(() => {
    if (cycleKey === "simple") return undefined;
    let active = true;
    repository.getMesocycleGroup(clientId, programId, { mesocycleId: cycleKey })
      .then((copies) => { if (active) setGroupSize(Math.max(1, copies.length)); }).catch(() => undefined);
    return () => { active = false; };
  }, [clientId, cycleKey, programId, repository, version]);

  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.clientIds.includes(clientId)) setVersion((value) => value + 1);
  }), [clientId, repository]);

  if (program === undefined) return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем программу…" /></View>;
  if (program === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <InlineNotice kind="error">Программа не найдена в библиотеке этого клиента.</InlineNotice>
        <AppButton variant="secondary" label="К списку программ" onPress={onArchived} />
      </View>
    );
  }

  const rename = async () => {
    if (renaming === null) return;
    setBusy(true);
    try {
      setProgram(await repository.renameProgram(program.id, program.revision, renaming));
      setRenaming(null);
      setMessage(null);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "DRAFT_INVALID" ? `Введите название (до ${PROGRAM_TITLE_MAX} символов).`
        : code === "PROGRAM_REVISION_CONFLICT" ? "Программа изменилась. Показана новая версия — повторите правку."
          : "Не удалось переименовать.");
      if (code === "PROGRAM_REVISION_CONFLICT") setVersion((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    try {
      await repository.archiveForClient(clientId, program.id);
      setConfirmArchive(false);
      onArchived();
    } catch {
      setMessage("Не удалось перенести в архив. Программа не изменена.");
      setConfirmArchive(false);
    } finally {
      setBusy(false);
    }
  };

  const deleteErrors: Readonly<Record<string, string>> = {
    PROGRAM_REVISION_CONFLICT: "Программа изменилась в другом месте. Показана новая версия — повторите.",
    LAST_MESOCYCLE: "Последний мезоцикл не удаляется: удалите программу целиком.",
  };
  const deleteCycle = async () => {
    const cycle = deletingCycle;
    if (cycle === null || planDelete === undefined || periodized === null) return;
    setBusy(true); setMessage(null);
    try {
      await planDelete.deleteMesocycle({ clientId, programId, mesocycleId: cycle.id, expectedRevision: periodized.program.revision });
      setNotice(`Мезоцикл «${cycle.title}» удалён.`);
    } catch (error) {
      setMessage(deleteErrors[error instanceof Error ? error.message : ""] ?? "Не удалось удалить мезоцикл. Ничего не изменено.");
      setVersion((value) => value + 1);
    } finally { setBusy(false); setDeletingCycle(null); }
  };
  const deleteProgram = async () => {
    if (planDelete === undefined) return;
    setBusy(true); setMessage(null);
    try {
      await planDelete.deleteProgram({ clientId, programId, expectedRevision: program.revision });
      setConfirmDelete(false);
      onArchived();
    } catch (error) {
      setMessage(deleteErrors[error instanceof Error ? error.message : ""] ?? "Не удалось удалить программу. Ничего не изменено.");
      setConfirmDelete(false);
      setVersion((value) => value + 1);
    } finally { setBusy(false); }
  };

  const others = program.memberClientIds.filter((id) => id !== clientId);
  const selectedCycle = () => periodized?.mesocycles.find((item) => item.id === periodized.selectedMesocycleId) ?? periodized?.mesocycles[0];
  const menuButton = <View ref={menuAnchor} collapsable={false} style={[styles.more, { backgroundColor: colors.surfaceRaised }]}>
    <AppIconButton compact label="Действия программы"
      icon={<Ellipsis size={20} color={colors.textPrimary} />} onPress={() => setMenuOpen(true)} />
  </View>;
  // Переключатель «Программа | Шаблоны» (макет владельца, UI-OWN-036): над содержимым, не прокручивается.
  const tabs = renderTemplates !== undefined ? <View style={[styles.tabs, { backgroundColor: colors.canvas }]}>
    <SegmentedControl items={[{ id: "program", label: "Программа" }, { id: "templates", label: "Шаблоны" }]}
      selectedId={tab} onSelect={(next) => { setTab(next); onTabChange?.(next); }} />
  </View> : null;
  const participants = renderParticipants?.(() => ({ mesocycleId: selectedCycle()?.id ?? null,
    weekIndex: weeksByCycle[cycleKey] ?? shownWeek.current, workoutId: null }));
  if (tab === "templates" && renderTemplates !== undefined) {
    return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{tabs}{participants}{renderTemplates()}</View>;
  }
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
    {tabs}
    {participants}
    <Animated.ScrollView ref={scrollRef} style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32} onScroll={(event) => scrollByCycle.current.set(scrollKey, event.nativeEvent.contentOffset.y)}>
      {program.kind === "PERIODIZED" && periodized !== null && periodized.mesocycles.length === 0 ? <View style={styles.row}><View style={styles.grow}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{program.title}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {program.kind === "PERIODIZED" ? `${programKindLabels[program.kind]} · ${membersWord(program.memberClientIds.length)}`
          : programKindLabels[program.kind]}
      </Text>
      </View><AppIconButton label="Действия программы" buttonRef={menuAnchor}
        icon={<Ellipsis size={24} color={colors.textPrimary} />} onPress={() => setMenuOpen(true)} /></View> : null}
      <DropdownMenu visible={menuOpen} anchor={menuAnchor} title="Программа" selected=""
        options={[{ value: "rename", label: "Переименовать", icon: (color: string) => <Pencil size={18} color={color} strokeWidth={2} /> },
          ...(weekSwap !== undefined && program.kind === "PERIODIZED" ? [{ value: "swap", label: "Поменять недели местами",
            icon: (color: string) => <ArrowLeftRight size={18} color={color} strokeWidth={2} /> }] : []),
          ...(onOpenMatrix !== undefined ? [{ value: "matrix", label: "Матрица недель", icon: (color: string) => <LayoutGrid size={18} color={color} strokeWidth={2} /> }] : []),
          { value: "save-program", label: "Сохранить как шаблон", icon: (color: string) => <Bookmark size={18} color={color} strokeWidth={2} /> },
          ...(program.kind === "SIMPLE" && onOpenProgram !== undefined ? [{ value: "upgrade", label: "Создать расширенную на основе",
            icon: (color: string) => <TrendingUp size={18} color={color} strokeWidth={2} /> }] : []),
          ...(program.kind === "PERIODIZED" && weekCopy !== undefined && (selectedCycle()?.weeks.length ?? 0) > 1
            ? [{ value: "copy-week", label: "Копировать неделю", icon: (color: string) => <Copy size={18} color={color} strokeWidth={2} /> }] : []),
          ...(program.kind === "PERIODIZED" && (periodized?.mesocycles.length ?? 0) > 0
            ? [{ value: "save-mesocycle", label: "Сохранить мезоцикл как шаблон", icon: (color: string) => <Bookmark size={18} color={color} strokeWidth={2} /> }] : []),
          { value: "archive", label: "В архив", icon: (color: string) => <Archive size={18} color={color} strokeWidth={2} /> },
          ...(planDelete !== undefined && program.kind === "PERIODIZED" && (periodized?.mesocycles.length ?? 0) > 1
            ? [{ value: "delete-mesocycle", label: "Удалить мезоцикл", danger: true,
              icon: (color: string) => <Trash2 size={18} color={color} strokeWidth={2} /> }] : []),
          ...(planDelete !== undefined ? [{ value: "delete-program", label: "Удалить программу", danger: true,
            icon: (color: string) => <Trash2 size={18} color={color} strokeWidth={2} /> }] : [])]}
        onClose={() => setMenuOpen(false)} onSelect={(value) => {
          if (value === "rename") setRenaming(program.title); else if (value === "archive") setConfirmArchive(true);
          else if (value === "delete-program") setConfirmDelete(true);
          else if (value === "delete-mesocycle") setDeletingCycle(selectedCycle() ?? null);
          else if (value === "swap") { setNotice(null); setMessage(null); setSwapping(true); }
          else if (value === "matrix") onOpenMatrix?.();
          else if (value === "upgrade") {
            setNotice(null); setMessage(null);
            setUpgrade({ title: `${program.title} — расширенная`.slice(0, 80), clientIds: [clientId] });
          }
          else if (value === "save-program") { setNotice(null); setTemplateForm({ kind: "program", mesocycleId: null, title: program.title }); }
          else if (value === "save-mesocycle") {
            const cycle = selectedCycle();
            if (cycle !== undefined) { setNotice(null); setTemplateForm({ kind: "mesocycle", mesocycleId: cycle.id, title: cycle.title }); }
          }
          else if (value === "copy-week") {
            const cycle = selectedCycle();
            if (cycle !== undefined && periodized !== null) {
              setNotice(null); setMessage(null);
              setCopyRequest({ clientId, programId, mesocycleId: cycle.id, targetWeek: shownWeek.current,
                expectedRevision: periodized.program.revision });
            }
          }
        }} />
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      {upgrade !== null ? (
        <View style={styles.rename}>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            Новая Расширенная программа: план этой программы по неделям станет первым мезоциклом. Эта программа и её
            результаты не изменятся, результаты в новую не переносятся.
          </Text>
          <TextField label="Название новой программы" required value={upgrade.title}
            onChangeText={(title) => setUpgrade({ ...upgrade, title })} />
          <ParticipantChips clientId={clientId} memberIds={[clientId, ...[...names.keys()].filter((id) => id !== clientId)]}
            names={names} selected={upgrade.clientIds} onChange={(clientIds) => setUpgrade({ ...upgrade, clientIds })}
            note="Каждый получит свою копию плана; результаты у всех свои." />
          <View style={styles.row}>
            <View style={styles.grow}><AppButton variant="secondary" label="Отмена" onPress={() => setUpgrade(null)} /></View>
            <View style={styles.grow}><AppButton label="Создать" busy={busy} disabled={upgrade.title.trim().length === 0}
              onPress={() => {
                const form = upgrade;
                setBusy(true); setMessage(null);
                void repository.createPeriodizedFromSimple(clientId, programId, { title: form.title, mesocycleTitle: "Мезоцикл 1",
                  clientIds: form.clientIds })
                  .then((created) => { setUpgrade(null); onOpenProgram?.(created.id); })
                  .catch((error: unknown) => setMessage(error instanceof Error && error.message === "DRAFT_INVALID"
                    ? "Введите название (до 80 символов)." : "Не удалось создать программу. Эта программа не изменена."))
                  .finally(() => setBusy(false));
              }} /></View>
          </View>
        </View>
      ) : null}
      {templateForm !== null ? (
        <View style={styles.rename}>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {templateForm.kind === "program" ? "Шаблон программы: только план этого клиента, без результатов."
              : "Шаблон мезоцикла: только план этого клиента, без результатов."}
          </Text>
          <TextField label="Название шаблона" required value={templateForm.title}
            onChangeText={(title) => setTemplateForm({ ...templateForm, title })} />
          <View style={styles.row}>
            <View style={styles.grow}><AppButton variant="secondary" label="Отмена" onPress={() => setTemplateForm(null)} /></View>
            <View style={styles.grow}><AppButton label="Сохранить" busy={busy} disabled={templateForm.title.trim().length === 0}
              onPress={() => {
                const form = templateForm;
                setBusy(true); setMessage(null);
                const saving = form.kind === "program" || form.mesocycleId === null
                  ? repository.saveProgramAsTemplate(clientId, programId, form.title)
                  : repository.saveMesocycleAsTemplate(clientId, programId, form.mesocycleId, form.title);
                void saving.then((template) => { setTemplateForm(null); setNotice(`Шаблон «${template.title}» сохранён.`); })
                  .catch((error: unknown) => setMessage(error instanceof Error && error.message === "DRAFT_INVALID"
                    ? "Введите название (до 80 символов); у программы должен быть хотя бы один мезоцикл."
                    : "Не удалось сохранить шаблон. Программа не изменена."))
                  .finally(() => setBusy(false));
              }} /></View>
          </View>
        </View>
      ) : null}
      {message !== null && plan === null && periodized === null ? <AppButton label="Повторить загрузку" variant="secondary"
        onPress={() => { setMessage(null); setVersion((value) => value + 1); }} /> : null}
      {others.length > 0 && renderParticipants === undefined ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {`Также у: ${others.map((id) => names.get(id) ?? "клиент в архиве").join(", ")}`}
        </Text>
      ) : null}
      {program.kind === "SIMPLE" ? <>
        {plan !== null && renderWeeks !== undefined ? renderWeeks({ key: "simple", selectedWeek: weeksByCycle.simple,
          onSelectWeek: (week) => selectWeek("simple", week), weeks: simpleWeeks.map((week) => ({ ...week, caption: null })),
          // Компоновка владельца (UI-OWN-034): название, неделя, тип; «Изменить», «В шаблоны», «⋯».
          header: (week) => <View style={styles.cardHead}>
            <Text accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.cardTitle, { color: colors.textPrimary }]}>{program.title}</Text>
            <View style={styles.cardMeta}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Неделя ${week} из ${plan.weeks}`}</Text>
              <Text style={[styles.kind, { color: colors.accentInk, backgroundColor: colors.accentSoft }]}>{programKindLabels[program.kind]}</Text>
            </View>
            <View style={styles.cardActions}>
              <View style={styles.grow}><AppButton compact label="Изменить"
                icon={(color) => <Pencil size={16} color={color} strokeWidth={2} />} onPress={onEditStructure} /></View>
              <View style={styles.grow}><AppButton compact variant="secondary" label="В шаблоны"
                icon={(color) => <Bookmark size={16} color={color} strokeWidth={2} />}
                onPress={() => { setNotice(null); setTemplateForm({ kind: "program", mesocycleId: null, title: program.title }); }} /></View>
              {menuButton}
            </View>
          </View>,
          afterCard: <AppButton variant="secondary" label="Добавить тренировку"
            icon={(color) => <Plus size={18} color={color} strokeWidth={2} />} onPress={onEditStructure} />,
        }) : plan?.workouts.map((workout) => (
          <View key={workout.id} style={[styles.workout, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.workoutTitle, { color: colors.textPrimary }]}>{workout.title}</Text>
            {workout.exercises.length === 0 ? (
              <Text style={[styles.meta, { color: colors.textMuted }]}>Упражнений нет</Text>
            ) : workout.exercises.map((exercise, index) => (
              <Text key={exercise.id} style={[styles.body, { color: colors.textPrimary }]}>
                {`${index + 1}. ${lookup?.get(exercise.exerciseId)?.name ?? "…"} — ${setsSummary(exercise)}`}
              </Text>
            ))}
          </View>
        ))}
      </> : periodized === null ? <LoadingState label="Открываем мезоциклы…" /> : (() => {
        const selected = periodized.mesocycles.find((item) => item.id === periodized.selectedMesocycleId) ?? periodized.mesocycles[0];
        return <>
          {swapping && weekSwap !== undefined && selected !== undefined ? <WeekSwapPanel scrollRef={scrollRef}
            weeks={selected.weeks.map((week) => ({ id: week.id, index: week.index, caption: weekTypeLabels[week.type],
              workouts: week.workouts.length }))}
            onDone={() => setSwapping(false)}
            onSwap={async (first, second) => {
              setMessage(null);
              try {
                await weekSwap.swap({ clientId, programId, mesocycleId: selected.id, first, second,
                  expectedRevision: periodized.program.revision });
                setNotice(`Недели ${first} и ${second} поменялись местами.`);
                return true;
              } catch (error) {
                const code = error instanceof Error ? error.message : "";
                setMessage(code === "PROGRAM_REVISION_CONFLICT" ? "Программа изменилась — показан новый порядок, повторите."
                  : code === "WEEK_SWAP_NO_SLOT" ? "В мезоцикле 52 недели — перестановка недоступна."
                    : "Не удалось поменять недели местами. Порядок прежний.");
                setVersion((value) => value + 1);
                return false;
              }
            }} /> : selected === undefined ? (
            <InlineNotice kind="info">Мезоциклов пока нет. Создайте первый: план первой недели скопируется во все недели.</InlineNotice>
          ) : renderWeeks?.({ key: selected.lineageId, mesocycleId: selected.id, selectedWeek: weeksByCycle[selected.id],
            onSelectWeek: (week) => selectWeek(selected.id, week),
            weeks: selected.weeks.map((week) => ({ index: week.index, caption: weekTypeLabels[week.type], type: week.type, workouts: week.workouts })),
            // Компоновка 2.0 (UI-OWN-040): мезоцикл, даты и номер недели, тип цикла и недели; «Изменить», «В шаблоны», «⋯».
            header: (weekIndex) => {
              shownWeek.current = weekIndex;
              const planWeek = selected.weeks.find((week) => week.index === weekIndex);
              return <View style={styles.cardHead}>
                <View>
                  <Text accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.cardTitle, { color: colors.textPrimary }]}>{selected.title}</Text>
                  <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>
                    {`${program.title} · ${membersWord(groupSize)}`}
                  </Text>
                </View>
                <View style={styles.cardMeta}>
                  <View style={[styles.dates, { backgroundColor: colors.surfaceRaised }]}>
                    <CalendarDays size={15} color={colors.textPrimary} strokeWidth={2} />
                    <Text style={[styles.tag, { color: colors.textPrimary }]}>
                      {selected.startDate != null ? `${weekRangeLabel(selected.startDate, weekIndex)} · Неделя ${weekIndex}`
                        : `Неделя ${weekIndex} из ${selected.weeks.length}`}
                    </Text>
                  </View>
                  {selected.cycleType != null ? <Text style={[styles.kind, { color: colors.textSecondary, backgroundColor: colors.surfaceRaised }]}>
                    {cycleTypeLabels[selected.cycleType]}</Text> : null}
                  {planWeek !== undefined ? <Text style={[styles.kind, styles.kindStrong, { color: colors.accentInk, backgroundColor: colors.accentSoft }]}>
                    {weekTypeLabels[planWeek.type]}</Text> : null}
                </View>
                <View style={styles.cardActions}>
                  <View style={styles.grow}><AppButton compact label="Изменить"
                    icon={(color) => <Pencil size={16} color={color} strokeWidth={2} />} onPress={() => onEditWeek(selected.id, weekIndex)} /></View>
                  <View style={styles.grow}><AppButton compact variant="secondary" label="В шаблоны"
                    icon={(color) => <Bookmark size={16} color={color} strokeWidth={2} />}
                    onPress={() => { setNotice(null); setTemplateForm({ kind: "mesocycle", mesocycleId: selected.id, title: selected.title }); }} /></View>
                  {menuButton}
                </View>
              </View>;
            } })}
          {weekCopy !== undefined ? <WeekCopyFlow port={weekCopy} request={copyRequest}
            weeks={selected?.weeks.map((week) => ({ index: week.index, caption: weekTypeLabels[week.type] })) ?? []}
            onClose={() => setCopyRequest(null)}
            onDone={(result) => { if (result.ok) setNotice(result.text); else setMessage(result.text); }} /> : null}
          <MesocycleBook mesocycles={periodized.mesocycles} selectedId={selected?.id} resetKey={orderReset} onAdd={onAddMesocycle}
            onDelete={planDelete === undefined ? undefined : setDeletingCycle}
            onSelect={(id) => { void repository.selectMesocycle(clientId, programId, id).catch(() => undefined); }}
            onReorder={(ids) => {
              setMessage(null);
              void repository.reorderMesocycles(clientId, programId, ids).catch(() => {
                setMessage("Не удалось сохранить порядок мезоциклов. Повторите перетаскивание.");
                setOrderReset((value) => value + 1);
                setVersion((value) => value + 1);
              });
            }} />
        </>;
      })()}
      {renaming !== null ? (
        <View style={styles.rename}>
          <TextField label="Название" required value={renaming} onChangeText={setRenaming} />
          {others.length > 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {`Название общее: сменится у всех участников программы (${others.length + 1}).`}
          </Text> : null}
          <View style={styles.row}>
            <View style={styles.grow}><AppButton variant="secondary" label="Отмена" onPress={() => setRenaming(null)} /></View>
            <View style={styles.grow}><AppButton label="Сохранить" busy={busy} onPress={() => { void rename(); }} /></View>
          </View>
        </View>
      ) : null}
      <ConfirmDialog visible={deletingCycle !== null} destructive confirmBusy={busy} title={`Удалить «${deletingCycle?.title ?? ""}»?`}
        description="Мезоцикл и все его тренировки, включая записанные результаты, удалятся у этого клиента. У других участников группы их копии останутся. Это нельзя отменить."
        confirmLabel="Удалить" onCancel={() => setDeletingCycle(null)} onConfirm={() => { void deleteCycle(); }} />
      <ConfirmDialog visible={confirmDelete} destructive confirmBusy={busy} title={`Удалить программу «${program.title}» полностью?`}
        description={others.length > 0
          ? "Удалятся план и все результаты этого клиента. У остальных участников программа останется. Это нельзя отменить."
          : "Программа, план и все результаты будут удалены. Это нельзя отменить. Если нужно лишь убрать программу из списка — «В архив»."}
        confirmLabel="Удалить" onCancel={() => setConfirmDelete(false)} onConfirm={() => { void deleteProgram(); }} />
      <ConfirmDialog visible={confirmArchive} confirmBusy={busy} title="Перенести в архив?"
        description={others.length > 0
          ? "Программа уйдёт в архив этого клиента. У остальных участников она останется. Вернуть можно из списка программ."
          : "Программа уйдёт в архив клиента. Вернуть можно из списка программ."}
        confirmLabel="В архив" onCancel={() => setConfirmArchive(false)} onConfirm={() => { void archive(); }} />
    </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  content: { padding: 16, gap: 12 },
  heading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23 },
  screen: { flex: 1 },
  tabs: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 2 },
  cardHead: { gap: 12 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.2 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  kind: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, overflow: "hidden" },
  kindStrong: { fontFamily: fonts.bold },
  tag: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  dates: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  more: { borderRadius: 14, alignItems: "center", justifyContent: "center" },
  meta: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  rename: { gap: 10 },
  workout: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  workoutTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, marginBottom: 2 },
  row: { flexDirection: "row", gap: 10 },
  grow: { flex: 1 },
});
