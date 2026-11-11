import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Flame, Footprints, Moon, TrendingUp, Utensils, type LucideIcon } from "lucide-react-native";
import { HealthConnectBanner, useHealthDaily, type HealthConnectPort, type HealthStorePort, type HealthSyncResult } from "../../health/public.ts";
import { InlineNotice, SegmentedRing } from "../../../shared/ui/components/public.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { dailyPoints, MeasurementsCard, upsertDailyMeasurement, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { goalFraction, MEALS_GOAL, SLEEP_GOAL_HOURS, STEPS_GOAL } from "../domain/ActivityGoals.ts";
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
import { nutritionErrorText, rangeText } from "./nutritionFormat.ts";
import type { MetricId } from "../domain/MetricSeries.ts";
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
      setState({ key: `${clientId}|${day}`, weight: point !== undefined && point.kind === "VALUE" ? point.measurement.valueX100 / 100 : null,
        ambiguous: point !== undefined && point.kind === "AMBIGUOUS" });
    }, () => undefined);
    return () => { active = false; };
  }, [measurements, clientId, day, tick]);
  useEffect(() => measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [measurements, clientId]);
  const current = state !== null && state.key === `${clientId}|${day}`;
  return { weight: current ? state.weight : null, ambiguous: current && state.ambiguous, loaded: current };
}

/** Состояние Health Connect у привязанной карточки (UIX-17): служба и разрешения; `null` — ещё проверяется. */
function useHealthReady(platform: HealthConnectPort, store: HealthStorePort, linked: boolean): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);
  // Привязка и синхронизация публикуются после коммита: статус перепроверяется, когда разрешения уже выданы.
  useEffect(() => store.subscribeCommittedChanges(() => setTick((value) => value + 1)), [store]);
  useEffect(() => {
    if (!linked) { setReady(null); return undefined; }
    let active = true;
    void (async () => {
      const availability = await platform.availability();
      const granted = availability === "AVAILABLE" ? await platform.grantedMetrics() : [];
      if (active) setReady(availability === "AVAILABLE" && granted.length > 0);
    })().catch(() => { if (active) setReady(false); });
    return () => { active = false; };
  }, [platform, linked, tick]);
  return ready;
}

const wholeNumber = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/gu, "\u00A0");

