import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppButton, InlineNotice, ScreenHeader } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientRepositoryPort, ClientRosterPort, ClientRecord } from "../../features/clients/public.ts";
import { CustomExerciseEditorScreen, ExerciseLibraryScreen, displayNameOf, searchKey, type CatalogEntry, type ExerciseCatalogPort } from "../../features/exercises/public.ts";
import type { TrainingPlansRepositoryPort, TrainingExecutionPort, ProgramCard } from "../../features/training/public.ts";
import { detectLegacyMapping, legacyFields, normalizeLegacyTable, type LegacyMapping, type PickedWorkbook, type TrainingTransfer, type TrainingTransferPort, type WorkbookFilesPort } from "../../features/import/public.ts";
import { transferSummary } from "../../shared/training-transfer/TrainingTransfer.ts";
import { TrainingTransferReviewScreen } from "./TrainingTransferReviewScreen.tsx";
type TransferRoutes = { TransferSetup: undefined; TransferReview: undefined; TransferExercise: { sourceId: string }; TransferCreateExercise: { sourceId: string; name: string } };
const Stack = createNativeStackNavigator<TransferRoutes>();

export function TrainingTransferScreen({ clients, plans, execution, exercises, transfer, files, initialClientId, onClose }: Readonly<{
  clients: ClientRepositoryPort & ClientRosterPort; plans: TrainingPlansRepositoryPort; exercises: ExerciseCatalogPort;
  execution: TrainingExecutionPort;
  transfer: TrainingTransferPort; files: WorkbookFilesPort; initialClientId?: string; onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const [roster, setRoster] = useState<readonly ClientRecord[]>([]); const [clientId, setClientId] = useState(initialClientId ?? "");
  const [name, setName] = useState(""); const [programs, setPrograms] = useState<readonly ProgramCard[]>([]); const [selected, setSelected] = useState<readonly string[]>([]);
  const [catalog, setCatalog] = useState<readonly CatalogEntry[]>([]); const [picked, setPicked] = useState<PickedWorkbook | null>(null);
  const [value, setValue] = useState<TrainingTransfer | null>(null); const [mapping, setMapping] = useState<Record<string, string>>({});
  const [tableIndex, setTableIndex] = useState(0); const [header, setHeader] = useState(0); const [columns, setColumns] = useState<LegacyMapping>({});
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); setError(""); setMessage(""); try { await task(); } catch (cause) { const detail = cause instanceof Error ? cause.message : ""; setError(/SQLITE|constraint failed|RUNTIME_|WORKFLOW_|TRAINING_/u.test(detail) || !detail ? "Операция не завершена. Дождитесь окончания восстановления и повторите попытку." : detail); } finally { setBusy(false); } };
  const refreshCatalog = async () => { const entries = [...await exercises.list(), ...await exercises.listArchived()]; setCatalog(entries); return entries; };
  useEffect(() => { void clients.listRoster("ACTIVE").then(setRoster).catch(() => setError("Не удалось загрузить клиентов.")); void refreshCatalog().catch(() => setError("Не удалось загрузить упражнения.")); }, [clients, exercises]);
  useEffect(() => {
    let cancelled = false; setPrograms([]); setSelected([]);
    if (clientId) void Promise.all([plans.getLibrary(clientId), execution.listClientExecutions(clientId)]).then(([library, history]) => {
      if (cancelled) return;
      const list = [...library.active, ...library.archived];
      for (const row of history) if (row.origin && !list.some((p) => p.id === row.programId)) {
        const createdAt = row.execution.session?.startedAt ?? `${row.execution.session?.actualDate ?? "2000-01-01"}T00:00:00.000Z`;
        list.push({ id: row.programId, kind: row.origin.programKind, title: row.origin.programTitle, revision: 1, createdAt, memberCount: 1, archivedAt: createdAt, sortPosition: null });
      }
      setPrograms(list); setSelected(list.map((p) => p.id));
    }).catch(() => setError("Не удалось загрузить программы."));
    return () => { cancelled = true; };
  }, [clientId, plans, execution, message]);
  const preview = (input: TrainingTransfer) => {
    const matched: Record<string, string> = {};
    for (const e of input.exercises) { const exact = catalog.filter((candidate) => candidate.definition.id === e.id || searchKey(displayNameOf(candidate)) === searchKey(e.name)); if (exact.length === 1) matched[e.id] = exact[0]!.definition.id; }
    setValue(input); setMapping(matched);
  };
  const pick = async () => { const result = await files.pick(); if (!result) return false; setValue(null); setPicked(result); if (result.kind === "TRANSFER") { preview(result.value); return true; } else { setTableIndex(0); const detected = detectLegacyMapping(result.tables[0]!); setColumns(detected.mapping); setHeader(detected.header); return false; } };
  const inputStyle = { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12 };
  const text = (label: string) => <Text style={{ color: colors.textPrimary, fontSize: 16, marginTop: 12 }}>{label}</Text>;
  const button = (label: string, onPress: () => void, disabled = false) => <AppButton key={label} label={label} variant="secondary" disabled={busy || disabled} onPress={onPress} />;
  const currentTable = picked?.kind === "TABLES" ? picked.tables[tableIndex] : undefined;
  return <Stack.Navigator screenOptions={{ header: ({ navigation, options }) => <ScreenHeader title={options.title} onBack={() => { if (navigation.canGoBack()) navigation.goBack(); else onClose(); }} />, contentStyle: { backgroundColor: colors.canvas } }}>
    <Stack.Screen name="TransferSetup" options={{ title: "Excel" }}>{({ navigation }) => <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
    {text("Excel: планы и результаты")}
    <Text style={{ color: colors.textSecondary }}>Импорт добавляет программы выбранному клиенту. «Пред.» рассчитывается из фактических результатов предыдущей недели.</Text>
    {!!error && <InlineNotice kind="error">{error}</InlineNotice>}{!!message && <InlineNotice kind="success">{message}</InlineNotice>}
    {busy && <InlineNotice>Обрабатываем файл…</InlineNotice>}
    {text("Клиент")}
    {roster.map((c) => button(`${c.id === clientId ? "✓ " : ""}${c.displayName}`, () => setClientId(c.id)))}
    <TextInput accessibilityLabel="Имя нового клиента" value={name} onChangeText={setName} placeholder="Имя нового клиента" placeholderTextColor={colors.textSecondary} style={inputStyle} editable={!busy} />
    {button("Создать клиента", () => { void run(async () => { const created = await clients.create({ displayName: name }); setRoster(await clients.listRoster("ACTIVE")); setClientId(created.id); setName(""); }); }, !name.trim())}
    {text("Экспорт")}
    {programs.map((p) => button(`${selected.includes(p.id) ? "✓ " : ""}${p.title}${p.archivedAt ? " · Архив" : ""}`, () => setSelected((s) => s.includes(p.id) ? s.filter((id) => id !== p.id) : [...s, p.id])))}
    {button("Экспортировать выбранные программы", () => { void run(async () => { const result = await transfer.exportClient(clientId, selected); await files.share(result); const summary = transferSummary(result); setMessage(`Подготовлено: программ ${summary.programs}, занятий ${summary.sessions}, фактических подходов ${summary.sets}.`); }); }, !clientId || selected.length === 0)}
    {text("Импорт")}
    {button("Выбрать Excel-файл", () => { void run(async () => { if (await pick()) navigation.navigate("TransferReview"); }); })}
    {button("Скачать шаблон", () => { void run(() => files.template()); })}
    {picked?.kind === "TABLES" && <>
      {text("Лист")}{picked.tables.map((t, i) => button(`${i === tableIndex ? "✓ " : ""}${t.name}`, () => { setTableIndex(i); const found = detectLegacyMapping(t); setHeader(found.header); setColumns(found.mapping); setValue(null); }))}
      {text("Строка заголовков")}
      <TextInput accessibilityLabel="Номер строки заголовков" keyboardType="number-pad" value={String(header + 1)} onChangeText={(s) => { setHeader(Math.max(0, Number(s) - 1)); setValue(null); }} style={inputStyle} editable={!busy} />
      {text("Столбцы: нажмите для выбора следующего")}
      {(Object.entries(legacyFields) as [keyof LegacyMapping, string][]).map(([field, title]) => button(`${title}: ${columns[field] === undefined ? "не задан" : String(currentTable?.rows[header]?.[columns[field]!] ?? columns[field]! + 1)}`, () => { const count = currentTable?.rows[header]?.length ?? 0; setColumns((c) => ({ ...c, [field]: c[field] === undefined ? 0 : c[field]! + 1 >= count ? undefined : c[field]! + 1 })); setValue(null); }))}
      {button("Предварительный просмотр", () => { void run(async () => { if (currentTable) { preview(normalizeLegacyTable(currentTable, picked.sourceId, header, columns)); navigation.navigate("TransferReview"); } }); })}
    </>}
    {value && <>
      {text("Сверка упражнений")}
      <Text style={{ color: colors.textPrimary }}>{value.client.name}: программ {value.programs.length}, занятий {value.sessions.length}.</Text>
      {button("Открыть сверку в конструкторе", () => navigation.navigate("TransferReview"))}
    </>}
  </ScrollView>}</Stack.Screen>
    <Stack.Screen name="TransferReview" options={{ title: "Сверка упражнений" }}>{({ navigation }) => value ? <TrainingTransferReviewScreen value={value} mapping={mapping} catalog={catalog} clientName={roster.find((c) => c.id === clientId)?.displayName ?? null} busy={busy} error={error}
      onMatch={(sourceId) => navigation.navigate("TransferExercise", { sourceId })} onBack={() => navigation.goBack()}
      onShare={() => { void run(() => files.share(value)); }}
      onConfirm={() => { void run(async () => { const summary = await transfer.importClient(clientId, value, mapping); setValue(null); setPicked(null); navigation.popTo("TransferSetup"); setMessage(`Импорт проверен: программ ${summary.programs}, занятий ${summary.sessions}, фактических подходов ${summary.sets}. Повторный импорт не создаёт дублей.`); }); }} /> : <AppButton label="Параметры импорта" onPress={() => navigation.popTo("TransferSetup")} />}</Stack.Screen>
    <Stack.Screen name="TransferExercise" options={{ title: "Выбрать упражнение" }}>{({ navigation, route }) => <ExerciseLibraryScreen key={route.params.sourceId} repository={exercises} picking initialQuery={value?.exercises.find((e) => e.id === route.params.sourceId)?.name ?? ""}
      onPick={(ids) => { if (ids[0]) { setMapping((m) => ({ ...m, [route.params.sourceId]: ids[0]! })); navigation.popTo("TransferReview"); } }}
      onCreate={(exerciseName) => navigation.navigate("TransferCreateExercise", { sourceId: route.params.sourceId, name: exerciseName })} />}</Stack.Screen>
    <Stack.Screen name="TransferCreateExercise" options={{ title: "Своё упражнение" }}>{({ navigation, route }) => <CustomExerciseEditorScreen repository={exercises} initialName={route.params.name} onCancel={() => navigation.goBack()}
      onSaved={(id) => { void run(async () => { try { await refreshCatalog(); setMapping((m) => ({ ...m, [route.params.sourceId]: id })); } finally { navigation.popTo("TransferReview"); } }); }} />}</Stack.Screen>
  </Stack.Navigator>;
}
