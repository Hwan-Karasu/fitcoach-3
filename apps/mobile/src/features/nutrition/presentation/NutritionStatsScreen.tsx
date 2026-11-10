import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, EmptyState, InlineNotice, LineChart, LoadingState, SegmentedControl } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { dailyPoints, formatDate, statsOfPoints, type ClientMeasurements, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { shiftIsoDate } from "../domain/DayNavigation.ts";
import { useToday } from "./useToday.ts";

type StatType = "WEIGHT" | "BODY_FAT";
type PeriodId = "week" | "month" | "quarter" | "year" | "all";
const TYPES = [{ id: "WEIGHT", label: "Вес" }, { id: "BODY_FAT", label: "% жира" }] as const;
const PERIODS: readonly Readonly<{ id: PeriodId; label: string; days: number }>[] = [
  { id: "week", label: "Неделя", days: 7 }, { id: "month", label: "Месяц", days: 30 }, { id: "quarter", label: "3 мес.", days: 90 },
  { id: "year", label: "Год", days: 365 }, { id: "all", label: "Всё", days: 0 },
];
const UNIT: Readonly<Record<StatType, string>> = { WEIGHT: "кг", BODY_FAT: "%" };
const LAST_VALUES = 8;

const decimal = (valueX10: number) => (valueX10 / 10).toFixed(1).replace(".", ",");
const signed = (valueX10: number) => `${valueX10 > 0 ? "+" : valueX10 < 0 ? "−" : ""}${decimal(Math.abs(valueX10))}`;
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
 * «Питание → Статистика»: вес и % жира (UIX-09, UI-OWN-075) — «Сейчас» и изменение за период, линия по известным значениям, плитки «Начало / Среднее / Минимум»
 * и список последних значений. Статистика питания (КБЖУ) находится на экране «Приёмы». Дни с несколькими записями без выбранной основной в расчёт не входят;
 * основную выбирают в журнале замеров («Все записи»).
 */
export function NutritionStatsScreen({ clientId, measurements, onOpenJournal, initialType = "WEIGHT" }: Readonly<{ clientId: string; measurements: MeasurementRepositoryPort;
  onOpenJournal: () => void; initialType?: StatType }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const today = useToday();
  const [type, setType] = useState<StatType>(initialType);
  const [period, setPeriod] = useState<PeriodId>("month");
  const [state, setState] = useState<Readonly<{ clientId: string; data: ClientMeasurements }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void measurements.listForClient(clientId).then((data) => { if (active) { setState({ clientId, data }); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [measurements, clientId, tick]);
  useEffect(() => measurements.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [measurements, clientId]);

  const data = state !== null && state.clientId === clientId ? state.data : null;
  const days = PERIODS.find((item) => item.id === period)!.days;
  const from = days === 0 ? "0001-01-01" : shiftIsoDate(today, -(days - 1));
  const points = useMemo(() => data === null ? [] : dailyPoints(data.measurements, data.primaries, type).filter((point) => point.localDate >= from && point.localDate <= today), [data, type, from, today]);
  const stats = useMemo(() => statsOfPoints(points), [points]);
  const line = useMemo(() => points.flatMap((point) => point.kind === "VALUE" ? [{ key: point.localDate, label: shortDate(point.localDate), caption: point.localDate, value: point.measurement.valueX10 / 10 }] : []), [points]);
  const unit = UNIT[type];
  const label = type === "WEIGHT" ? "Вес" : "Процент жира";

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
      <SegmentedControl compact fit items={TYPES} selectedId={type} onSelect={setType} />
      <SegmentedControl compact fit items={PERIODS} selectedId={period} onSelect={setPeriod} />
      {data === null ? failed ? <View><InlineNotice kind="error">Не удалось загрузить замеры.</InlineNotice><AppButton label="Повторить" onPress={() => setTick((value) => value + 1)} /></View>
        : <LoadingState label="Загружаем замеры…" /> : stats.count === 0 && stats.ambiguousDays === 0
        ? <EmptyState reason="no-data" title="Нет данных" body={`За выбранный период нет значений: ${label.toLowerCase()}. Добавьте замер на главной клиента.`} /> : (
          <>
            {failed ? <InlineNotice kind="error">Не удалось обновить замеры. Показаны последние загруженные данные.</InlineNotice> : null}
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>Сейчас</Text>
              <View accessible accessibilityLabel={stats.nowX10 === null ? `${label}: нет данных` : `${label}: ${decimal(stats.nowX10)} ${unit}${stats.changeX10 === null ? "" : `, изменение за период ${signed(stats.changeX10)} ${unit}`}`}
                style={styles.nowRow}>
                <Text style={[styles.big, { color: stats.nowX10 === null ? colors.textMuted : colors.textPrimary }]}>{stats.nowX10 === null ? "—" : decimal(stats.nowX10)}</Text>
                <Text style={[styles.unit, { color: colors.textSecondary }]}>{unit}</Text>
                {stats.changeX10 === null ? null : <Text style={[styles.change, { color: colors.textSecondary }]}>{`${signed(stats.changeX10)} ${unit} за период`}</Text>}
              </View>
              {line.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Нет определённых значений за период.</Text>
                : <LineChart points={line} format={(value) => String(Math.round(value * 10) / 10)} formatValue={(value) => `${String(Math.round(value * 10) / 10).replace(".", ",")} ${unit}`}
                  title={label} accessibilityLabel={`${label}: динамика по известным значениям`} />}
              <View style={styles.tiles}>
                <Tile label="Начало" value={stats.startX10 === null ? "—" : `${decimal(stats.startX10)} ${unit}`} />
                <Tile label="Среднее" value={stats.averageX10 === null ? "—" : `${decimal(stats.averageX10)} ${unit}`} />
                <Tile label="Минимум" value={stats.minX10 === null ? "—" : `${decimal(stats.minX10)} ${unit}`} />
              </View>
              {stats.ambiguousDays > 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Дней с несколькими записями без основной: ${stats.ambiguousDays}. Они не входят в расчёт — основную выбирают в журнале замеров.`}</Text> : null}
            </View>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.heading, { color: colors.textPrimary }]}>Последние значения</Text>
              {[...points].reverse().slice(0, LAST_VALUES).map((point) => (
                <View key={point.localDate} accessible accessibilityLabel={point.kind === "VALUE" ? `${formatDate(point.localDate)}: ${decimal(point.measurement.valueX10)} ${unit}` : `${formatDate(point.localDate)}: несколько записей, основная не выбрана`}
                  style={[styles.valueRow, { borderColor: colors.border }]}>
                  <Text style={[styles.valueDate, { color: colors.textSecondary }]}>{formatDate(point.localDate)}</Text>
                  <Text style={[styles.valueText, { color: point.kind === "VALUE" ? colors.textPrimary : colors.textMuted }]}>{point.kind === "VALUE" ? `${decimal(point.measurement.valueX10)} ${unit}` : "несколько записей"}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      <AppButton variant="secondary" label="Все записи" accessibilityLabel="Открыть журнал замеров: все записи, правка и выбор основной" onPress={onOpenJournal} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { ...shadow.card, borderRadius: 26, padding: 16, gap: 10 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  nowRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 8 },
  big: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, fontVariant: ["tabular-nums"] },
  unit: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  change: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minWidth: 0, borderRadius: 18, padding: 10, gap: 2 },
  tileLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  tileValue: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, fontVariant: ["tabular-nums"] },
  valueRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  valueDate: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  valueText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, fontVariant: ["tabular-nums"] },
});
