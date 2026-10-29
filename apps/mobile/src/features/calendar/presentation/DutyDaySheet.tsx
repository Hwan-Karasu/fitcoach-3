import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { AppButton, InlineNotice, SelectionChip, TextField, TimeWheelPicker } from "../../../shared/ui/components/public.ts";
import { MAX_DUTY_PRESETS, MAX_DUTY_PRESET_NAME, type DutyPreset } from "../../../shared/domain/DutyPreset.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { CalendarInterval, LocalDate } from "../domain/CalendarModel.ts";
import type { TimeWindow } from "../domain/CalendarGeometry.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { formatMinute, mergeDutyRange } from "../domain/CalendarRules.ts";
import { SLOT_MINUTES } from "../domain/CalendarModel.ts";
import { calendarErrorMessage, dayTitle } from "./calendarPresentation.ts";

/** Пресеты — сеткой по два в ряд на всю ширину окна. */
const PRESET_COLUMNS = 2;

const rangeText = (start: number, end: number) => `${formatMinute(start)}–${formatMinute(end)}`;

/**
 * Дежурство дня из шапки календаря: второй способ рядом с протягиванием по сетке — работает, когда день занят
 * карточками клиентов. Диапазон сливается с соседними дежурствами; пресет применяется одним касанием.
 */
