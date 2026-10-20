import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, EmptyState, InlineNotice, LoadingState, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { pickDate } from "../../../shared/ui/components/pickDate.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type TargetException, type TargetVersion } from "../domain/TargetModel.ts";
import { affectedPeriod, energyConsistency, versionFor } from "../domain/TargetRules.ts";
import { dayTitle, metricLabels, nutritionErrorText, rangeText, todayLocal } from "./nutritionFormat.ts";
import { corridorsOf, draftOf, EMPTY_DRAFT, isEmptyDraft, weekdayFull, weekdayShort, type CorridorDraft } from "./targetDraft.ts";

const unitOf = { kcal: "ккал", protein: "г", fat: "г", carbs: "г" } as const;

function CorridorFields({ draft, onChange }: Readonly<{ draft: CorridorDraft; onChange: (draft: CorridorDraft) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={styles.fields}>
      {TARGET_METRICS.map((metric) => (
        <View key={metric} style={styles.metricRow}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{`${metricLabels[metric]}, ${unitOf[metric]}`}</Text>
          <View style={styles.pair}>
            <View style={styles.grow}><TextField label={`${metricLabels[metric]}: от`} value={draft[metric].min} keyboardType="decimal-pad" placeholder="от"
              onChangeText={(min) => onChange({ ...draft, [metric]: { ...draft[metric], min } })} /></View>
            <View style={styles.grow}><TextField label={`${metricLabels[metric]}: до`} value={draft[metric].max} keyboardType="decimal-pad" placeholder="до"
              onChangeText={(max) => onChange({ ...draft, [metric]: { ...draft[metric], max } })} /></View>
          </View>
        </View>
      ))}
    </View>
  );
}

function corridorLine(corridors: Corridors): string {
  const parts = TARGET_METRICS.flatMap((metric) => { const text = rangeText(corridors[metric]); return text === null ? [] : [`${metricLabels[metric]} ${text}`]; });
  return parts.join(" · ");
}

type Mode = "view" | "version" | "exception";

/**
 * «Цели» питания клиента (§§49.8–49.12): коридоры ккал/Б/Ж/У по дням недели, версии с даты начала действия и особые цели на дату. Новая версия
 * применяется только после явного сохранения; прошлые версии не удаляются, факты питания не меняются. Несовместимые границы — предупреждение, не правка.
 */
