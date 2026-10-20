import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, TextField } from "../../../shared/ui/components/public.ts";
import { pickDate } from "../../../shared/ui/components/pickDate.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { ClientMeasurements, Measurement, MeasurementType } from "../domain/MeasurementModel.ts";
import type { MeasurementRepositoryPort } from "../domain/MeasurementRepositoryPort.ts";
import { dailyPoints, formatDate, localDateOf, measurementTypeInfo, parseValueX10 } from "../domain/MeasurementRules.ts";

/** Восемь окружностей в порядке карточки «Замеры»; масса и % жира живут в расчёте и в журнале замеров. */
const CIRCUMFERENCES: readonly MeasurementType[] = ["NECK", "SHOULDERS", "CHEST", "WAIST", "HIPS", "ARM", "THIGH", "CALF"];
const ROWS: readonly (readonly MeasurementType[])[] = [["NECK", "SHOULDERS", "CHEST"], ["WAIST", "HIPS", "ARM"], ["THIGH", "CALF"]];

type Cell = Readonly<{ kind: "EMPTY" }> | Readonly<{ kind: "VALUE"; measurement: Measurement }> | Readonly<{ kind: "MANY" }>;

/** `ДД.ММ` для ленты дат. */
const shortDate = (localDate: string) => `${localDate.slice(8, 10)}.${localDate.slice(5, 7)}`;
const fullDate = (localDate: string) => `${localDate.slice(8, 10)}.${localDate.slice(5, 7)}.${localDate.slice(0, 4)}`;
const valueText = (valueX10: number) => (valueX10 % 10 === 0 ? String(valueX10 / 10) : String(valueX10 / 10).replace(".", ","));

function errorText(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "MEASUREMENT_VALUE_INVALID": return "Проверьте значение: оно вне допустимого диапазона для окружности (10–250 см).";
    case "MEASUREMENT_DATE_INVALID": return "Замер не может быть в будущем.";
    case "MEASUREMENT_STALE": return "Замер уже изменился. Список обновлён, повторите действие.";
    default: return "Не удалось сохранить. Часть замеров могла не измениться — проверьте карточку.";
  }
}

/** Ячейки восьми окружностей на дату по §49.18: единственная запись или выбранная основная — значение; несколько без выбора — «несколько», а не последняя и не среднее. */
function cellsOf(data: ClientMeasurements, localDate: string): Readonly<Record<MeasurementType, Cell>> {
  const cells = {} as Record<MeasurementType, Cell>;
  for (const type of CIRCUMFERENCES) {
    const point = dailyPoints(data.measurements, data.primaries, type).find((candidate) => candidate.localDate === localDate);
    cells[type] = point === undefined ? { kind: "EMPTY" } : point.kind === "VALUE" ? { kind: "VALUE", measurement: point.measurement } : { kind: "MANY" };
  }
  return cells;
}

interface EditorState { readonly editingDate: string | null; readonly date: string; readonly values: Readonly<Record<MeasurementType, string>> }

/**
 * Карточка «Замеры» (§§49.14–49.18, UX «Расчёт»): лента дат, «+», восемь окружностей, «Изменить» и «Удалить». Источник — единственный журнал Measurements;
 * пустое значение — «—», не ноль. Состояние редактирования независимо от формы расчёта.
 */
