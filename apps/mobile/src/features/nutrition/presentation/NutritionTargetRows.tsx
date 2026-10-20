import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { rebalanceMacroRanges, type GramRange, type MacroGrams } from "../domain/CalcRules.ts";
import { kcalRangeFromEntered } from "../domain/EnergyRules.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type TargetException, type TargetVersion } from "../domain/TargetModel.ts";
import { differsFromUniform, resolveTarget, uniformWeek, versionFor } from "../domain/TargetRules.ts";
import { formatTargetText, parseTargetText } from "../domain/TargetText.ts";
import { metricLabels, nutritionErrorText, todayLocal } from "./nutritionFormat.ts";

const NO_EXCEPTIONS: readonly TargetException[] = [];
export type TargetMode = "EXACT" | "RANGE";
type MacroMetric = "protein" | "fat" | "carbs";
const MACROS: readonly MacroMetric[] = ["protein", "fat", "carbs"];
type Drafts = Readonly<Record<MacroMetric, string>>;
const EMPTY: Drafts = { protein: "", fat: "", carbs: "" };
const fieldLabels: Readonly<Record<MacroMetric, string>> = { protein: "Белки, г", fat: "Жиры, г", carbs: "Углеводы, г" };

/** Тексты полей → коридоры Б/Ж/У; калории — сумма 4/9/4 (считаются сами). Пустое поле — показатель без цели. Строка — текст ошибки. */
function corridorsFrom(texts: Drafts, mode: TargetMode): Corridors | string | null {
  const out = {} as Record<MacroMetric, { minX10: number; maxX10: number } | null>;
  for (const metric of MACROS) {
    const parsed = parseTargetText(texts[metric]);
    if (parsed === "invalid") return `${metricLabels[metric]}: введите ${mode === "EXACT" ? "одно число (22)" : "число (22) или диапазон (22-30)"}; нижняя граница не больше верхней.`;
    if (mode === "EXACT" && parsed !== null && parsed.minX10 !== parsed.maxX10) return `${metricLabels[metric]}: в режиме «Точно» нужно одно число. Введите его или переключитесь на «Коридор».`;
    out[metric] = parsed;
  }
  if (MACROS.every((metric) => out[metric] === null)) return null;
  return { kcal: kcalRangeFromEntered(out), protein: out.protein, fat: out.fat, carbs: out.carbs };
}

/**
 * Ручная корректировка Б/Ж/У = цель на сегодня (UX 2.0 + §49.8): по одной ячейке на показатель — «22» (точно) или «22-30» (коридор, режим переключается в шапке карточки КБЖУ). Введённое
 * фиксируется, остальное и калории досчитываются под суточный ориентир (формулы 2.0, `rebalanceMacroRanges`; 1 г белка и углеводов = 4 ккал, жира = 9). Расчёт цель не меняет: сохраняется
 * только явное «Сохранить цели» (версия с сегодняшней даты, §49.11). Дни недели, версии и исключения — «Цели по дням недели».
 */
