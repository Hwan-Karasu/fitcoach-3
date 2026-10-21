import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight, ClipboardPaste, Copy, Droplets, Plus, Repeat2 } from "lucide-react-native";
import { AppButton, ConfirmDialog, EmptyState, InlineNotice, LoadingState } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { MEAL_SLOTS, type CopyEntriesRequest, type DiaryEntry, type MealSlot } from "../domain/DiaryModel.ts";
import { entryNutrients, sumNutrients } from "../domain/DiaryRules.ts";
import { dayOrientation } from "../domain/HomeMacroTargets.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type TargetMetric } from "../domain/TargetModel.ts";
import { NUTRIENT_OF } from "../domain/TargetRules.ts";
import { EntryEditorDialog } from "./EntryEditorDialog.tsx";
import { MacroCells, useMacroColors } from "./MacroGrid.tsx";
import { dayTitle, kcalText, metricLabels, nutritionErrorText, quantityText, slotLabels, todayLocal, wholeText } from "./nutritionFormat.ts";
import { useNutritionGuide } from "./useNutritionGuide.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import type { CatalogFilter } from "./AddFoodScreen.tsx";
import { DiaryWeekHeader } from "./DiaryWeekHeader.tsx";
import { useNutritionDay } from "./useNutritionDay.ts";
import { SavedMealEditorDialog } from "./SavedMealEditorDialog.tsx";
import { savedSnapshot } from "../domain/SavedMeal.ts";
import type { FoodSnapshot } from "../domain/FoodSnapshot.ts";

const metricLetters: Readonly<Record<TargetMetric, string>> = { kcal: "К", protein: "Б", fat: "Ж", carbs: "У" };
const WATER_STEP_ML = 250;
const WATER_QUICK_ML = [250, 500, 750, 1000] as const;

interface PendingCopy { readonly request: CopyEntriesRequest; readonly text: string }

