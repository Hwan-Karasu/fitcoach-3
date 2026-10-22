import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, TextField } from "../../../shared/ui/components/public.ts";
import { pickDate } from "../../../shared/ui/components/pickDate.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { MEASUREMENT_GROUPS, MEASUREMENT_TYPES, type ClientMeasurements, type Measurement, type MeasurementGroup, type MeasurementType } from "../domain/MeasurementModel.ts";
import type { MeasurementRepositoryPort } from "../domain/MeasurementRepositoryPort.ts";
import { dailyPoints, formatDate, localDateOf, measurementTypeInfo, parseValueX10 } from "../domain/MeasurementRules.ts";

/** Окружности: всё, кроме массы и % жира (они живут в расчёте и в журнале замеров). */
const CIRCUMFERENCES: readonly MeasurementType[] = MEASUREMENT_TYPES.filter((type) => type !== "WEIGHT" && type !== "BODY_FAT");
/** Базовый набор карточки: прежние восемь обхватов (плечо, бедро и голень — с сторонами). Остальные включаются в «Настроить замеры» (UX v1.1, NUT-FS-10). */
const DEFAULT_VISIBLE: ReadonlySet<string> = new Set(["NECK", "SHOULDERS", "CHEST", "WAIST", "HIPS", "BICEPS", "THIGH", "CALF"]);
const typesOf = (group: MeasurementGroup): readonly MeasurementType[] => [group.single, group.left, group.right, group.legacy].filter((type): type is MeasurementType => type !== undefined);

type Cell = Readonly<{ kind: "EMPTY" }> | Readonly<{ kind: "VALUE"; measurement: Measurement }> | Readonly<{ kind: "MANY" }>;

/** `ДД.ММ` для ленты дат. */
const shortDate = (localDate: string) => `${localDate.slice(8, 10)}.${localDate.slice(5, 7)}`;
const fullDate = (localDate: string) => `${localDate.slice(8, 10)}.${localDate.slice(5, 7)}.${localDate.slice(0, 4)}`;
const sideLabels = (group: MeasurementGroup): readonly [string, string] => group.id === "THIGH"
  ? ["Левое", "Правое"] : group.id === "CALF" ? ["Левая", "Правая"] : ["Левый", "Правый"];
const valueText = (valueX10: number) => (valueX10 % 10 === 0 ? String(valueX10 / 10) : String(valueX10 / 10).replace(".", ","));

function errorText(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "MEASUREMENT_VALUE_INVALID": return "Проверьте значение: оно вне допустимого диапазона для окружности (10–250 см).";
    case "MEASUREMENT_DATE_INVALID": return "Замер не может быть в будущем.";
    case "MEASUREMENT_MANY": return "За эту дату уже несколько записей показателя. Выберите основную в журнале замеров.";
    case "MEASUREMENT_STALE": return "Замер уже изменился. Список обновлён, повторите действие.";
    default: return "Не удалось сохранить. Часть замеров могла не измениться — проверьте карточку.";
  }
}

/** Ячейки обхватов на дату по §49.18: единственная запись или выбранная основная — значение; несколько без выбора — «несколько», а не последняя и не среднее. */
function cellsOf(data: ClientMeasurements, localDate: string): Readonly<Record<MeasurementType, Cell>> {
  const cells = {} as Record<MeasurementType, Cell>;
  for (const type of CIRCUMFERENCES) {
    const point = dailyPoints(data.measurements, data.primaries, type).find((candidate) => candidate.localDate === localDate);
    cells[type] = point === undefined ? { kind: "EMPTY" } : point.kind === "VALUE" ? { kind: "VALUE", measurement: point.measurement } : { kind: "MANY" };
  }
  return cells;
}

const cellText = (cell: Cell): string => cell.kind === "VALUE" ? valueText(cell.measurement.valueX10) : cell.kind === "MANY" ? "несколько" : "—";
const cellSpeech = (cell: Cell): string => cell.kind === "VALUE" ? `${valueText(cell.measurement.valueX10)} см` : cell.kind === "MANY" ? "несколько записей, основная не выбрана" : "нет данных";

interface EditorState { readonly editingDate: string | null; readonly date: string; readonly values: Readonly<Record<MeasurementType, string>> }

