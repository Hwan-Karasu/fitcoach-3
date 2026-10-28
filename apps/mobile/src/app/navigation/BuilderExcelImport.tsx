import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, InlineNotice, LoadingState, ScreenHeader, SegmentedControl, TextField } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { CustomExerciseEditorScreen, ExerciseLibraryScreen, displayNameOf, type CatalogEntry, type ExerciseCatalogPort, type CatalogBackHandle } from "../../features/exercises/public.ts";
import { applyWorkbookColumns, autoMatchWorkbookEntry, builderWorkbookImport, compileWholeWorkbook, correctWorkbookValue,
  emptyWorkbookSheet, prepareWorkbookResponsive, requireWorkbookNameChoices, selectWorkbookImportSheets, selectWorkbookSheet, setWorkbookNameMatch,
  startWorkbookReview, updateWorkbookEntry, wholeWorkbookStatus, workbookMatchesToRemember, workbookSourceNames, workbookUnmatchedTargets,
  mergeLogNames, parseWorkoutLog, similarLogNames, workoutLogWorkbook,
  type ExerciseImportMatch, type ExerciseImportMatchesPort, type PickedWorkbook, type TrainingTransfer, type WorkbookFilesPort,
  type WorkbookReviewEntry, type WorkbookReviewSession, type WorkoutLog } from "../../features/import/public.ts";
import { CYCLE_TYPES, type BuilderExcelDraft } from "../../features/training/public.ts";
import { localToday, TextLogDistribution, TextLogInput, type LogCycleType } from "./TextLogImport.tsx";
import { AiTableHelp } from "./AiTableHelp.tsx";
import { TrainingTransferReviewScreen } from "./TrainingTransferReviewScreen.tsx";
import { WorkbookColumnSettings } from "./WorkbookColumnSettings.tsx";
import { RememberedImportMatchesDialog } from "./RememberedImportMatchesDialog.tsx";
import { previousImportPage } from "./importBack.ts";

export type WorkbookImportTarget = Readonly<{ kind: "PROGRAM"; title?: string;
  save: (value: TrainingTransfer, mapping: Readonly<Record<string, string>>, matches: readonly ExerciseImportMatch[]) => Promise<void> }>
  | Readonly<{ kind: "BUILDER"; title?: string; apply: (draft: BuilderExcelDraft) => void }>;
type Page = "text" | "distribute" | "reading" | "sheets" | "history" | "review" | "confirm" | "catalog" | "create" | null;
const HINTS_SHOWN = 6;
const TEXT_MAX = 200_000;
const yieldFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 32));

