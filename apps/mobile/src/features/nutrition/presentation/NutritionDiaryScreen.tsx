import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight, ClipboardPaste, Copy, Droplets, Plus, Repeat2 } from "lucide-react-native";
import { AppButton, ConfirmDialog, EmptyState, InlineNotice, LoadingState, StatusTag, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { MEAL_SLOTS, type CopyEntriesRequest, type DiaryEntry, type MealSlot } from "../domain/DiaryModel.ts";
import { sumNutrients } from "../domain/DiaryRules.ts";
import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type TargetMetric } from "../domain/TargetModel.ts";
import { assessDay, NUTRIENT_OF } from "../domain/TargetRules.ts";
import { dayTitle, kcalText, metricLabels, nutritionErrorText, quantityText, rangeText, slotLabels, todayLocal, unitLabels, verdictKinds, verdictLabels,
  wholeText } from "./nutritionFormat.ts";
import type { CatalogFilter } from "./AddFoodScreen.tsx";
import { DiaryWeekHeader } from "./DiaryWeekHeader.tsx";
import { useNutritionDay } from "./useNutritionDay.ts";

const WATER_STEP_ML = 250;
const WATER_QUICK_ML = [250, 500, 750, 1000] as const;

interface PendingCopy { readonly request: CopyEntriesRequest; readonly text: string }

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
  onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [localDate, setLocalDate] = useState(today);
  const { data, failed } = useNutritionDay(clientId, localDate, diary, targets);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Readonly<{ date: string; slot: MealSlot }> | null>(null);
  const [pending, setPending] = useState<PendingCopy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  /** Ручное сворачивание приёмов; без выбора приём раскрыт, если в нём есть записи. */
  const [expanded, setExpanded] = useState<Readonly<Partial<Record<MealSlot, boolean>>>>({});

  const guard = useCallback(async (work: () => Promise<unknown>): Promise<string | null> => {
    try { await work(); setError(null); return null; } catch (failure) { const message = nutritionErrorText(failure); setError(message); return message; }
  }, []);
  const changeWater = (delta: number) => {
    const next = Math.max(0, (data?.waterMl ?? 0) + delta);
    void guard(() => next === 0 ? diary.clearWater(clientId, localDate) : diary.setWater(clientId, localDate, next));
  };

  const runCopy = async (request: CopyEntriesRequest) => {
    if (copying) return;
    setCopying(true); setPending(null);
    const message = await guard(async () => {
      const result = await diary.copyEntries(clientId, request);
      setNotice(result.copied === 0 ? "Ничего не скопировано: нет подходящих записей или приёмы уже заполнены." : `Скопировано записей: ${result.copied}.`);
    });
    if (message !== null) setNotice(null);
    setCopying(false);
  };
  /** Копирование проверяет конфликт: непустой приём/день не затирается, только дополняется после подтверждения (§49.5.6). */
  const askCopy = (request: CopyEntriesRequest, filledTargets: boolean, text: string) => {
    if (filledTargets) setPending({ request, text }); else void runCopy(request);
  };
  const copyPreviousDay = async () => {
    const from = await diary.previousFoodDate(clientId, localDate, null);
    if (from === null) { setNotice("Раньше этого дня записей о еде нет."); return; }
    const request: CopyEntriesRequest = { fromDate: from, toDate: localDate, slot: null, targetSlot: null, mode: "SKIP_FILLED" };
    askCopy(request, data !== null && data.entries.length > 0,
      `В этом дне уже есть записи. Скопировать день ${dayTitle(from, today)} только в пустые приёмы пищи? Существующие записи не изменятся.`);
  };
  const repeatSlot = async (slot: MealSlot) => {
    const from = await diary.previousFoodDate(clientId, localDate, slot);
    if (from === null) { setNotice(`Прежних записей в приёме «${slotLabels[slot]}» нет.`); return; }
    askCopy({ fromDate: from, toDate: localDate, slot, targetSlot: null, mode: "APPEND" }, data !== null && data.entries.some((entry) => entry.slot === slot),
      `В приёме «${slotLabels[slot]}» уже есть записи. Добавить к ним приём из дня ${dayTitle(from, today)}?`);
  };
  const pasteSlot = (slot: MealSlot) => {
    if (copied === null) return;
    askCopy({ fromDate: copied.date, toDate: localDate, slot: copied.slot, targetSlot: slot, mode: "APPEND" }, data !== null && data.entries.some((entry) => entry.slot === slot),
      `В приёме «${slotLabels[slot]}» уже есть записи. Добавить к ним скопированный приём «${slotLabels[copied.slot]}»?`);
  };

  const header = (
    <View style={styles.dateBar}>
      <DiaryWeekHeader clientId={clientId} diary={diary} localDate={localDate} today={today} onSelect={setLocalDate} />
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
        <View style={styles.waterRow}>
          <View style={styles.grow}><AppButton compact variant="secondary" label="Сегодня" disabled={localDate === today} onPress={() => setLocalDate(today)} /></View>
          <View style={styles.grow}><AppButton compact variant="secondary" icon={(color) => <Repeat2 size={16} color={color} />} label="С прошлого дня" busy={copying} onPress={() => { void copyPreviousDay(); }} /></View>
        </View>
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        {notice !== null ? <InlineNotice kind="info">{notice}</InlineNotice> : null}

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
          const open = expanded[slot] ?? slotEntries.length > 0;
          return (
            <View key={slot} style={[styles.card, { backgroundColor: colors.surface }]}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${slotLabels[slot]}${total === null ? "" : `, ${kcalText(total)}`}. ${open ? "Свернуть" : "Раскрыть"}`}
                style={styles.slotHead} onPress={() => setExpanded({ ...expanded, [slot]: !open })}>
                {open ? <ChevronDown size={18} color={colors.textSecondary} /> : <ChevronRight size={18} color={colors.textSecondary} />}
                <Text style={[styles.slotTitle, { color: colors.textPrimary }]}>{slotLabels[slot]}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{total === null ? "" : kcalText(total)}</Text>
              </Pressable>
              {open ? <>
              {slotEntries.map((entry) => <EntryRow key={entry.id} entry={entry} onOpen={() => setEditing(entry)} />)}
              <AppButton compact variant="secondary" icon={(color) => <Plus size={16} color={color} />} label="Добавить" onPress={() => onAdd(localDate, slot)}
                accessibilityLabel={`Добавить в приём пищи: ${slotLabels[slot]}`} />
              <View style={styles.waterRow}>
                <View style={styles.grow}><AppButton compact variant="ghost" label="Из избранного" accessibilityLabel={`Добавить из избранного в: ${slotLabels[slot]}`} onPress={() => onAdd(localDate, slot, "FAVORITES")} /></View>
                <View style={styles.grow}><AppButton compact variant="ghost" label="Из недавних" accessibilityLabel={`Добавить из недавних в: ${slotLabels[slot]}`} onPress={() => onAdd(localDate, slot, "RECENT")} /></View>
              </View>
              <View style={styles.waterRow}>
                <View style={styles.grow}><AppButton compact variant="ghost" icon={(color) => <Repeat2 size={16} color={color} />} label="Повторить" disabled={copying}
                  accessibilityLabel={`Повторить приём пищи: ${slotLabels[slot]}`} onPress={() => { void repeatSlot(slot); }} /></View>
                {slotEntries.length > 0 ? <View style={styles.grow}><AppButton compact variant="ghost" icon={(color) => <Copy size={16} color={color} />} label="Копировать"
                  accessibilityLabel={`Копировать приём пищи: ${slotLabels[slot]}`} onPress={() => { setCopied({ date: localDate, slot }); setNotice(`Скопирован приём «${slotLabels[slot]}». Откройте нужный приём и нажмите «Вставить».`); }} /></View> : null}
                {copied !== null && !(copied.date === localDate && copied.slot === slot) ? <View style={styles.grow}><AppButton compact variant="ghost" icon={(color) => <ClipboardPaste size={16} color={color} />}
                  label="Вставить" disabled={copying} accessibilityLabel={`Вставить скопированный приём в: ${slotLabels[slot]}`} onPress={() => pasteSlot(slot)} /></View> : null}
              </View>
              </> : null}
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
            {WATER_QUICK_ML.map((ml) => <View key={ml} style={styles.grow}><AppButton compact variant="secondary" label={`+${ml}`} accessibilityLabel={`Добавить воды: ${ml} мл`} onPress={() => changeWater(ml)} /></View>)}
          </View>
          <AppButton compact variant="ghost" label={`−${WATER_STEP_ML} мл`} disabled={data.waterMl === null} onPress={() => changeWater(-WATER_STEP_ML)} />
          <Text style={[styles.meta, { color: colors.textMuted }]}>Вода не считается едой и не влияет на оценку дня.</Text>
        </View>

        {!recorded && data.waterMl === null ? <EmptyState reason="no-data" title="В этот день записей нет"
          body="Добавьте продукт или рецепт в приём пищи — итоги и оценка по цели появятся сразу." /> : null}
      </ScrollView>
      <ConfirmDialog visible={pending !== null} title="Копировать приём?" description={pending?.text ?? ""} confirmLabel="Скопировать" onCancel={() => setPending(null)}
        onConfirm={() => { if (pending !== null) void runCopy(pending.request); }} />
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
  dateBar: { paddingHorizontal: 16, paddingTop: 4 },
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
