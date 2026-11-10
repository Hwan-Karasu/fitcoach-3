import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react-native";
import { AppButton, BarChart, BottomSheet, DateRangeCalendar, EmptyState, InlineNotice, LoadingState, ProgressBar, SegmentedControl } from "../../../shared/ui/components/public.ts";
import type { DateRange } from "../../../shared/ui/components/DateRangeCalendar.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { HealthStorePort } from "../../health/public.ts";
import type { MeasurementRepositoryPort } from "../../measurements/public.ts";
import { shiftIsoDate } from "../domain/DayNavigation.ts";
import { goalFraction, SLEEP_MIN_ADULT_HOURS } from "../domain/ActivityGoals.ts";
import { datesIn, periodLabel, recentMonths, spanOf, stepAnchor, summarizeSeries, type DateSpan, type MetricScale } from "../domain/MetricPeriods.ts";
import type { MetricId } from "../domain/MetricSeries.ts";
import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { MealMacroStats } from "./MealMacroStats.tsx";
import { saveDayData } from "./dayData.ts";
import { DayTabs } from "./DayTabs.tsx";
import { useClientDay } from "./ClientDay.tsx";
import type { CalcClientBody } from "./NutritionCalcScreen.tsx";
import { useMetricSeries } from "./useMetricSeries.ts";
import { useNutritionGuide } from "./useNutritionGuide.ts";
import { ValueSheet } from "./ValueSheet.tsx";

const SCALES: readonly Readonly<{ id: MetricScale; label: string }>[] = [
  { id: "DAY", label: "День" }, { id: "WEEK", label: "Неделя" }, { id: "MONTH", label: "Месяц" }, { id: "PERIOD", label: "Период" },
];

interface Info { readonly title: string; readonly unit: string; readonly bigCaption: string; readonly goalText: (goal: number) => string }
const spaced = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
const INFO: Readonly<Record<MetricId, Info>> = {
  steps: { title: "Шаги", unit: "шагов", bigCaption: "шагов в день", goalText: (goal) => `Цель: ${spaced(goal)} шагов` },
  sleep: { title: "Сон", unit: "ч", bigCaption: "часов сна", goalText: (goal) => `Цель: ${goal} ч, не менее ${SLEEP_MIN_ADULT_HOURS} ч для взрослых` },
  expenditure: { title: "Расход", unit: "ккал", bigCaption: "ккал в день", goalText: (goal) => `Расчётная норма: ${spaced(goal)} ккал` },
  meals: { title: "Приёмы пищи", unit: "приёмов", bigCaption: "приёмов в день", goalText: (goal) => `Цель: ${goal} приёма в день` },
};

/** Заголовок экрана показателя для шапки клиента. */
export const metricTitle = (metric: MetricId): string => INFO[metric].title;

const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

