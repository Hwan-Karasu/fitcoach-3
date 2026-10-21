import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight, ClipboardPaste, Copy, Droplets, Plus, Repeat2 } from "lucide-react-native";
import { AppButton, ConfirmDialog, EmptyState, InlineNotice, LoadingState } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { MEAL_SLOTS, type CopyEntriesRequest, type DiaryEntry, type MealSlot } from "../domain/DiaryModel.ts";
import { sumNutrients } from "../domain/DiaryRules.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type TargetMetric } from "../domain/TargetModel.ts";
import { assessDay, NUTRIENT_OF } from "../domain/TargetRules.ts";
import { EntryEditorDialog } from "./EntryEditorDialog.tsx";
import { MacroCells, MacroHeader } from "./MacroGrid.tsx";
import { dayTitle, kcalText, metricLabels, nutritionErrorText, quantityText, rangeText, slotLabels, todayLocal, verdictLabels,
  wholeText } from "./nutritionFormat.ts";
import type { CatalogFilter } from "./AddFoodScreen.tsx";
import { DiaryWeekHeader } from "./DiaryWeekHeader.tsx";
import { useNutritionDay } from "./useNutritionDay.ts";
import { SavedMealEditorDialog } from "./SavedMealEditorDialog.tsx";
import { savedSnapshot } from "../domain/SavedMeal.ts";
import type { FoodSnapshot } from "../domain/FoodSnapshot.ts";

const WATER_STEP_ML = 250;
const WATER_QUICK_ML = [250, 500, 750, 1000] as const;

interface PendingCopy { readonly request: CopyEntriesRequest; readonly text: string }

