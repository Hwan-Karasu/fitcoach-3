import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, ProgressRing, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import { calcMacros, deriveCalc } from "../domain/CalcRules.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { assessDay, NUTRIENT_OF } from "../domain/TargetRules.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { useMacroColors } from "./MacroGrid.tsx";
import { NutritionTargetRows } from "./NutritionTargetRows.tsx";
import { metricLabels, nutritionErrorText, rangeText, todayLocal, verdictLabels, wholeText } from "./nutritionFormat.ts";
import { DEFAULT_CALC_PROFILE, useCalcData } from "./useCalcData.ts";
import { useNutritionDay } from "./useNutritionDay.ts";

/** Шаги за сегодня: одно значение на дату; пусто — «нет данных», а не 0 (§49.5). Подписка снимается в cleanup. */
function useTodaySteps(clientId: string, calc: NutritionCalcPort, today: string): Readonly<{ steps: number | null; loaded: boolean }> {
  const [state, setState] = useState<Readonly<{ key: string; steps: number | null }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void calc.listSteps(clientId, today, today).then((days) => { if (active) setState({ key: `${clientId}|${today}`, steps: days[0]?.steps ?? null }); }, () => undefined);
    return () => { active = false; };
  }, [calc, clientId, today, tick]);
  useEffect(() => calc.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [calc, clientId]);
  const current = state !== null && state.key === `${clientId}|${today}`;
  return { steps: current ? state.steps : null, loaded: current };
}

/**
 * Блоки питания на главной клиента (§49.5.4, AUD-05): «Шаги сегодня» и «КБЖУ» — факт дня рядом с действующей целью (min–max) и два ряда
 * «Расчёт» / «Вручную». Источники — Nutrition и Measurements; legacy `client_kbju_state` не используется.
 */
