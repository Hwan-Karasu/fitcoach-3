import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { rebalanceMacros, type CalcResult, type MacroGrams } from "../domain/CalcRules.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type TargetException, type TargetMetric, type TargetVersion } from "../domain/TargetModel.ts";
import { differsFromUniform, energyConsistency, resolveTarget, uniformWeek, versionFor } from "../domain/TargetRules.ts";
import { kcalRangeFromMacros } from "../domain/EnergyRules.ts";
import { formatTargetText, parseTargetText } from "../domain/TargetText.ts";
import { metricLabels, nutritionErrorText, todayLocal, wholeText } from "./nutritionFormat.ts";
import { useMacroColors } from "./MacroGrid.tsx";

const NO_EXCEPTIONS: readonly TargetException[] = [];
type Drafts = Readonly<Record<TargetMetric, string>>;
const EMPTY: Drafts = { kcal: "", protein: "", fat: "", carbs: "" };
type MacroMetric = "protein" | "fat" | "carbs";
const fieldLabels: Readonly<Record<TargetMetric, string>> = { kcal: "Ккал", protein: "Белки, г", fat: "Жиры, г", carbs: "Углеводы, г" };

/** Расчётные ориентиры для ряда «Расчёт»: ккал и граммы Б/Ж/У как отдельные числа (справочно), неизвестное — `null`. */
function reference(result: CalcResult | null, macros: MacroGrams | null, metric: TargetMetric): number | null {
  if (result === null) return null;
  return metric === "kcal" ? result.target : macros === null ? null : macros[metric];
}

/** Тексты полей → коридоры; пустое поле — показатель без цели. Строка — текст ошибки. */
function corridorsFrom(drafts: Drafts): Corridors | string | null {
  const out = {} as Record<TargetMetric, { minX10: number; maxX10: number } | null>;
  for (const metric of TARGET_METRICS) {
    const parsed = parseTargetText(drafts[metric]);
    if (parsed === "invalid") return `${metricLabels[metric]}: введите число (22) или диапазон (22-30); нижняя граница не больше верхней.`;
    out[metric] = parsed;
  }
  return TARGET_METRICS.every((metric) => out[metric] === null) ? null : out;
}

/**
 * Два ряда КБЖУ (UX 2.0 + §49.8, UX v1.1): «Расчёт» — справочные ориентиры по формулам, только чтение; «Вручную» — цель тренера, по одной ячейке на показатель: «22» — точное число,
 * «22-30» — диапазон. Расчёт цель не меняет: сохраняется только явное «Сохранить цели» (версия с сегодняшней даты, §49.11). Дни недели, версии и исключения — «Цели по дням недели».
 */
