import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import { calcMacros, deriveCalc } from "../domain/CalcRules.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS } from "../domain/TargetModel.ts";
import { assessDay, NUTRIENT_OF } from "../domain/TargetRules.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
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
export function NutritionHomeCards({ clientId, body, diary, targets, calc, measurements, onOpenNutrition }: Readonly<{ clientId: string; body: CalcClientBody; diary: NutritionDiaryPort;
  targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onOpenNutrition: () => void }>) {
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
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>КБЖУ сегодня</Text>
          <AppButton compact variant="secondary" label="Питание" onPress={onOpenNutrition} />
        </View>
        {data === null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Загружаем…</Text> : <>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {data.target.source === "NONE" ? "Цель не установлена" : `Суточный ориентир: ${rangeText(data.target.corridors.kcal) ?? "—"} ккал`}{recorded ? "" : " · записей о еде нет"}
          </Text>
          <View style={styles.metrics}>
            {TARGET_METRICS.map((metric) => {
              const value = recorded ? data.summary.totals[NUTRIENT_OF[metric]] : null;
              const range = data.target.source === "NONE" ? null : rangeText(data.target.corridors[metric]);
              const verdict = verdicts === null ? "UNKNOWN" : verdicts[metric];
              return (
                <View key={metric} accessible style={styles.metric}
                  accessibilityLabel={`${metricLabels[metric]}: ${value === null ? "нет данных" : wholeText(value)}${range === null ? "" : `, цель ${range}`}${verdictLabels[verdict] === "" ? "" : `, ${verdictLabels[verdict]}`}`}>
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>{metricLabels[metric]}</Text>
                  <Text style={[styles.value, { color: colors.textPrimary }]}>{wholeText(value)}</Text>
                  <Text style={[styles.hint, { color: colors.textMuted }]}>{range === null ? " " : range}</Text>
                </View>
              );
            })}
          </View>
        </>}
        <NutritionTargetRows key={clientId} clientId={clientId} targets={targets} result={result} macros={macros} />
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
  value: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
});