/** Exactly one host modal. Active tab is presentation; selected sheets are the write scope. */
export function BuilderExcelImport({ files, exercises, target, clientName = "Конструктор", label = "Импортировать из Excel", renderTrigger, memory }: Readonly<{
  files: WorkbookFilesPort; exercises: ExerciseCatalogPort; target: WorkbookImportTarget; clientName?: string; label?: string;
  memory?: ExerciseImportMatchesPort;
  /** `onText` — тот же импорт из текста заметок (TEXT-LOG-2). */
  renderTrigger?: (onPress: () => void, disabled: boolean, onText: () => void) => ReactNode;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const [page, setPage] = useState<Page>(null);
  const [session, setSession] = useState<WorkbookReviewSession | null>(null);
  const [catalog, setCatalog] = useState<readonly CatalogEntry[]>([]);
  const [sourceId, setSourceId] = useState(""); const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false); const [committing, setCommitting] = useState(false);
  const [error, setError] = useState(""); const [progress, setProgress] = useState("");
  const [proposals, setProposals] = useState<readonly ExerciseImportMatch[] | null>(null);
  const [notice, setNotice] = useState("");
  const [logText, setLogText] = useState(""); const [log, setLog] = useState<WorkoutLog | null>(null);
  const [cycleType, setCycleType] = useState<LogCycleType>("hypertrophy");
  const [similar, setSimilar] = useState<readonly (readonly [string, string])[]>([]); const [merged, setMerged] = useState<ReadonlySet<number>>(new Set());
  const catalogBack = useRef<CatalogBackHandle>(null);
  const operation = useRef(0); const locked = useRef(false); const writing = useRef(false);
  const pageRef = useRef(page); pageRef.current = page;
  useEffect(() => () => { operation.current += 1; }, []);
  const current = session?.entries[session.activeId];
  const status = session ? wholeWorkbookStatus(session) : null;
  const candidates = (rows: readonly CatalogEntry[]) => rows.map((entry) => ({ id: entry.definition.id, name: displayNameOf(entry), available: !entry.overlay.hidden }));
  const match = (review: WorkbookReviewSession) => autoMatchWorkbookEntry(review, candidates(catalog));
  const close = () => {
    if (writing.current) return;
    operation.current += 1; locked.current = false; setBusy(false); setPage(null); setSession(null); setProposals(null); setError(""); setNotice("");
  };
  const run = async (task: (id: number) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; const id = ++operation.current; setBusy(true); setError("");
    try { await task(id); }
    catch (cause) { if (id === operation.current) setError(cause instanceof Error ? cause.message : "Не удалось обработать Excel."); }
    finally { if (id === operation.current) { locked.current = false; setBusy(false); } }
  };
  const back = () => {
    if (writing.current) return;
    if (page === "reading" || page === "text") { close(); return; }
    if (page === "distribute") { setError(""); setPage("text"); return; }
    if (page === "history") { setProposals(null); setPage("review"); return; }
    if (page === "sheets" || page === "confirm") { setPage("review"); return; }
    if (page === "catalog" || page === "create") { const previous = previousImportPage(page, catalogBack.current); if (previous !== null) setPage(previous); return; }
    close();
  };
  const pick = () => { void run(async (id) => {
    setPage(null); await yieldFrame();
    const picked = await files.pick({ active: () => id === operation.current, onReading: async () => {
      if (id !== operation.current) return; setProgress("Читаем книгу Excel…"); setPage("reading"); await yieldFrame();
    } });
    if (id !== operation.current) return;
    if (!picked) { setPage(session ? "review" : null); return; }
    await open(picked, id);
  }); };
  /** Общая сверка для книги Excel и для заметок. */
  const open = async (picked: PickedWorkbook, id: number) => {
    setPage("reading"); setProgress("Загружаем каталог…"); await yieldFrame();
    const entries = await exercises.list(); if (id !== operation.current) return; setCatalog(entries);
    const started = startWorkbookReview(picked, false); const prefix = `${clientName} — `;
    const initial = { ...started, programTitle: target.title || (started.programTitle.startsWith(prefix) ? started.programTitle.slice(prefix.length) : started.programTitle) };
    const review = await prepareWorkbookResponsive(initial, candidates(entries), () => id === operation.current,
      (done, total) => setProgress(`Подготовка листов: ${done} из ${total}`));
    if (!review) return;
    setSession(review); setNotice(""); setPage("review"); await yieldFrame();
    if (!memory) return;
    setProgress("Проверяем прошлые сопоставления…");
    try {
      const suggestions = await memory.getExerciseMatches(workbookSourceNames(review));
      if (id !== operation.current) return;
      if (suggestions.length) { setSession(requireWorkbookNameChoices(review, suggestions.map((m) => m.sourceName))); setProposals(suggestions); setPage("history"); }
    } catch { if (id === operation.current) setNotice("Прошлые сопоставления недоступны. Можно выбрать упражнения вручную."); }
  };
  const startText = () => {
    if (locked.current) return;
    setSession(null); setLog(null); setError(""); setNotice(""); setPage("text");
  };
  const parseText = () => {
    if (logText.length > TEXT_MAX) { setError("Текст слишком длинный: вставьте его частями до 200 000 символов."); return; }
    const parsed = parseWorkoutLog(logText, localToday());
    if (!parsed.workouts.some((w) => w.exercises.length)) { setError("Не нашёл упражнений. Название — строка с буквами, подход — «22 на 15»."); return; }
    const pairs = similarLogNames(parsed);
    setLog(parsed); setSimilar(pairs); setMerged(new Set(pairs.map((_, i) => i))); setError(""); setPage("distribute");
  };
  const continueText = () => { void run(async (id) => {
    if (!log) return;
    const reps = CYCLE_TYPES.find((item) => item.id === cycleType)!.reps;
    const picked = workoutLogWorkbook(mergeLogNames(log, similar.filter((_, i) => merged.has(i))), { name: "Заметки", cycleType, reps });
    await open(picked, id);
  }); };
  const patch = (change: Partial<WorkbookReviewEntry>) => setSession((s) => s ? updateWorkbookEntry(s, change) : null);
  const select = (id: string) => { if (!busy && session) { setError(""); setSession(match(selectWorkbookSheet(session, id))); } };
  const currentName = current?.value?.exercises.find((e) => e.id === sourceId)?.name ?? "";
  const chooseMatches = (selected: readonly ExerciseImportMatch[]) => {
    if (session) setSession(selected.reduce((s, m) => setWorkbookNameMatch(s, m.sourceName, m.targetId, "HISTORY"), session));
    setProposals(null); setPage("review");
  };
  const confirm = () => { void run(async (id) => {
    if (!session) return;
    if (target.kind === "BUILDER") {
      const draft = builderWorkbookImport(session); setPage(null); await yieldFrame();
      if (id !== operation.current) return;
      try { target.apply(draft); } catch (cause) { setPage("confirm"); throw cause; }
      locked.current = false; close(); return;
    }
    const whole = compileWholeWorkbook(session); writing.current = true; setCommitting(true);
    try { await target.save(whole.value, whole.mapping, workbookMatchesToRemember(session, true)); }
    finally { writing.current = false; setCommitting(false); }
    locked.current = false; close();
  }); };
  const fromText = session?.picked.kind === "TABLES" && session.picked.tables[0]?.source === "text";
  const selectedLabels = session?.sheets.filter((s) => session.selectedSheetIds.has(s.id)).map((s) => s.label) ?? [];
  const unmatched = session ? workbookUnmatchedTargets(session) : [];
  const otherProblems = status?.problems.filter((p) => !unmatched.some((t) => t.sheetId === p.id) || !p.reason.startsWith("Выберите упражнения")) ?? [];
  /** Подсказка: открыть лист и неделю и прокрутить к карточке. */
  const focusCard = (sheetId: string, weekIndex: number | null, id: string | null) => {
    if (busy || !session) return;
    setError("");
    const next = match(selectWorkbookSheet(session, sheetId));
    setSession(updateWorkbookEntry(next, { ...(weekIndex === null ? {} : { viewWeek: weekIndex }), ...(id === null ? {} : { focus: { id, at: Date.now() } }) }));
  };
  const controls = session ? <>
    <AppButton compact variant="secondary" label={`Листы для импорта: ${session.selectedSheetIds.size} из ${session.sheets.length}`} disabled={busy} onPress={() => setPage("sheets")} />
    <TextField label="Название программы" value={session.programTitle} disabled={busy || !!target.title} onChangeText={(programTitle) => setSession({ ...session, programTitle })} />
    {!!(otherProblems.length || unmatched.length) && <View style={{ gap: 4 }}><Text style={{ color: colors.textSecondary }}>Проверьте выбранные листы:</Text>
      {unmatched.slice(0, HINTS_SHOWN).map((t) => <AppButton key={`${t.sheetId}:${t.name}`} compact variant="ghost" disabled={busy}
        label={`${t.sheetLabel}${t.weekIndex === null ? "" : ` · неделя ${t.weekIndex}`} · выберите «${t.name}»`}
        onPress={() => focusCard(t.sheetId, t.weekIndex, t.rowId)} />)}
      {unmatched.length > HINTS_SHOWN && <Text style={{ color: colors.textSecondary }}>И ещё упражнений: {unmatched.length - HINTS_SHOWN}. Выбор применяется ко всем совпадениям в книге.</Text>}
      {otherProblems.map((p) => { const issue = session.entries[p.id]?.value?.issues?.[0];
        return <AppButton key={p.id} compact variant="ghost" label={`${p.label}: ${p.reason}`} disabled={busy}
          onPress={() => issue ? focusCard(p.id, null, `issue:${issue.id}`) : select(p.id)} />; })}</View>}
    {session.picked.kind === "TABLES" && !fromText && <AiTableHelp busy={busy} onTemplate={() => { void run(async () => files.aiTemplate()); }} />}
    {session.picked.kind === "TABLES" && !fromText && current && <WorkbookColumnSettings table={session.picked.tables[Number(session.activeId)]!} entry={current} busy={busy} onChange={patch}
      onApply={() => setSession(match(applyWorkbookColumns(session)))} />}
  </> : null;
  return <>
    {renderTrigger ? renderTrigger(pick, busy, startText) : <>
      <AppButton compact variant="secondary" label={label} disabled={busy} onPress={pick} />
      <AppButton compact variant="secondary" label="Вставить из заметок" disabled={busy} onPress={startText} />
    </>}
    {!!error && page === null && <InlineNotice kind="error">{error}</InlineNotice>}
    <Modal visible={page !== null} animationType="none" onRequestClose={back}>
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScreenHeader insetTop={false} title={page === "catalog" ? "Выбрать упражнение" : page === "create" ? "Своё упражнение" : page === "sheets" ? "Листы для импорта" : page === "text" || page === "distribute" || fromText ? "Импорт из заметок" : "Импорт Excel"} onBack={back} />
        {!!notice && <InlineNotice>{notice}</InlineNotice>}
        {page === "text" && <TextLogInput text={logText} error={error} busy={busy} onText={setLogText} onParse={parseText} />}
        {page === "distribute" && log && <TextLogDistribution log={log} onChange={setLog} cycleType={cycleType} onCycleType={setCycleType}
          similar={similar} merged={merged} busy={busy} error={error} onContinue={continueText}
          onToggleMerge={(i) => setMerged((current) => { const next = new Set(current); if (!next.delete(i)) next.add(i); return next; })} />}
        {page === "reading" && <View style={{ padding: 24, gap: 16 }}>{error ? <InlineNotice kind="error">{error}</InlineNotice> : <LoadingState label={progress} />}<AppButton label="Отменить" variant="secondary" onPress={close} /></View>}
        {page === "history" && <RememberedImportMatchesDialog matches={proposals} catalog={catalog} onApply={chooseMatches} onDecline={() => chooseMatches([])} />}
        {page === "sheets" && session && <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={{ color: colors.textSecondary }}>Каждый выбранный лист станет отдельным циклом этой программы.</Text>
          <AppButton label="Выбрать все" variant="secondary" onPress={() => setSession(selectWorkbookImportSheets(session, session.sheets.map((s) => s.id)))} />
          <AppButton label="Снять выбор" variant="ghost" onPress={() => setSession(selectWorkbookImportSheets(session, []))} />
          {session.sheets.map((s) => { const checked = session.selectedSheetIds.has(s.id); const empty = emptyWorkbookSheet(session, s.id); return <Pressable key={s.id} accessibilityRole="checkbox" disabled={empty} accessibilityState={{ checked, disabled: empty }}
            onPress={() => setSession(selectWorkbookImportSheets(session, checked ? [...session.selectedSheetIds].filter((id) => id !== s.id) : [...session.selectedSheetIds, s.id]))}
            style={{ padding: 16, borderWidth: 1, borderColor: checked ? colors.accentInk : colors.border, borderRadius: 14, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.textPrimary }}>{checked ? "☑" : "☐"} {s.label}</Text>
            {empty && <Text style={{ color: colors.textSecondary }}>Нет тренировок — лист пропускается.</Text>}
            {!!session.entries[s.id]?.error && <Text style={{ color: colors.textSecondary }}>{session.entries[s.id]!.error}</Text>}
          </Pressable>; })}
          <AppButton label="Готово" onPress={() => { const first = session.sheets.find((s) => session.selectedSheetIds.has(s.id)); if (first && !session.selectedSheetIds.has(session.activeId)) setSession(match(selectWorkbookSheet(session, first.id))); setPage("review"); }} />
        </ScrollView>}
        {page === "confirm" && session && <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Text style={{ color: colors.textPrimary, fontSize: 18 }}>Программа «{session.programTitle}»</Text>
          <Text style={{ color: colors.textPrimary }}>Будет добавлено {status?.cycles ?? 0} циклов</Text>
          {selectedLabels.map((name) => <Text key={name} style={{ color: colors.textSecondary }}>• {name}</Text>)}
          <Text style={{ color: colors.textSecondary }}>{target.kind === "BUILDER" ? "Циклы добавятся в черновик. Сохранение программы выполняется общей кнопкой конструктора." : "Все циклы сохранятся одной операцией."} Тренировки с результатами и пустые тренировки недель, где результаты есть, отметятся завершёнными; недели без результатов останутся «не начаты». Неизвестные даты сохранятся.</Text>
          {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
          <AppButton label={target.kind === "BUILDER" ? "Добавить циклы в черновик" : "Импортировать выбранные листы"} busy={busy} disabled={!status?.cycles || !!status.problems.length} onPress={confirm} />
          <AppButton label="Вернуться к сверке" variant="secondary" disabled={committing} onPress={back} />
        </ScrollView>}
        {page === "review" && session && <>
          <View style={{ padding: 12, gap: 6 }}><Text style={{ color: colors.textSecondary }}>Выбрано листов: {session.selectedSheetIds.size} · Будет добавлено {status?.cycles ?? 0} циклов</Text>
            <SegmentedControl scroll items={session.sheets} selectedId={session.activeId} onSelect={select} />
            {!session.selectedSheetIds.has(session.activeId) && <InlineNotice>Этот лист не выбран и не будет импортирован.</InlineNotice>}
            {fromText ? <AppButton compact variant="ghost" label="Вернуться к распределению" disabled={busy} onPress={() => setPage("distribute")} />
              : <AppButton compact variant="ghost" label="Выбрать другой файл" disabled={busy} onPress={pick} />}
            {busy && <AppButton compact variant="ghost" label="Продолжить без прошлых сопоставлений" onPress={() => { operation.current += 1; locked.current = false; setBusy(false); }} />}
          </View>
          {current?.value ? <TrainingTransferReviewScreen key={session.activeId} value={current.value} mapping={current.mapping} catalog={catalog} clientName={clientName}
            busy={busy} error={error} sheetMode allowUnknownDates controls={controls} controlsExpanded={current.settingsOpen} selectedValidation
            viewWeek={current.viewWeek} focus={current.focus} onViewWeek={(viewWeek) => patch({ viewWeek })} issueInputs={current.issueInputs ?? {}} onIssueInputs={(issueInputs) => patch({ issueInputs })}
            blocked={!!status?.problems.length || !status?.cycles}
            blockedReason={!status?.cycles ? "Выберите хотя бы один лист." : "Проверьте выбранные листы или измените их список."}
            actionLabel="Продолжить импорт выбранных листов" footerNote={`Будет добавлено ${status?.cycles ?? 0} циклов. Открытая вкладка не ограничивает импорт.`}
            onCorrectIssue={(id, correction) => { try { setSession(correctWorkbookValue(session, id, correction)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Проверьте значение."); } }}
            onMatch={(id) => { setSourceId(id); setPage("catalog"); }} onConfirm={() => setPage("confirm")} onBack={back}
            onParameters={fromText ? () => setPage("distribute") : () => patch({ settingsOpen: !current.settingsOpen })}
            parametersLabel={fromText ? "К распределению" : "Настроить столбцы"}
            onShare={() => { void run(async () => files.share(current.value!)); }} />
            : <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>{!!(error || current?.error) && <InlineNotice>{error || current?.error}</InlineNotice>}{controls}
              <AppButton label="Продолжить импорт выбранных листов" disabled={busy || !status?.cycles || !!status.problems.length} onPress={() => setPage("confirm")} />
            </ScrollView>}
        </>}
        {page === "catalog" && <ExerciseLibraryScreen repository={exercises} backRef={catalogBack} picking initialQuery={currentName}
          onPick={(ids) => { if (ids[0] && session) { setSession(setWorkbookNameMatch(session, currentName, ids[0])); setNotice("Выбор применён ко всем точным совпадениям в книге."); setPage("review"); } }}
          onCreate={(name) => { setCreateName(name); setPage("create"); }} />}
        {page === "create" && <CustomExerciseEditorScreen repository={exercises} initialName={createName} onCancel={back}
          onSaved={(id) => { void run(async (request) => { const rows = await exercises.list(); if (request !== operation.current) return;
            setCatalog(rows); if (session) setSession(setWorkbookNameMatch(session, currentName, id)); if (pageRef.current === "create") setPage("review"); }); }} />}
      </SafeAreaView>
    </Modal>
  </>;
}
