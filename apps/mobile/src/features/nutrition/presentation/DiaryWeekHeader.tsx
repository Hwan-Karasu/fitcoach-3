import { useEffect, useMemo, useState } from "react";
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react-native";
import { AppButton, AppIconButton } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { accountedDates } from "../domain/DiaryRules.ts";
import { monthGrid, monthRange, monthStart, shiftMonth, weekOf } from "../domain/DiaryCalendar.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import { dayTitle, shiftDate } from "./nutritionFormat.ts";

const weekdayShort = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;
const SWIPE_PX = 48;

/** Даты диапазона, где у клиента есть пищевые записи (критерий «дня с учётом», §49.22); обновляется при фиксации изменений клиента, подписка снимается в cleanup. */
function useAccountedRange(clientId: string, diary: NutritionDiaryPort, from: string, to: string): ReadonlySet<string> {
  const [dates, setDates] = useState<Readonly<{ key: string; set: ReadonlySet<string> }>>({ key: "", set: new Set() });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void diary.listEntries(clientId, from, to).then((entries) => { if (active) setDates({ key: `${clientId}|${from}|${to}`, set: new Set(accountedDates(entries)) }); }, () => undefined);
    return () => { active = false; };
  }, [clientId, diary, from, to, tick]);
  useEffect(() => diary.subscribeCommittedChanges((change) => { if (change.clientId === clientId) setTick((value) => value + 1); }), [clientId, diary]);
  return dates.key === `${clientId}|${from}|${to}` ? dates.set : EMPTY;
}
const EMPTY: ReadonlySet<string> = new Set();

/** Число дня: день с записями о еде отмечен кружком-подложкой и точкой; выбранный день заливается акцентом (`selected`). */
function DayNumber({ text, marked, selected, today, textStyle }: Readonly<{ text: number; marked: boolean; selected: boolean; today: boolean; textStyle: object }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const ink = selected ? colors.onAccentFill : today ? colors.accentInk : colors.textPrimary;
  return (
    <View style={[styles.dayCircle, marked && !selected ? { backgroundColor: colors.accentSoft } : null]}>
      <Text style={[textStyle, { color: ink }]}>{text}</Text>
      <View style={[styles.marker, { backgroundColor: marked ? (selected ? colors.onAccentFill : colors.accentInk) : "transparent" }]} />
    </View>
  );
}

