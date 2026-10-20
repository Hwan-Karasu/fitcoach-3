import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BarChart, EmptyState, InlineNotice, LoadingState, SegmentedControl } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { DiaryEntry } from "../domain/DiaryModel.ts";
import { computeNutritionStats } from "../domain/NutritionStats.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import { TARGET_METRICS, type TargetException, type TargetVersion } from "../domain/TargetModel.ts";
import { metricLabels, shiftDate, todayLocal, wholeText } from "./nutritionFormat.ts";

type PeriodId = "week" | "month" | "quarter";
const periods: readonly Readonly<{ id: PeriodId; label: string; days: number }>[] = [
  { id: "week", label: "Неделя", days: 7 }, { id: "month", label: "Месяц", days: 30 }, { id: "quarter", label: "3 месяца", days: 90 },
];
const unitOf = { kcal: "ккал", protein: "г", fat: "г", carbs: "г" } as const;

const percentText = (x10: number | null) => x10 === null ? "—" : `${String(x10 / 10).replace(".", ",")} %`;
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * «Статистика» питания клиента (§§49.22–49.23): среднее и доля попаданий в коридор по дням с учётом — это дни, где есть хотя бы одна пищевая запись.
 * Дни без еды и только с водой не входят; неизвестные значения не заменяются нулём. Всегда «по внесённым записям», не как доказанное полное потребление.
 */
export function NutritionStatsScreen({ clientId, diary, targets }: Readonly<{ clientId: string; diary: NutritionDiaryPort; targets: NutritionTargetsPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = todayLocal();
  const [period, setPeriod] = useState<PeriodId>("week");
  const [data, setData] = useState<Readonly<{ entries: readonly DiaryEntry[]; versions: readonly TargetVersion[]; exceptions: readonly TargetException[]; key: string }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const days = periods.find((item) => item.id === period)!.days;
  const from = shiftDate(today, -(days - 1));

  useEffect(() => {
    let active = true;
    void Promise.all([diary.listEntries(clientId, from, today), targets.listVersions(clientId), targets.listExceptions(clientId)]).then(([entries, versions, exceptions]) => {
      if (active) { setData({ entries, versions, exceptions, key: `${clientId}|${from}` }); setFailed(false); }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, diary, targets, from, today, tick]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const offDiary = diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    const offTargets = targets.subscribeCommittedChanges((change) => { if (change.clientId === clientId) refresh(); });
    return () => { offDiary(); offTargets(); };
  }, [clientId, diary, targets]);

  const stats = useMemo(() => data === null || data.key !== `${clientId}|${from}` ? null
    : computeNutritionStats({ from, to: today, entries: data.entries, versions: data.versions, exceptions: data.exceptions }), [data, clientId, from, today]);

  const control = <View style={styles.pad}><SegmentedControl items={periods} selectedId={period} onSelect={setPeriod} /></View>;
  if (stats === null) {
    return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{control}
      {failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить статистику питания.</InlineNotice></View> : <LoadingState label="Считаем статистику…" />}</View>;
  }
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
      {control}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Дней с записями о еде</Text>
        <Text style={[styles.big, { color: colors.textPrimary }]}>{`${stats.accountedDays} из ${stats.periodDays}`}</Text>
        <Text style={[styles.meta, { color: colors.textMuted }]}>По внесённым записям: данные могут быть неполными. Вода и пустые дни не учитываются.</Text>
      </View>
      {stats.accountedDays === 0 ? <EmptyState reason="no-data" title="Нет данных" body="За выбранный период нет пищевых записей. Статистика появится после добавления еды в дневник." /> : (
        <>
          {TARGET_METRICS.map((metric) => {
            const item = stats.metrics[metric];
            return (
              <View key={metric} accessible style={[styles.card, { backgroundColor: colors.surface }]}
                accessibilityLabel={`${metricLabels[metric]}: в среднем ${item.averageX10 === null ? "нет данных" : `${wholeText(item.averageX10)} ${unitOf[metric]}`}, попаданий в коридор ${item.compared === 0 ? "нет оценки" : `${item.inRange} из ${item.compared}`}`}>
                <Text style={[styles.heading, { color: colors.textPrimary }]}>{metricLabels[metric]}</Text>
                <Text style={[styles.big, { color: colors.textPrimary }]}>{item.averageX10 === null ? "—" : `${wholeText(item.averageX10)} ${unitOf[metric]}`}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {item.averageX10 === null ? "Среднее: нет данных" : `Среднее за ${item.daysWithValue} дн. с записями`}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {item.compared === 0 ? "В коридоре: — (нет целей или данных для сравнения)"
                    : `В коридоре: ${item.inRange} из ${item.compared} (${percentText(item.hitPercentX10)}) · ниже ${item.below} · выше ${item.above}`}</Text>
              </View>
            );
          })}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.heading, { color: colors.textPrimary }]}>Калории по дням</Text>
            <BarChart items={stats.days.map((day) => ({ key: day.localDate, label: shortDate(day.localDate), value: day.valuesX10.kcal === null ? null : Math.round(day.valuesX10.kcal / 10) }))}
              format={(value) => `${Math.round(value)} ккал`} accessibilityLabel={`Калории по дням, ${stats.accountedDays} дней с записями`} />
            <Text style={[styles.meta, { color: colors.textMuted }]}>Дни без записей — без столбца, а не ноль.</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingTop: 8 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 4 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  big: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
