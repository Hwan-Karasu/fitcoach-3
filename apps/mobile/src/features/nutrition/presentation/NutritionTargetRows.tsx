import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { InlineNotice } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { MacroGrams } from "../domain/CalcRules.ts";
import { deriveHomeMacroTarget, homeAdjustmentFor, EMPTY_MANUAL_MACROS } from "../domain/HomeMacroTargets.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type HomeMacroAdjustment, type TargetVersion } from "../domain/TargetModel.ts";
import { uniformWeek } from "../domain/TargetRules.ts";
import { formatTargetText, parseTargetText } from "../domain/TargetText.ts";
import { macroBarGeometry } from "../domain/MacroBar.ts";
import { metricLabels, nutritionErrorText, rangeText, wholeText } from "./nutritionFormat.ts";
import { useToday } from "./useToday.ts";
import { HomeTargetSaveQueue } from "./HomeTargetSaveQueue.ts";

export type TargetMode = "EXACT" | "RANGE";
export type MacroMetric = "protein" | "fat" | "carbs";
const MACROS: readonly MacroMetric[] = ["protein", "fat", "carbs"];
type Drafts = Readonly<Record<MacroMetric, string>>;
const NO_DEFAULTS: MacroGrams = { protein: null, fat: null, carbs: null };
const EMPTY: Drafts = { protein: "", fat: "", carbs: "" };
const fieldLabels: Readonly<Record<MacroMetric, string>> = { protein: "Белки, г", fat: "Жиры, г", carbs: "Углеводы, г" };

/** Только явный ввод, без подстановки расчётных значений в нижние поля. */
function manualFrom(texts: Drafts, mode: TargetMode): HomeMacroAdjustment["manual"] | string {
  const out = { ...EMPTY_MANUAL_MACROS };
  for (const metric of MACROS) {
    const parsed = parseTargetText(texts[metric]);
    if (parsed === "invalid") return `${metricLabels[metric]}: введите число или диапазон с нижней границей не больше верхней.`;
    if (mode === "EXACT" && parsed !== null && parsed.minX10 !== parsed.maxX10) return `${metricLabels[metric]}: в режиме «Точно» нужно одно число или переключение на «Коридор».`;
    out[metric] = parsed;
  }
  return out;
}

/**
 * Сводка пересчитывается сразу; цель сохраняется без кнопки (UI-OWN-071): по «Готово» на клавиатуре и при уходе фокуса с поля.
 * Недопустимая комбинация не пишется: ошибка под строкой, введённое остаётся в поле.
 */