export function NutritionTargetsScreen({ clientId, targets }: Readonly<{ clientId: string; targets: NutritionTargetsPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [versions, setVersions] = useState<readonly TargetVersion[] | null>(null);
  const [exceptions, setExceptions] = useState<readonly TargetException[]>([]);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<Mode>("view");
  const [date, setDate] = useState(today);
  const [days, setDays] = useState<readonly CorridorDraft[]>(Array(7).fill(EMPTY_DRAFT));
  const [weekday, setWeekday] = useState(0);
  const [single, setSingle] = useState<CorridorDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([targets.listVersions(clientId), targets.listExceptions(clientId)]).then(([nextVersions, nextExceptions]) => {
      if (active) { setVersions(nextVersions); setExceptions(nextExceptions); setFailed(false); }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, targets, tick]);
  useEffect(() => targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [clientId, targets]);

  const current = useMemo(() => versionFor(versions ?? [], today), [versions, today]);
  const startVersionEdit = useCallback(() => {
    setDays(Array.from({ length: 7 }, (_, index) => draftOf(current?.days[index] ?? null)));
    setDate(today); setWeekday(0); setError(null); setMode("version");
  }, [current, today]);
  const startException = (localDate: string, corridors: Corridors | null) => { setDate(localDate); setSingle(draftOf(corridors)); setError(null); setMode("exception"); };

  const warning = useMemo(() => {
    const draft = mode === "version" ? days[weekday] : single;
    if (draft === undefined) return null;
    const parsed = corridorsOf(draft, metricLabels);
    return typeof parsed === "string" ? null : energyConsistency(parsed) === "INCOMPATIBLE"
      ? "Калорийный коридор не сходится с энергией из Б/Ж/У (4·Б + 9·Ж + 4·У). Проверьте значения — они не изменены." : null;
  }, [mode, days, weekday, single]);

  const fail = (failure: unknown) => setError(failure instanceof Error && failure.message === "TARGET_STALE" ? "Цели уже изменились. Данные обновлены, повторите." : nutritionErrorText(failure));
  const saveVersion = async () => {
    setConfirm(null); setBusy(true);
    const parsed = days.map((day) => isEmptyDraft(day) ? null : corridorsOf(day, metricLabels));
    const bad = parsed.findIndex((item) => typeof item === "string");
    if (bad >= 0) { setError(`${weekdayShort[bad]}: ${parsed[bad] as string}`); setBusy(false); return; }
    if (parsed.every((item) => item === null)) { setError("Задайте коридор хотя бы для одного дня недели."); setBusy(false); return; }
    try {
      const same = (versions ?? []).find((version) => version.effectiveFrom === date);
      await targets.saveVersion(clientId, { effectiveFrom: date, days: parsed as (Corridors | null)[] }, same?.revision ?? null);
      setMode("view"); setError(null);
    } catch (failure) { fail(failure); setTick((value) => value + 1); } finally { setBusy(false); }
  };
  const askSaveVersion = () => {
    const period = affectedPeriod(versions ?? [], date);
    const exists = (versions ?? []).some((version) => version.effectiveFrom === date);
    const notes = [date < today ? `Цели начнут действовать задним числом: ${dayTitle(period.from, today)}${period.to === null ? " и далее" : ` — ${dayTitle(period.to, today)}`}. Оценка уже внесённых дней может измениться; сами записи о еде — нет.` : null,
      exists ? "На эту дату уже есть версия целей — она будет заменена (прежние даты остаются)." : null].filter((part) => part !== null);
    if (notes.length === 0) { void saveVersion(); return; }
    setConfirm(notes.join(" "));
  };
  const saveException = async () => {
    const parsed = corridorsOf(single, metricLabels);
    if (typeof parsed === "string") { setError(parsed); return; }
    setBusy(true);
    try { await targets.setException(clientId, date, parsed); setMode("view"); setError(null); } catch (failure) { fail(failure); } finally { setBusy(false); }
  };

  if (versions === null) return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
    {failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить цели питания.</InlineNotice></View> : <LoadingState label="Загружаем цели…" />}</View>;

  if (mode !== "view") {
    const isVersion = mode === "version";
    return (
      <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        <AppButton variant="secondary" label={isVersion ? `Действуют с: ${dayTitle(date, today)}` : `Особая цель на: ${dayTitle(date, today)}`}
          onPress={() => { void pickDate({ value: date, title: isVersion ? "Дата начала действия" : "Дата особой цели" }).then((picked) => { if (picked !== null) setDate(picked); }); }} />
        {isVersion ? (
          <>
            <View style={styles.chips}>
              {weekdayShort.map((label, index) => <SelectionChip key={label} group="День недели" label={isEmptyDraft(days[index]!) ? `${label} ·` : label} selected={weekday === index} onPress={() => setWeekday(index)} />)}
            </View>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Редактируется: ${weekdayFull[weekday]}. «·» — для дня цели нет.`}</Text>
            <CorridorFields draft={days[weekday]!} onChange={(next) => setDays(days.map((day, index) => index === weekday ? next : day))} />
            <AppButton compact variant="secondary" label="Скопировать на все дни" onPress={() => setDays(days.map(() => days[weekday]!))} />
          </>
        ) : <CorridorFields draft={single} onChange={setSingle} />}
        {warning !== null ? <InlineNotice kind="warning">{warning}</InlineNotice> : null}
        <AppButton label={isVersion ? "Сохранить цели" : "Сохранить особую цель"} busy={busy} onPress={() => { if (isVersion) askSaveVersion(); else void saveException(); }} />
        <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => { setMode("view"); setError(null); }} />
        <ConfirmDialog visible={confirm !== null} title="Сохранить цели?" description={confirm ?? ""} confirmLabel="Сохранить" onCancel={() => setConfirm(null)} onConfirm={() => { void saveVersion(); }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {current === null ? <EmptyState reason="no-data" title="Цели не установлены" body="Задайте коридоры калорий и БЖУ: их можно менять по дням недели и с выбранной даты."
        action={{ label: "Задать цели", onPress: startVersionEdit }} /> : (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>{`Действуют с ${dayTitle(current.effectiveFrom, today)}`}</Text>
          {current.days.map((day, index) => (
            <View key={weekdayFull[index]} style={styles.dayRow}>
              <Text style={[styles.dayName, { color: colors.textSecondary }]}>{weekdayShort[index]}</Text>
              <Text style={[styles.dayText, { color: day === null ? colors.textMuted : colors.textPrimary }]}>{day === null ? "цели нет" : corridorLine(day)}</Text>
            </View>
          ))}
          <AppButton variant="secondary" label="Изменить цели" onPress={startVersionEdit} />
        </View>
      )}

      {(versions?.length ?? 0) > 1 ? <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>История целей</Text>
        {[...(versions ?? [])].reverse().map((version) => <Text key={version.id} style={[styles.meta, { color: colors.textSecondary }]}>{`С ${dayTitle(version.effectiveFrom, today)}`}</Text>)}
      </View> : null}

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Особые цели на дату</Text>
        {exceptions.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Нет. Особая цель заменяет расписание только для одной даты.</Text> : null}
        {exceptions.map((item) => (
          <View key={item.localDate} style={styles.exception}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Особая цель на ${dayTitle(item.localDate, today)}: ${corridorLine(item.corridors)}. Изменить`} style={styles.grow}
              onPress={() => startException(item.localDate, item.corridors)}>
              <Text style={[styles.dayText, { color: colors.textPrimary }]}>{dayTitle(item.localDate, today)}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{corridorLine(item.corridors)}</Text>
            </Pressable>
            <AppButton compact variant="ghost" label="Удалить" accessibilityLabel={`Удалить особую цель на ${dayTitle(item.localDate, today)}`}
              onPress={() => { void targets.clearException(clientId, item.localDate).catch(fail); }} />
          </View>
        ))}
        <AppButton variant="secondary" label="Добавить особую цель" onPress={() => startException(today, null)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 8 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  fields: { gap: 8 },
  metricRow: { gap: 2 },
  pair: { flexDirection: "row", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayRow: { flexDirection: "row", gap: 8, minHeight: 28, alignItems: "center" },
  dayName: { width: 28, fontFamily: fonts.semibold, fontSize: 13 },
  dayText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  exception: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 },
});
