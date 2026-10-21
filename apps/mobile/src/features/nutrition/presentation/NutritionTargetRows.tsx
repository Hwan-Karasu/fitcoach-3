import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { MacroGrams } from "../domain/CalcRules.ts";
import { deriveHomeMacroTarget, homeAdjustmentFor, EMPTY_MANUAL_MACROS } from "../domain/HomeMacroTargets.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type Corridors, type HomeMacroAdjustment, type TargetVersion } from "../domain/TargetModel.ts";
import { uniformWeek } from "../domain/TargetRules.ts";
import { formatTargetText, parseTargetText } from "../domain/TargetText.ts";
import { metricLabels, nutritionErrorText } from "./nutritionFormat.ts";
import { useToday } from "./useToday.ts";

export type TargetMode = "EXACT" | "RANGE";
type MacroMetric = "protein" | "fat" | "carbs";
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

/** Сводка пересчитывается сразу; версия и происхождение полей сохраняются только явной кнопкой. */
export function NutritionTargetRows({ clientId, targets, calories, defaults, leanMassKg, mode, onModeAutoChange, onLiveTarget }: Readonly<{ clientId: string; targets: NutritionTargetsPort;
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
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    void targets.listVersions(clientId).then((versions) => { if (active) setData({ versions }); }, () => { if (active) setError("Не удалось загрузить цели."); });
    return () => { active = false; };
  }, [targets, clientId, tick]);
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
    setDrafts({ ...shown, [metric]: text });
    setDirty(true);
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (lock.current || data === null || problem !== null || !hasTarget || typeof manual === "string") return;
    lock.current = true;
    setBusy(true);
    try {
      const same = data.versions.find((version) => version.effectiveFrom === today);
      const saved = await targets.saveVersion(clientId, { effectiveFrom: today, days: uniformWeek(parsed), homeAdjustment: { mode, manual } }, same?.revision ?? null);
      setData((current) => current === null ? current : { ...current, versions: [...current.versions.filter((version) => version.id !== saved.id), saved] });
      setDirty(false);
      setError(null);
      setNotice("Корректировка БЖУ сохранена.");
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "TARGET_STALE" ? "Цели уже изменились. Данные обновлены — повторите." : nutritionErrorText(failure));
      setTick((value) => value + 1);
    }
    lock.current = false;
    setBusy(false);
  };

  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" accessibilityLabel="Ручная корректировка Б/Ж/У" style={[styles.label, styles.centered, { color: colors.textSecondary }]}>— Ручная корректировка БЖУ —</Text>
      <View style={styles.row}>
        {MACROS.map((metric) => (
          <View key={metric} style={styles.cell}>
            <TextField label={fieldLabels[metric]} value={shown[metric]} textAlign="center" keyboardType="numbers-and-punctuation" disabled={busy || data === null}
              placeholder={mode === "EXACT" ? "22" : "22–30"} onChangeText={(text) => setField(metric, text)} />
          </View>
        ))}
      </View>
      {problem !== null ? <InlineNotice kind="error">{problem}</InlineNotice> : null}
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      {dirty ? <AppButton compact label="Сохранить БЖУ" busy={busy} disabled={problem !== null || !hasTarget || data === null} disabledReason={problem ?? "Недостаточно данных для сохранения."} onPress={() => { void save(); }} /> : null}
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
