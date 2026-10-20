import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, SegmentedRing, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { localDateOf, upsertDailyMeasurement, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { calcMacros, deriveCalc, trendAdjustment, weightTrendKg } from "../domain/CalcRules.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { NUTRIENT_OF } from "../domain/TargetRules.ts";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { useMacroColors } from "./MacroGrid.tsx";
import { NutritionTargetRows, type TargetMode } from "./NutritionTargetRows.tsx";
import { metricLabels, nutritionErrorText, rangeText, todayLocal, wholeText } from "./nutritionFormat.ts";
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

/** Ручная отметка тренировки за сегодня: `true`/`false` или `null` — не отмечено. */
function useTodayWorkoutMark(clientId: string, calc: NutritionCalcPort, today: string): Readonly<{ done: boolean | null; loaded: boolean }> {
  const [state, setState] = useState<Readonly<{ key: string; done: boolean | null }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void calc.listWorkoutMarks(clientId, today, today).then((days) => { if (active) setState({ key: `${clientId}|${today}`, done: days[0]?.done ?? null }); }, () => undefined);
    return () => { active = false; };
  }, [calc, clientId, today, tick]);
  useEffect(() => calc.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [calc, clientId]);
  const current = state !== null && state.key === `${clientId}|${today}`;
  return { done: current ? state.done : null, loaded: current };
}

const midpoint = (range: Readonly<{ minX10: number; maxX10: number }>) => (range.minX10 + range.maxX10) / 2;

/**
 * Блоки питания на главной клиента (UX 2.0, §49.5.4, AUD-05): «Данные дня» (вес, шаги, тренировка; суточный ориентир с поправкой по динамике веса за 7 дней) и «КБЖУ» (ориентир, кольцо
 * «съедено от цели» из трёх цветов Б/Ж/У, «съедено / цель» по каждому макро, ручная корректировка). Источники — Nutrition, Measurements и дневник тренировок; legacy `client_kbju_state` не используется.
 * `trainedToday` — факт тренировки из дневника тренировок (авто «Да»), `null` — неизвестно.
 */