export function MeasurementsCard({ clientId, repository }: Readonly<{ clientId: string; repository: MeasurementRepositoryPort }>) {
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

  /** Даты, где есть хотя бы одна окружность, по возрастанию. */
  const dates = useMemo(() => data === null ? [] : [...new Set(data.measurements.filter((item) => CIRCUMFERENCES.includes(item.type)).map((item) => item.localDate))].sort(), [data]);
  const current = selected !== null && dates.includes(selected) ? selected : (dates[dates.length - 1] ?? null);
  const cells = useMemo(() => data === null || current === null ? null : cellsOf(data, current), [data, current]);
  const index = current === null ? -1 : dates.indexOf(current);

  const openNew = () => setEditor({ editingDate: null, date: localDateOf(new Date()), values: Object.fromEntries(CIRCUMFERENCES.map((type) => [type, ""])) as Record<MeasurementType, string> });
  const openEdit = () => {
    if (cells === null || current === null) return;
    setEditor({ editingDate: current, date: current, values: Object.fromEntries(CIRCUMFERENCES.map((type) => {
      const cell = cells[type];
      return [type, cell.kind === "VALUE" ? valueText(cell.measurement.valueX10) : ""];
    })) as Record<MeasurementType, string> });
  };

  const save = useCallback(async () => {
    if (editor === null || data === null || busy) return;
    const parsed = CIRCUMFERENCES.map((type) => ({ type, text: editor.values[type].trim(), valueX10: parseValueX10(editor.values[type]) }));
    const invalid = parsed.find((item) => item.text !== "" && item.valueX10 === null);
    if (invalid !== undefined) { setError(`${measurementTypeInfo[invalid.type].label}: число не более чем с одним знаком после запятой, например 97,5.`); return; }
    const existing = editor.editingDate === null ? null : cellsOf(data, editor.editingDate);
    setBusy(true);
    setError(null);
    try {
      for (const item of parsed) {
        const cell = existing === null ? ({ kind: "EMPTY" } as Cell) : existing[item.type];
        if (cell.kind === "MANY") continue;
        if (item.valueX10 === null) {
          if (cell.kind === "VALUE") await repository.remove(cell.measurement.id, cell.measurement.revision);
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

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: colors.accentInk }]} />
        <Text style={[styles.title, { color: colors.accentInk }]}>ЗАМЕРЫ</Text>
        {current !== null ? <>
          <AppButton compact variant="secondary" label="Изменить" disabled={busy} onPress={openEdit} />
          <AppButton compact variant="ghost" label="Удалить" disabled={busy} accessibilityLabel={`Удалить замеры за ${fullDate(current)}`} onPress={() => setConfirmDelete(true)} />
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
                style={[styles.dateChip, { borderColor: date === current ? colors.accentInk : colors.border, backgroundColor: date === current ? colors.accentFill : colors.surfaceRaised }]}>
                <Text style={[styles.dateText, { color: date === current ? colors.onAccentFill : colors.textPrimary }]}>{shortDate(date)}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Новая запись замеров" onPress={openNew} style={[styles.dateChip, styles.plus, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
              <Plus size={20} color={colors.accentInk} />
            </Pressable>
          </ScrollView>
          <AppIconButton label="Следующая дата замера" icon={<ChevronRight size={20} color={colors.textSecondary} />} disabled={index < 0 || index >= dates.length - 1} onPress={() => move(1)} />
        </View>
        {current === null || cells === null ? <>
          <Text style={[styles.empty, { color: colors.textSecondary }]}>Замеров пока нет. Нажмите «+», чтобы добавить первую запись.</Text>
          <AppButton variant="secondary" label="Новая запись" onPress={openNew} />
        </> : <>
          <Text style={[styles.fullDate, { color: colors.textPrimary }]}>{fullDate(current)}</Text>
          {ROWS.map((row) => (
            <View key={row.join()} style={styles.tiles}>
              {row.map((type) => {
                const cell = cells[type];
                const text = cell.kind === "VALUE" ? `${valueText(cell.measurement.valueX10)} см` : cell.kind === "MANY" ? "несколько" : "—";
                return (
                  <View key={type} accessible accessibilityLabel={`${measurementTypeInfo[type].label}: ${cell.kind === "VALUE" ? text : cell.kind === "MANY" ? "несколько записей, основная не выбрана" : "нет данных"}`}
                    style={[styles.tile, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
                    <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>{measurementTypeInfo[type].label}</Text>
                    <Text style={[styles.tileValue, { color: cell.kind === "VALUE" ? colors.textPrimary : colors.textMuted }]}>{text}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </>}
      </>}

      <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) setEditor(null); }}>
        <View style={styles.backdrop}>
          <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
            <Text style={[styles.dialogTitle, { color: colors.textPrimary }]}>{editor?.editingDate === null ? "Новая запись" : "Изменить замеры"}</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogBody}>
              {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
              <AppButton variant="secondary" label={editor === null ? "" : formatDate(editor.date)} accessibilityLabel="Дата замера" disabled={busy}
                onPress={() => { void pickDate({ value: editor?.date ?? localDateOf(new Date()), title: "Дата замера" }).then((picked) => { if (picked !== null && editor !== null) setEditor({ ...editor, date: picked }); }); }} />
              <Text style={[styles.hint, { color: colors.textSecondary }]}>Заполните то, что измерено. Пустое поле остаётся «нет данных»; у существующей записи пустое поле удаляет это значение.</Text>
              {editor === null ? null : [0, 2, 4, 6].map((start) => (
                <View key={start} style={styles.tiles}>
                  {CIRCUMFERENCES.slice(start, start + 2).map((type) => {
                    const locked = editor.editingDate !== null && cells !== null && editor.editingDate === current && cells[type].kind === "MANY";
                    return (
                      <View key={type} style={styles.grow}>
                        <TextField label={`${measurementTypeInfo[type].label}, см`} value={editor.values[type]} keyboardType="decimal-pad" disabled={locked || busy}
                          disabledReason="За эту дату несколько записей: выберите основную в журнале замеров."
                          onChangeText={(text) => setEditor({ ...editor, values: { ...editor.values, [type]: text } })} />
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
            <AppButton label="Сохранить" busy={busy} onPress={() => { void save(); }} />
            <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => { setEditor(null); setError(null); }} />
          </View>
        </View>
      </Modal>
      <ConfirmDialog visible={confirmDelete} destructive title="Удалить замеры за день?" confirmLabel="Удалить" onCancel={() => setConfirmDelete(false)} onConfirm={() => { void removeDate(); }}
        description={current === null ? "" : `Будут удалены все окружности за ${fullDate(current)}. Масса тела и процент жира не затрагиваются.`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...shadow.card, borderRadius: 24, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
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
  tileLabel: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  tileValue: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10, maxHeight: "92%" },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  dialogBody: { gap: 10, paddingBottom: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
