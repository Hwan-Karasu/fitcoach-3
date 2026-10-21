import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { AppButton, AppIconButton, ChoiceSegments, InlineNotice, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { dailyPoints, type ClientMeasurements, type MeasurementRepositoryPort } from "../../measurements/public.ts";
import { monthGrid, monthRange, monthStart, shiftMonth } from "../domain/DiaryCalendar.ts";
import type { NutritionCalcPort, StepsDay, WorkoutMark } from "../domain/NutritionCalcPort.ts";
import { saveDayData, type DayDataErrors, type DayDataPorts, type WorkoutChoice } from "./dayData.ts";
import { dayTitle } from "./nutritionFormat.ts";

const weekdayShort = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;
const workoutItems = [{ id: "NONE", label: "Нет данных" }, { id: "YES", label: "Да" }, { id: "NO", label: "Нет" }] as const;

interface MonthData { readonly key: string; readonly body: ClientMeasurements; readonly steps: readonly StepsDay[]; readonly marks: readonly WorkoutMark[] }

/** Значения месяца для календаря и редактора; обновляются при фиксации изменений клиента в расчёте или замерах, подписки снимаются в cleanup. */
function useMonthData(clientId: string, calc: NutritionCalcPort, measurements: MeasurementRepositoryPort, month: string, enabled: boolean): MonthData | null {
  const [data, setData] = useState<MonthData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const { from, to } = monthRange(month);
    void Promise.all([measurements.listForClient(clientId), calc.listSteps(clientId, from, to), calc.listWorkoutMarks(clientId, from, to)]).then(([body, steps, marks]) => {
      if (active) setData({ key: `${clientId}|${month}`, body, steps, marks });
    }, () => undefined);
    return () => { active = false; };
  }, [clientId, calc, measurements, month, tick, enabled]);
  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = (change: { readonly clientId: string }) => { if (change.clientId === clientId) setTick((value) => value + 1); };
    const offCalc = calc.subscribeCommittedChanges(refresh);
    const offMeasurements = measurements.subscribeCommittedChanges(refresh);
    return () => { offCalc(); offMeasurements(); };
  }, [clientId, calc, measurements, enabled]);
  return data !== null && data.key === `${clientId}|${month}` ? data : null;
}

/** Редактор одной даты: вес, шаги, тренировка. Каждое поле записывается отдельно (`saveDayData`); ошибка одного не блокирует остальные. */
function DayEditor({ date, today, data, ports, onBack }: Readonly<{ date: string; today: string; data: MonthData; ports: DayDataPorts; onBack: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const point = dailyPoints(data.body.measurements, data.body.primaries, "WEIGHT").find((candidate) => candidate.localDate === date);
  const storedWeight = point !== undefined && point.kind === "VALUE" ? String(point.measurement.valueX10 / 10).replace(".", ",") : "";
  const storedSteps = data.steps.find((row) => row.localDate === date)?.steps;
  const storedMark = data.marks.find((row) => row.localDate === date);
  const storedWorkout: WorkoutChoice = storedMark === undefined ? "NONE" : storedMark.done ? "YES" : "NO";
  const [weight, setWeight] = useState(storedWeight);
  const [steps, setSteps] = useState(storedSteps === undefined ? "" : String(storedSteps));
  const [workout, setWorkout] = useState<WorkoutChoice>(storedWorkout);
  const [errors, setErrors] = useState<DayDataErrors>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const ambiguous = point !== undefined && point.kind === "AMBIGUOUS";

  const save = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setSaved(false);
    // Пишется только изменённое: без правки не растут ревизии фактов.
    const result = await saveDayData(ports, { localDate: date,
      weight: ambiguous || weight.trim().replace(",", ".") === storedWeight.replace(",", ".") ? null : weight,
      steps: steps.trim() === (storedSteps === undefined ? "" : String(storedSteps)) ? null : steps,
      workout: workout === storedWorkout ? null : workout });
    setErrors(result);
    setSaved(Object.keys(result).length === 0);
    lock.current = false; setBusy(false);
  };

  return (
    <View style={styles.editor}>
      <AppButton compact variant="ghost" label="← К календарю" onPress={onBack} />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{dayTitle(date, today)}</Text>
      {ambiguous ? <InlineNotice kind="info">За эту дату несколько записей веса. Основную выбирают в журнале замеров.</InlineNotice> : null}
      <TextField label="Вес, кг" value={weight} keyboardType="decimal-pad" disabled={busy || ambiguous} error={errors.weight} placeholder="85,4"
        onChangeText={(value) => { setWeight(value); setSaved(false); }} />
      <TextField label="Шаги" value={steps} keyboardType="number-pad" disabled={busy} error={errors.steps} placeholder="8000"
        onChangeText={(value) => { setSteps(value); setSaved(false); }} />
      <ChoiceSegments label="Тренировка" items={workoutItems} value={workout} disabled={busy} onChange={(next) => { setWorkout(next); setSaved(false); }} />
      {errors.workout !== undefined ? <InlineNotice kind="error">{errors.workout}</InlineNotice> : null}
      {saved ? <InlineNotice kind="success">Сохранено.</InlineNotice> : null}
      <AppButton label="Сохранить" busy={busy} onPress={() => { void save(); }} />
    </View>
  );
}