/** Месячный календарь в модальном окне: выбор месяца не меняет выбранную дату, выбор дня — меняет (P-11). */
function MonthModal({ visible, clientId, diary, selected, today, onSelect, onClose }: Readonly<{ visible: boolean; clientId: string; diary: NutritionDiaryPort; selected: string;
  today: string; onSelect: (localDate: string) => void; onClose: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [month, setMonth] = useState(monthStart(selected));
  const range = monthRange(month);
  const marks = useAccountedRange(clientId, diary, range.from, range.to);
  const grid = useMemo(() => monthGrid(month), [month]);
  const [year, number] = month.split("-").map(Number) as [number, number];
  return (
    <Modal visible={visible} transparent animationType="fade" onShow={() => setMonth(monthStart(selected))} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть календарь" style={styles.backdrop} onPress={onClose}>
        <Pressable accessible={false} style={[styles.dialog, { backgroundColor: colors.surface }]} onPress={() => undefined}>
          <View style={styles.monthHead}>
            <AppIconButton label="Предыдущий месяц" icon={<ChevronLeft size={22} color={colors.textPrimary} />} onPress={() => setMonth(shiftMonth(month, -1))} />
            <Text accessibilityRole="header" style={[styles.monthTitle, { color: colors.textPrimary }]}>{`${monthNames[number - 1]} ${year} г.`}</Text>
            <AppIconButton label="Следующий месяц" icon={<ChevronRight size={22} color={colors.textPrimary} />} onPress={() => setMonth(shiftMonth(month, 1))} />
          </View>
          <View style={styles.weekRow}>{weekdayShort.map((label) => <Text key={label} style={[styles.weekday, { color: colors.textMuted }]}>{label}</Text>)}</View>
          {grid.map((row, index) => (
            <View key={index} style={styles.weekRow}>
              {row.map((date, column) => date === null ? <View key={column} style={styles.cell} /> : (
                <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: date === selected }}
                  accessibilityLabel={`${dayTitle(date, today)}${marks.has(date) ? ", есть записи о еде" : ""}`} onPress={() => { onSelect(date); onClose(); }}
                  style={[styles.cell, date === selected ? { backgroundColor: colors.accentFill, borderRadius: 14 } : null]}>
                  <DayNumber text={Number(date.slice(8, 10))} marked={marks.has(date)} selected={date === selected} today={date === today} textStyle={styles.cellText} />
                </Pressable>
              ))}
            </View>
          ))}
          <View style={styles.footer}>
            <AppButton compact variant="secondary" label="Сегодня" onPress={() => { onSelect(today); onClose(); }} />
            <AppButton compact variant="ghost" label="Закрыть" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Шапка дневника (P-10, P-11): «Календарь ▾», неделя из семи дней с выбранным днём и отметками дней с питанием, листание недель стрелками и свайпом.
 * Дата принадлежит экрану дневника, шапка только сообщает выбор.
 */
export function DiaryWeekHeader({ clientId, diary, localDate, today, onSelect }: Readonly<{ clientId: string; diary: NutritionDiaryPort; localDate: string; today: string; onSelect: (localDate: string) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [calendar, setCalendar] = useState(false);
  const week = useMemo(() => weekOf(localDate), [localDate]);
  const marks = useAccountedRange(clientId, diary, week[0] as string, week[6] as string);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx <= -SWIPE_PX) onSelectRef.current(shiftDate(dateRef.current, 7));
      else if (gesture.dx >= SWIPE_PX) onSelectRef.current(shiftDate(dateRef.current, -7));
    },
  }), []);
  const onSelectRef = useLatest(onSelect);
  const dateRef = useLatest(localDate);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${dayTitle(localDate, today)}. Открыть календарь`} style={styles.calendarButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => setCalendar(true)}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Календарь</Text>
          <ChevronDown size={18} color={colors.textPrimary} />
        </Pressable>
        <Text numberOfLines={1} style={[styles.dayTitle, { color: colors.textSecondary }]}>{dayTitle(localDate, today)}</Text>
      </View>
      <View style={styles.strip} {...pan.panHandlers}>
        <AppIconButton label="Предыдущая неделя" icon={<ChevronLeft size={20} color={colors.textSecondary} />} onPress={() => onSelect(shiftDate(localDate, -7))} />
        {week.map((date, index) => {
          const active = date === localDate;
          return (
            <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${dayTitle(date, today)}${marks.has(date) ? ", есть записи о еде" : ""}`}
              onPress={() => onSelect(date)} style={[styles.day, active ? { backgroundColor: colors.accentFill, borderRadius: 16 } : null]}>
              <Text style={[styles.dayName, { color: active ? colors.onAccentFill : colors.textMuted }]}>{weekdayShort[index]}</Text>
              <DayNumber text={Number(date.slice(8, 10))} marked={marks.has(date)} selected={active} today={date === today} textStyle={styles.dayNumber} />
            </Pressable>
          );
        })}
        <AppIconButton label="Следующая неделя" icon={<ChevronRight size={20} color={colors.textSecondary} />} onPress={() => onSelect(shiftDate(localDate, 7))} />
      </View>
      <MonthModal visible={calendar} clientId={clientId} diary={diary} selected={localDate} today={today} onSelect={onSelect} onClose={() => setCalendar(false)} />
    </View>
  );
}

/** Актуальное значение для колбэков жестов: жест создаётся один раз и не пересоздаётся при смене даты. */
function useLatest<T>(value: T): { readonly current: T } {
  const [box] = useState<{ current: T }>(() => ({ current: value }));
  box.current = value;
  return box;
}

const styles = StyleSheet.create({
  card: { ...shadow.card, borderRadius: 18, paddingHorizontal: 6, paddingVertical: 4, gap: 0 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 6 },
  calendarButton: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20 },
  dayTitle: { flex: 1, textAlign: "right", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  strip: { flexDirection: "row", alignItems: "center" },
  day: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", gap: 0 },
  dayCircle: { minWidth: 34, minHeight: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  dayName: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  dayNumber: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  marker: { width: 4, height: 4, borderRadius: 2 },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 14, gap: 4 },
  monthHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, paddingVertical: 4 },
  cell: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 1 },
  cellText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  footer: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
});