function Tile({ group, cells, compact }: Readonly<{ group: MeasurementGroup; cells: Readonly<Record<MeasurementType, Cell>>; compact: boolean }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const sided = group.left !== undefined && group.right !== undefined;
  const legacy = group.legacy === undefined ? null : cells[group.legacy];
  const hasLegacy = legacy !== null && legacy.kind !== "EMPTY";
  const speech = sided
    ? `${group.label}: левый ${cellSpeech(cells[group.left as MeasurementType])}, правый ${cellSpeech(cells[group.right as MeasurementType])}${hasLegacy ? `, без указания стороны ${cellSpeech(legacy)}` : ""}`
    : `${group.label}: ${cellSpeech(cells[group.single as MeasurementType])}`;
  const muted = (cell: Cell) => cell.kind === "VALUE" ? colors.textPrimary : colors.textMuted;
  return (
    <View accessible accessibilityLabel={speech} style={[styles.tile, compact && styles.compactTile, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
      <Text style={[styles.tileLabel, compact && styles.compactTileLabel, { color: colors.textSecondary }]}>{group.label}</Text>
      {sided ? <>
        <View style={styles.sides}>
          <Text style={[styles.tileValue, compact && styles.compactTileValue, { color: muted(cells[group.left as MeasurementType]) }]}>{`Л ${cellText(cells[group.left as MeasurementType])}`}</Text>
          <Text style={[styles.tileValue, compact && styles.compactTileValue, { color: muted(cells[group.right as MeasurementType]) }]}>{`П ${cellText(cells[group.right as MeasurementType])}`}</Text>
        </View>
        {hasLegacy ? <Text style={[styles.tileLabel, compact && styles.compactTileLabel, { color: colors.textMuted }]}>{`без стороны ${cellText(legacy)}`}</Text> : null}
      </> : <Text style={[styles.tileValue, compact && styles.compactTileValue, { color: muted(cells[group.single as MeasurementType]) }]}>{cellText(cells[group.single as MeasurementType])}{cells[group.single as MeasurementType].kind === "VALUE" ? " см" : ""}</Text>}
    </View>
  );
}

/**
 * Карточка «Замеры» (§§49.14–49.18, UX «Расчёт», v1.1 NUT-FS-07…14): лента дат, «+», компактные группы обхватов (плечо, предплечье, бедро, голень — Л и П в одном блоке), «Изменить»,
 * «Удалить» и «Настроить замеры». Источник — единственный журнал Measurements; пусто — «—», не ноль; старые односторонние значения остаются «без стороны». Видимость полей — настройка
 * экрана на время работы: скрытое поле не удаляет факты, а группа с данными за выбранную дату показывается всегда.
 */
export function MeasurementsCard({ clientId, repository, onOpenJournal, compact = false }: Readonly<{ compact?: boolean; clientId: string; repository: MeasurementRepositoryPort;
  /** Полный журнал замеров: несколько значений за день, выбор основного, масса и % жира. */
  onOpenJournal?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [data, setData] = useState<ClientMeasurements | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(DEFAULT_VISIBLE);
  const [configuring, setConfiguring] = useState(false);
  const stripRef = useRef<ScrollView>(null);

  useEffect(() => {
    let active = true;
    void repository.listForClient(clientId).then((loaded) => { if (active) { setData(loaded); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [repository, clientId, tick]);
  useEffect(() => {
    const off = repository.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); });
    return off;
  }, [repository, clientId]);

  /** Даты, где есть хотя бы один обхват, по возрастанию. */
  const dates = useMemo(() => data === null ? [] : [...new Set(data.measurements.filter((item) => CIRCUMFERENCES.includes(item.type)).map((item) => item.localDate))].sort(), [data]);
  const current = selected !== null && dates.includes(selected) ? selected : (dates[dates.length - 1] ?? null);
  const cells = useMemo(() => data === null || current === null ? null : cellsOf(data, current), [data, current]);
  const index = current === null ? -1 : dates.indexOf(current);
  /** Показываемые группы: включённые в настройке и все, где за дату есть данные. */
  const groupsFor = (shownCells: Readonly<Record<MeasurementType, Cell>> | null): readonly MeasurementGroup[] =>
    MEASUREMENT_GROUPS.filter((group) => visible.has(group.id) || (shownCells !== null && typesOf(group).some((type) => shownCells[type].kind !== "EMPTY")));
  const shownGroups = useMemo(() => groupsFor(cells), [cells, visible]);

  const emptyValues = () => Object.fromEntries(CIRCUMFERENCES.map((type) => [type, ""])) as Record<MeasurementType, string>;
  const openNew = () => setEditor({ editingDate: null, date: localDateOf(new Date()), values: emptyValues() });
  const openEdit = () => {
    if (cells === null || current === null) return;
    setEditor({ editingDate: current, date: current, values: Object.fromEntries(CIRCUMFERENCES.map((type) => [type, cells[type].kind === "VALUE" ? valueText((cells[type] as { measurement: Measurement }).measurement.valueX10) : ""])) as Record<MeasurementType, string> });
  };

  const save = useCallback(async () => {
    if (editor === null || data === null || busy) return;
    const parsed = CIRCUMFERENCES.map((type) => ({ type, text: editor.values[type].trim(), valueX10: parseValueX10(editor.values[type]) }));
    const invalid = parsed.find((item) => item.text !== "" && item.valueX10 === null);
    if (invalid !== undefined) { setError(`${measurementTypeInfo[invalid.type].label}: число не более чем с одним знаком после запятой, например 97,5.`); return; }
    const moving = editor.editingDate !== null && editor.editingDate !== editor.date;
    const source = cellsOf(data, editor.editingDate ?? editor.date);
    if (moving && CIRCUMFERENCES.some((type) => source[type].kind === "MANY")) { setError("За эту дату несколько записей одного показателя: смена даты недоступна. Выберите основную в журнале замеров."); return; }
    if (moving && data.measurements.some((row) => row.localDate === editor.date && CIRCUMFERENCES.includes(row.type))) { setError("На выбранную дату замеры уже есть. Откройте ту дату и измените её или выберите другую."); return; }
    setBusy(true);
    setError(null);
    try {
      for (const item of parsed) {
        const cell = source[item.type];
        if (cell.kind === "MANY") { if (item.valueX10 !== null && editor.editingDate === null) throw new Error("MEASUREMENT_MANY"); continue; }
        if (item.valueX10 === null) {
          // Пустое поле удаляет значение только при изменении существующей записи; в новой записи пустое поле ничего не делает.
          if (cell.kind === "VALUE" && editor.editingDate !== null) await repository.remove(cell.measurement.id, cell.measurement.revision);
          continue;
        }
        if (cell.kind === "VALUE") {
          if (cell.measurement.valueX10 !== item.valueX10 || cell.measurement.localDate !== editor.date) {
            await repository.correct(cell.measurement.id, cell.measurement.revision, { type: item.type, valueX10: item.valueX10, localDate: editor.date, localMinute: cell.measurement.localMinute });
          }
        } else {
          await repository.record(clientId, { type: item.type, valueX10: item.valueX10, localDate: editor.date, localMinute: null });
        }
      }
      setSelected(editor.date);
      setEditor(null);
    } catch (failure) {
      setError(errorText(failure));
      setTick((value) => value + 1);
    }
    setBusy(false);
  }, [editor, data, busy, repository, clientId]);

  const removeDate = async () => {
    if (data === null || current === null) return;
    setConfirmDelete(false);
    setBusy(true);
    try {
      for (const item of data.measurements.filter((row) => row.localDate === current && CIRCUMFERENCES.includes(row.type))) await repository.remove(item.id, item.revision);
      setSelected(null);
      setError(null);
    } catch (failure) { setError(errorText(failure)); setTick((value) => value + 1); }
    setBusy(false);
  };

  const move = (step: number) => {
    const next = dates[index + step];
    if (next !== undefined) setSelected(next);
  };
  const toggleGroup = (id: string) => setVisible((currentSet) => { const next = new Set(currentSet); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  /** Плотный просмотр — три группы в ряд; обычный — одиночные по три, парные по две. */
  const rows = (groups: readonly MeasurementGroup[]): readonly (readonly MeasurementGroup[])[] => {
    const singles = groups.filter((group) => group.single !== undefined);
    const sided = groups.filter((group) => group.single === undefined);
    const chunk = (list: readonly MeasurementGroup[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, row) => list.slice(row * size, row * size + size));
    return compact ? chunk(groups, 3) : [...chunk(singles, 3), ...chunk(sided, 2)];
  };
  const editorGroups = groupsFor(editor !== null && editor.editingDate !== null ? cells : null);
  const editorField = (type: MeasurementType, label: string) => {
    if (editor === null) return null;
    const locked = editor.editingDate !== null && editor.editingDate === current && cells !== null && cells[type].kind === "MANY";
    return <View key={type} style={styles.grow}><TextField compact textAlign="center" label={label} value={editor.values[type]}
      keyboardType="decimal-pad" disabled={locked || busy} disabledReason="Несколько записей: выберите основную в журнале."
      onChangeText={(text) => setEditor({ ...editor, values: { ...editor.values, [type]: text } })} /></View>;
  };

  return (
    <View style={[styles.card, compact && styles.compactCard, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: colors.accentInk }]} />
        <Text style={[styles.title, { color: colors.accentInk }]}>ЗАМЕРЫ{compact && current !== null ? <Text style={styles.compactDateTitle}>{`\n${fullDate(current)}`}</Text> : null}</Text>
        {current !== null ? <>
          <AppButton compact size={compact ? "small" : "default"} variant="secondary" label="Изменить" disabled={busy} onPress={openEdit} />
          <AppButton compact size={compact ? "small" : "default"} variant="ghost" label="Удалить" disabled={busy} accessibilityLabel={`Удалить замеры за ${fullDate(current)}`} onPress={() => setConfirmDelete(true)} />
        </> : null}
      </View>
      {error !== null && editor === null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {data === null ? (failed ? <InlineNotice kind="error">Не удалось загрузить замеры.</InlineNotice> : <LoadingState label="Загружаем замеры…" />) : <>
        <View style={styles.strip}>
          <AppIconButton label="Предыдущая дата замера" icon={<ChevronLeft size={20} color={colors.textSecondary} />} disabled={index <= 0} onPress={() => move(-1)} />
          <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} style={styles.grow} contentContainerStyle={styles.stripList}
            onContentSizeChange={() => stripRef.current?.scrollToEnd({ animated: false })}>
            {dates.map((date) => (
              <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: date === current }} accessibilityLabel={`Замер от ${fullDate(date)}`} onPress={() => setSelected(date)}
                style={[styles.dateChip, compact && styles.compactDateChip, { borderColor: date === current ? colors.accentInk : colors.border, backgroundColor: date === current ? colors.accentFill : colors.surfaceRaised }]}>
                <Text style={[styles.dateText, { color: date === current ? colors.onAccentFill : colors.textPrimary }]}>{shortDate(date)}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Новая запись замеров" onPress={openNew} style={[styles.dateChip, styles.plus, compact && styles.compactDateChip, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
              <Plus size={20} color={colors.accentInk} />
            </Pressable>
          </ScrollView>
          <AppIconButton label="Следующая дата замера" icon={<ChevronRight size={20} color={colors.textSecondary} />} disabled={index < 0 || index >= dates.length - 1} onPress={() => move(1)} />
        </View>
        {current === null || cells === null ? <>
          <Text style={[styles.empty, { color: colors.textSecondary }]}>Замеров пока нет. Нажмите «+», чтобы добавить первую запись.</Text>
          {!compact ? <AppButton variant="secondary" label="Новая запись" onPress={openNew} /> : null}
        </> : <>
          {!compact ? <Text style={[styles.fullDate, { color: colors.textPrimary }]}>{fullDate(current)}</Text> : null}
          {rows(shownGroups).map((row) => (
            <View key={row.map((group) => group.id).join()} style={styles.tiles}>
              {row.map((group) => <Tile key={group.id} group={group} cells={cells} compact={compact} />)}
            </View>
          ))}
        </>}
        <View style={styles.tiles}>
          <View style={styles.grow}><AppButton compact size={compact ? "small" : "default"} variant="ghost" label={configuring ? "Готово" : "Настроить замеры"} onPress={() => setConfiguring(!configuring)} /></View>
          {onOpenJournal !== undefined ? <View style={styles.grow}><AppButton compact size={compact ? "small" : "default"} variant="ghost" label="Журнал замеров" onPress={onOpenJournal} /></View> : null}
        </View>
        {configuring ? <>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Выберите показатели, которые показывать. Скрытие не удаляет внесённые значения; группа с данными за дату видна всегда. Настройка действует, пока открыто приложение.</Text>
          <View style={styles.settingsGrid}>
            {MEASUREMENT_GROUPS.map((group) => <Pressable key={group.id} accessibilityRole="checkbox" accessibilityLabel={`Показать замер: ${group.label}`}
              accessibilityState={{ checked: visible.has(group.id) }} onPress={() => toggleGroup(group.id)}
              style={({ pressed }) => [styles.settingChip, { backgroundColor: visible.has(group.id) ? colors.accentFill : colors.surfaceRaised,
                borderColor: visible.has(group.id) ? colors.accentFill : colors.border, opacity: pressed ? 0.75 : 1 }]}>
              <View style={styles.checkSpace}>{visible.has(group.id) ? <Check size={14} color={colors.onAccentFill} /> : null}</View>
              <Text style={[styles.settingLabel, { color: visible.has(group.id) ? colors.onAccentFill : colors.textSecondary }]}>{group.label}</Text>
              <View style={styles.checkSpace} />
            </Pressable>)}
          </View>
        </> : null}
      </>}

      <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) setEditor(null); }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.backdrop}>
          <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
            <View style={styles.head}>
              <Text style={[styles.dialogTitle, styles.grow, { color: colors.textPrimary }]}>{editor?.editingDate === null ? "Новые замеры" : "Изменить замеры"}</Text>
              <AppButton compact size="small" variant="secondary" label={editor === null ? "Дата" : shortDate(editor.date)} accessibilityLabel={editor === null ? "Дата замеров" : `Дата замеров: ${formatDate(editor.date)}`} disabled={busy}
                onPress={() => { void pickDate({ value: editor?.date ?? localDateOf(new Date()), title: "Дата замеров" }).then((picked) => { if (picked !== null && editor !== null) setEditor({ ...editor, date: picked }); }); }} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogBody}>
              {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
              <Text style={[styles.editorHint, { color: colors.textSecondary }]}>Все обхваты — в см. Пустое поле при исправлении удаляет значение. Левую и правую сторону можно вносить отдельно.</Text>
              <View style={styles.editorGrid}>
                {editorGroups.filter((group) => group.single !== undefined).map((group) => <View key={group.id} style={styles.singleEditor}>
                  {editorField(group.single as MeasurementType, group.label)}
                </View>)}
              </View>
              <View style={styles.editorGrid}>
                {editorGroups.filter((group) => group.left !== undefined && group.right !== undefined).map((group) => <View key={group.id}
                  style={[styles.pairedEditor, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                  <Text style={[styles.groupLabel, { color: colors.textPrimary }]}>{group.label}</Text>
                  <View style={styles.tiles}>{editorField(group.left as MeasurementType, sideLabels(group)[0])}{editorField(group.right as MeasurementType, sideLabels(group)[1])}</View>
                  {group.legacy !== undefined && editor !== null && editor.values[group.legacy] !== "" ? editorField(group.legacy, "Без стороны") : null}
                </View>)}
              </View>
            </ScrollView>
            <View style={styles.tiles}>
              <View style={styles.grow}><AppButton compact size="small" variant="secondary" label="Отмена" disabled={busy} onPress={() => { setEditor(null); setError(null); }} /></View>
              <View style={styles.grow}><AppButton compact size="small" label="Сохранить" busy={busy} onPress={() => { void save(); }} /></View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ConfirmDialog visible={confirmDelete} destructive title="Удалить замеры за день?" confirmLabel="Удалить" onCancel={() => setConfirmDelete(false)} onConfirm={() => { void removeDate(); }}
        description={current === null ? "" : `Будут удалены все окружности за ${fullDate(current)}. Масса тела и процент жира не затрагиваются.`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...shadow.card, borderRadius: 24, padding: 14, gap: 10 },
  compactCard: { padding: 8, gap: 4, borderRadius: 20 },
  compactTile: { minHeight: 40, paddingHorizontal: 5, paddingVertical: 4, borderRadius: 10, gap: 0 },
  compactTileLabel: { fontSize: 10, lineHeight: 13 },
  compactTileValue: { fontSize: 11, lineHeight: 15 },
  compactDateTitle: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 13, letterSpacing: 0 },
  compactDateChip: { minHeight: 40 },
  head: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0.6 },
  grow: { flex: 1 },
  strip: { flexDirection: "row", alignItems: "center", gap: 2 },
  stripList: { gap: 8, alignItems: "center", paddingHorizontal: 4 },
  dateChip: { minWidth: 56, minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  plus: { minWidth: 48, paddingHorizontal: 0 },
  dateText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  fullDate: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minHeight: 64, borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, justifyContent: "center", gap: 2 },
  sides: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  tileLabel: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  tileValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  settingsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  settingChip: { width: "47%", flexGrow: 1, minHeight: 38, borderRadius: 19, borderWidth: 1, paddingHorizontal: 8, flexDirection: "row", alignItems: "center" },
  checkSpace: { width: 16 },
  settingLabel: { flex: 1, fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, textAlign: "center" },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { width: "100%", maxWidth: 520, alignSelf: "center", borderRadius: 20, padding: 12, gap: 8, maxHeight: "92%" },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  dialogBody: { gap: 10, paddingBottom: 4 },
  editorHint: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  editorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  singleEditor: { width: "30%", flexGrow: 1 },
  pairedEditor: { width: "47%", flexGrow: 1, borderWidth: 1, borderRadius: 12, padding: 6, gap: 4 },
  groupLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