export function DutyDaySheet({ date, repository, window, onClose }: Readonly<{
  /** `null` — окно закрыто. */
  date: LocalDate | null;
  repository: CalendarRepositoryPort;
  window: TimeWindow;
  onClose: () => void;
}>) {
  const { palette, dutyPresets, setDutyPresets } = usePrototypeTheme();
  const colors = palette.tokens;
  const [duties, setDuties] = useState<readonly CalendarInterval[]>([]);
  const [start, setStart] = useState(window.startMinute);
  const [end, setEnd] = useState(window.endMinute);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Дежурства дня читаются при открытии и после каждого commit; подписка снимается при закрытии.
  useEffect(() => {
    if (date === null) return undefined;
    setStart(window.startMinute);
    setEnd(window.endMinute);
    setDuties([]);
    setEditingId(null);
    setPresetName(null);
    setError(null);
    let active = true;
    const load = () => {
      void repository.listRange(date, date).then((range) => {
        if (active) setDuties(range.intervals.filter((row) => row.kind === "DUTY"));
      }, () => { if (active) setError("Не удалось прочитать дежурства дня."); });
    };
    load();
    const off = repository.subscribeCommittedChanges((change) => {
      if (change.dates === "ALL" || change.dates.includes(date)) load();
    });
    return () => { active = false; off(); };
  }, [date, repository, window.endMinute, window.startMinute]);

  if (date === null) return null;

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await task(); } catch (failure) { setError(calendarErrorMessage(failure)); } finally { setBusy(false); }
  };
  const apply = (from: number, to: number, replacing: string | null) => run(async () => {
    const plan = mergeDutyRange(duties, date, from, to, replacing);
    await repository.reshapeIntervals(plan.removeIds, [plan.create]);
    onClose();
  });
  const savePreset = () => {
    const name = (presetName ?? "").trim();
    if (name === "") { setError("Введите название пресета."); return; }
    setDutyPresets([...dutyPresets, { id: `duty-${Date.now().toString(36)}`, name, startMinute: start, endMinute: end }]);
    setPresetName(null);
  };
  const removePreset = (preset: DutyPreset) => setDutyPresets(dutyPresets.filter((item) => item.id !== preset.id));

  const timeButton = (kind: "start" | "end", label: string, value: number) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${formatMinute(value)}. Изменить`} disabled={busy}
      onPress={() => setPicker(kind)}
      style={({ pressed }) => [styles.time, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.timeValue, { color: colors.textPrimary }]}>{formatMinute(value)}</Text>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={styles.overlay}>
        <Pressable accessible={false} importantForAccessibility="no" style={styles.scrim} onPress={() => { if (!busy) onClose(); }} />
        <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Дежурство · {dayTitle(date)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть окно дежурства" disabled={busy} onPress={onClose} style={styles.close}>
              <X size={20} color={colors.iconPrimary} />
            </Pressable>
          </View>
          {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}

          {duties.map((row) => (
            <View key={row.id} style={styles.row}>
              <Text style={[styles.dutyText, { color: editingId === row.id ? colors.accentInk : colors.textPrimary }]}>
                {rangeText(row.startMinute, row.endMinute)}
              </Text>
              <View style={styles.dutyActions}>
                <AppButton compact size="small" variant="secondary" label="Изменить" disabled={busy}
                  onPress={() => { setEditingId(row.id); setStart(row.startMinute); setEnd(row.endMinute); }} />
                <AppButton compact size="small" variant="destructive" label="Снять" disabled={busy}
                  onPress={() => { void run(async () => { await repository.removeInterval(row.id); if (editingId === row.id) setEditingId(null); }); }} />
              </View>
            </View>
          ))}
          {duties.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>В этот день дежурства нет.</Text> : null}

          {dutyPresets.length > 0 ? (
            <View style={styles.presetGrid}>
              {Array.from({ length: Math.ceil(dutyPresets.length / PRESET_COLUMNS) }, (_, rowIndex) => (
                <View key={rowIndex} style={styles.presetGridRow}>
                  {Array.from({ length: PRESET_COLUMNS }, (_, column) => {
                    const preset = dutyPresets[rowIndex * PRESET_COLUMNS + column];
                    // Пустая ячейка последнего ряда держит ширину колонки: нечётный пресет не растягивается на всю строку.
                    if (preset === undefined) return <View key={`empty-${column}`} style={styles.presetCell} />;
                    return (
                      <View key={preset.id} style={styles.presetCell}>
                        <SelectionChip fill compact group="Пресет дежурства" label={`${preset.name} ${rangeText(preset.startMinute, preset.endMinute)}`}
                          selected={false} disabled={busy} onPress={() => { void apply(preset.startMinute, preset.endMinute, editingId); }} />
                        <Pressable accessibilityRole="button" accessibilityLabel={`Удалить пресет ${preset.name}`} disabled={busy}
                          onPress={() => removePreset(preset)} style={styles.presetRemove}>
                          <X size={14} color={colors.textSecondary} />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.row}>
            {timeButton("start", "С", start)}
            {timeButton("end", "До", end)}
          </View>

          {presetName === null ? (
            <View style={styles.row}>
              <View style={styles.cell}>
                <AppButton compact size="small" variant="secondary" label="Как пресет" disabled={busy || dutyPresets.length >= MAX_DUTY_PRESETS}
                  onPress={() => setPresetName("")} />
              </View>
              <View style={styles.cell}>
                <AppButton compact size="small" busy={busy} label={editingId === null ? "Добавить дежурство" : "Сохранить дежурство"}
                  onPress={() => { void apply(start, end, editingId); }} />
              </View>
            </View>
          ) : <>
            <TextField compact label="Название пресета" value={presetName} onChangeText={(value) => setPresetName(value.slice(0, MAX_DUTY_PRESET_NAME))}
              placeholder="Например, Утро" />
            <View style={styles.row}>
              <View style={styles.cell}><AppButton compact size="small" variant="secondary" label="Отмена" onPress={() => setPresetName(null)} /></View>
              <View style={styles.cell}><AppButton compact size="small" label="Сохранить пресет" onPress={savePreset} /></View>
            </View>
          </>}
        </View>
      </View>
      <TimeWheelPicker visible={picker === "start"} title="Дежурство с" value={start} min={0} max={end - SLOT_MINUTES}
        onClose={() => setPicker(null)} onConfirm={(minute) => setStart(minute)} />
      <TimeWheelPicker visible={picker === "end"} title="Дежурство до" value={end} min={start + SLOT_MINUTES} max={1440}
        onClose={() => setPicker(null)} onConfirm={(minute) => setEnd(minute)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.48)" },
  dialog: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  cell: { flex: 1, minWidth: 0 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  dutyText: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  dutyActions: { flexDirection: "row", gap: 6 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  presetGrid: { gap: 6 },
  presetGridRow: { flexDirection: "row", gap: 6 },
  presetCell: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  presetRemove: { width: 32, height: 48, alignItems: "center", justifyContent: "center" },
  time: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  timeLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  timeValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
});
