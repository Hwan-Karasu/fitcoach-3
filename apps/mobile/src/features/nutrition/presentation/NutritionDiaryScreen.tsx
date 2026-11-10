import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight, ClipboardPaste, Copy, Droplets, Plus } from "lucide-react-native";
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
import { TARGET_METRICS } from "../domain/TargetModel.ts";
import { NUTRIENT_OF } from "../domain/TargetRules.ts";
import { EntryEditorDialog } from "./EntryEditorDialog.tsx";
import { MacroCells, MacroColumnHeads } from "./MacroGrid.tsx";
import { DayTotalsCard } from "./DayTotalsCard.tsx";
import { dayTitle, kcalText, nutritionErrorText, quantityText, slotLabels, wholeText } from "./nutritionFormat.ts";
import { useNutritionGuide } from "./useNutritionGuide.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import type { CatalogFilter } from "./AddFoodScreen.tsx";
import { useClientDay } from "./ClientDay.tsx";
import { useNutritionDay } from "./useNutritionDay.ts";
import { SavedMealEditorDialog } from "./SavedMealEditorDialog.tsx";
import { savedSnapshot } from "../domain/SavedMeal.ts";
import type { FoodSnapshot } from "../domain/FoodSnapshot.ts";

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
export function NutritionDiaryScreen({ clientId, diary, targets, body, calc, measurements, onAdd, onEditSource }: Readonly<{
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
  const { day: localDate, today } = useClientDay();
  const { data, stale, failed, reload } = useNutritionDay(clientId, localDate, diary, targets);
  const { guide, defaults, leanMassKg } = useNutritionGuide(clientId, body, calc, measurements);
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
  const latestWater = useRef<number | null>(null);
  latestWater.current = data?.waterMl ?? 0;
  // Данные дня догнали записанную воду: кэш запросов больше не нужен, внешние изменения воды снова читаются из данных.
  useEffect(() => {
    for (const [key, request] of waterRequests.current) if (request.pending === 0 && request.value === (data?.waterMl ?? 0)) waterRequests.current.delete(key);
  }, [data?.waterMl]);
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
      // Запись удалена или нет — кэш не живёт вечно: при ошибке сразу, при успехе — когда экран уже показывает записанное значение (см. эффект ниже).
      if (pending.pending === 0 && (message !== null || latestWater.current === pending.value)) waterRequests.current.delete(key);
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

  if (data === null) {
    return <ScrollView style={[styles.screen, { backgroundColor: colors.canvas }]} contentContainerStyle={styles.list}>
      {failed ? <View><InlineNotice kind="error">Не удалось загрузить дневник питания.</InlineNotice><AppButton label="Повторить загрузку" onPress={reload} /></View> : <LoadingState label="Загружаем день…" />}</ScrollView>;
  }
  const recorded = data.summary.state === "FOOD_RECORDED";
  const orientation = dayOrientation(data.target, data.versions, data.summary.localDate, guide, defaults, leanMassKg);
  const totalRows = TARGET_METRICS.map((metric) => ({ metric, eaten: !recorded ? 0 : Math.round((data.summary.totals[NUTRIENT_OF[metric]] ?? 0) / 10), target: orientation[metric] }));

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {slow ? <View accessible accessibilityLabel="Загружаем день" style={[styles.slowBar, { backgroundColor: colors.accentFill }]} /> : null}
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" pointerEvents={stale ? "none" : "auto"}>
        <DayTotalsCard rows={totalRows} copying={copying} onCopyPrevious={() => { void copyPreviousDay(); }} />
        <View style={styles.legend}><MacroColumnHeads /></View>
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        {failed ? <InlineNotice kind="error">Не удалось обновить дневник. Показаны последние загруженные данные.</InlineNotice> : null}
        {notice !== null ? <InlineNotice kind="info">{notice}</InlineNotice> : null}

        {MEAL_SLOTS.map((slot) => {
          const slotEntries = data.entries.filter((entry) => entry.slot === slot);
          const total = slotEntries.length === 0 ? null : sumNutrients(slotEntries.map((entry) => entry.snapshot.eaten));
          const open = expanded[slot] ?? slotEntries.length > 0;
          return (
            <View key={slot} style={[styles.card, !open && styles.cardCollapsed, { backgroundColor: colors.surface }]}>
              <View style={styles.slotHeadRow}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${slotLabels[slot]}${total === null ? "" : `, ${kcalText(total)}`}. ${open ? "Свернуть" : "Раскрыть"}`}
                  style={[styles.slotHead, styles.grow]} onPress={() => setExpanded({ ...expanded, [slot]: !open })}>
                  {open ? <ChevronDown size={18} color={colors.textPrimary} /> : <ChevronRight size={18} color={colors.textSecondary} />}
                  <Text style={[styles.slotTitle, { color: open ? colors.textPrimary : colors.textSecondary }]}>{slotLabels[slot]}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Добавить в приём пищи: ${slotLabels[slot]}`} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} onPress={() => onAdd(localDate, slot)}
                  style={[styles.plus, { backgroundColor: colors.accentFill }]}>
                  <Plus size={18} color={colors.onAccentFill} />
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
            <Text style={[styles.waterTotal, { color: colors.textPrimary }]}>{data.waterMl === null ? "не записана" : `${wholeText(data.waterMl * 10)} мл`}</Text>
          </View>
          <View style={styles.waterRow}>
            {WATER_QUICK_ML.map((ml) => (
              <Pressable key={ml} accessibilityRole="button" accessibilityLabel={`Добавить воды: ${ml} мл`} hitSlop={{ top: 5, bottom: 5 }} onPress={() => changeWater(ml)}
                style={({ pressed }) => [styles.waterButton, shadow.chip, { backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 }]}>
                <Text style={[styles.waterButtonText, { color: colors.textPrimary }]}>{`+${ml}`}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.waterFoot}>
            <Text style={[styles.waterHint, { color: colors.textSecondary }]}>Вода не считается едой и не влияет на оценку дня.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Убрать ${WATER_STEP_ML} мл воды`} accessibilityState={{ disabled: data.waterMl === null }} disabled={data.waterMl === null}
              hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} onPress={() => changeWater(-WATER_STEP_ML)}>
              <Text style={[styles.waterMinus, { color: colors.textSecondary, opacity: data.waterMl === null ? 0.5 : 1 }]}>{`−${WATER_STEP_ML} мл`}</Text>
            </Pressable>
          </View>
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
          // Правка и копии в другие приёмы — одна транзакция порта. Устаревшая запись: окно закрывается, иначе повтор с прежней revision невозможен.
          let stale = false;
          const message = await guard(async () => {
            try { await diary.editEntry(clientId, entry.id, entry.revision, { quantityX10, slot, override, copyToSlots: extraSlots }); }
            catch (failure) { stale = failure instanceof Error && failure.message === "DIARY_STALE"; throw failure; }
          });
          if (stale) setEditing(null);
          return message;
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
  list: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 10, gap: 8 },
  card: { ...shadow.card, borderRadius: 26, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent", gap: 8 },
  cardCollapsed: { paddingVertical: 8 },
  /** Подписи колонок «ккал Б Ж У» один раз над карточками приёмов; правый отступ равен отступу карточки. */
  legend: { alignItems: "flex-end", paddingRight: 12 },
  slotHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  slotTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  entry: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingBottom: 0, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 },
  entryText: { flex: 1, gap: 2 },
  slotHeadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  plus: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  chipStrip: { flexDirection: "row", gap: 6, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  chip: { flex: 1, minWidth: 0, minHeight: 34, borderRadius: 17, borderWidth: 1, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  chipText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  entryName: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  waterRow: { flexDirection: "row", gap: 6 },
  waterButton: { flex: 1, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  waterButtonText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  waterTotal: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  waterFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  waterHint: { flex: 1, fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  waterMinus: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15 },
});
