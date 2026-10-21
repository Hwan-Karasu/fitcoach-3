import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import { AppButton, AppIconButton, ChoiceSegments, ConfirmDialog, DropdownMenu, InlineNotice, LineChart,
  LoadingState, SearchableSelect, TextField, pickDate } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { MEASUREMENT_TYPES, type ClientMeasurements, type Measurement, type MeasurementType } from "../domain/MeasurementModel.ts";
import type { MeasurementRepositoryPort } from "../domain/MeasurementRepositoryPort.ts";
import { dailyPoints, formatDate, formatTime, formatValue, localDateOf, measurementTypeInfo, parseTime, parseValueX10 } from "../domain/MeasurementRules.ts";
import { measurementJournalView, type JournalPeriod } from "./measurementJournalView.ts";
import { plural } from "../../../shared/format/clockText.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const PERIODS: readonly Readonly<{ id: JournalPeriod; label: string }>[] = [
  { id: "30", label: "30 дней" }, { id: "90", label: "90 дней" }, { id: "365", label: "Год" }, { id: "ALL", label: "Всё" },
];
const typeOptions = MEASUREMENT_TYPES.map((type) => ({ value: type, label: measurementTypeInfo[type].label }));
const isType = (value: string): value is MeasurementType => MEASUREMENT_TYPES.some((type) => type === value);
const numberText = (value: number) => String(value / 10).replace(".", ",");

function errorMessage(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "MEASUREMENT_VALUE_INVALID": return "Проверьте значение: оно вне допустимого диапазона для этого показателя.";
    case "MEASUREMENT_DATE_INVALID": return "Замер не может быть в будущем.";
    case "MEASUREMENT_TIME_INVALID": return "Время — в формате ЧЧ:ММ.";
    case "MEASUREMENT_STALE": return "Замер уже изменился. Список обновлён, повторите действие.";
    default: return "Не удалось сохранить. Замеры не изменены.";
  }
}
interface Draft { readonly editing: Measurement | null; readonly type: MeasurementType; readonly value: string; readonly date: string; readonly time: string }
function freshDraft(type: MeasurementType): Draft {
  const now = new Date();
  return { editing: null, type, value: "", date: localDateOf(now), time: formatTime(now.getHours() * 60 + now.getMinutes()) };
}