export function NutritionTargetRows({ clientId, targets, result, macros, onOpenSchedule }: Readonly<{ clientId: string; targets: NutritionTargetsPort; result: CalcResult | null;
  macros: MacroGrams | null; onOpenSchedule?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const macroColors = useMacroColors();
  const today = todayLocal();
  const [data, setData] = useState<Readonly<{ versions: readonly TargetVersion[]; exceptions: readonly TargetException[] }> | null>(null);
  const [tick, setTick] = useState(0);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY);
  const [dirty, setDirty] = useState(false);
  /** Калории считаются сами из Б/Ж/У (4/9/4), пока тренер не ввёл их вручную; очистка поля возвращает авторасчёт. */
  const [kcalManual, setKcalManual] = useState(false);
  /** Какие из Б/Ж/У ввёл тренер: остальные досчитываются под калорийный ориентир (формулы 2.0), пока он их не введёт сам. */
  const [macroManual, setMacroManual] = useState<Readonly<Record<MacroMetric, boolean>>>({ protein: false, fat: false, carbs: false });
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
    if (resolved === null || dirty) return;
    if (resolved.source === "NONE") { setDrafts(EMPTY); setKcalManual(false); setMacroManual({ protein: false, fat: false, carbs: false }); return; }
    const c = resolved.corridors;
    const auto = kcalRangeFromMacros({ protein: c.protein, fat: c.fat, carbs: c.carbs });
    setDrafts({ kcal: formatTargetText(c.kcal), protein: formatTargetText(c.protein), fat: formatTargetText(c.fat), carbs: formatTargetText(c.carbs) });
    setMacroManual({ protein: c.protein !== null, fat: c.fat !== null, carbs: c.carbs !== null });
    // Сохранённая калорийная цель, отличающаяся от суммы 4/9/4, — осознанный ручной ввод: авторасчёт её не затирает.
    setKcalManual(c.kcal !== null && (auto === null || auto.minX10 !== c.kcal.minX10 || auto.maxX10 !== c.kcal.maxX10));
  }, [resolved, dirty]);

  /** Пересчёт Б/Ж/У: введённые тренером — как введены (диапазон — серединой), остальные добираются до калорийного ориентира расчёта. */
  const rebalanced = useMemo<MacroGrams | null>(() => {
    if (!macroManual.protein && !macroManual.fat && !macroManual.carbs) return null;
    const point = (metric: MacroMetric): number | null => {
      if (!macroManual[metric]) return null;
      const range = parseTargetText(drafts[metric]);
      return range === null || range === "invalid" ? null : (range.minX10 + range.maxX10) / 20;
    };
    return rebalanceMacros(result?.target ?? null, macros ?? { protein: null, fat: null, carbs: null }, { protein: point("protein"), fat: point("fat"), carbs: point("carbs") });
  }, [macroManual, drafts, result, macros]);
  const macroAuto = (metric: MacroMetric) => !macroManual[metric] && rebalanced !== null && rebalanced[metric] !== null;
  /** Б/Ж/У с автозаполнением: введённые — как есть, досчитанные — целым числом граммов. */
  const filled = useMemo<Drafts>(() => ({ ...drafts, protein: macroAuto("protein") ? String(rebalanced?.protein) : drafts.protein, fat: macroAuto("fat") ? String(rebalanced?.fat) : drafts.fat,
    carbs: macroAuto("carbs") ? String(rebalanced?.carbs) : drafts.carbs }), [drafts, rebalanced, macroManual]);

  const autoKcal = useMemo(() => {
    const ranges = { protein: parseTargetText(filled.protein), fat: parseTargetText(filled.fat), carbs: parseTargetText(filled.carbs) };
    const { protein, fat, carbs } = ranges;
    return protein === "invalid" || fat === "invalid" || carbs === "invalid" ? null : kcalRangeFromMacros({ protein, fat, carbs });
  }, [filled]);
  /** Тексты полей с учётом автозаполнения Б/Ж/У и калорий: так же они разбираются и сохраняются. */
  const effective = useMemo<Drafts>(() => !kcalManual && autoKcal !== null ? { ...filled, kcal: formatTargetText(autoKcal) } : filled, [filled, kcalManual, autoKcal]);
  const kcalAuto = !kcalManual && autoKcal !== null;

  const parsed = useMemo(() => corridorsFrom(effective), [effective]);
  const warning = parsed !== null && typeof parsed !== "string" && energyConsistency(parsed) === "INCOMPATIBLE"
    ? "Калорийный коридор не сходится с энергией из Б/Ж/У (4·Б + 9·Ж + 4·У). Проверьте значения — они не изменены." : null;
  const setField = (metric: TargetMetric, text: string) => {
    setDrafts({ ...drafts, [metric]: text });
    if (metric === "kcal") setKcalManual(text.trim() !== "");
    else setMacroManual({ ...macroManual, [metric]: text.trim() !== "" });
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
      setNotice(resolved !== null && resolved.source === "EXCEPTION" ? "Версия целей сохранена, но сегодня действует особая цель на дату — она приоритетнее. Изменить её можно в «Целях по дням недели»." : "Цели сохранены с сегодняшней даты на все дни недели.");
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "TARGET_STALE" ? "Цели уже изменились. Данные обновлены — повторите." : nutritionErrorText(failure));
      setTick((value) => value + 1);
    }
    lock.current = false;
    setBusy(false);
  };
  const askSave = () => {
    if (data === null) return;
    if (parsed === null) { setError("Задайте цель хотя бы для одного показателя."); return; }
    if (typeof parsed === "string") { setError(parsed); return; }
    // Действующая версия (не только на сегодняшнюю дату): новая версия с сегодняшнего дня вытеснит её расписание на будущее.
    const effective = versionFor(data.versions, today);
    if (effective !== null && differsFromUniform(effective, parsed)) {
      setConfirm(effective.effectiveFrom === today
        ? "На сегодняшнюю дату цели уже заданы по дням недели. Они будут заменены этими значениями на все дни: значения по дням, которых нет здесь, пропадут. Прошлые версии и особые цели на даты сохраняются."
        : "Сейчас действует расписание целей по дням недели. С сегодняшней даты вместо него будут действовать эти значения, одинаковые на все дни. Прошлая версия сохранится в истории, особые цели на даты — тоже.");
      return;
    }
    void save();
  };

  const source = resolved === null ? "" : resolved.source === "NONE" ? "Цель не установлена" : resolved.source === "EXCEPTION" ? "Сегодня действует особая цель на дату" : "Действует расписание целей";
  const field = (metric: TargetMetric) => {
    const calc = reference(result, macros, metric);
    return (
      <TextField label={metric === "kcal" ? (kcalAuto ? "Ккал (авто из Б/Ж/У)" : fieldLabels[metric]) : macroAuto(metric) ? `${fieldLabels[metric]} (авто)` : fieldLabels[metric]} value={effective[metric]} keyboardType="numbers-and-punctuation" disabled={busy}
        hint={metric === "kcal" ? "1 г белка = 4 ккал, жира = 9, углеводов = 4. Можно ввести своё число — оно заменит авторасчёт." : undefined}
        placeholder={calc === null ? "22 или 22-30" : `расчёт ${wholeText(calc * 10)}`} onChangeText={(text) => setField(metric, text)} />
    );
  };
  return (
    <View style={styles.wrap}>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{source}</Text>
      <View style={styles.row} accessible accessibilityLabel={`Расчёт: ${TARGET_METRICS.map((metric) => `${metricLabels[metric]} ${reference(result, macros, metric) === null ? "нет данных" : reference(result, macros, metric)}`).join(", ")}`}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Расчёт</Text>
        {TARGET_METRICS.map((metric) => {
          const value = reference(result, macros, metric);
          return <Text key={metric} style={[styles.value, { color: macroColors[metric] }]}>{value === null ? "—" : wholeText(value * 10)}</Text>;
        })}
      </View>
      <Text style={[styles.label, { color: colors.textSecondary }]}>Ручная корректировка</Text>
      <Text style={[styles.hint, { color: colors.textMuted }]}>В каждой ячейке — число (22) или диапазон (22-30). Введёте часть Б/Ж/У — остальное и калории досчитаются под расчётный калораж.</Text>
      {field("kcal")}
      <View style={styles.row}>
        <View style={styles.cell}>{field("protein")}</View>
        <View style={styles.cell}>{field("fat")}</View>
        <View style={styles.cell}>{field("carbs")}</View>
      </View>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {warning !== null ? <InlineNotice kind="warning">{warning}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      <AppButton label="Сохранить цели" busy={busy} disabled={!dirty || parsed === null} disabledReason="Измените значения в ручной корректировке." onPress={askSave} />
      {onOpenSchedule !== undefined ? <AppButton variant="secondary" label="Цели по дням недели" onPress={onOpenSchedule} /> : null}
      <ConfirmDialog visible={confirm !== null} title="Заменить цели на сегодня?" confirmLabel="Заменить" onCancel={() => setConfirm(null)} onConfirm={() => { void save(); }} description={confirm ?? ""} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  value: { flex: 1, textAlign: "center", fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  cell: { flex: 1 },
});
