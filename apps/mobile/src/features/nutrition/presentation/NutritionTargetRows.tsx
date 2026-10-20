import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { CalcResult, MacroGrams } from "../domain/CalcRules.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type TargetException, type TargetMetric, type TargetVersion } from "../domain/TargetModel.ts";
import { differsFromUniform, energyConsistency, resolveTarget, uniformWeek } from "../domain/TargetRules.ts";
import { metricLabels, nutritionErrorText, todayLocal, wholeText } from "./nutritionFormat.ts";
import { corridorsOf, draftOf, EMPTY_DRAFT, isEmptyDraft, type CorridorDraft } from "./targetDraft.ts";

const shortLabels: Readonly<Record<TargetMetric, string>> = { kcal: "К", protein: "Б", fat: "Ж", carbs: "У" };
const NO_EXCEPTIONS: readonly TargetException[] = [];

/** Расчётные ориентиры для ряда «Расчёт»: ккал и граммы Б/Ж/У как отдельные числа (справочно), неизвестное — `null`. */
function reference(result: CalcResult | null, macros: MacroGrams | null, metric: TargetMetric): number | null {
  if (result === null) return null;
  return metric === "kcal" ? result.target : macros === null ? null : macros[metric === "protein" ? "protein" : metric === "fat" ? "fat" : "carbs"];
}

/**
 * Два ряда КБЖУ (UX 2.0 + §49.8, UX v1.1): «Расчёт» — справочные ориентиры по формулам, только чтение; «Ручная корректировка» — коридоры тренера =
 * действующая цель на сегодня. Расчёт цель не меняет: сохраняется только явное «Сохранить цели» (версия с сегодняшней даты, §49.11).
 * Дни недели, версии и исключения — на экране «Цели по дням недели».
 */
export function NutritionTargetRows({ clientId, targets, result, macros, onOpenSchedule }: Readonly<{ clientId: string; targets: NutritionTargetsPort; result: CalcResult | null;
  macros: MacroGrams | null; onOpenSchedule?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [data, setData] = useState<Readonly<{ versions: readonly TargetVersion[]; exceptions: readonly TargetException[] }> | null>(null);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<CorridorDraft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([targets.listVersions(clientId), targets.listExceptions(clientId)]).then(([versions, exceptions]) => { if (active) setData({ versions, exceptions }); }, () => { if (active) setError("Не удалось загрузить цели."); });
    return () => { active = false; };
  }, [targets, clientId, tick]);
  useEffect(() => targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [targets, clientId]);

  const resolved = useMemo(() => data === null ? null : resolveTarget(data.versions, data.exceptions ?? NO_EXCEPTIONS, today), [data, today]);
  // Пока тренер не правил поля, они показывают действующую цель; правка не затирается обновлением данных.
  useEffect(() => {
    if (resolved !== null && !dirty) setDraft(resolved.source === "NONE" ? EMPTY_DRAFT : draftOf(resolved.corridors));
  }, [resolved, dirty]);

  const parsed = useMemo(() => isEmptyDraft(draft) ? null : corridorsOf(draft, metricLabels), [draft]);
  const warning = parsed !== null && typeof parsed !== "string" && energyConsistency(parsed) === "INCOMPATIBLE"
    ? "Калорийный коридор не сходится с энергией из Б/Ж/У (4·Б + 9·Ж + 4·У). Проверьте значения — они не изменены." : null;
  const setField = (metric: TargetMetric, side: "min" | "max", text: string) => {
    setDraft({ ...draft, [metric]: { ...draft[metric], [side]: text } });
    setDirty(true);
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    setConfirm(null);
    if (lock.current || data === null || parsed === null || typeof parsed === "string") return;
    lock.current = true;
    setBusy(true);
    try {
      const same = data.versions.find((version) => version.effectiveFrom === today);
      await targets.saveVersion(clientId, { effectiveFrom: today, days: uniformWeek(parsed) }, same?.revision ?? null);
      setDirty(false);
      setError(null);
      setNotice("Цели сохранены с сегодняшней даты на все дни недели.");
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "TARGET_STALE" ? "Цели уже изменились. Данные обновлены — повторите." : nutritionErrorText(failure));
      setTick((value) => value + 1);
    }
    lock.current = false;
    setBusy(false);
  };
  const askSave = () => {
    if (data === null) return;
    if (parsed === null) { setError("Задайте границы хотя бы для одного показателя."); return; }
    if (typeof parsed === "string") { setError(parsed); return; }
    const same = data.versions.find((version) => version.effectiveFrom === today);
    if (same !== undefined && differsFromUniform(same, parsed)) {
      setConfirm("На сегодняшнюю дату цели уже заданы по дням недели. Они будут заменены этими коридорами на все дни: значения по дням, которых нет в этом ряду, пропадут. Прошлые версии и особые цели на даты сохраняются.");
      return;
    }
    void save();
  };

  const source = resolved === null ? "" : resolved.source === "NONE" ? "Цель не установлена" : resolved.source === "EXCEPTION" ? "Сегодня действует особая цель на дату" : "Действует расписание целей";
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Цель на сегодня</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{source}</Text>
      <View style={styles.row}>
        <View style={styles.label} />
        {TARGET_METRICS.map((metric) => <Text key={metric} accessibilityLabel={metricLabels[metric]} style={[styles.head, { color: colors.textSecondary }]}>{shortLabels[metric]}</Text>)}
      </View>
      <View style={styles.row} accessible accessibilityLabel={`Расчёт: ${TARGET_METRICS.map((metric) => `${metricLabels[metric]} ${reference(result, macros, metric) === null ? "нет данных" : reference(result, macros, metric)}`).join(", ")}`}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Расчёт</Text>
        {TARGET_METRICS.map((metric) => {
          const value = reference(result, macros, metric);
          return <Text key={metric} style={[styles.value, { color: colors.textPrimary }]}>{value === null ? "—" : wholeText(value * 10)}</Text>;
        })}
      </View>
      <Text style={[styles.hint, { color: colors.textMuted }]}>Ручная корректировка — границы «от» и «до»; это и есть цель</Text>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Вручную</Text>
        {TARGET_METRICS.map((metric) => (
          <View key={metric} style={styles.cell}>
            {(["min", "max"] as const).map((side) => (
              <TextField key={side} hideLabel label={`${metricLabels[metric]}, ${side === "min" ? "от" : "до"}`} placeholder={side === "min" ? "от" : "до"} keyboardType="decimal-pad"
                value={draft[metric][side]} disabled={busy} onChangeText={(text) => setField(metric, side, text)} />
            ))}
          </View>
        ))}
      </View>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {warning !== null ? <InlineNotice kind="warning">{warning}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      <AppButton label="Сохранить цели" busy={busy} disabled={!dirty || parsed === null} disabledReason="Измените значения в ряду «Вручную»." onPress={askSave} />
      {onOpenSchedule !== undefined ? <AppButton variant="secondary" label="Цели по дням недели" onPress={onOpenSchedule} /> : null}
      <ConfirmDialog visible={confirm !== null} title="Заменить цели на сегодня?" confirmLabel="Заменить" onCancel={() => setConfirm(null)} onConfirm={() => { void save(); }} description={confirm ?? ""} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { width: 64, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  head: { flex: 1, textAlign: "center", fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  value: { flex: 1, textAlign: "center", fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  cell: { flex: 1, gap: 4 },
});
