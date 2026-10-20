import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, ChevronRight, Droplets, Plus } from "lucide-react-native";
import { AppButton, AppIconButton, EmptyState, InlineNotice, LoadingState, StatusTag, TextField } from "../../../shared/ui/components/public.ts";
import { pickDate } from "../../../shared/ui/components/pickDate.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { MEAL_SLOTS, type DiaryEntry, type MealSlot } from "../domain/DiaryModel.ts";
import { sumNutrients } from "../domain/DiaryRules.ts";
import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type TargetMetric } from "../domain/TargetModel.ts";
import { assessDay, NUTRIENT_OF } from "../domain/TargetRules.ts";
import { dayTitle, kcalText, metricLabels, nutritionErrorText, quantityText, rangeText, shiftDate, slotLabels, todayLocal, unitLabels, verdictKinds, verdictLabels,
  wholeText } from "./nutritionFormat.ts";
import { useNutritionDay } from "./useNutritionDay.ts";

const WATER_STEP_ML = 250;

function EntryRow({ entry, onOpen }: Readonly<{ entry: DiaryEntry; onOpen: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { snapshot } = entry;
  const detail = [quantityText(snapshot.basis, snapshot.quantityX10), kcalText(snapshot.eaten), snapshot.source.kind === "RECIPE" ? "рецепт" : null]
    .filter((part) => part !== null).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${snapshot.name}, ${detail}. Изменить количество`} onPress={onOpen}
      style={({ pressed }) => [styles.entry, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
      <Text numberOfLines={2} style={[styles.entryName, { color: colors.textPrimary }]}>{snapshot.name}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{detail}</Text>
    </Pressable>
  );
}

/** Правка количества или удаление записи; снимок продукта не меняется (§49.5.2). */
function EntryDialog({ entry, onClose, onSave, onRemove }: Readonly<{ entry: DiaryEntry | null; onClose: () => void;
  onSave: (entry: DiaryEntry, quantityX10: number) => Promise<string | null>; onRemove: (entry: DiaryEntry) => Promise<string | null> }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [text, setText] = useState("");
  const [shownId, setShownId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (entry !== null && shownId !== entry.id) { setShownId(entry.id); setText(formatDecimalX10(entry.snapshot.quantityX10)); setError(null); }
  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    const message = await work();
    setBusy(false);
    if (message === null) onClose(); else setError(message);
  };
  const save = () => {
    const quantity = parseDecimalX10(text);
    if (entry === null) return;
    if (quantity === null || quantity <= 0) { setError("Введите количество, например 150 или 1,5."); return; }
    void run(() => onSave(entry, quantity));
  };
  return (
    <Modal visible={entry !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <Text style={[styles.dialogTitle, { color: colors.textPrimary }]}>{entry?.snapshot.name ?? ""}</Text>
          <TextField label={`Количество, ${entry === null ? "" : unitLabels[entry.snapshot.basis.unit]}`} value={text} onChangeText={setText} keyboardType="decimal-pad"
            hint="Значения продукта — из момента добавления." error={error ?? undefined} />
          <AppButton label="Сохранить" onPress={save} busy={busy} />
          <AppButton variant="destructive" label="Удалить запись" disabled={busy} onPress={() => { if (entry !== null) void run(() => onRemove(entry)); }} />
          <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/**
 * «Дневник» питания клиента (§49.2): день, итоги и коридоры цели, приёмы пищи, вода. Итог — сумма внесённых записей; пустой день и день только с водой
 * не оцениваются (§49.22). Экран пишет через порты дневника и читает цель на дату (исключение → версия → «не установлена»).
 */
export function NutritionDiaryScreen({ clientId, diary, targets, onAdd }: Readonly<{
  clientId: string;
  diary: NutritionDiaryPort;
  targets: NutritionTargetsPort;
  onAdd: (localDate: string, slot: MealSlot) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [localDate, setLocalDate] = useState(today);
  const { data, failed } = useNutritionDay(clientId, localDate, diary, targets);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(async (work: () => Promise<unknown>): Promise<string | null> => {
    try { await work(); setError(null); return null; } catch (failure) { const message = nutritionErrorText(failure); setError(message); return message; }
  }, []);
  const changeWater = (delta: number) => {
    const next = Math.max(0, (data?.waterMl ?? 0) + delta);
    void guard(() => next === 0 ? diary.clearWater(clientId, localDate) : diary.setWater(clientId, localDate, next));
  };

  const header = (
    <View style={styles.dateBar}>
      <AppIconButton label="Предыдущий день" icon={<ChevronLeft size={22} color={colors.textPrimary} />} onPress={() => setLocalDate(shiftDate(localDate, -1))} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${dayTitle(localDate, today)}. Выбрать дату`} style={styles.dateTitle}
        onPress={() => { void pickDate({ value: localDate, title: "Дата дневника" }).then((picked) => { if (picked !== null) setLocalDate(picked); }); }}>
        <Text style={[styles.dateText, { color: colors.textPrimary }]}>{dayTitle(localDate, today)}</Text>
      </Pressable>
      <AppIconButton label="Следующий день" icon={<ChevronRight size={22} color={colors.textPrimary} />} onPress={() => setLocalDate(shiftDate(localDate, 1))} />
    </View>
  );

  if (data === null) {
    return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{header}
      {failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить дневник питания.</InlineNotice></View> : <LoadingState label="Загружаем день…" />}</View>;
  }
  const verdicts = assessDay(data.summary, data.target);
  const recorded = data.summary.state === "FOOD_RECORDED";
  const targetNote = data.target.source === "NONE" ? "Цель не установлена" : data.target.source === "EXCEPTION" ? "Особая цель на дату" : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {header}
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {localDate !== today ? <AppButton compact variant="secondary" label="Вернуться к сегодняшнему дню" onPress={() => setLocalDate(today)} /> : null}
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.totals}>
            {TARGET_METRICS.map((metric: TargetMetric) => {
              const value = recorded ? data.summary.totals[NUTRIENT_OF[metric]] : null;
              const range = data.target.source === "NONE" ? null : rangeText(data.target.corridors[metric]);
              const verdict = verdicts[metric];
              return (
                <View key={metric} accessible style={styles.tile}
                  accessibilityLabel={`${metricLabels[metric]}: ${value === null ? "нет данных" : wholeText(value)}${range === null ? "" : `, цель ${range}`}${verdictLabels[verdict] === "" ? "" : `, ${verdictLabels[verdict]}`}`}>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>{metricLabels[metric]}</Text>
                  <Text style={[styles.tileValue, { color: colors.textPrimary }]}>{wholeText(value)}</Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]}>{range === null ? " " : `цель ${range}`}</Text>
                  {verdict === "UNKNOWN" ? null : <StatusTag kind={verdictKinds[verdict]} label={verdictLabels[verdict]} />}
                </View>
              );
            })}
          </View>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {[recorded ? "По внесённым записям: данные могут быть неполными" : "Записей о еде нет", targetNote].filter((part) => part !== null).join(" · ")}</Text>
        </View>

        {MEAL_SLOTS.map((slot) => {
          const slotEntries = data.entries.filter((entry) => entry.slot === slot);
          const total = slotEntries.length === 0 ? null : sumNutrients(slotEntries.map((entry) => entry.snapshot.eaten));
          return (
            <View key={slot} style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.slotHead}>
                <Text style={[styles.slotTitle, { color: colors.textPrimary }]}>{slotLabels[slot]}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{total === null ? "" : kcalText(total)}</Text>
              </View>
              {slotEntries.map((entry) => <EntryRow key={entry.id} entry={entry} onOpen={() => setEditing(entry)} />)}
              <AppButton compact variant="secondary" icon={(color) => <Plus size={16} color={color} />} label="Добавить" onPress={() => onAdd(localDate, slot)}
                accessibilityLabel={`Добавить в приём пищи: ${slotLabels[slot]}`} />
            </View>
          );
        })}

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.slotHead}>
            <Droplets size={18} color={colors.accentInk} />
            <Text style={[styles.slotTitle, { color: colors.textPrimary }]}>Вода</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{data.waterMl === null ? "не записана" : `${wholeText(data.waterMl * 10)} мл`}</Text>
          </View>
          <View style={styles.waterRow}>
            <View style={styles.grow}><AppButton compact variant="secondary" label={`+${WATER_STEP_ML} мл`} onPress={() => changeWater(WATER_STEP_ML)} /></View>
            <View style={styles.grow}><AppButton compact variant="ghost" label={`−${WATER_STEP_ML} мл`} disabled={data.waterMl === null} onPress={() => changeWater(-WATER_STEP_ML)} /></View>
          </View>
          <Text style={[styles.meta, { color: colors.textMuted }]}>Вода не считается едой и не влияет на оценку дня.</Text>
        </View>

        {!recorded && data.waterMl === null ? <EmptyState reason="no-data" title="В этот день записей нет"
          body="Добавьте продукт или рецепт в приём пищи — итоги и оценка по цели появятся сразу." /> : null}
      </ScrollView>
      <EntryDialog entry={editing} onClose={() => setEditing(null)}
        onSave={(entry, quantityX10) => guard(() => diary.updateQuantity(clientId, entry.id, entry.revision, quantityX10))}
        onRemove={(entry) => guard(() => diary.removeEntry(clientId, entry.id, entry.revision))} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  dateBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 4 },
  dateTitle: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center" },
  dateText: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  list: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8, gap: 10 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 8 },
  totals: { flexDirection: "row", gap: 6 },
  tile: { flex: 1, alignItems: "center", gap: 2 },
  tileValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  slotHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  slotTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  entry: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, minHeight: 48, justifyContent: "center", gap: 2 },
  entryName: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  waterRow: { flexDirection: "row", gap: 8 },
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10 },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
});