export function NutritionTargetRows({ clientId, targets, calories, defaults, leanMassKg, mode, onModeAutoChange, onLiveTarget, eaten, macroColors }: Readonly<{ clientId: string; targets: NutritionTargetsPort;
  /** Съедено за выбранный день в десятых грамма; `null` — данных нет (не 0). */
  eaten: Readonly<Record<MacroMetric, number | null>>;
  /** Цвет Б/Ж/У: подпись, заливка полосы и рамка коридора. */
  macroColors: Readonly<Record<MacroMetric, string>>;
  /** Суточный ориентир, ккал (расчёт с поправкой по весу); `null` — расчёта нет. */
  calories: number | null;
  /** Расчётные Б/Ж/У под этот ориентир (от сухой массы); `null` — не определены. */
  defaults: MacroGrams | null; leanMassKg: number | null; mode: TargetMode;
  /** Сохранённая цель с диапазоном открывается в режиме «Коридор», с точными числами — в «Точно». */
  onModeAutoChange: (mode: TargetMode) => void;
  /** Живая цель по тому, что сейчас в ячейках (расчёт, правка тренера, калории по введённому): для ориентира, кольца и «съедено/цель» в карточке; `null` — данных нет. */
  onLiveTarget?: (target: Corridors | null) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = useToday();
  const [data, setData] = useState<Readonly<{ versions: readonly TargetVersion[] }> | null>(null);
  const [tick, setTick] = useState(0);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveQueue = useMemo(() => new HomeTargetSaveQueue(clientId, targets), [clientId, targets]);

  useEffect(() => {
    let active = true;
    void targets.listVersions(clientId).then((versions) => { if (active) { saveQueue.adopt(versions); setData({ versions }); } }, () => { if (active) setError("Не удалось загрузить цели."); });
    return () => { active = false; };
  }, [targets, clientId, tick, saveQueue]);
  useEffect(() => targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [targets, clientId]);

  const adjustment = useMemo(() => data === null ? null : homeAdjustmentFor(data.versions, today), [data, today]);
  const shown = useMemo<Drafts>(() => dirty ? drafts : {
    protein: formatTargetText(adjustment?.manual.protein ?? null),
    fat: formatTargetText(adjustment?.manual.fat ?? null),
    carbs: formatTargetText(adjustment?.manual.carbs ?? null),
  }, [dirty, drafts, adjustment]);
  // Старые числовые цели не задают ни режим ввода, ни значения верхней сводки.
  useEffect(() => {
    if (!dirty && adjustment !== null) onModeAutoChange(adjustment.mode);
  }, [adjustment, dirty, onModeAutoChange]);

  const manual = useMemo(() => manualFrom(shown, mode), [shown, mode]);
  const balanced = useMemo(() => deriveHomeMacroTarget(calories, defaults ?? NO_DEFAULTS, leanMassKg,
    typeof manual === "string" ? EMPTY_MANUAL_MACROS : manual, mode), [calories, defaults, leanMassKg, manual, mode]);
  const problem = typeof manual === "string" ? manual : balanced.problem;
  const parsed = balanced.corridors;
  const hasTarget = TARGET_METRICS.some((metric) => parsed[metric] !== null);
  const live = parsed;
  useEffect(() => { if (data !== null) onLiveTarget?.(live); }, [data, live, onLiveTarget]);

  const setField = (metric: MacroMetric, text: string) => {
    saveQueue.markEdited();
    setDrafts({ ...shown, [metric]: text });
    setDirty(true);
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (!dirty || data === null || problem !== null || !hasTarget || typeof manual === "string") return;
    try {
      const { saved, edit } = await saveQueue.save({ effectiveFrom: today, days: uniformWeek(parsed), homeAdjustment: { mode, manual } });
      setData((current) => current === null ? current : { ...current, versions: [...current.versions.filter((version) => version.id !== saved.id), saved] });
      if (saveQueue.isCurrent(edit)) {
        setDirty(false);
        setError(null);
        setNotice("Корректировка БЖУ сохранена.");
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "TARGET_STALE" ? "Цели уже изменились. Данные обновлены — повторите." : nutritionErrorText(failure));
      setTick((value) => value + 1);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" accessibilityLabel="Цель по Б/Ж/У" style={[styles.caption, { color: colors.textMuted }]}>Цель по БЖУ</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>своя — в поле справа, пусто = авто</Text>
      </View>
      {MACROS.map((metric) => {
        const targetText = rangeText(parsed[metric]);
        const eatenText = wholeText(eaten[metric]);
        const bar = macroBarGeometry(eaten[metric], parsed[metric]);
        const manualText = shown[metric].trim() !== "";
        return (
          <View key={metric} style={styles.row}>
            <View accessible accessibilityLabel={`${metricLabels[metric]}: съедено ${eatenText} из ${targetText ?? "—"} граммов`} style={styles.rowMain}>
              <View style={styles.rowHead}>
                <Text style={[styles.metricName, { color: macroColors[metric] }]}>{metricLabels[metric]}</Text>
                <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{`${eatenText} / ${targetText ?? "—"} г`}</Text>
              </View>
              <View style={[styles.bar, { backgroundColor: colors.border }]}>
                <View style={[styles.barFill, { width: `${bar.fill * 100}%`, backgroundColor: macroColors[metric] }]} />
                {bar.band === null ? null : <View style={[styles.band, { left: `${bar.band.left * 100}%`, width: `${bar.band.width * 100}%`, borderColor: macroColors[metric] }]} />}
              </View>
            </View>
            <TextInput accessibilityLabel={`${fieldLabels[metric]}: своя цель`} accessibilityHint={mode === "EXACT" ? "Одно число; пусто — расчётная цель" : "Диапазон, например 22–30; пусто — расчётная цель"}
              hitSlop={{ top: 6, bottom: 6 }} editable={data !== null} value={shown[metric]} onChangeText={(text) => setField(metric, text)} placeholder="авто" placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation" returnKeyType="done" selectionColor={colors.accentInk} textAlign="center"
              onSubmitEditing={() => { void save(); }} onBlur={() => { void save(); }}
              style={[styles.field, manualText
                ? { borderWidth: 2, borderColor: colors.accentInk, backgroundColor: colors.accentSoft, color: colors.textPrimary, fontFamily: fonts.bold }
                : { borderWidth: 1, borderColor: colors.controlBorder, color: colors.textPrimary, fontFamily: fonts.semibold }, data === null ? { opacity: 0.6 } : null]} />
          </View>
        );
      })}
      {problem !== null ? <InlineNotice kind="error">{problem}</InlineNotice> : null}
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  caption: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.66, textTransform: "uppercase" },
  hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, flexShrink: 1, textAlign: "right" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowMain: { flex: 1, minWidth: 0, gap: 4 },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  metricName: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  metricValue: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] },
  bar: { height: 6, borderRadius: 3 },
  barFill: { height: 6, borderRadius: 3 },
  band: { position: "absolute", top: -2, bottom: -2, borderRadius: 4, borderWidth: 2 },
  /** Размер макета 68×36; зона нажатия расширена `hitSlop` до 48 dp. */
  field: { width: 68, height: 36, borderRadius: 18, paddingHorizontal: 6, paddingVertical: 0, fontSize: 13 },
});
