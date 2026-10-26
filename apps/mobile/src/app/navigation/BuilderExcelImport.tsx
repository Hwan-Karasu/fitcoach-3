import { useRef, useState, type ReactNode } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, ConfirmDialog, InlineNotice, ScreenHeader, SegmentedControl, TextField } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { CustomExerciseEditorScreen, ExerciseLibraryScreen, displayNameOf, type CatalogEntry, type ExerciseCatalogPort, type CatalogBackHandle } from "../../features/exercises/public.ts";
import { applyWorkbookColumns, copyWorkbookPlan, correctWorkbookValue, hasRepeatedWorkbookWeeks, selectWorkbookSheet,
  startWorkbookReview, updateWorkbookEntry, type PickedWorkbook, type TrainingTransfer, type WorkbookFilesPort,
  type WorkbookReviewEntry, type WorkbookReviewSession } from "../../features/import/public.ts";
import { autoMatchWorkbookEntry, setWorkbookNameMatch, workbookSourceNames, workbookMatchesToRemember, requireWorkbookNameChoices,
  type ExerciseImportMatch, type ExerciseImportMatchesPort } from "../../features/import/public.ts";
import type { BuilderExcelDraft } from "../../features/training/public.ts";
import { TrainingTransferReviewScreen } from "./TrainingTransferReviewScreen.tsx";
import { WorkbookColumnSettings } from "./WorkbookColumnSettings.tsx";
import { RememberedImportMatchesDialog } from "./RememberedImportMatchesDialog.tsx";
import { previousImportPage } from "./importBack.ts";
import { prepareWholeWorkbook, wholeWorkbookStatus, compileWholeWorkbook } from "../../features/import/public.ts";

/** Resolve only unique exact matches. Existing manual choices are never replaced. */
function matchActive(session: WorkbookReviewSession, catalog: readonly CatalogEntry[]): WorkbookReviewSession {
  return autoMatchWorkbookEntry(session, catalog.map((entry) => ({ id: entry.definition.id, name: displayNameOf(entry), available: !entry.overlay.hidden })));
}

