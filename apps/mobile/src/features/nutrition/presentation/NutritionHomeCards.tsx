import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { InlineNotice, SegmentedRing } from "../../../shared/ui/components/public.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { dailyPoints, upsertDailyMeasurement, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { goalFraction, MEALS_GOAL, STEPS_GOAL } from "../domain/ActivityGoals.ts";
import { mealCount } from "../domain/DiaryRules.ts";
import { KCAL_PER_G } from "../domain/EnergyRules.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import type { Corridors } from "../domain/TargetModel.ts";
import { NUTRIENT_OF } from "../domain/TargetRules.ts";
import type { CalcClientBody, SaveCalcProfile } from "./NutritionCalcScreen.tsx";
import { CalcSheet } from "./CalcSheet.tsx";
import { useMacroColors } from "./MacroGrid.tsx";
import { NutritionTargetRows, type TargetMode } from "./NutritionTargetRows.tsx";
import { metricLabels, nutritionErrorText, rangeText, wholeText } from "./nutritionFormat.ts";
import { saveDayData } from "./dayData.ts";
import { useNutritionGuide } from "./useNutritionGuide.ts";
import { useNutritionDay } from "./useNutritionDay.ts";
import { useClientDay } from "./ClientDay.tsx";
import { ValueSheet } from "./ValueSheet.tsx";

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

/** Вес за выбранный день (единственная запись или основная); пусто — «нет данных», а не 0. */
function useDayWeight(clientId: string, measurements: MeasurementRepositoryPort, day: string): Readonly<{ weight: number | null; ambiguous: boolean; loaded: boolean }> {
  const [state, setState] = useState<Readonly<{ key: string; weight: number | null; ambiguous: boolean }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void measurements.listForClient(clientId).then((data) => {
      if (!active) return;
      const point = dailyPoints(data.measurements, data.primaries, "WEIGHT").find((candidate) => candidate.localDate === day);
      setState({ key: `${clientId}|${day}`, weight: point !== undefined && point.kind === "VALUE" ? point.measurement.valueX10 / 10 : null,
        ambiguous: point !== undefined && point.kind === "AMBIGUOUS" });
    }, () => undefined);
    return () => { active = false; };
  }, [measurements, clientId, day, tick]);
  useEffect(() => measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [measurements, clientId]);
  const current = state !== null && state.key === `${clientId}|${day}`;
  return { weight: current ? state.weight : null, ambiguous: current && state.ambiguous, loaded: current };
}

const wholeNumber = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/gu, "\u00A0");

/** Кружок показателя дня: дуга прогресса, число внутри, подпись ниже; нажатие открывает ввод или связанный экран. */
function DayRing({ label, unit, caption, value, fraction, disabled = false, hint, onPress }: Readonly<{
  label: string; unit?: string; caption: string; value: string | null; fraction: number | null; disabled?: boolean; hint: string; onPress: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value === null ? "нет данных" : `${value}${unit === undefined ? "" : ` ${unit}`}`}`} accessibilityHint={hint} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.ring, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}>
      <View importantForAccessibility="no-hide-descendants">
        <SegmentedRing size={64} stroke={6} fraction={fraction} accessibilityLabel={label}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.ringNumber, { color: colors.textPrimary }]}>{value ?? "—"}</Text>
        </SegmentedRing>
      </View>
      <Text numberOfLines={2} style={[styles.ringCaption, { color: colors.textSecondary }]}>{caption}</Text>
    </Pressable>
  );
}

/** Плашка показателя дня (одной ширины с соседями); без `onPress` — только значение. */
function DayPlate({ label, value, disabled = false, hint, onPress }: Readonly<{
  label: string; value: string | null; disabled?: boolean; hint: string; onPress?: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const content = <>
    <Text numberOfLines={1} style={[styles.plateLabel, { color: colors.textSecondary }]}>{label}</Text>
    <Text style={[styles.plateValue, { color: value === null ? colors.textMuted : colors.textPrimary }]}>{value ?? "—"}</Text>
  </>;
  // Без действия — обычный блок, а не «недоступная кнопка» для TalkBack.
  if (onPress === undefined) return <View accessible accessibilityLabel={`${label}: ${value ?? "нет данных"}`} accessibilityHint={hint} style={[styles.plate, { backgroundColor: colors.surfaceRaised }]}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? "нет данных"}`} accessibilityHint={hint} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.plate, { backgroundColor: colors.surfaceRaised, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}>
      {content}
    </Pressable>
  );
}