const EntryRow = memo(function EntryRow({ entry, onOpen }: Readonly<{ entry: DiaryEntry; onOpen: (entry: DiaryEntry) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { snapshot } = entry;
  const detail = [quantityText(snapshot.basis, snapshot.quantityX10), snapshot.source.kind === "RECIPE" ? "рецепт" : null].filter((part) => part !== null).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${snapshot.name}, ${detail}, ${kcalText(entryNutrients(snapshot.eaten))}. Изменить`} onPress={() => onOpen(entry)}
      style={({ pressed }) => [styles.entry, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
      <View style={styles.entryText}>
        <Text numberOfLines={2} style={[styles.entryName, { color: colors.textPrimary }]}>{snapshot.name}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{detail}</Text>
      </View>
      <MacroCells values={entryNutrients(snapshot.eaten)} />
    </Pressable>
  );
}, (before, after) => before.entry.id === after.entry.id && before.entry.revision === after.entry.revision && before.entry.slot === after.entry.slot && before.onOpen === after.onOpen);

/** Малая кнопка-чип полосы быстрых действий: видимая высота 32, область касания не меньше 48 за счёт hitSlop (NUT-FS-19). */
function QuickChip({ label, icon, onPress, disabled = false, accessibilityLabel }: Readonly<{ label: string; icon?: React.ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel: string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.accentSoft : colors.surfaceRaised, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}>
      {icon}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.chipText, { color: colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * «Дневник» питания клиента (§49.2): день, итоги и коридоры цели, приёмы пищи, вода. Итог — сумма внесённых записей; пустой день и день только с водой
 * не оцениваются (§49.22). Экран пишет через порты дневника и читает цель на дату (исключение → версия → «не установлена»).
 */
export function NutritionDiaryScreen({ clientId, diary, targets, body, calc, measurements, onAdd, onEditSource, requestedDay }: Readonly<{
  requestedDay?: Readonly<{ date: string; token: number }>;
  clientId: string;
  diary: NutritionDiaryPort;
  targets: NutritionTargetsPort;
  body: CalcClientBody;
  calc: NutritionCalcPort;
  measurements: MeasurementRepositoryPort;
  onAdd: (localDate: string, slot: MealSlot, filter?: CatalogFilter) => void;
  /** Открыть продукт или рецепт записи в каталоге (карандаш окна записи). */
  onEditSource?: (source: Readonly<{ kind: "FOOD" | "RECIPE"; id: string }>) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [localDate, setLocalDate] = useState(today);
  useEffect(() => { if (requestedDay !== undefined) setLocalDate(requestedDay.date); }, [requestedDay]);
  const { data, stale, failed, reload } = useNutritionDay(clientId, localDate, diary, targets);
  const { guide, defaults, leanMassKg } = useNutritionGuide(clientId, body, calc, measurements);
  const macroColors = useMacroColors();
  const [slow, setSlow] = useState(false);
  // Индикатор только если новый день читается дольше ~200 мс; экран при этом не затемняется.
  useEffect(() => {
    if (!stale) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 200);
    return () => clearTimeout(timer);
  }, [stale]);
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
  const recorded = data.summary.state === "FOOD_RECORDED";
  const orientation = dayOrientation(data.target, data.versions, data.summary.localDate, guide, defaults, leanMassKg);
  const eatenText = (metric: TargetMetric) => !recorded ? "0" : wholeText(data.summary.totals[NUTRIENT_OF[metric]]);
  const orientText = (metric: TargetMetric) => orientation[metric] === null ? "—" : String(orientation[metric]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {header}
      <View style={[styles.totalsBar, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessible accessibilityLabel={`Итоги дня, съедено из ориентира: ${TARGET_METRICS.map((metric) => `${metricLabels[metric]} ${eatenText(metric)} из ${orientText(metric)}`).join(", ")}`}>
        <Text style={[styles.totalsTitle, { color: colors.textPrimary }]}>Итого</Text>
        {TARGET_METRICS.map((metric) => (
          <View key={metric} style={styles.totalsCell}>
            <Text style={[styles.totalsLetter, { color: macroColors[metric] }]}>{metricLetters[metric]}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.totalsValue, { color: macroColors[metric] }]}>{`${eatenText(metric)}/${orientText(metric)}`}</Text>
          </View>
        ))}
      </View>
      {slow ? <View accessible accessibilityLabel="Загружаем день" style={[styles.slowBar, { backgroundColor: colors.accentFill }]} /> : null}
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" pointerEvents={stale ? "none" : "auto"}>
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
                {slotEntries.map((entry) => <EntryRow key={entry.id} entry={entry} onOpen={setEditing} />)}
                <View style={[styles.chipStrip, { borderColor: colors.border }]}>
                  <QuickChip label="Сохранить еду" accessibilityLabel={`Сохранить набор: ${slotLabels[slot]}`} disabled={slotEntries.length === 0} onPress={() => setSavingMeal(slotEntries.map(savedSnapshot))} />
                  <QuickChip label="Копировать" icon={<Copy size={14} color={colors.textPrimary} />} disabled={slotEntries.length === 0} accessibilityLabel={`Копировать приём пищи: ${slotLabels[slot]}`}
                    onPress={() => { setCopied({ date: localDate, slot }); setNotice(`Скопирован приём «${slotLabels[slot]}». Откройте нужный приём и нажмите «Вставить».`); }} />
                  <QuickChip label="Вставить" icon={<ClipboardPaste size={14} color={colors.textPrimary} />} disabled={copying || copied === null || (copied.date === localDate && copied.slot === slot)}
                    accessibilityLabel={`Вставить скопированный приём в: ${slotLabels[slot]}`} onPress={() => pasteSlot(slot)} />
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
      {savingMeal !== null ? <SavedMealEditorDialog snapshots={savingMeal} onClose={() => setSavingMeal(null)} onSave={async (input) => { await diary.createSavedMeal(clientId, input); setNotice("Набор сохранён для этого клиента."); }} /> : null}
      <EntryEditorDialog entry={editing} onClose={() => setEditing(null)}
        onEditSource={onEditSource === undefined ? undefined : (entry) => { setEditing(null); onEditSource(entry.snapshot.source); }}
        onSave={async (entry, quantityX10, slot, override, extraSlots) => {
          return guard(async () => {
            const edited = await diary.editEntry(clientId, entry.id, entry.revision, { quantityX10, slot, override });
            if (extraSlots.length === 0) return;
            // Копии в другие приёмы того же дня: те же количество и значения (правка пищевой ценности переносится).
            const copies = await diary.addEntries(clientId, extraSlots.map((extra) => ({ localDate: edited.localDate, slot: extra, snapshot: edited.snapshot })));
            if (edited.override != null) for (const copy of copies) await diary.setOverride(clientId, copy.id, copy.revision, edited.snapshot.eaten);
          });
        }}
        onRemove={(entry) => guard(() => diary.removeEntry(clientId, entry.id, entry.revision))} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  slowBar: { height: 2, marginHorizontal: 16, borderRadius: 1 },
  pad: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  dateBar: { paddingHorizontal: 16, paddingTop: 2 },
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
  totalsBar: { marginHorizontal: 16, marginTop: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 6 },
  totalsTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18 },
  totalsCell: { flex: 1, minWidth: 0, alignItems: "center" },
  totalsLetter: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 15 },
  totalsValue: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, fontVariant: ["tabular-nums"] },
  gridRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  slotHeadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  plus: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  chipStrip: { flexDirection: "row", gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  chip: { flex: 1, minWidth: 0, minHeight: 32, borderRadius: 16, borderWidth: 1, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  entryName: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  waterRow: { flexDirection: "row", gap: 8 },
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 18, gap: 10 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
});