/** A workbook stays in memory until closed; each sheet owns its corrections, matching and column settings. */
export function BuilderExcelImport({ files, exercises, simple = false, onApply, onImport, clientName = "Конструктор", label = "Импортировать Excel", renderTrigger, memory }: Readonly<{
  files: WorkbookFilesPort; exercises: ExerciseCatalogPort; simple?: boolean; onApply?: (draft: BuilderExcelDraft) => void;
  onImport?: (value: TrainingTransfer, mapping: Readonly<Record<string, string>>, rememberMatches: readonly ExerciseImportMatch[]) => Promise<void>; clientName?: string; label?: string;
  memory?: ExerciseImportMatchesPort;
  renderTrigger?: (onPress: () => void, disabled: boolean) => ReactNode;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const [page, setPage] = useState<"review" | "catalog" | "create" | null>(null);
  const [session, setSession] = useState<WorkbookReviewSession | null>(null);
  const [catalog, setCatalog] = useState<readonly CatalogEntry[]>([]);
  const [sourceId, setSourceId] = useState(""); const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [confirm, setConfirm] = useState(false);
  const catalogBack = useRef<CatalogBackHandle>(null);
  const bookRequest = useRef(0);
  const historyCheckedNames = useRef<ReadonlySet<string>>(new Set());
  const viewedSheets = useRef(new Set<string>());
  const [proposals, setProposals] = useState<readonly ExerciseImportMatch[] | null>(null);
  const [mappingNotice, setMappingNotice] = useState("");
  const current = session?.entries[session.activeId];
  const bookStatus = session && onImport ? wholeWorkbookStatus(session) : null;
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось открыть Excel."); }
    finally { setBusy(false); }
  };
  const close = () => { bookRequest.current += 1; historyCheckedNames.current = new Set(); setPage(null); setSession(null); setError(""); setConfirm(false); setProposals(null); setMappingNotice(""); };
  const back = () => { setError(""); const previous = previousImportPage(page, catalogBack.current); if (previous === null) close(); else setPage(previous); };
  const open = async (picked: PickedWorkbook, entries: readonly CatalogEntry[], request: number) => {
    const started = startWorkbookReview(picked, !onImport);
    const prefix = `${clientName} — `;
    const initial = { ...started, programTitle: started.programTitle.startsWith(prefix) ? started.programTitle.slice(prefix.length) : started.programTitle };
    const review = onImport ? prepareWholeWorkbook(initial, entries.map((entry) => ({ id: entry.definition.id, name: displayNameOf(entry), available: !entry.overlay.hidden }))) : matchActive(initial, entries);
    viewedSheets.current = new Set([review.activeId]);
    const names = workbookSourceNames(review);
    let suggestions: readonly ExerciseImportMatch[] = [];
    try { suggestions = memory ? await memory.getExerciseMatches(names) : []; }
    catch { if (bookRequest.current === request) setError("Не удалось загрузить прошлые сопоставления. Можно выбрать упражнения вручную."); }
    if (bookRequest.current !== request) return;
    historyCheckedNames.current = new Set(names);
    setMappingNotice(""); setSession(requireWorkbookNameChoices(review, suggestions.map((match) => match.sourceName)));
    setPage("review"); setProposals(suggestions.length ? suggestions : null);
  };
  const pick = () => { void run(async () => {
    const request = ++bookRequest.current;
    const entries = await exercises.list(); setCatalog(entries);
    const result = await files.pick(); if (result) await open(result, entries, request);
  }); };
  const patch = (change: Partial<WorkbookReviewEntry>) => setSession((active) => active ? updateWorkbookEntry(active, change) : null);
  const reconfigure = () => { void run(async () => {
    if (!session) return;
    let configured = matchActive(applyWorkbookColumns(session), catalog);
    setSession(configured);
    const names = workbookSourceNames(configured).filter((name) => !historyCheckedNames.current.has(name));
    if (!memory || !names.length) return;
    const request = bookRequest.current;
    const suggestions = await memory.getExerciseMatches(names);
    if (request !== bookRequest.current) return;
    historyCheckedNames.current = new Set([...historyCheckedNames.current, ...names]);
    configured = requireWorkbookNameChoices(configured, suggestions.map((match) => match.sourceName));
    setSession(configured); if (suggestions.length) setProposals(suggestions);
  }); };
  const settings = (id: string, entry: WorkbookReviewEntry) => {
    if (!session || session.picked.kind !== "TABLES") return null;
    const table = session.picked.tables[Number(id)];
    if (!table) return null;
    return <WorkbookColumnSettings key={id} table={table} entry={entry} busy={busy} onChange={patch}
      onApply={reconfigure} />;
  };
  const parameters = () => {
    if (session?.picked.kind === "TABLES") patch({ settingsOpen: !current?.settingsOpen }); else pick();
  };
  const chooseSheet = (id: string) => {
    if (busy || !session) return;
    viewedSheets.current.add(id); setError(""); setSession(matchActive(selectWorkbookSheet(session, id), catalog));
  };
  const apply = async () => {
    if (!current?.value || !current.scope || current.settingsDirty) return;
    try {
      const draft = copyWorkbookPlan(current.scope, current.mapping, () => `excel-draft:${Date.now()}:${Math.random().toString(36).slice(2)}`);
      if (simple && !hasRepeatedWorkbookWeeks(draft.weeks)) throw new Error("На листе планы недель различаются. Импортируйте его в расширенную программу, чтобы сохранить все недели.");
      const available = new Set((await exercises.list()).filter((entry) => !entry.overlay.hidden).map((entry) => entry.definition.id));
      if (current.value.exercises.some((exercise) => !available.has(current.mapping[exercise.id]!))) throw new Error("Выбранное упражнение недоступно. Выберите замену в каталоге.");
      onApply?.(draft);
      let rememberError = "";
      try { if (memory && session) await memory.rememberExerciseMatches(workbookMatchesToRemember(session)); }
      catch { rememberError = "План применён, но сопоставления не удалось запомнить для следующих импортов."; }
      close(); if (rememberError) setError(rememberError);
    } catch (cause) { setConfirm(false); setError(cause instanceof Error ? cause.message : "Не удалось применить план."); }
  };
  const currentName = current?.value?.exercises.find((exercise) => exercise.id === sourceId)?.name ?? "";
  return <>
    {renderTrigger ? renderTrigger(pick, busy) : <AppButton compact variant="secondary" label={label} disabled={busy} onPress={pick} />}
    {!!error && page === null && <InlineNotice kind="error">{error}</InlineNotice>}
    <Modal visible={page !== null} animationType="slide" onRequestClose={back}>
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScreenHeader insetTop={false} title={page === "catalog" ? "Выбрать упражнение" : page === "create" ? "Своё упражнение" : "Сверка в конструкторе"} onBack={back} />
        {page === "review" && session && <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          <Text style={{ color: colors.textSecondary }}>{onImport ? `Вся книга → одна программа · Циклов: ${bookStatus?.cycles ?? 0}` : "Листы Excel · выберите цикл для конструктора"}</Text>
          {!!mappingNotice && <Text style={{ color: colors.accentInk }}>{mappingNotice}</Text>}
          <SegmentedControl scroll items={session.sheets} selectedId={session.activeId} onSelect={chooseSheet} />
          <AppButton compact variant="ghost" label="Выбрать другой файл" disabled={busy} onPress={pick} />
        </View>}
        {session && Object.entries(session.entries).filter(([id]) => viewedSheets.current.has(id)).map(([id, entry]) => <View key={id}
          style={{ flex: 1, display: page === "review" && session.activeId === id ? "flex" : "none" }}>
          {entry.value ? <TrainingTransferReviewScreen value={entry.value} mapping={entry.mapping} catalog={catalog}
            clientName={clientName} planOnly={!onImport} busy={busy} error={error || entry.error} sheetMode blocked={entry.settingsDirty || !!bookStatus?.problems.length || bookStatus?.cycles === 0}
            actionLabel={onImport ? "Импортировать всю книгу" : undefined}
            allowUnknownDates={!!onImport}
            footerNote={onImport ? `Одна программа · Циклов: ${bookStatus?.cycles ?? 0}. Все тренировки будут завершены; пустые подходы останутся пустыми.` : undefined}
            blockedReason={bookStatus?.problems.length ? `Проверьте листы книги: ${bookStatus.problems.length}. Все циклы сохраняются вместе.` : undefined}
            controls={<>
              {onImport && <TextField label="Название программы" value={session.programTitle} onChangeText={(programTitle) => setSession({ ...session, programTitle })} />}
              {!!bookStatus?.emptySheets.length && <InlineNotice>Пустые листы без тренировок пропускаются: {bookStatus.emptySheets.join(", ")}.</InlineNotice>}
              {!!bookStatus?.problems.length && <View style={{ gap: 4 }}>
                <Text style={{ color: colors.textSecondary }}>Перед импортом всей книги проверьте:</Text>
                {bookStatus.problems.map((problem) => <AppButton key={problem.id} compact variant="ghost" label={`${problem.label}: ${problem.reason}`} disabled={busy}
                  onPress={() => chooseSheet(problem.id)} />)}
              </View>}
              {settings(id, entry)}
            </>} controlsExpanded={entry.settingsOpen}
            onCorrectIssue={(issueId, correction) => { void run(async () => { setSession(correctWorkbookValue(session, issueId, correction)); }); }}
            onMatch={(exerciseId) => { setSourceId(exerciseId); setPage("catalog"); }}
            onConfirm={() => {
              if (onImport) void run(async () => { const whole = compileWholeWorkbook(session); await onImport(whole.value, whole.mapping, workbookMatchesToRemember(session, true)); close(); }); else setConfirm(true);
            }} onBack={back} onParameters={parameters} parametersLabel={session.picked.kind === "TABLES" ? "Настроить столбцы" : "Выбрать другой файл"}
            onShare={() => { void run(() => files.share(entry.value!)); }} />
            : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
              {bookStatus?.emptySheets.includes(session.sheets.find((sheet) => sheet.id === id)!.label)
                ? <InlineNotice>На этом листе нет тренировок. При импорте всей книги он будет пропущен. Откройте другой лист для сверки.</InlineNotice>
                : !!(error || entry.error) && <InlineNotice kind="error">{error || entry.error}</InlineNotice>}
              {settings(id, entry)}
            </ScrollView>}
        </View>)}
        {page === "catalog" && <ExerciseLibraryScreen repository={exercises} backRef={catalogBack} picking initialQuery={currentName}
          onPick={(ids) => { if (ids[0] && session) { setSession(setWorkbookNameMatch(session, currentName, ids[0])); setMappingNotice("Выбор применён ко всем точным совпадениям в этой книге."); setPage("review"); } }}
          onCreate={(name) => { setCreateName(name); setPage("create"); }} />}
        {page === "create" && <CustomExerciseEditorScreen repository={exercises} initialName={createName} onCancel={back}
          onSaved={(id) => { void run(async () => { setCatalog(await exercises.list()); if (session) setSession(setWorkbookNameMatch(session, currentName, id)); setMappingNotice("Созданное упражнение выбрано для всех точных совпадений в этой книге."); setPage("review"); }); }} />}
        <RememberedImportMatchesDialog matches={proposals} catalog={catalog} onDecline={() => setProposals(null)} onApply={(selected) => {
          if (session) setSession(selected.reduce((review, match) => setWorkbookNameMatch(review, match.sourceName, match.targetId, "HISTORY"), session));
          setProposals(null); if (selected.length) setMappingNotice(`Применено прошлых сопоставлений: ${selected.length}.`);
        }} />
        <ConfirmDialog visible={confirm} title="Применить план из Excel?" description="План открытого листа заменит текущий черновик конструктора. Остальные листы не импортируются. Затем можно изменить тренировки и сохранить программу или цикл."
          confirmLabel="Применить" cancelLabel="Вернуться" onCancel={() => setConfirm(false)} onConfirm={() => { void run(apply); }} />
      </SafeAreaView>
    </Modal>
  </>;
}