const midpoint = (range: Readonly<{ minX10: number; maxX10: number }>) => (range.minX10 + range.maxX10) / 2;

/**
 * Блоки питания на главной клиента (UX 2.0, §49.5.4, AUD-05): «Данные дня» (вес, шаги, тренировка; суточный ориентир с поправкой по динамике веса за 7 дней) и «КБЖУ» (ориентир, кольцо
 * «съедено от цели» из трёх цветов Б/Ж/У, «съедено / цель» по каждому макро, ручная корректировка). Источники — Nutrition, Measurements и дневник тренировок; legacy `client_kbju_state` не используется.
 * `trainedToday` — факт тренировки из дневника тренировок (авто «Да»), `null` — неизвестно.
 */
export function NutritionHomeCards({ clientId, body, diary, targets, calc, measurements, trainedToday, workoutsThisWeek, onOpenNutrition, onSaveProfile, onOpenJournal }: Readonly<{ clientId: string; body: CalcClientBody; diary: NutritionDiaryPort;
  targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; trainedToday: boolean | null;
  /** Тренировок за текущую неделю Пн–Вс по дневнику; `null` — нет данных (не 0). */ workoutsThisWeek: number | null; onOpenNutrition: () => void;
  /** Лист «Расчёт»: сохранение профиля и переход в журнал замеров (оболочка клиента). */
  onSaveProfile: SaveCalcProfile; onOpenJournal: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const macroColors = useMacroColors();
  const { day, today, future } = useClientDay();
  const { loaded, guide, defaults, leanMassKg, tdee } = useNutritionGuide(clientId, body, calc, measurements);
  const { data, stale } = useNutritionDay(clientId, day, diary, targets);
  const stepsToday = useTodaySteps(clientId, calc, day);
  const mark = useTodayWorkoutMark(clientId, calc, day);
  const dayWeight = useDayWeight(clientId, measurements, day);
  const [mode, setMode] = useState<TargetMode>("EXACT");
  /** Живая цель из ячеек ручной корректировки (расчёт или правка тренера). */
  const [liveTarget, setLiveTarget] = useState<Corridors | null>(null);
  const [sheet, setSheet] = useState<"weight" | "steps" | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const saveLock = useRef(false);
  const recordWeight = useCallback((valueX10: number, localDate: string) => upsertDailyMeasurement(measurements, clientId, { type: "WEIGHT", valueX10, localDate, localMinute: null }), [measurements, clientId]);

  // Другой день — другие значения: открытый лист и ошибка прежнего дня закрываются.
  useEffect(() => { setSheet(null); setError(null); }, [day]);

  // Авто-«Да» из дневника тренировок известно только за сегодня.
  const trainingAuto = day === today && trainedToday === true;
  const trainingState = trainingAuto || mark.done === true;
  const cycleTraining = useCallback(async () => {
    if (trainingAuto || lock.current) return;
    lock.current = true;
    try {
      // Два состояния: Да ↔ Нет (нет отметки показывается как «Нет»).
      await calc.setWorkoutMark(clientId, day, mark.done !== true);
      setError(null);
    } catch (failure) { setError(nutritionErrorText(failure)); }
    lock.current = false;
  }, [calc, clientId, day, mark.done, trainingAuto]);

  /** Вес или шаги выбранного дня из листа: ошибка возвращается в лист, а не теряет введённое. */
  const saveValue = useCallback(async (field: "weight" | "steps", text: string): Promise<string | null> => {
    if (saveLock.current) return "Идёт сохранение, повторите через секунду.";
    saveLock.current = true;
    const result = await saveDayData({ clientId, calc, recordWeight }, { localDate: day,
      weight: field === "weight" ? text : null, steps: field === "steps" ? text : null, workout: null })
      .finally(() => { saveLock.current = false; });
    const messages = Object.values(result);
    return messages.length === 0 ? null : messages.join(" ");
  }, [clientId, calc, recordWeight, day]);

  const recorded = data?.summary.state === "FOOD_RECORDED";
  /** Ориентир по калориям: цель тренера (коридор Б/Ж/У → ккал), иначе суточный ориентир расчёта. */
  const liveKcal = liveTarget?.kcal ?? null;
  const kcalRange = rangeText(liveKcal);
  const orientText = liveTarget !== null ? kcalRange : (guide === null ? null : String(guide));
  const orientMiddle = liveTarget !== null ? (liveKcal === null ? null : midpoint(liveKcal) / 10) : guide;
  const eaten = (metric: "kcal" | "protein" | "fat" | "carbs"): number | null => (recorded && data !== null ? data.summary.totals[NUTRIENT_OF[metric]] : null);
  const eatenKcalX10 = eaten("kcal");
  const fraction = eatenKcalX10 === null || orientMiddle === null || orientMiddle <= 0 ? null : eatenKcalX10 / 10 / orientMiddle;
  /** Дуга делится по калориям съеденных белков, жиров и углеводов (4/9/4). */
  const segments = (["protein", "fat", "carbs"] as const).map((metric) => ({ weight: (eaten(metric) ?? 0) * KCAL_PER_G[metric], color: macroColors[metric] }));
  const effective = liveTarget;
  const targetText = (metric: "protein" | "fat" | "carbs"): string => {
    if (effective !== null) return rangeText(effective[metric]) ?? "—";
    return defaults === null || defaults[metric] === null ? "—" : String(defaults[metric]).replace(".", ",");
  };
  const eatenText = (metric: "protein" | "fat" | "carbs"): string => (data === null ? "—" : !recorded ? "0" : wholeText(eaten(metric)));

  return (
    <>
      <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Данные дня</Text>
        <View style={styles.rings}>
          <DayRing label="Шаги" unit="шагов" caption="Шаги" value={future || !stepsToday.loaded || stepsToday.steps === null ? null : wholeNumber(stepsToday.steps)}
            fraction={future ? null : goalFraction(stepsToday.steps, STEPS_GOAL)} disabled={future} hint="Ввести шаги за день" onPress={() => setSheet("steps")} />
          {/* Сон приходит из Health Connect (ADR-059, UIX-16/17): пока кружок без данных и не нажимается. */}
          <DayRing label="Сон" caption="Сон" value={null} fraction={null} disabled hint="Нужен Health Connect: сон придёт из него" onPress={() => undefined} />
          <DayRing label="Расход" unit="ккал" caption="Расход, ккал" value={tdee === null ? null : wholeNumber(tdee)} fraction={null}
            hint="Расчёт калорий" onPress={() => setCalcOpen(true)} />
          <DayRing label="Приёмы" caption="Приёмы пищи" value={data === null || stale ? null : String(mealCount(data.summary))}
            fraction={data === null || stale ? null : goalFraction(mealCount(data.summary), MEALS_GOAL)} hint="Открыть дневник питания" onPress={onOpenNutrition} />
        </View>
        <View style={styles.plates}>
          <DayPlate label="Вес, кг" value={future || dayWeight.weight === null ? null : String(dayWeight.weight).replace(".", ",")} disabled={future}
            hint="Ввести вес за день" onPress={() => setSheet("weight")} />
          <DayPlate label="Тренировка" value={future ? null : trainingState ? "Да" : "Нет"} disabled={future || trainingAuto}
            hint={trainingAuto ? "Отмечено по дневнику тренировок" : "Отметить тренировку: да или нет"} onPress={() => { void cycleTraining(); }} />
          <DayPlate label="На неделе" value={workoutsThisWeek === null ? null : String(workoutsThisWeek)} disabled hint="Тренировок за неделю по дневнику" />
        </View>
        {future ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Для будущего дня доступно только питание.</Text> : null}
        {dayWeight.ambiguous ? <Text style={[styles.hint, { color: colors.textSecondary }]}>За этот день несколько записей веса: основную выбирают в журнале замеров.</Text> : null}
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </View>
      <CalcSheet visible={calcOpen} clientId={clientId} body={body} onSaveProfile={onSaveProfile} onOpenJournal={onOpenJournal} calc={calc} measurements={measurements}
        onClose={() => setCalcOpen(false)} />
      <ValueSheet visible={sheet === "weight"} title="Вес за день" label="Вес" unit="кг" keyboardType="decimal-pad" placeholder="85,4" emptyMessage="Введите вес."
        initial={dayWeight.weight === null ? "" : String(dayWeight.weight).replace(".", ",")} onSave={(text) => saveValue("weight", text)} onClose={() => setSheet(null)} />
      <ValueSheet visible={sheet === "steps"} title="Шаги за день" label="Шаги" unit="шагов" keyboardType="number-pad" placeholder="8000"
        initial={stepsToday.steps === null ? "" : String(stepsToday.steps)} onSave={(text) => saveValue("steps", text)} onClose={() => setSheet(null)} />

      <View style={[styles.card, styles.bigCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
          <Pressable accessibilityRole="button" accessibilityLabel="Расчёт калорий и БЖУ" hitSlop={{ top: 8, bottom: 8 }} onPress={() => setCalcOpen(true)}
            style={[styles.group, styles.segment, { borderColor: colors.accentInk, backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.segmentText, { color: colors.accentInk }]}>Расчёт ›</Text>
          </Pressable>
        </View>
        </View>
        <View style={styles.summary}>
          <View style={styles.guide} accessible accessibilityLabel={`Суточный ориентир: ${orientText === null ? "нет данных" : `${orientText} ккал`}`}>
            <View style={[styles.pill, styles.guidePill, { backgroundColor: colors.accentSoft }]}><Text style={[styles.pillText, { color: colors.accentInk }]}>Суточный ориентир</Text></View>
            <Text style={[styles.bigNumber, { color: colors.textPrimary }]}>{orientText ?? "—"}<Text style={[styles.unit, { color: colors.textSecondary }]}>{orientText === null ? "" : " ккал"}</Text></Text>
          </View>
          <SegmentedRing size={100} stroke={12} fraction={fraction} segments={segments} accessibilityLabel={`От цели по калориям: ${fraction === null ? "нет данных" : `${Math.round(fraction * 100)} процентов`}`}>
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
        {loaded !== null && loaded.fat === null ? (
          <Pressable accessibilityRole="link" accessibilityLabel="Рассчитать процент жира" onPress={() => setCalcOpen(true)}
            style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Для расчёта БЖУ нужен процент жира. Его можно рассчитать в разделе «Питание».</Text>
          </Pressable>
        ) : null}
        <NutritionTargetRows key={clientId} clientId={clientId} targets={targets} calories={guide} defaults={defaults} leanMassKg={leanMassKg} mode={mode} onModeAutoChange={setMode} onLiveTarget={setLiveTarget} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 8, gap: 4 },
  rings: { flexDirection: "row", gap: 6, paddingTop: 6 },
  ring: { flex: 1, minWidth: 0, minHeight: 48, alignItems: "center", gap: 6, paddingVertical: 4 },
  ringNumber: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19, paddingHorizontal: 4, textAlign: "center" },
  ringCaption: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, textAlign: "center" },
  plates: { flexDirection: "row", gap: 6, paddingTop: 6 },
  plate: { flex: 1, flexBasis: 0, minWidth: 0, minHeight: 56, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 8, gap: 2 },
  plateLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
  plateValue: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  bigCard: { flexGrow: 1, justifyContent: "space-between" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  group: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  segment: { minHeight: 28, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  cardTitle: { fontSize: 14, lineHeight: 19, fontFamily: fonts.bold },
  hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  guide: { flex: 1, minWidth: 0, alignItems: "center", gap: 4 },
  guidePill: { alignSelf: "center" },
  summary: { flexDirection: "row", alignItems: "center", gap: 10 },
  pill: { alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  pillText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  bigNumber: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, textAlign: "center", fontVariant: ["tabular-nums"] },
  unit: { fontFamily: fonts.regular, fontSize: 14 },
  ringValue: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24 },
  metrics: { flexDirection: "row", gap: 6 },
  metric: { flex: 1, alignItems: "center", gap: 2 },
  value: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  rule: { height: StyleSheet.hairlineWidth },
});