export function NutritionHomeCards({ clientId, body, diary, targets, calc, measurements, onOpenNutrition, onOpenSchedule }: Readonly<{ clientId: string; body: CalcClientBody; diary: NutritionDiaryPort;
  targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onOpenNutrition: () => void; onOpenSchedule?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const { loaded } = useCalcData(clientId, calc, measurements);
  const { data } = useNutritionDay(clientId, today, diary, targets);
  const stepsToday = useTodaySteps(clientId, calc, today);
  const [stepsText, setStepsText] = useState("");
  const [stepsDirty, setStepsDirty] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [stepsBusy, setStepsBusy] = useState(false);
  const lock = useRef(false);

  useEffect(() => { if (!stepsDirty && stepsToday.loaded) setStepsText(stepsToday.steps === null ? "" : String(stepsToday.steps)); }, [stepsToday, stepsDirty]);

  const result = useMemo(() => loaded === null ? null : deriveCalc(loaded.stored?.profile ?? DEFAULT_CALC_PROFILE,
    { sex: body.sex, age: body.age, heightCm: body.heightCm, weightKg: loaded.weight, fatPercent: loaded.fat, avgSteps: loaded.steps }), [loaded, body]);
  const macros = useMemo(() => result === null ? null : calcMacros(result.leanMassKg, result.target, loaded?.stored?.profile.goal ?? DEFAULT_CALC_PROFILE.goal), [result, loaded]);

  const saveSteps = useCallback(async () => {
    if (lock.current) return;
    const text = stepsText.trim();
    lock.current = true;
    setStepsBusy(true);
    try {
      if (text === "") await calc.clearSteps(clientId, today);
      else if (/^\d{1,6}$/u.test(text)) await calc.setSteps(clientId, today, Number(text));
      else { setStepsError("Шаги — целое число, например 8000."); lock.current = false; setStepsBusy(false); return; }
      setStepsDirty(false);
      setStepsError(null);
    } catch (failure) { setStepsError(failure instanceof Error && failure.message === "CALC_STEPS_INVALID" ? "Шаги — от 1 до 100 000." : nutritionErrorText(failure)); }
    lock.current = false;
    setStepsBusy(false);
  }, [calc, clientId, today, stepsText]);

  const verdicts = data === null ? null : assessDay(data.summary, data.target);
  const recorded = data?.summary.state === "FOOD_RECORDED";
  const macroColors = useMacroColors();
  const corridors = data === null || data.target.source === "NONE" ? null : data.target.corridors;
  const kcalRange = rangeText(corridors?.kcal ?? null);
  /** «% от цели»: съеденные ккал к середине калорийного коридора; нет еды, цели или калорий — нет данных, а не 0 %. */
  const kcalFraction = (() => {
    const eaten = recorded && data !== null ? data.summary.totals.kcalX10 : null;
    const range = corridors?.kcal ?? null;
    if (eaten === null || range === null) return null;
    const middle = (range.minX10 + range.maxX10) / 2;
    return middle > 0 ? eaten / middle : null;
  })();
  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Шаги сегодня</Text>
        <View style={styles.stepsRow}>
          <View style={styles.grow}>
            <TextField label="Шаги" value={stepsText} keyboardType="number-pad" placeholder="Например, 8000" disabled={stepsBusy}
              hint="Среднее за 30 дней учитывается в расчёте NEAT. Пусто — нет данных."
              onChangeText={(value) => { setStepsText(value); setStepsDirty(true); setStepsError(null); }} />
          </View>
          <AppButton label="Записать" busy={stepsBusy} disabled={!stepsDirty} onPress={() => { void saveSteps(); }} />
        </View>
        {stepsError !== null ? <InlineNotice kind="error">{stepsError}</InlineNotice> : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.head}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>КБЖУ</Text>
          <AppButton compact variant="secondary" label="Питание" onPress={onOpenNutrition} />
        </View>
        {data === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Загружаем…</Text> : <>
          <View style={styles.summary}>
            <View style={styles.grow} accessible accessibilityLabel={`Суточный ориентир: ${kcalRange === null ? "цель не установлена" : `${kcalRange} ккал`}`}>
              <View style={[styles.pill, { backgroundColor: colors.accentSoft }]}><Text style={[styles.pillText, { color: colors.accentInk }]}>Суточный ориентир</Text></View>
              <Text style={[styles.bigNumber, { color: colors.textPrimary }]}>{kcalRange ?? "—"}<Text style={[styles.unit, { color: colors.textSecondary }]}>{kcalRange === null ? "" : " ккал"}</Text></Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{data.target.source === "NONE" ? "Цель не установлена" : recorded ? `Съедено: ${wholeText(data.summary.totals.kcalX10)} ккал` : "Записей о еде нет"}</Text>
            </View>
            <ProgressRing fraction={kcalFraction} accessibilityLabel={`От цели по калориям: ${kcalFraction === null ? "нет данных" : `${Math.round(kcalFraction * 100)} процентов`}`}>
              <Text style={[styles.ringValue, { color: colors.textPrimary }]}>{kcalFraction === null ? "—" : `${Math.round(kcalFraction * 100)}%`}</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>от цели</Text>
            </ProgressRing>
          </View>
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
          <View style={styles.metrics}>
            {(["protein", "fat", "carbs"] as const).map((metric) => {
              const value = recorded ? data.summary.totals[NUTRIENT_OF[metric]] : null;
              const range = corridors === null ? null : rangeText(corridors[metric]);
              return (
                <View key={metric} accessible style={styles.metric}
                  accessibilityLabel={`${metricLabels[metric]}: ${value === null ? "нет данных" : `${wholeText(value)} г`}${range === null ? "" : `, цель ${range}`}${verdicts === null || verdictLabels[verdicts[metric]] === "" ? "" : `, ${verdictLabels[verdicts[metric]]}`}`}>
                  <Text style={[styles.hint, { color: macroColors[metric] }]}>{metricLabels[metric]}</Text>
                  <Text style={[styles.value, { color: macroColors[metric] }]}>{wholeText(value)}<Text style={[styles.unit, { color: colors.textSecondary }]}>{value === null ? "" : " г"}</Text></Text>
                  <Text style={[styles.hint, { color: colors.textMuted }]}>{range === null ? " " : `цель ${range}`}</Text>
                </View>
              );
            })}
          </View>
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
        </>}
        <NutritionTargetRows key={clientId} clientId={clientId} targets={targets} result={result} macros={macros} onOpenSchedule={onOpenSchedule} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 15, lineHeight: 22, fontFamily: fonts.bold },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  stepsRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  grow: { flex: 1 },
  metrics: { flexDirection: "row", gap: 6 },
  metric: { flex: 1, alignItems: "center", gap: 2 },
  value: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12 },
  pill: { alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  bigNumber: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38 },
  unit: { fontFamily: fonts.regular, fontSize: 14 },
  ringValue: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  rule: { height: StyleSheet.hairlineWidth },
});