/** Кружок показателя дня (макет): дуга своего цвета, число внутри, значок и подпись ниже; нажатие открывает ввод или связанный экран. */
function DayRing({ label, unit, caption, icon: Icon, color, value, fraction, disabled = false, hint, onPress }: Readonly<{
  label: string; unit?: string; caption: string; icon: LucideIcon; color: string; value: string | null; fraction: number | null; disabled?: boolean; hint: string; onPress: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value === null ? "нет данных" : `${value}${unit === undefined ? "" : ` ${unit}`}`}`} accessibilityHint={hint} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.ring, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}>
      <View importantForAccessibility="no-hide-descendants">
        <SegmentedRing size={62} stroke={6} fraction={fraction} segments={[{ weight: 1, color }]} accessibilityLabel={label}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.ringNumber, { color: colors.textPrimary }]}>{value ?? "—"}</Text>
        </SegmentedRing>
      </View>
      <View style={styles.ringCaptionRow} importantForAccessibility="no-hide-descendants">
        <Icon size={13} color={colors.textSecondary} strokeWidth={2} />
        <Text numberOfLines={1} style={[styles.ringCaption, { color: colors.textSecondary }]}>{caption}</Text>
      </View>
    </Pressable>
  );
}

/** Ячейка показателя дня в общей плашке (значение крупно, подпись под ним); без `onPress` — только значение. */
function DayPlate({ label, value, disabled = false, hint, onPress, onChart }: Readonly<{
  label: string; value: string | null; disabled?: boolean; hint: string; onPress?: () => void;
  /** Значок графика в углу ячейки: открывает статистику показателя (нажатие на саму ячейку по-прежнему вводит значение). */
  onChart?: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const content = <>
    <Text numberOfLines={1} style={[styles.plateValue, { color: value === null ? colors.textMuted : colors.textPrimary }]}>{value ?? "—"}</Text>
    <Text numberOfLines={1} style={[styles.plateLabel, { color: colors.textSecondary }]}>{label}</Text>
  </>;
  // Без действия — обычный блок, а не «недоступная кнопка» для TalkBack.
  if (onPress === undefined) return <View accessible accessibilityLabel={`${label}: ${value ?? "нет данных"}`} accessibilityHint={hint} style={[styles.plateWrap, styles.plate]}>{content}</View>;
  return (
    <View style={styles.plateWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? "нет данных"}`} accessibilityHint={hint} disabled={disabled} onPress={onPress} hitSlop={{ top: 6, bottom: 6 }}
        style={({ pressed }) => [styles.plate, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}>
        {content}
      </Pressable>
      {onChart === undefined ? null : (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: открыть график и статистику`} onPress={onChart} style={styles.chartIcon}>
          <TrendingUp size={16} color={colors.accentInk} />
        </Pressable>
      )}
    </View>
  );
}

const midpoint = (range: Readonly<{ minX10: number; maxX10: number }>) => (range.minX10 + range.maxX10) / 2;

/**
 * Блоки питания на главной клиента (UX 2.0, §49.5.4, AUD-05): «Данные дня» (вес, шаги, тренировка; суточный ориентир с поправкой по динамике веса за 7 дней) и «КБЖУ» (ориентир, кольцо
 * «съедено от цели» из трёх цветов Б/Ж/У, «съедено / цель» по каждому макро, ручная корректировка). Источники — Nutrition, Measurements и дневник тренировок; legacy `client_kbju_state` не используется.
 * `trainedToday` — факт тренировки из дневника тренировок (авто «Да»), `null` — неизвестно.
 */
export function NutritionHomeCards({ clientId, body, diary, targets, calc, measurements, trainedToday, workoutsThisWeek, onOpenMetric, onOpenWeightStats, onSaveProfile, onOpenJournal, health, onOpenHealth }: Readonly<{ clientId: string; body: CalcClientBody; diary: NutritionDiaryPort;
  targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; trainedToday: boolean | null;
  /** Тренировок за текущую неделю Пн–Вс по дневнику; `null` — нет данных (не 0). */ workoutsThisWeek: number | null;
  /** Кружок показателя открывает его экран с графиком (UIX-08). */ onOpenMetric: (metric: MetricId) => void;
  /** Значок графика у «Вес»: статистика веса и % жира. */ onOpenWeightStats: () => void;
  /** Health Connect: сон выбранного дня и состояние подключения (UIX-16/17); `linked` — эта карточка привязана «для себя». */
  health: Readonly<{ store: HealthStorePort; platform: HealthConnectPort; linked: boolean; sync: () => Promise<HealthSyncResult> }>;
  /** Открыть карточку клиента, где подключается Health Connect. */
  onOpenHealth: () => void;
  /** Лист «Расчёт»: сохранение профиля и переход в журнал замеров (оболочка клиента). */
  onSaveProfile: SaveCalcProfile; onOpenJournal: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const macroColors = useMacroColors();
  const { day, today, future } = useClientDay();
  const { loaded, guide, defaults, leanMassKg, tdee } = useNutritionGuide(clientId, body, calc, measurements);
  const { data, stale } = useNutritionDay(clientId, day, diary, targets);
  const stepsToday = useTodaySteps(clientId, calc, day);
  const sleepDay = useHealthDaily(health.store, clientId, "SLEEP_MIN", day, day);
  const sleepHours = sleepDay === null || future ? null : (sleepDay.get(day) ?? null) === null ? null : (sleepDay.get(day) as number) / 60;
  const healthReady = useHealthReady(health.platform, health.store, health.linked);
  const mark = useTodayWorkoutMark(clientId, calc, day);
  const dayWeight = useDayWeight(clientId, measurements, day);
  const [mode, setMode] = useState<TargetMode>("EXACT");
  /** Живая цель из ячеек ручной корректировки (расчёт или правка тренера). */
  const [liveTarget, setLiveTarget] = useState<Corridors | null>(null);
  const [sheet, setSheet] = useState<"weight" | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const saveLock = useRef(false);
  const recordWeight = useCallback((valueX100: number, localDate: string) => upsertDailyMeasurement(measurements, clientId, { type: "WEIGHT", valueX100, localDate, localMinute: null }), [measurements, clientId]);

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

  /** Вес выбранного дня из листа: ошибка возвращается в лист, а не теряет введённое. */
  const saveWeight = useCallback(async (text: string): Promise<string | null> => {
    if (saveLock.current) return "Идёт сохранение, повторите через секунду.";
    saveLock.current = true;
    const result = await saveDayData({ clientId, calc, recordWeight }, { localDate: day,
      weight: text, steps: null, workout: null })
      .finally(() => { saveLock.current = false; });
    const messages = Object.values(result);
    return messages.length === 0 ? null : messages.join(" ");
  }, [clientId, calc, recordWeight, day]);

  // Данные предыдущего дня (stale) не показываются как данные выбранного: кольцо и «съедено» остаются пустыми, пока день не загрузился.
  const fresh = data !== null && !stale;
  const recorded = fresh && data.summary.state === "FOOD_RECORDED";
  /** Ориентир по калориям: цель тренера (коридор Б/Ж/У → ккал), иначе суточный ориентир расчёта. */
  const liveKcal = liveTarget?.kcal ?? null;
  const kcalRange = rangeText(liveKcal);
  const orientText = liveTarget !== null ? kcalRange : (guide === null ? null : String(guide));
  const orientMiddle = liveTarget !== null ? (liveKcal === null ? null : midpoint(liveKcal) / 10) : guide;
  const eaten = (metric: "kcal" | "protein" | "fat" | "carbs"): number | null => (recorded ? data.summary.totals[NUTRIENT_OF[metric]] : null);
  const eatenKcalX10 = eaten("kcal");
  const fraction = eatenKcalX10 === null || orientMiddle === null || orientMiddle <= 0 ? null : eatenKcalX10 / 10 / orientMiddle;
  /** Дуга делится по калориям съеденных белков, жиров и углеводов (4/9/4). */
  const segments = (["protein", "fat", "carbs"] as const).map((metric) => ({ weight: (eaten(metric) ?? 0) * KCAL_PER_G[metric], color: macroColors[metric] }));
  /** Съедено Б/Ж/У для полос: день не загрузился — «нет данных», еды нет — 0. */
  const eatenGrams = (metric: "protein" | "fat" | "carbs"): number | null => (!fresh ? null : !recorded ? 0 : eaten(metric));
  const eatenByMacro = { protein: eatenGrams("protein"), fat: eatenGrams("fat"), carbs: eatenGrams("carbs") };
  const sourceHint = future ? "только питание" : health.linked && healthReady !== false ? "Health Connect" : null;

  return (
    <>
      <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.label, { color: colors.textMuted }]}>Данные дня</Text>
          {sourceHint === null ? null : <Text style={[styles.hint, { color: colors.textSecondary }]}>{sourceHint}</Text>}
        </View>
        <View style={styles.rings}>
          <DayRing label="Шаги" unit="шагов" caption="Шаги" icon={Footprints} color={colors.accentFill}
            value={future || !stepsToday.loaded || stepsToday.steps === null ? null : wholeNumber(stepsToday.steps)}
            fraction={future ? null : goalFraction(stepsToday.steps, STEPS_GOAL)} hint="Открыть график шагов" onPress={() => onOpenMetric("steps")} />
          {/* Сон приходит из Health Connect (ADR-059, UIX-16/17): до подключения экран сна показывает пустое состояние. */}
          <DayRing label="Сон" unit="часов" caption="Сон" icon={Moon} color={colors.success} value={sleepHours === null ? null : (Math.round(sleepHours * 10) / 10).toFixed(1).replace(".", ",")}
            fraction={goalFraction(sleepHours, SLEEP_GOAL_HOURS)} hint="Открыть график сна" onPress={() => onOpenMetric("sleep")} />
          <DayRing label="Расход" unit="ккал" caption="Расход" icon={Flame} color={colors.warning} value={tdee === null ? null : wholeNumber(tdee)} fraction={null}
            hint="Открыть график расхода" onPress={() => onOpenMetric("expenditure")} />
          <DayRing label="Приёмы" caption="Приёмы" icon={Utensils} color={colors.accentFill} value={!fresh ? null : String(mealCount(data.summary))}
            fraction={!fresh ? null : goalFraction(mealCount(data.summary), MEALS_GOAL)} hint="Открыть график приёмов пищи" onPress={() => onOpenMetric("meals")} />
        </View>
        <View style={[styles.plates, { backgroundColor: colors.surfaceRaised }]}>
          <DayPlate label="Вес, кг" value={future || dayWeight.weight === null ? null : String(dayWeight.weight).replace(".", ",")} disabled={future}
            hint="Ввести вес за день" onPress={() => setSheet("weight")} onChart={onOpenWeightStats} />
          <DayPlate label="Тренировка" value={future ? null : trainingState ? "Да" : "Нет"} disabled={future || trainingAuto}
            hint={trainingAuto ? "Отмечено по дневнику тренировок" : "Отметить тренировку: да или нет"} onPress={() => { void cycleTraining(); }} />
          <DayPlate label="На неделе" value={workoutsThisWeek === null ? null : String(workoutsThisWeek)} disabled hint="Тренировок за неделю по дневнику" />
        </View>
        {/* Предложение подключить Health Connect (UIX-FIT-10, M7): пока он не привязан ни к одной карточке. */}
        <HealthConnectBanner clientId={clientId} store={health.store} platform={health.platform} sync={health.sync} />
        {health.linked && healthReady === false ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Health Connect не подключён. Открыть карточку клиента" onPress={onOpenHealth}
            style={[styles.healthNotice, { backgroundColor: colors.surfaceRaised }]}>
            <Text style={[styles.hint, { color: colors.textPrimary }]}>Health Connect не подключён: шаги и сон не обновляются. Нажмите, чтобы открыть карточку и дать доступ.</Text>
          </Pressable>
        ) : null}
        {dayWeight.ambiguous ? <Text style={[styles.hint, { color: colors.textSecondary }]}>За этот день несколько записей веса: основную выбирают в журнале замеров.</Text> : null}
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </View>
      <CalcSheet visible={calcOpen} clientId={clientId} body={body} onSaveProfile={onSaveProfile} calc={calc} measurements={measurements}
        onClose={() => setCalcOpen(false)} />
      <ValueSheet visible={sheet === "weight"} title="Вес за день" label="Вес" unit="кг" keyboardType="decimal-pad" placeholder="85,45" emptyMessage="Введите вес."
        initial={dayWeight.weight === null ? "" : String(dayWeight.weight).replace(".", ",")} onSave={saveWeight} onClose={() => setSheet(null)} />

      <View style={[styles.card, styles.cardTight, shadow.card, { backgroundColor: colors.surface }]}>
        <View style={styles.head}>
          <View style={[styles.group, { backgroundColor: colors.surfaceRaised }]}>
            {([["EXACT", "Точно"], ["RANGE", "Коридор"]] as const).map(([id, label]) => (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: mode === id }} accessibilityLabel={`Режим цели: ${label}`} hitSlop={{ top: 8, bottom: 8 }} onPress={() => setMode(id)}
                style={[styles.segment, mode === id ? { backgroundColor: colors.accentFill } : null]}>
                <Text style={[styles.segmentText, { color: mode === id ? colors.onAccentFill : colors.textSecondary }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Расчёт калорий и БЖУ" hitSlop={{ top: 8, bottom: 8 }} onPress={() => setCalcOpen(true)}
            style={[styles.calcPill, { borderColor: colors.accentInk }]}>
            <Text style={[styles.segmentText, { color: colors.accentInk }]}>Расчёт ›</Text>
          </Pressable>
        </View>
        <View style={styles.summary}>
          <SegmentedRing size={76} stroke={9} fraction={fraction} segments={segments} accessibilityLabel={`От цели по калориям: ${fraction === null ? "нет данных" : `${Math.round(fraction * 100)} процентов`}`}>
            <Text style={[styles.ringValue, { color: colors.textPrimary }]}>{fraction === null ? "—" : `${Math.round(fraction * 100)}%`}</Text>
          </SegmentedRing>
          <View style={styles.guide} accessible accessibilityLabel={`Суточный ориентир: ${orientText === null ? "нет данных" : `${orientText} ккал`}`}>
            <Text style={[styles.bigNumber, { color: colors.textPrimary }]}>{orientText ?? "—"}</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{orientText === null ? "суточный ориентир" : "ккал · суточный ориентир"}</Text>
          </View>
        </View>
        {loaded !== null && loaded.fat === null ? (
          <Pressable accessibilityRole="link" accessibilityLabel="Рассчитать процент жира" onPress={() => setCalcOpen(true)}
            style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Для расчёта БЖУ нужен процент жира. Его можно рассчитать в «Расчёте».</Text>
          </Pressable>
        ) : null}
        <NutritionTargetRows key={clientId} clientId={clientId} targets={targets} calories={guide} defaults={defaults} leanMassKg={leanMassKg} mode={mode} onModeAutoChange={setMode} onLiveTarget={setLiveTarget}
          eaten={eatenByMacro} macroColors={macroColors} />
      </View>
      <MeasurementsCard day={day} future={future} clientId={clientId} repository={measurements} onOpenJournal={onOpenJournal} />
    </>
  );
}

const styles = StyleSheet.create({
  /** Карточка как у «Абонемента» (UI-OWN-067): радиус 26, отступ 14, без рамки. */
  card: { borderRadius: 26, padding: 12, gap: 10 },
  cardTight: { gap: 8 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.66, textTransform: "uppercase" },
  rings: { flexDirection: "row", gap: 6 },
  ring: { flex: 1, minWidth: 0, minHeight: 48, alignItems: "center", gap: 4 },
  ringNumber: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, paddingHorizontal: 4, textAlign: "center" },
  ringCaptionRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  ringCaption: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, flexShrink: 1 },
  healthNotice: { borderRadius: 18, padding: 12, minHeight: 48, justifyContent: "center" },
  /** Одна плашка с тремя равными ячейками «Вес · Тренировка · На неделе». */
  plates: { flexDirection: "row", borderRadius: 20, paddingVertical: 8 },
  plateWrap: { flex: 1, flexBasis: 0, minWidth: 0 },
  chartIcon: { position: "absolute", top: -4, right: 0, width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  plate: { flex: 1, flexBasis: 0, minWidth: 0, minHeight: 38, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  plateLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, textAlign: "center" },
  plateValue: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, textAlign: "center" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  group: { flexDirection: "row", alignItems: "center", borderRadius: 999, padding: 2 },
  segment: { minHeight: 30, paddingHorizontal: 12, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  calcPill: { minHeight: 30, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  guide: { flex: 1, minWidth: 0, gap: 2 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12 },
  bigNumber: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, fontVariant: ["tabular-nums"] },
  ringValue: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20 },
});