function JournalEntry({ row, primary, canChoose, busy, onEdit, onDelete, onPrimary }: Readonly<{
  row: Measurement; primary: boolean; canChoose: boolean; busy: boolean; onEdit: () => void; onDelete: () => void; onPrimary: () => void;
}>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  return <View style={[styles.entry, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={`Исправить: ${measurementTypeInfo[row.type].label}, ${formatValue(row.valueX10, row.type)}, ${formatTime(row.localMinute)}`}
      onPress={onEdit} style={styles.entryBody}>
      <View style={styles.row}>
        <Text style={[styles.entryLabel, { color: colors.textSecondary }]}>{measurementTypeInfo[row.type].label}</Text>
        <Text style={[styles.entryValue, { color: colors.textPrimary }]}>{formatValue(row.valueX10, row.type)}</Text>
      </View>
      <Text style={[styles.hint, { color: primary ? colors.accentInk : colors.textMuted }]}>{formatTime(row.localMinute)}{primary ? " · основной" : ""}{row.method === "NAVY_ESTIMATE" ? " · оценка ВМС" : ""}</Text>
    </Pressable>
    <View ref={anchor} collapsable={false}>
      <AppIconButton label={`Действия: ${measurementTypeInfo[row.type].label}, ${formatValue(row.valueX10, row.type)}`}
        disabled={busy} icon={<MoreHorizontal size={19} color={colors.textSecondary} />} onPress={() => setOpen(true)} />
    </View>
    <DropdownMenu visible={open} anchor={anchor} title="Действия с замером" selected="" onClose={() => setOpen(false)}
      options={[...(canChoose ? [{ value: "PRIMARY", label: "Сделать основным за день" }] : []),
        { value: "EDIT", label: "Исправить" }, { value: "DELETE", label: "Удалить", danger: true }]}
      onSelect={(action) => { setOpen(false); if (busy) return; if (action === "PRIMARY") onPrimary(); else if (action === "EDIT") onEdit(); else if (action === "DELETE") onDelete(); }} />
  </View>;
}

/** §§49.14–49.18: one fact journal, explicit primary selection and no invented daily averages. */
export function ClientMeasurementsScreen({ clientId, repository }: Readonly<{ clientId: string; repository: MeasurementRepositoryPort }>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const [data, setData] = useState<ClientMeasurements | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [type, setType] = useState<MeasurementType | "ALL">("WEIGHT");
  const [period, setPeriod] = useState<JournalPeriod>("90");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Measurement | null>(null);
  useEffect(() => { setData(null); setDraft(null); setDeleting(null); setError(null); setType("WEIGHT"); }, [clientId]);
  useEffect(() => {
    let active = true;
    void repository.listForClient(clientId).then((next) => { if (active) { setData(next); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, repository, tick]);
  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.clientId === clientId) setTick((value) => value + 1);
  }), [clientId, repository]);
  const today = localDateOf(new Date());
  const view = useMemo(() => data === null ? null : measurementJournalView(data, type, period, today), [data, type, period, today]);
  const graph = useMemo(() => view?.points.flatMap((point) => point.kind === "VALUE" ? [{ key: point.localDate,
    label: `${point.localDate.slice(8)}.${point.localDate.slice(5, 7)}`, caption: formatDate(point.localDate), value: point.measurement.valueX10 / 10 }] : []) ?? [], [view]);
  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await work(); after?.(); } catch (failure) { setError(errorMessage(failure)); setTick((value) => value + 1); }
    finally { lock.current = false; setBusy(false); }
  };
  const edit = (row: Measurement) => {
    setError(null); setDraft({ editing: row, type: row.type, value: numberText(row.valueX10), date: row.localDate,
      time: row.localMinute === null ? "" : formatTime(row.localMinute) });
  };
  const save = () => {
    if (draft === null || lock.current) return;
    const valueX10 = parseValueX10(draft.value), minute = parseTime(draft.time);
    if (valueX10 === null) { setError("Введите значение, например 80,1."); return; }
    if (minute === "invalid") { setError(errorMessage(new Error("MEASUREMENT_TIME_INVALID"))); return; }
    const input = { type: draft.type, valueX10, localDate: draft.date, localMinute: minute };
    const editing = draft.editing;
    void run(() => editing === null ? repository.record(clientId, input) : repository.correct(editing.id, editing.revision, input), () => { setDraft(null); setType(draft.type); });
  };
  if (data === null || view === null) return <PrototypeScreen compact>
    {failed ? <InlineNotice kind="error">Замеры не загрузились.</InlineNotice> : <LoadingState label="Загружаем замеры…" />}
    {failed ? <AppButton label="Повторить" onPress={() => setTick((value) => value + 1)} /> : null}
  </PrototypeScreen>;
  const primaryIds = new Set(data.primaries.map((entry) => entry.measurementId));
  const info = type === "ALL" ? null : measurementTypeInfo[type];
  const deltaUnit = type === "BODY_FAT" ? "п.п." : info?.unit;
  return <>
    <FlatList style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={styles.listContent}
      data={view.days} keyExtractor={([date]) => date} initialNumToRender={10} windowSize={7}
      keyboardShouldPersistTaps="handled" ListHeaderComponent={<View style={styles.listHeader}>
      <View style={styles.row}>
        <Text style={[styles.title, styles.grow, { color: colors.textPrimary }]}>Замеры и динамика</Text>
        <AppButton compact size="small" label="+ Замер" disabled={busy} onPress={() => { setError(null); setDraft(freshDraft(type === "ALL" ? "WEIGHT" : type)); }} />
      </View>
      <SearchableSelect title="Показатель" value={type} options={[{ value: "ALL", label: "Все показатели" }, ...typeOptions]}
        onSelect={(value) => { if (value === "ALL" || isType(value)) setType(value); }} />
      <ChoiceSegments label="Период замеров" items={PERIODS} value={period} onChange={setPeriod} />
      {error !== null && draft === null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {info !== null ? <>
        <View style={styles.row}>
          <View style={[styles.stat, { backgroundColor: colors.surface }]}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Последний замер</Text>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>{view.latest?.kind === "VALUE" ? `${numberText(view.latest.measurement.valueX10)} ${info.unit}` : "—"}</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>{view.latest === null ? "Нет данных за период" : view.latest.kind === "AMBIGUOUS" ? "Выберите основной за день" : formatDate(view.latest.localDate)}</Text>
          </View>
          <View style={[styles.stat, { backgroundColor: colors.surface }]}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Изменение за период</Text>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>{view.changeX10 === null ? "—" : `${view.changeX10 > 0 ? "+" : ""}${numberText(view.changeX10)} ${deltaUnit}`}</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>От первого к последнему</Text>
          </View>
        </View>
        {graph.length > 0 ? <LineChart key={`${clientId}:${type}:${period}`} points={graph} title={info.label}
          format={(value) => String(Math.round(value * 10) / 10).replace(".", ",")}
          formatValue={(value) => `${String(Math.round(value * 10) / 10).replace(".", ",")} ${info.unit}`}
          accessibilityLabel={`Динамика: ${info.label}. Дневных значений: ${graph.length}.`} /> : null}
        {view.ambiguousCount > 0 ? <InlineNotice kind="info">Есть дни с несколькими замерами. Выберите основной через «⋯» у записи; до выбора эти дни не показываются на графике.</InlineNotice> : null}
      </> : null}
      <View style={styles.row}><Text style={[styles.title, styles.grow, { color: colors.textPrimary }]}>История</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{view.rows.length} {plural(view.rows.length, "запись", "записи", "записей")}</Text></View>
      </View>}
      ListEmptyComponent={<View style={[styles.empty, { backgroundColor: colors.surface }]}>
        <Text style={[styles.entryValue, { color: colors.textPrimary }]}>За этот период замеров нет</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Выберите другой период или добавьте замер.</Text>
      </View>}
      renderItem={({ item: [date, rows] }) => <View style={styles.day}>
        <Text style={[styles.dayTitle, { color: colors.textSecondary }]}>{formatDate(date)}</Text>
        {MEASUREMENT_TYPES.filter((id) => dailyPoints(rows, data.primaries, id)[0]?.kind === "AMBIGUOUS").map((id) => <Text key={id}
          style={[styles.hint, { color: colors.warning }]}>{measurementTypeInfo[id].label}: выберите основной замер.</Text>)}
        {rows.map((row) => <JournalEntry key={row.id} row={row} primary={primaryIds.has(row.id)} busy={busy}
          canChoose={rows.filter((other) => other.type === row.type).length > 1 && !primaryIds.has(row.id)}
          onEdit={() => edit(row)} onDelete={() => setDeleting(row)} onPrimary={() => { void run(() => repository.setPrimary(row.id)); }} />)}
      </View>}
    />
    <Modal visible={draft !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) { setDraft(null); setError(null); } }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{draft?.editing === null ? "Новый замер" : "Исправить замер"}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogBody}>
            {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
            <SearchableSelect title="Показатель" value={draft?.type ?? "WEIGHT"} options={typeOptions} disabled={busy}
              onSelect={(value) => { if (draft !== null && isType(value)) setDraft({ ...draft, type: value }); }} />
            <View style={styles.row}>
              <View style={styles.grow}><TextField compact label={`Значение, ${measurementTypeInfo[draft?.type ?? "WEIGHT"].unit}`} value={draft?.value ?? ""} required disabled={busy} keyboardType="decimal-pad"
                onChangeText={(value) => { if (draft !== null) setDraft({ ...draft, value }); }} /></View>
              <View style={styles.grow}><TextField compact label="Время, ЧЧ:ММ" value={draft?.time ?? ""} disabled={busy} placeholder="Не указано" keyboardType="numbers-and-punctuation"
                onChangeText={(time) => { if (draft !== null) setDraft({ ...draft, time }); }} /></View>
            </View>
            <AppButton compact size="small" variant="secondary" label={formatDate(draft?.date ?? today)} accessibilityLabel="Дата замера" disabled={busy}
              onPress={() => { if (draft === null) return; void pickDate({ value: draft.date, max: today, title: "Дата замера" }).then((picked) => {
                if (picked !== null) setDraft((current) => current === null ? null : { ...current, date: picked }); }); }} />
            <Text style={[styles.hint, { color: colors.textMuted }]}>Если время неизвестно, оставьте поле пустым.</Text>
          </ScrollView>
          <View style={styles.row}>
            <View style={styles.grow}><AppButton compact size="small" variant="secondary" label="Отмена" disabled={busy} onPress={() => { setDraft(null); setError(null); }} /></View>
            <View style={styles.grow}><AppButton compact size="small" label="Сохранить" busy={busy} onPress={save} /></View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <ConfirmDialog visible={deleting !== null} destructive confirmBusy={busy} title="Удалить замер?"
      description={deleting === null ? "" : `${measurementTypeInfo[deleting.type].label}: ${formatValue(deleting.valueX10, deleting.type)}, ${formatDate(deleting.localDate)}. Остальные записи сохранятся.`}
      confirmLabel="Удалить" onCancel={() => setDeleting(null)} onConfirm={() => {
        const row = deleting; if (row !== null) void run(() => repository.remove(row.id, row.revision), () => setDeleting(null));
      }} />
  </>;
}
const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 20, gap: 8 },
  listHeader: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
  stat: { flex: 1, alignSelf: "stretch", borderRadius: 14, padding: 10, gap: 3 },
  statValue: { fontFamily: fonts.bold, fontSize: 21, lineHeight: 27 },
  day: { gap: 4, marginTop: 6 },
  dayTitle: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 17, marginBottom: 2 },
  entry: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingLeft: 10, paddingRight: 2 },
  entryBody: { flex: 1, minWidth: 0, paddingVertical: 8, gap: 3 },
  entryLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  entryValue: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  hint: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  empty: { padding: 16, borderRadius: 14, gap: 4 },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { width: "100%", maxWidth: 520, alignSelf: "center", maxHeight: "90%", borderRadius: 20, padding: 12, gap: 10 },
  dialogBody: { gap: 8 },
});