/**
 * Журнал данных дня (вес, шаги, тренировка): календарь месяца с отметками дат, где есть значения; нажатие на дату открывает редактор этой даты.
 * Прошлые даты вносятся здесь; будущие недоступны. Ввод ручной — позже сюда же придут шаги из приложений и часов.
 */
export function DayDataJournal({ visible, clientId, today, calc, measurements, recordWeight, onClose }: Readonly<{ visible: boolean; clientId: string; today: string; calc: NutritionCalcPort;
  measurements: MeasurementRepositoryPort; recordWeight: DayDataPorts["recordWeight"]; onClose: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [month, setMonth] = useState(monthStart(today));
  const [selected, setSelected] = useState<string | null>(null);
  const data = useMonthData(clientId, calc, measurements, month, visible);
  const grid = useMemo(() => monthGrid(month), [month]);
  const ports = useMemo<DayDataPorts>(() => ({ clientId, calc, recordWeight }), [clientId, calc, recordWeight]);
  const marked = useMemo(() => {
    const dates = new Set<string>();
    if (data === null) return dates;
    for (const point of dailyPoints(data.body.measurements, data.body.primaries, "WEIGHT")) dates.add(point.localDate);
    for (const row of data.steps) dates.add(row.localDate);
    for (const row of data.marks) dates.add(row.localDate);
    return dates;
  }, [data]);
  const [year, number] = month.split("-").map(Number) as [number, number];
  const close = () => { setSelected(null); setMonth(monthStart(today)); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {selected !== null && data !== null ? <DayEditor key={selected} date={selected} today={today} data={data} ports={ports} onBack={() => setSelected(null)} /> : <>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Журнал данных дня</Text>
              <View style={styles.monthHead}>
                <AppIconButton label="Предыдущий месяц" icon={<ChevronLeft size={22} color={colors.textPrimary} />} onPress={() => setMonth(shiftMonth(month, -1))} />
                <Text accessibilityRole="header" style={[styles.monthTitle, { color: colors.textPrimary }]}>{`${monthNames[number - 1]} ${year} г.`}</Text>
                <AppIconButton label="Следующий месяц" icon={<ChevronRight size={22} color={colors.textPrimary} />} onPress={() => setMonth(shiftMonth(month, 1))} />
              </View>
              <View style={styles.weekRow}>{weekdayShort.map((label) => <Text key={label} style={[styles.weekday, { color: colors.textMuted }]}>{label}</Text>)}</View>
              {grid.map((row, index) => (
                <View key={index} style={styles.weekRow}>
                  {row.map((date, column) => {
                    if (date === null) return <View key={column} style={styles.cell} />;
                    const future = date > today;
                    const has = marked.has(date);
                    return (
                      <Pressable key={date} accessibilityRole="button" disabled={future || data === null} accessibilityState={{ disabled: future || data === null }}
                        accessibilityLabel={`${dayTitle(date, today)}${has ? ", есть данные" : ", данных нет"}`} onPress={() => setSelected(date)}
                        style={[styles.cell, date === today ? { borderColor: colors.accentInk, borderWidth: 1, borderRadius: 14 } : null, future ? { opacity: 0.35 } : null]}>
                        <Text style={[styles.cellText, { color: colors.textPrimary }]}>{Number(date.slice(8, 10))}</Text>
                        <View style={[styles.dot, has ? { backgroundColor: colors.accentFill } : null]} />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              <Text style={[styles.hint, { color: colors.textSecondary }]}>Точка — в этот день есть вес, шаги или отметка тренировки. Нажмите на дату, чтобы посмотреть и изменить.</Text>
              <AppButton variant="ghost" label="Закрыть" onPress={close} />
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 14, maxHeight: "94%" },
  body: { gap: 6 },
  editor: { gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  monthHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, paddingVertical: 4 },
  cell: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 2 },
  cellText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, paddingTop: 6 },
});