export function NutritionHomeCards({ clientId, body, diary, targets, calc, measurements, trainedToday, onOpenNutrition, onOpenSchedule }: Readonly<{ clientId: string; body: CalcClientBody; diary: NutritionDiaryPort;
  targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; trainedToday: boolean | null; onOpenNutrition: () => void; onOpenSchedule?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const macroColors = useMacroColors();
  const today = todayLocal();
  const { loaded } = useCalcData(clientId, calc, measurements);
  const { data } = useNutritionDay(clientId, today, diary, targets);
  const stepsToday = useTodaySteps(clientId, calc, today);
  const mark = useTodayWorkoutMark(clientId, calc, today);
  const [mode, setMode] = useState<TargetMode>("EXACT");
  const [weightText, setWeightText] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  // Поля показывают сегодняшние значения, пока тренер их не правил; правка не затирается обновлением данных.
  useEffect(() => {
    if (dirty || loaded === null || !stepsToday.loaded) return;
    setWeightText(loaded.weightToday === null ? "" : String(loaded.weightToday).replace(".", ","));
    setStepsText(stepsToday.steps === null ? "" : String(stepsToday.steps));
  }, [dirty, loaded, stepsToday]);

  const profile = loaded?.stored?.profile ?? DEFAULT_CALC_PROFILE;
  const result = useMemo(() => loaded === null ? null : deriveCalc(profile, { sex: body.sex, age: body.age, heightCm: body.heightCm, weightKg: loaded.weight, fatPercent: loaded.fat, avgSteps: loaded.steps }), [loaded, profile, body]);
  /** Суточный ориентир = расчёт (с целью) + поправка по динамике веса за 7 дней. */
  const adjustment = loaded === null ? 0 : trendAdjustment(profile.goal, weightTrendKg(loaded.weights), loaded.weight);
  // Ориентир не бывает неположительным: поправка не должна обнулять расчёт.
  const guide = result === null || result.target === null || result.target + adjustment <= 0 ? null : result.target + adjustment;
  const defaults = useMemo(() => result === null ? null : calcMacros(result.leanMassKg, guide, profile.goal), [result, guide, profile.goal]);

  const trainingAuto = trainedToday === true;
  const trainingState: boolean | null = trainingAuto ? true : mark.done;
  const cycleTraining = useCallback(async () => {
    if (trainingAuto || lock.current) return;
    lock.current = true;
    try {
      if (mark.done === null) await calc.setWorkoutMark(clientId, today, true);
      else if (mark.done) await calc.setWorkoutMark(clientId, today, false);
      else await calc.clearWorkoutMark(clientId, today);
      setError(null);
    } catch (failure) { setError(nutritionErrorText(failure)); }
    lock.current = false;
  }, [calc, clientId, today, mark.done, trainingAuto]);

  const saveDay = useCallback(async () => {
    if (lock.current) return;
    const weight = weightText.trim().replace(",", ".");
    const steps = stepsText.trim();
    if (weight !== "" && !/^\d{1,3}(\.\d)?$/u.test(weight)) { setError("Вес — число с одним знаком после запятой, например 85,4."); return; }
    if (steps !== "" && !/^\d{1,6}$/u.test(steps)) { setError("Шаги — целое число, например 8000."); return; }
    lock.current = true;
    setBusy(true);
    try {
      // Вес записывается только при изменении: без правки не растёт ревизия факта.
      if (weight !== "" && Number(weight) !== loaded?.weightToday) await upsertDailyMeasurement(measurements, clientId, { type: "WEIGHT", valueX10: Math.round(Number(weight) * 10), localDate: localDateOf(new Date()), localMinute: null });
      if (steps === "") await calc.clearSteps(clientId, today); else await calc.setSteps(clientId, today, Number(steps));
      setDirty(false);
      setError(null);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "MEASUREMENT_VALUE_INVALID" ? "Вес вне допустимого диапазона (20–400 кг)." : code === "MEASUREMENT_AMBIGUOUS_DAY" ? "За сегодня несколько записей веса. Выберите основную в журнале замеров."
        : code === "CALC_STEPS_INVALID" ? "Шаги — от 1 до 100 000." : nutritionErrorText(failure));
    }
    lock.current = false;
    setBusy(false);
  }, [weightText, stepsText, measurements, clientId, calc, today, loaded]);

  const recorded = data?.summary.state === "FOOD_RECORDED";
  const corridors = data === null || data.target.source === "NONE" ? null : data.target.corridors;
  /** Ориентир по калориям: цель тренера (коридор Б/Ж/У → ккал), иначе суточный ориентир расчёта. */
  const kcalRange = rangeText(corridors?.kcal ?? null);
  const orientText = kcalRange ?? (guide === null ? null : String(guide));
  const orientMiddle = corridors?.kcal != null ? midpoint(corridors.kcal) / 10 : guide;
  const eaten = (metric: "kcal" | "protein" | "fat" | "carbs"): number | null => (recorded && data !== null ? data.summary.totals[NUTRIENT_OF[metric]] : null);
  const eatenKcalX10 = eaten("kcal");
  const fraction = eatenKcalX10 === null || orientMiddle === null || orientMiddle <= 0 ? null : eatenKcalX10 / 10 / orientMiddle;
  /** Дуга делится по калориям съеденных белков, жиров и углеводов (4/9/4). */
  const segments = (["protein", "fat", "carbs"] as const).map((metric) => ({ weight: (eaten(metric) ?? 0) * (metric === "fat" ? 9 : 4), color: macroColors[metric] }));
  const targetText = (metric: "protein" | "fat" | "carbs"): string => {
    const range = rangeText(corridors?.[metric] ?? null);
    if (range !== null) return range;
    return defaults === null || defaults[metric] === null ? "—" : String(defaults[metric]);
  };
  const eatenText = (metric: "protein" | "fat" | "carbs"): string => (data === null ? "—" : !recorded ? "0" : wholeText(eaten(metric)));

  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.head}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Данные дня</Text>
          <View style={[styles.pill, { backgroundColor: colors.accentSoft }]}><Text style={[styles.pillText, { color: colors.accentInk }]}>Сегодня</Text></View>
        </View>
        <View style={styles.dayRow}>
          <View style={styles.dayCell}>
            <TextField label="Вес, кг" value={weightText} keyboardType="decimal-pad" placeholder="85,4" disabled={busy} onChangeText={(value) => { setWeightText(value); setDirty(true); setError(null); }} />
          </View>
          <View style={styles.dayCell}>
            <TextField label="Шаги" value={stepsText} keyboardType="number-pad" placeholder="8000" disabled={busy} onChangeText={(value) => { setStepsText(value); setDirty(true); setError(null); }} />
          </View>
          <View style={styles.dayCell}>
            <Text style={[styles.cellLabel, { color: colors.textPrimary }]}>Тренировка</Text>
            <Pressable accessibilityRole="button" disabled={trainingAuto}
              accessibilityLabel={`Тренировка сегодня: ${trainingState === null ? "не отмечена" : trainingState ? "да" : "нет"}${trainingAuto ? ", по дневнику тренировок" : ". Нажмите, чтобы изменить"}`}
              onPress={() => { void cycleTraining(); }} style={[styles.trainingButton, { borderColor: colors.border, backgroundColor: trainingState === true ? colors.accentSoft : colors.surfaceRaised, opacity: trainingAuto ? 0.85 : 1 }]}>
              <Text style={[styles.trainingText, { color: trainingState === true ? colors.accentInk : colors.textPrimary }]}>{trainingState === null ? "—" : trainingState ? "Да" : "Нет"}</Text>
            </Pressable>
          </View>
        </View>
        {dirty ? <AppButton compact label="Записать" busy={busy} onPress={() => { void saveDay(); }} /> : null}
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.head}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>КБЖУ</Text>
        <View style={styles.headRight}>
          <View style={[styles.group, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
            {([["EXACT", "Точно"], ["RANGE", "Коридор"]] as const).map(([id, label]) => (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: mode === id }} accessibilityLabel={`Режим цели: ${label}`} hitSlop={{ top: 8, bottom: 8 }} onPress={() => setMode(id)}
                style={[styles.segment, mode === id ? { backgroundColor: colors.accentFill } : null]}>
                <Text style={[styles.segmentText, { color: mode === id ? colors.onAccentFill : colors.textPrimary }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Открыть дневник питания" hitSlop={{ top: 8, bottom: 8 }} onPress={onOpenNutrition}
            style={[styles.group, styles.segment, { borderColor: colors.accentInk, backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.segmentText, { color: colors.accentInk }]}>Питание</Text>
          </Pressable>
        </View>
        </View>
        <View style={styles.summary}>
          <View style={styles.grow} accessible accessibilityLabel={`Суточный ориентир: ${orientText === null ? "нет данных" : `${orientText} ккал`}`}>
            <View style={[styles.pill, { backgroundColor: colors.accentSoft }]}><Text style={[styles.pillText, { color: colors.accentInk }]}>Суточный ориентир</Text></View>
            <Text style={[styles.bigNumber, { color: colors.textPrimary }]}>{orientText ?? "—"}<Text style={[styles.unit, { color: colors.textSecondary }]}>{orientText === null ? "" : " ккал"}</Text></Text>
          </View>
          <SegmentedRing size={84} stroke={10} fraction={fraction} segments={segments} accessibilityLabel={`От цели по калориям: ${fraction === null ? "нет данных" : `${Math.round(fraction * 100)} процентов`}`}>
            <Text style={[styles.ringValue, { color: colors.textPrimary }]}>{fraction === null ? "—" : `${Math.round(fraction * 100)}%`}</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>от цели</Text>
          </SegmentedRing>
        </View>
        <View style={styles.metrics}>
          {(["protein", "fat", "carbs"] as const).map((metric) => (
            <View key={metric} accessible style={styles.metric} accessibilityLabel={`${metricLabels[metric]}: съедено ${eatenText(metric)} из ${targetText(metric)} граммов`}>
              <Text style={[styles.hint, { color: macroColors[metric] }]}>{metricLabels[metric]}</Text>
              <Text style={[styles.value, { color: macroColors[metric] }]}>{`${eatenText(metric)}/${targetText(metric)}`}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />
        <NutritionTargetRows key={clientId} clientId={clientId} targets={targets} calories={guide} defaults={defaults} mode={mode} onModeAutoChange={setMode} onOpenSchedule={onOpenSchedule} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  group: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  segment: { minHeight: 28, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch" },
  cardTitle: { fontSize: 14, lineHeight: 19, fontFamily: fonts.bold },
  hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  grow: { flex: 1 },
  dayRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  dayCell: { flex: 1, gap: 4 },
  cellLabel: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  trainingButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  trainingText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  summary: { flexDirection: "row", alignItems: "center", gap: 10 },
  pill: { alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  pillText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  bigNumber: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  unit: { fontFamily: fonts.regular, fontSize: 14 },
  ringValue: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 21 },
  metrics: { flexDirection: "row", gap: 6 },
  metric: { flex: 1, alignItems: "center", gap: 2 },
  value: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  rule: { height: StyleSheet.hairlineWidth },
});