export function NutritionTargetRows({ clientId, targets, calories, defaults, mode, onModeAutoChange, onLiveTarget, onOpenSchedule }: Readonly<{ clientId: string; targets: NutritionTargetsPort;
  /** Суточный ориентир, ккал (расчёт с поправкой по весу); `null` — расчёта нет. */
  calories: number | null;
  /** Расчётные Б/Ж/У под этот ориентир (от сухой массы); `null` — не определены. */
  defaults: MacroGrams | null; mode: TargetMode;
  /** Сохранённая цель с диапазоном открывается в режиме «Коридор», с точными числами — в «Точно». */
  onModeAutoChange: (mode: TargetMode) => void;
  /** Живая цель по тому, что сейчас в ячейках (расчёт, правка тренера, калории по введённому): для ориентира, кольца и «съедено/цель» в карточке; `null` — данных нет. */
  onLiveTarget?: (target: Corridors | null) => void; onOpenSchedule?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [data, setData] = useState<Readonly<{ versions: readonly TargetVersion[]; exceptions: readonly TargetException[] }> | null>(null);
  const [tick, setTick] = useState(0);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY);
  /** Какие из Б/Ж/У ввёл тренер: остальные досчитываются под ориентир, пока он их не введёт сам. */
  const [manual, setManual] = useState<Readonly<Record<MacroMetric, boolean>>>({ protein: false, fat: false, carbs: false });
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
    if (resolved === null || dirty) return;
    if (resolved.source === "NONE") { setDrafts(EMPTY); setManual({ protein: false, fat: false, carbs: false }); return; }
    const c = resolved.corridors;
    setDrafts({ protein: formatTargetText(c.protein), fat: formatTargetText(c.fat), carbs: formatTargetText(c.carbs) });
    setManual({ protein: c.protein !== null, fat: c.fat !== null, carbs: c.carbs !== null });
    onModeAutoChange(TARGET_METRICS.some((metric) => c[metric] !== null && c[metric]!.minX10 !== c[metric]!.maxX10) ? "RANGE" : "EXACT");
  }, [resolved, dirty, onModeAutoChange]);

  /** Расчётные Б/Ж/У — стартовые значения ячеек; введённое тренером фиксируется, остальное досчитывается под исходный калораж (формулы 2.0). */
  const rebalanced = useMemo(() => {
    const range = (metric: MacroMetric): GramRange | null => {
      if (!manual[metric]) return null;
      const parsedRange = parseTargetText(drafts[metric]);
      return parsedRange === null || parsedRange === "invalid" || (mode === "EXACT" && parsedRange.minX10 !== parsedRange.maxX10) ? null : { min: parsedRange.minX10 / 10, max: parsedRange.maxX10 / 10 };
    };
    return rebalanceMacroRanges(calories, defaults ?? { protein: null, fat: null, carbs: null }, { protein: range("protein"), fat: range("fat"), carbs: range("carbs") });
  }, [manual, drafts, calories, defaults, mode]);
  const isAuto = (metric: MacroMetric) => !manual[metric] && rebalanced !== null && rebalanced[metric] !== null;
  const autoText = (metric: MacroMetric) => { const r = rebalanced?.[metric]; return r === null || r === undefined ? "" : formatTargetText({ minX10: r.min * 10, maxX10: r.max * 10 }); };
  /** Б/Ж/У с автозаполнением: введённые — как есть, досчитанные — целыми граммами (в режиме «Коридор» — коридором). */
  const shown = useMemo<Drafts>(() => ({ protein: isAuto("protein") ? autoText("protein") : drafts.protein, fat: isAuto("fat") ? autoText("fat") : drafts.fat, carbs: isAuto("carbs") ? autoText("carbs") : drafts.carbs }),
    [drafts, rebalanced, manual]);
  const parsed = useMemo(() => corridorsFrom(shown, mode), [shown, mode]);
  const anyManual = manual.protein || manual.fat || manual.carbs;
  // Калории: введено что-то — считаются по ячейкам (даже по одному белку); иначе — исходный расчётный калораж.
  const liveKcal = useMemo(() => {
    if (anyManual) return parsed !== null && typeof parsed !== "string" ? parsed.kcal : null;
    return calories === null ? null : { minX10: calories * 10, maxX10: calories * 10 };
  }, [anyManual, parsed, calories]);
  const live = useMemo<Corridors | null>(() => {
    const base = parsed !== null && typeof parsed !== "string" ? parsed : null;
    if (base === null && liveKcal === null) return null;
    return { kcal: liveKcal, protein: base?.protein ?? null, fat: base?.fat ?? null, carbs: base?.carbs ?? null };
  }, [parsed, liveKcal]);
  const liveKey = JSON.stringify(live);
  useEffect(() => { onLiveTarget?.(live); }, [liveKey, onLiveTarget]);

  const setField = (metric: MacroMetric, text: string) => {
    setDrafts({ ...drafts, [metric]: text });
    setManual({ ...manual, [metric]: text.trim() !== "" });
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

  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" accessibilityLabel="Ручная корректировка Б/Ж/У" style={[styles.label, styles.centered, { color: colors.textSecondary }]}>— Ручная корректировка БЖУ —</Text>
      <View style={styles.row}>
        {MACROS.map((metric) => (
          <View key={metric} style={styles.cell}>
            <TextField label={isAuto(metric) ? `${fieldLabels[metric]} (авто)` : fieldLabels[metric]} value={shown[metric]} keyboardType="numbers-and-punctuation" disabled={busy}
              placeholder={defaults === null || defaults[metric] === null ? (mode === "EXACT" ? "22" : "22-30") : `расчёт ${defaults[metric]}`} onChangeText={(text) => setField(metric, text)} />
          </View>
        ))}
      </View>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      {dirty ? <AppButton compact label="Сохранить цели" busy={busy} disabled={parsed === null} disabledReason="Задайте значения в ручной корректировке." onPress={askSave} /> : null}
      {onOpenSchedule !== undefined && !dirty ? <AppButton compact variant="ghost" label="Цели по дням недели" onPress={onOpenSchedule} /> : null}
      <ConfirmDialog visible={confirm !== null} title="Заменить цели на сегодня?" confirmLabel="Заменить" onCancel={() => setConfirm(null)} onConfirm={() => { void save(); }} description={confirm ?? ""} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: "row", gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  cell: { flex: 1 },
  centered: { textAlign: "center" },
});
