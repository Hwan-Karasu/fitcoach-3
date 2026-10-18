import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { Ellipsis, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, DropdownMenu, InlineNotice, LoadingState, SelectionChip, TextField } from "../../../../shared/ui/components/public.ts";
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
import { weekTypeLabels, type PeriodizedPlan } from "../domain/PeriodizedModel.ts";
import { setsSummary } from "../domain/SimplePlanRules.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";

/** Неделя программы для панели недель (её рисует дневник — другой модуль). */
export interface ProgramWeeksView {
  /** Меняется при смене мезоцикла: панель начинает с его первой незакрытой недели. */
  readonly key: string;
  readonly weeks: readonly Readonly<{ index: number; caption: string | null; workouts: readonly PlannedWorkout[] }>[];
  readonly weekActions?: (weekIndex: number) => ReactNode;
  readonly selectedWeek?: number;
  readonly onSelectWeek: (weekIndex: number) => void;
}

/**
 * Открытая программа клиента (T01): открытие делает её выбранной у этого клиента. Простая — недели и
 * «Изменить программу»; Расширенная — мезоциклы этого участника (выбор хранится, §48.10), недели выбранного
 * и «Изменить неделю» (T04).
 */
export function ProgramScreen({ clientId, programId, repository, listCandidates, exercises, renderWeeks, onEditStructure,
  onAddMesocycle, onEditWeek, onArchived, requestedWeek, requestedMesocycle, weekCopy, weekSwap, onOpenProgram }: Readonly<{
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
  requestedMesocycle?: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [program, setProgram] = useState<TrainingProgram | null | undefined>(undefined);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
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
  const menuAnchor = useRef<View>(null);
  const [weeksByCycle, setWeeksByCycle] = useState<Readonly<Record<string, number>>>({});
  const scrollByCycle = useRef(new Map<string, number>());
  const cycleKey = periodized?.selectedMesocycleId ?? periodized?.mesocycles[0]?.id ?? "simple";
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const bookRef = useAnimatedRef<Animated.ScrollView>();
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
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: scrollByCycle.current.get(cycleKey) ?? 0, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [cycleKey, scrollRef]);
  const selectWeek = (key: string, week: number) => setWeeksByCycle((current) => ({ ...current, [key]: week }));

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

  const others = program.memberClientIds.filter((id) => id !== clientId);
  return (
    <Animated.ScrollView ref={scrollRef} style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32} onScroll={(event) => scrollByCycle.current.set(cycleKey, event.nativeEvent.contentOffset.y)}>
      <View style={styles.row}><View style={styles.grow}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{program.title}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {program.kind === "PERIODIZED" ? `${programKindLabels[program.kind]} · ${membersWord(program.memberClientIds.length)}`
          : programKindLabels[program.kind]}
      </Text>
      </View><AppIconButton label="Действия программы" buttonRef={menuAnchor}
        icon={<Ellipsis size={24} color={colors.textPrimary} />} onPress={() => setMenuOpen(true)} /></View>
      <DropdownMenu visible={menuOpen} anchor={menuAnchor} title="Программа" selected=""
        options={[{ value: "rename", label: "Переименовать" },
          ...(weekSwap !== undefined && program.kind === "PERIODIZED" ? [{ value: "swap", label: "Поменять недели местами" }] : []),
          { value: "save-program", label: "Сохранить как шаблон" },
          ...(program.kind === "SIMPLE" && onOpenProgram !== undefined ? [{ value: "upgrade", label: "Создать расширенную на основе" }] : []),
          ...(program.kind === "PERIODIZED" && (periodized?.mesocycles.length ?? 0) > 0
            ? [{ value: "save-mesocycle", label: "Сохранить мезоцикл как шаблон" }] : []),
          { value: "archive", label: "В архив" }]}
        onClose={() => setMenuOpen(false)} onSelect={(value) => {
          if (value === "rename") setRenaming(program.title); else if (value === "archive") setConfirmArchive(true);
          else if (value === "swap") { setNotice(null); setMessage(null); setSwapping(true); }
          else if (value === "upgrade") {
            setNotice(null); setMessage(null);
            setUpgrade({ title: `${program.title} — расширенная`.slice(0, 80), clientIds: [clientId] });
          }
          else if (value === "save-program") { setNotice(null); setTemplateForm({ kind: "program", mesocycleId: null, title: program.title }); }
          else if (value === "save-mesocycle") {
            const cycle = periodized?.mesocycles.find((item) => item.id === periodized.selectedMesocycleId) ?? periodized?.mesocycles[0];
            if (cycle !== undefined) { setNotice(null); setTemplateForm({ kind: "mesocycle", mesocycleId: cycle.id, title: cycle.title }); }
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
      {others.length > 0 ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {`Также у: ${others.map((id) => names.get(id) ?? "клиент в архиве").join(", ")}`}
        </Text>
      ) : null}
      {program.kind === "SIMPLE" ? <>
        <AppButton label="Изменить" onPress={onEditStructure} />
        {plan !== null ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Недель: ${plan.weeks} · простая программа`}</Text>
        ) : null}
        {plan !== null && renderWeeks !== undefined ? renderWeeks({ key: "simple", selectedWeek: weeksByCycle.simple,
          onSelectWeek: (week) => selectWeek("simple", week), weeks: simpleWeeks.map((week) => ({ ...week, caption: null })) }) : plan?.workouts.map((workout) => (
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
          ) : renderWeeks?.({ key: selected.id, selectedWeek: weeksByCycle[selected.id],
            onSelectWeek: (week) => selectWeek(selected.id, week),
            weeks: selected.weeks.map((week) => ({ index: week.index, caption: weekTypeLabels[week.type], workouts: week.workouts })),
            weekActions: (weekIndex) => <View style={styles.row}>
              <View style={styles.grow}><AppButton label="Изменить" onPress={() => onEditWeek(selected.id, weekIndex)} /></View>
              {weekCopy !== undefined && selected.weeks.length > 1 ? <View style={styles.grow}>
                <AppButton variant="secondary" label="Копировать" onPress={() => {
                  setNotice(null); setMessage(null);
                  setCopyRequest({ clientId, programId, mesocycleId: selected.id, targetWeek: weekIndex,
                    expectedRevision: periodized.program.revision });
                }} />
              </View> : null}
            </View> })}
          {weekCopy !== undefined ? <WeekCopyFlow port={weekCopy} request={copyRequest}
            weeks={selected?.weeks.map((week) => ({ index: week.index, caption: weekTypeLabels[week.type] })) ?? []}
            onClose={() => setCopyRequest(null)}
            onDone={(result) => { if (result.ok) setNotice(result.text); else setMessage(result.text); }} /> : null}
          {/* Долгое нажатие на мезоцикл — перетащить: порядок свой у этого клиента (у каждого участника своя книга). */}
          <Animated.ScrollView ref={bookRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.book}>
          <Sortable.Flex key={orderReset} gap={8} flexWrap="nowrap" activeItemScale={1.03} scrollableRef={bookRef}
            onDragEnd={({ order }) => {
              const ids = order(periodized.mesocycles.map((item) => item.id));
              setMessage(null);
              void repository.reorderMesocycles(clientId, programId, ids).catch(() => {
                setMessage("Не удалось сохранить порядок мезоциклов. Повторите перетаскивание.");
                setOrderReset((value) => value + 1);
                setVersion((value) => value + 1);
              });
            }}>
            {periodized.mesocycles.map((item) => (
              <Sortable.Touchable key={item.id} accessibilityHint="Долгое нажатие — перетащить"
                accessible accessibilityRole="button" accessibilityLabel={`Мезоцикл: ${item.title}`}
                accessibilityState={{ selected: item.id === selected?.id }}
                onAccessibilityTap={() => { void repository.selectMesocycle(clientId, programId, item.id).catch(() => undefined); }}
                onTap={() => { void repository.selectMesocycle(clientId, programId, item.id).catch(() => undefined); }}>
                <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
                  <SelectionChip group="Мезоцикл" label={item.title} selected={item.id === selected?.id} onPress={() => undefined} />
                </View>
              </Sortable.Touchable>
            ))}
          </Sortable.Flex>
          <AppIconButton label="Добавить мезоцикл" icon={<Plus size={22} color={colors.accentInk} />} onPress={onAddMesocycle} />
          </Animated.ScrollView>
        </>;
      })()}
      {renaming !== null ? (
        <View style={styles.rename}>
          <TextField label="Название" required value={renaming} onChangeText={setRenaming} />
          <View style={styles.row}>
            <View style={styles.grow}><AppButton variant="secondary" label="Отмена" onPress={() => setRenaming(null)} /></View>
            <View style={styles.grow}><AppButton label="Сохранить" busy={busy} onPress={() => { void rename(); }} /></View>
          </View>
        </View>
      ) : null}
      <ConfirmDialog visible={confirmArchive} confirmBusy={busy} title="Перенести в архив?"
        description={others.length > 0
          ? "Программа уйдёт в архив этого клиента. У остальных участников она останется. Вернуть можно из списка программ."
          : "Программа уйдёт в архив клиента. Вернуть можно из списка программ."}
        confirmLabel="В архив" onCancel={() => setConfirmArchive(false)} onConfirm={() => { void archive(); }} />
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  content: { padding: 16, gap: 12 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  rename: { gap: 10 },
  workout: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  workoutTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, marginBottom: 2 },
  row: { flexDirection: "row", gap: 10 },
  book: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 4 },
  grow: { flex: 1 },
});