function EntryRow({ entry, onOpen }: Readonly<{ entry: DiaryEntry; onOpen: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { snapshot } = entry;
  const detail = [quantityText(snapshot.basis, snapshot.quantityX10), snapshot.source.kind === "RECIPE" ? "рецепт" : null].filter((part) => part !== null).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${snapshot.name}, ${detail}, ${kcalText(snapshot.eaten)}. Изменить`} onPress={onOpen}
      style={({ pressed }) => [styles.entry, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
      <View style={styles.entryText}>
        <Text numberOfLines={2} style={[styles.entryName, { color: colors.textPrimary }]}>{snapshot.name}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{detail}</Text>
      </View>
      <MacroCells values={snapshot.eaten} />
    </Pressable>
  );
}

/** Малая кнопка-чип полосы быстрых действий: видимая высота 32, область касания не меньше 48 за счёт hitSlop (NUT-FS-19). */
function QuickChip({ label, icon, onPress, disabled = false, accessibilityLabel }: Readonly<{ label: string; icon?: React.ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel: string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.accentSoft : colors.surfaceRaised, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}>
      {icon}
      <Text style={[styles.chipText, { color: colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * «Дневник» питания клиента (§49.2): день, итоги и коридоры цели, приёмы пищи, вода. Итог — сумма внесённых записей; пустой день и день только с водой
 * не оцениваются (§49.22). Экран пишет через порты дневника и читает цель на дату (исключение → версия → «не установлена»).
 */
export function NutritionDiaryScreen({ clientId, diary, targets, onAdd, requestedDay }: Readonly<{
  requestedDay?: Readonly<{ date: string; token: number }>;
  clientId: string;
  diary: NutritionDiaryPort;
  targets: NutritionTargetsPort;
  onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [localDate, setLocalDate] = useState(today);
  useEffect(() => { if (requestedDay !== undefined) setLocalDate(requestedDay.date); }, [requestedDay]);
  const { data, failed, reload } = useNutritionDay(clientId, localDate, diary, targets);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Readonly<{ date: string; slot: MealSlot }> | null>(null);
  const [pending, setPending] = useState<PendingCopy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const copyLock = useRef(false);
  const waterRequests = useRef(new Map<string, { pending: number; value: number }>());
  const [savingMeal, setSavingMeal] = useState<readonly FoodSnapshot[] | null>(null);
  /** Ручное сворачивание приёмов; без выбора приём раскрыт, если в нём есть записи. */
  const [expanded, setExpanded] = useState<Readonly<Partial<Record<MealSlot, boolean>>>>({});

  const guard = useCallback(async (work: () => Promise<unknown>): Promise<string | null> => {
    try { await work(); setError(null); return null; } catch (failure) { const message = nutritionErrorText(failure); setError(message); return message; }
  }, []);
  const changeWater = (delta: number) => {
    const key = `${clientId}|${localDate}`;
    let request = waterRequests.current.get(key);
    if (request === undefined) { request = { pending: 0, value: data?.waterMl ?? 0 }; waterRequests.current.set(key, request); }
    const next = Math.max(0, request.value + delta);
    if (next > 20000) { setError("Вода — не более 20 000 мл за день."); return; }
    request.value = next; request.pending += 1;
    const pending = request;
    void guard(() => next === 0 ? diary.clearWater(clientId, localDate) : diary.setWater(clientId, localDate, next)).then((message) => {
      pending.pending -= 1;
      if (message !== null && pending.pending === 0) waterRequests.current.delete(key);
    });
  };

  const runCopy = async (request: CopyEntriesRequest) => {
    if (copyLock.current) return;
    copyLock.current = true;
    setCopying(true); setPending(null);
    const message = await guard(async () => {
      const result = await diary.copyEntries(clientId, request);
      setNotice(result.copied === 0 ? "Ничего не скопировано: нет подходящих записей или приёмы уже заполнены." : `Скопировано записей: ${result.copied}.`);
    });
    if (message !== null) setNotice(null);
    setCopying(false);
    copyLock.current = false;
  };
  /** Копирование проверяет конфликт: непустой приём/день не затирается, только дополняется после подтверждения (§49.5.6). */
  const askCopy = (request: CopyEntriesRequest, filledTargets: boolean, text: string) => {
    if (filledTargets) setPending({ request, text }); else void runCopy(request);
  };
  const copyPreviousDay = async () => {
    try {
    const from = await diary.previousFoodDate(clientId, localDate, null);
    if (from === null) { setNotice("Раньше этого дня записей о еде нет."); return; }
    const request: CopyEntriesRequest = { fromDate: from, toDate: localDate, slot: null, targetSlot: null, mode: "SKIP_FILLED" };
    askCopy(request, data !== null && data.entries.length > 0,
      `В этом дне уже есть записи. Скопировать день ${dayTitle(from, today)} только в пустые приёмы пищи? Существующие записи не изменятся.`);
    } catch (failure) { setError(nutritionErrorText(failure)); }
  };
  const repeatSlot = async (slot: MealSlot) => {
    try {
    const from = await diary.previousFoodDate(clientId, localDate, slot);
    if (from === null) { setNotice(`Прежних записей в приёме «${slotLabels[slot]}» нет.`); return; }
    askCopy({ fromDate: from, toDate: localDate, slot, targetSlot: null, mode: "APPEND" }, data !== null && data.entries.some((entry) => entry.slot === slot),
      `В приёме «${slotLabels[slot]}» уже есть записи. Добавить к ним приём из дня ${dayTitle(from, today)}?`);
    } catch (failure) { setError(nutritionErrorText(failure)); }
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
      {failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить дневник питания.</InlineNotice><AppButton label="Повторить загрузку" onPress={reload} /></View> : <LoadingState label="Загружаем день…" />}</View>;
  }
  const verdicts = assessDay(data.summary, data.target);
  const recorded = data.summary.state === "FOOD_RECORDED";
  const corridors = data.target.source === "NONE" ? null : data.target.corridors;
  const targetNote = data.target.source === "NONE" ? "Цель не установлена" : data.target.source === "EXCEPTION" ? "Особая цель на дату" : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {header}
      <View style={[styles.totalsBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.gridRow}>
          <Text style={[styles.slotTitle, { color: colors.textPrimary }]}>{recorded ? "Итого за день" : "Итого: записей нет"}</Text>
          <MacroHeader />
        </View>
        <View style={styles.gridRow} accessible accessibilityLabel={`Итоги дня: ${TARGET_METRICS.map((metric: TargetMetric) => `${metricLabels[metric]} ${recorded ? wholeText(data.summary.totals[NUTRIENT_OF[metric]]) : "нет данных"}`).join(", ")}`}>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{recorded ? "по внесённым записям" : ""}</Text>
          <MacroCells values={recorded ? data.summary.totals : null} bold />
        </View>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {corridors === null ? "Цель не установлена" : [targetNote, ...TARGET_METRICS.flatMap((metric: TargetMetric) => {
            const range = rangeText(corridors[metric]);
            return range === null ? [] : [`${metricLabels[metric]} ${range}${verdictLabels[verdicts[metric]] === "" ? "" : ` (${verdictLabels[verdicts[metric]].toLocaleLowerCase("ru")})`}`];
          })].filter((part) => part !== null).join(" · ")}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <View style={styles.waterRow}>
          <View style={styles.grow}><AppButton compact variant="secondary" label="Сегодня" disabled={localDate === today} onPress={() => setLocalDate(today)} /></View>
          <View style={styles.grow}><AppButton compact variant="secondary" icon={(color) => <Repeat2 size={16} color={color} />} label="С прошлого дня" busy={copying} onPress={() => { void copyPreviousDay(); }} /></View>
        </View>
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        {failed ? <InlineNotice kind="error">Не удалось обновить дневник. Показаны последние загруженные данные.</InlineNotice> : null}
        {notice !== null ? <InlineNotice kind="info">{notice}</InlineNotice> : null}

        {MEAL_SLOTS.map((slot) => {
          const slotEntries = data.entries.filter((entry) => entry.slot === slot);
          const total = slotEntries.length === 0 ? null : sumNutrients(slotEntries.map((entry) => entry.snapshot.eaten));
          const open = expanded[slot] ?? slotEntries.length > 0;
          return (
            <View key={slot} style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.slotHeadRow}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${slotLabels[slot]}${total === null ? "" : `, ${kcalText(total)}`}. ${open ? "Свернуть" : "Раскрыть"}`}
                  style={[styles.slotHead, styles.grow]} onPress={() => setExpanded({ ...expanded, [slot]: !open })}>
                  {open ? <ChevronDown size={18} color={colors.textSecondary} /> : <ChevronRight size={18} color={colors.textSecondary} />}
                  <Text style={[styles.slotTitle, { color: colors.textPrimary }]}>{slotLabels[slot]}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Добавить в приём пищи: ${slotLabels[slot]}`} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} onPress={() => onAdd(localDate, slot)}
                  style={[styles.plus, { backgroundColor: colors.accentFill }]}>
                  <Plus size={16} color={colors.onAccentFill} />
                </Pressable>
                <MacroCells values={total} bold />
              </View>
              {open ? <>
                {slotEntries.map((entry) => <EntryRow key={entry.id} entry={entry} onOpen={() => setEditing(entry)} />)}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipStrip} keyboardShouldPersistTaps="handled">
                  <QuickChip label="Из избранного" accessibilityLabel={`Добавить из избранного в: ${slotLabels[slot]}`} onPress={() => onAdd(localDate, slot, "FAVORITES")} />
                  <QuickChip label="Из недавних" accessibilityLabel={`Добавить из недавних в: ${slotLabels[slot]}`} onPress={() => onAdd(localDate, slot, "RECENT")} />
                  <QuickChip label="Сохранённая еда" accessibilityLabel={`Добавить сохранённую еду в: ${slotLabels[slot]}`} onPress={() => onAdd(localDate, slot, "SAVED")} />
                  <QuickChip label="Сохранить еду" accessibilityLabel={`Сохранить набор: ${slotLabels[slot]}`} disabled={slotEntries.length === 0} onPress={() => setSavingMeal(slotEntries.map(savedSnapshot))} />
                  <QuickChip label="Повторить" icon={<Repeat2 size={14} color={colors.textPrimary} />} disabled={copying} accessibilityLabel={`Повторить приём пищи: ${slotLabels[slot]}`} onPress={() => { void repeatSlot(slot); }} />
                  <QuickChip label="Копировать" icon={<Copy size={14} color={colors.textPrimary} />} disabled={slotEntries.length === 0} accessibilityLabel={`Копировать приём пищи: ${slotLabels[slot]}`}
                    onPress={() => { setCopied({ date: localDate, slot }); setNotice(`Скопирован приём «${slotLabels[slot]}». Откройте нужный приём и нажмите «Вставить».`); }} />
                  <QuickChip label="Вставить" icon={<ClipboardPaste size={14} color={colors.textPrimary} />} disabled={copying || copied === null || (copied.date === localDate && copied.slot === slot)}
                    accessibilityLabel={`Вставить скопированный приём в: ${slotLabels[slot]}`} onPress={() => pasteSlot(slot)} />
                </ScrollView>
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
      {savingMeal !== null ? <SavedMealEditorDialog snapshots={savingMeal} onClose={() => setSavingMeal(null)} onSave={async (input) => { await diary.createSavedMeal(clientId, input); setNotice("Набор сохранён для этого клиента."); }} /> : null}
      <EntryEditorDialog entry={editing} onClose={() => setEditing(null)}
        onSave={async (entry, quantityX10, slot, override) => {
          return guard(() => diary.editEntry(clientId, entry.id, entry.revision, { quantityX10, slot, override }));
        }}
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
  card: { ...shadow.card, borderRadius: 20, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent", gap: 8 },
  totals: { flexDirection: "row", gap: 6 },
  tile: { flex: 1, alignItems: "center", gap: 2 },
  tileValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  slotHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  slotTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  entry: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 },
  entryText: { flex: 1, gap: 2 },
  totalsBar: { marginHorizontal: 16, marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  gridRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  slotHeadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  plus: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  chipStrip: { flexDirection: "row", gap: 8, paddingVertical: 4, paddingRight: 4 },
  chip: { minHeight: 32, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 4 },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  entryName: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  waterRow: { flexDirection: "row", gap: 8 },
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
});