function Tile({ label, value }: Readonly<{ label: string; value: string }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
      <Text numberOfLines={1} style={[styles.tileLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.tileValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

/**
 * Экран показателя «Шаги / Сон / Расход / Приёмы» (UIX-08, UI-OWN-075): масштаб «День | Неделя | Месяц | Период», навигатор периода,
 * крупное число, график с целью пунктиром и три плитки. «День» — выбранный день клиента (общий с «Главной»), «Неделя» — понедельник–воскресенье,
 * «Месяц» — календарный, «Период» — диапазон из календаря. Почасовых данных нет (шаги и еда пишутся за день), поэтому «День» без графика.
 * Для будущего дня доступно только питание. Сон придёт из Health Connect (UIX-16): до этого — пустое состояние.
 */
export function MetricScreen({ metric, clientId, body, diary, targets, calc, measurements, health, onOpenDiary }: Readonly<{ metric: MetricId; clientId: string; body: CalcClientBody;
  /** Health Connect: сон и (у привязанной карточки) шаги приходят из него; ручного ввода шагов тогда нет. */
  health?: Readonly<{ store: HealthStorePort; linked: boolean }>;
  diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onOpenDiary: () => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const info = INFO[metric];
  const { day, today, setDay } = useClientDay();
  const [scale, setScale] = useState<MetricScale>("WEEK");
  const [anchor, setAnchor] = useState(day);
  const [custom, setCustom] = useState<DateSpan | null>(null);
  const [months, setMonths] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [draft, setDraft] = useState<DateRange>({ from: null, to: null });
  const [stepsSheet, setStepsSheet] = useState(false);
  const { tdee } = useNutritionGuide(clientId, body, calc, measurements);

  const span = useMemo(() => scale === "DAY" ? spanOf("DAY", day) : spanOf(scale, anchor, custom), [scale, day, anchor, custom]);
  const { data, failed } = useMetricSeries(metric, span, clientId, body, tdee, { diary, calc, measurements, ...(health === undefined ? {} : { health: health.store }) });
  const summary = useMemo(() => data === null ? null : summarizeSeries(data.values, span, metric === "sleep" ? 1 : 0), [data, span, metric]);
  const future = scale === "DAY" ? day > today : span.from > today;
  const futureBlocked = future && metric !== "meals";

  const chooseScale = (next: MetricScale) => {
    if (next === "PERIOD") {
      const initial = custom ?? spanOf("WEEK", scale === "DAY" ? day : anchor);
      setDraft({ from: initial.from, to: initial.to });
      setCalendar(true);
      return;
    }
    if (scale === "DAY" && next !== "DAY") setAnchor(day);
    setScale(next);
  };
  const stepPeriod = (direction: -1 | 1) => {
    // Выбранный период сдвигается на свою длину; опорная дата для него не используется.
    if (scale === "PERIOD" && custom !== null) {
      const length = datesIn(custom).length;
      setCustom({ from: shiftIsoDate(custom.from, direction * length), to: shiftIsoDate(custom.to, direction * length) });
      return;
    }
    setAnchor((current) => stepAnchor(scale, current, direction));
  };
  const nextDisabled = spanOf(scale, anchor, custom).to >= today;
  const rangeDays = draft.from === null || draft.to === null ? 0 : datesIn({ from: draft.from, to: draft.to }).length;

  const saveSteps = useCallback((text: string) => saveDayData({ clientId, calc, recordWeight: () => Promise.resolve() }, { localDate: day, weight: null, steps: text, workout: null })
    .then((errors) => { const messages = Object.values(errors); return messages.length === 0 ? null : messages.join(" "); }), [clientId, calc, day]);

  const dayValue = scale === "DAY" && summary !== null ? summary.days[0]?.value ?? null : null;
  const big = summary === null ? null : scale === "DAY" ? dayValue : metric === "meals" && summary.known > 0 ? summary.total / summary.known : summary.average;
  /** Приёмы в среднем — с десятой («3,5»), остальные показатели — целые. */
  /** Максимум/минимум по дням — значения отдельных дней: приёмы целые («5»), в отличие от среднего («4,5»). */
  const extremeText = (value: number) => metric === "sleep" ? bigText(value) : spaced(value);
  const bigText = (value: number) => metric === "sleep" || (metric === "meals" && scale !== "DAY") ? (Math.round(value * 10) / 10).toFixed(1).replace(".", ",") : spaced(value);
  const elapsedDays = summary === null ? 0 : summary.days.filter((entry) => entry.date <= today).length;
  const goal = data?.goal ?? null;
  const unitText = metric === "meals" ? "приёмов" : info.unit;

  const navigator = scale === "DAY" ? <DayTabs /> : (
    <View style={styles.navigator}>
      <Pressable accessibilityRole="button" accessibilityLabel="Предыдущий период" onPress={() => stepPeriod(-1)} style={[styles.arrow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <ChevronLeft size={22} color={colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Период: ${periodLabel(scale, span)}${scale === "MONTH" ? ". Выбрать месяц" : scale === "PERIOD" ? ". Выбрать даты" : ""}`}
        disabled={scale === "WEEK"} onPress={() => { if (scale === "MONTH") setMonths(true); else chooseScale("PERIOD"); }}
        style={[styles.periodPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text numberOfLines={1} style={[styles.periodText, { color: colors.textPrimary }]}>{periodLabel(scale, span)}</Text>
        {scale === "WEEK" ? null : <ChevronDown size={16} color={colors.textSecondary} />}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Следующий период" accessibilityState={{ disabled: nextDisabled }} disabled={nextDisabled} onPress={() => stepPeriod(1)}
        style={[styles.arrow, { backgroundColor: colors.surface, borderColor: colors.border, opacity: nextDisabled ? 0.4 : 1 }]}>
        <ChevronRight size={22} color={colors.textPrimary} />
      </Pressable>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {navigator}
      <SegmentedControl compact fit items={SCALES} selectedId={scale} onSelect={chooseScale} />

      {futureBlocked ? <EmptyState reason="no-data" title="Будущий день" body="Для будущего дня доступно только питание." />
        : failed && data === null ? <InlineNotice kind="error">Не удалось загрузить данные показателя.</InlineNotice>
            : summary === null ? <LoadingState label="Загружаем…" /> : (
              <View style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{info.title}</Text>
                <View accessible accessibilityLabel={big === null ? `${info.title}: нет данных` : `${info.title}: ${bigText(big)} ${unitText}${scale === "DAY" ? "" : " в среднем в день"}`} style={styles.bigRow}>
                  <Text style={[styles.big, { color: big === null ? colors.textMuted : colors.textPrimary }]}>{big === null ? "—" : bigText(big)}</Text>
                  <Text style={[styles.bigUnit, { color: colors.textSecondary }]}>{scale === "DAY" ? unitText : `${unitText} · в среднем в день`}</Text>
                </View>
                {scale === "DAY" ? (
                  <>
                    {goal === null ? null : <ProgressBar value={goalFraction(dayValue, goal)} accessibilityLabel={`${info.title}: доля цели`} />}
                    <Text style={[styles.empty, { color: colors.textMuted }]}>Почасовых данных нет: значение записывается за день.</Text>
                  </>
                ) : summary.known === 0 ? (metric === "meals" ? null : <Text style={[styles.empty, { color: colors.textSecondary }]}>{metric === "sleep" ? "Данных о сне нет: они приходят из Health Connect (подключение — в карточке клиента)." : "За выбранный период данных нет."}</Text>) : (
                  <BarChart goal={goal ?? undefined} items={summary.days.map((entry) => ({ key: entry.date, label: shortDate(entry.date), value: entry.value }))}
                    format={(value) => metric === "sleep" ? bigText(value) : spaced(value)} accessibilityLabel={`${info.title} по дням, дней с данными: ${summary.known}`}
                    onPressItem={(item) => { setDay(item.key); setScale("DAY"); }} />
                )}
                {goal === null ? null : <Text style={[styles.goal, { color: colors.textMuted }]}>{info.goalText(goal)}</Text>}
                {scale === "DAY" ? null : (
                  <View style={styles.tiles}>
                    <Tile label="Максимум" value={summary.max === null ? "—" : extremeText(summary.max)} />
                    <Tile label="Минимум" value={summary.min === null ? "—" : extremeText(summary.min)} />
                    <Tile label="Дней с данными" value={`${summary.known} из ${Math.max(elapsedDays, summary.known)}`} />
                  </View>
                )}
              </View>
            )}

      {metric === "meals" && !future ? <MealMacroStats clientId={clientId} body={body} span={span} diary={diary} targets={targets} calc={calc} measurements={measurements}
        onOpenDay={(date) => { setDay(date); setScale("DAY"); }} /> : null}
      {metric === "steps" && health?.linked === true ? <Text style={[styles.note, { color: colors.textMuted }]}>Шаги приходят из Health Connect; ручного ввода нет.</Text> : null}
      {metric === "steps" && scale === "DAY" && !future && health?.linked !== true ? <AppButton label={dayValue === null ? "Ввести шаги за день" : "Изменить шаги за день"} onPress={() => setStepsSheet(true)} /> : null}
      {metric === "meals" ? <AppButton variant="secondary" label="Открыть дневник питания" onPress={onOpenDiary} /> : null}
      {metric === "expenditure" ? <Text style={[styles.note, { color: colors.textMuted }]}>Расход дня — REE + NEAT по шагам этого дня + EAT. Дни без шагов в график не попадают.</Text> : null}

      <ValueSheet visible={stepsSheet} title="Шаги за день" label="Шаги" unit="шагов" keyboardType="number-pad" placeholder="8000"
        initial={dayValue === null ? "" : String(dayValue)} onSave={saveSteps} onClose={() => setStepsSheet(false)} />
      <BottomSheet visible={months} title="Месяц" onClose={() => setMonths(false)}>
        <View style={styles.monthList}>
          {recentMonths(today, 12).map((month) => (
            <Pressable key={month.anchor} accessibilityRole="button" accessibilityState={{ selected: month.anchor === span.from }} accessibilityLabel={month.label}
              onPress={() => { setAnchor(month.anchor); setMonths(false); }}
              style={[styles.monthRow, { backgroundColor: month.anchor === span.from ? colors.accentFill : colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.monthText, { color: month.anchor === span.from ? colors.onAccentFill : colors.textPrimary }]}>{month.label}</Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
      <Modal visible={calendar} transparent animationType="fade" onRequestClose={() => setCalendar(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Выберите период</Text>
            <DateRangeCalendar value={draft} max={today} onChange={setDraft} />
            {rangeDays > 366 ? <Text style={[styles.note, { color: colors.danger }]}>Период — до года.</Text> : null}
            <AppButton label="Показать период" disabled={rangeDays <= 0 || rangeDays > 366}
              onPress={() => { if (draft.from !== null && draft.to !== null) { setCustom({ from: draft.from, to: draft.to }); setScale("PERIOD"); setCalendar(false); } }} />
            <AppButton variant="ghost" label="Отмена" onPress={() => setCalendar(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  navigator: { flexDirection: "row", alignItems: "center", gap: 6 },
  arrow: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  periodPill: { flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12 },
  periodText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  card: { ...shadow.card, borderRadius: 26, padding: 16, gap: 12 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  bigRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 8 },
  big: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, fontVariant: ["tabular-nums"] },
  bigUnit: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  goal: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minWidth: 0, borderRadius: 18, padding: 10, gap: 2 },
  tileLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  tileValue: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, fontVariant: ["tabular-nums"] },
  monthList: { gap: 8 },
  monthRow: { minHeight: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  monthText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  backdrop: { flex: 1, padding: 16, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  dialog: { padding: 14, borderRadius: 26, gap: 8 },
});
