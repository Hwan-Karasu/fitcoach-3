import { startTransition, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Check, ChevronDown, Undo2 } from "lucide-react-native";
import { AppButton } from "../../../shared/ui/components/public.ts";
import { CalendarPager } from "../../../shared/ui/components/CalendarPager.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { monthOffset, monthPage, monthRange, monthStart, shiftMonth, weekOf, weekOffset } from "../domain/DiaryCalendar.ts";
import type { NutritionDiaryPort } from "../domain/NutritionDiaryPort.ts";
import { dayTitle, shiftDate } from "./nutritionFormat.ts";

const weekdayShort = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;
const MONTH_SPAN = 120;
const WEEK_SPAN = 520;
const emptyDates: ReadonlySet<string> = new Set();

/** Preload marks for visible and adjacent pages; water-only days remain unmarked (§49.22). */
function useAccountedRange(clientId: string, diary: NutritionDiaryPort, from: string, to: string, enabled = true): ReadonlySet<string> {
  const [dates, setDates] = useState<Readonly<{ clientId: string; set: ReadonlySet<string> }>>({ clientId: "", set: emptyDates });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void diary.listAccountedDates(clientId, from, to).then((found) => {
      if (active) setDates({ clientId, set: new Set(found) });
    }, () => undefined);
    return () => { active = false; };
  }, [clientId, diary, from, to, tick, enabled]);
  useEffect(() => enabled ? diary.subscribeCommittedChanges((change) => {
    if (change.clientId === clientId && change.scope !== "WATER") setTick((value) => value + 1);
  }) : undefined, [clientId, diary, enabled]);
  // Preserve marks while browsing, but never show another client's marks.
  return dates.clientId === clientId ? dates.set : emptyDates;
}

function DayNumber({ text, marked, selected, today, textStyle }: Readonly<{
  text: number; marked: boolean; selected: boolean; today: boolean; textStyle: object;
}>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  return <View style={styles.dayCircle}>
    <Text style={[textStyle, { color: selected ? colors.onAccentFill : today ? colors.accentInk : colors.textPrimary }]}>{text}</Text>
    <View style={styles.marker}>{marked ? <Check size={10} strokeWidth={3} color={selected ? colors.onAccentFill : colors.accentInk} /> : null}</View>
  </View>;
}

/** Same native pager as the appointment month: the title/grid slide; the modal frame/footer stay still. */
function MonthModal({ visible, clientId, diary, selected, today, month, onBrowse, onSelect, onClose }: Readonly<{
  visible: boolean; clientId: string; diary: NutritionDiaryPort; selected: string; today: string; month: string;
  onBrowse: (month: string) => void; onSelect: (date: string) => void; onClose: () => void;
}>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const [base] = useState(month);
  const marks = useAccountedRange(clientId, diary, monthRange(shiftMonth(month, -1)).from, monthRange(shiftMonth(month, 1)).to, visible);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable accessibilityLabel="Закрыть календарь" style={styles.backdrop} onPress={onClose}>
      <Pressable accessible={false} style={[styles.dialog, { backgroundColor: colors.surface }]} onPress={() => undefined}>
        <CalendarPager page={monthOffset(base, month) + MONTH_SPAN} pageCount={MONTH_SPAN * 2 + 1}
          height={348} testID="nutrition-month-pager"
          onPageChange={(index) => onBrowse(shiftMonth(base, index - MONTH_SPAN))}
          renderPage={(index, width) => {
            const pageMonth = shiftMonth(base, index - MONTH_SPAN);
            const [year, number] = pageMonth.split("-").map(Number) as [number, number];
            return <View style={{ width }}>
              <Text accessibilityRole="adjustable" accessibilityLabel={`${monthNames[number - 1]} ${year} г.`}
                accessibilityActions={[{ name: "increment", label: "Следующий месяц" }, { name: "decrement", label: "Предыдущий месяц" }]}
                onAccessibilityAction={(event) => onBrowse(shiftMonth(pageMonth, event.nativeEvent.actionName === "increment" ? 1 : -1))}
                style={[styles.monthTitle, { color: colors.textPrimary }]}>{`${monthNames[number - 1]} ${year} г.`}</Text>
              <View style={styles.weekRow}>{weekdayShort.map((label) => <Text key={label} style={[styles.weekday, { color: colors.textMuted }]}>{label}</Text>)}</View>
              {monthPage(pageMonth).map((week) => <View key={week[0]} style={styles.weekRow}>
                {week.map((date) => <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: date === selected }}
                  accessibilityLabel={`${dayTitle(date, today)}${marks.has(date) ? ", есть записи о еде" : ""}`}
                  onPress={() => { onSelect(date); onClose(); }}
                  style={[styles.cell, date === selected ? { backgroundColor: colors.accentFill, borderRadius: 14 } : null,
                    date.slice(0, 7) !== pageMonth ? { opacity: 0.55 } : null]}>
                  <DayNumber text={Number(date.slice(8, 10))} marked={marks.has(date)} selected={date === selected}
                    today={date === today} textStyle={styles.cellText} />
                </Pressable>)}
              </View>)}
            </View>;
          }} />
        <View style={styles.footer}>
          <AppButton compact variant="secondary" label="Сегодня" onPress={() => { onSelect(today); onClose(); }} />
          <AppButton compact variant="ghost" label="Закрыть" onPress={onClose} />
        </View>
      </Pressable>
    </Pressable>
  </Modal>;
}

/** N02 / P-10,P-11: native paging matches appointments, while date/food ownership stays in nutrition. */
export function DiaryWeekHeader({ clientId, diary, localDate, today, onSelect: onSelectDate }: Readonly<{
  clientId: string; diary: NutritionDiaryPort; localDate: string; today: string; onSelect: (date: string) => void;
}>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const { width } = useWindowDimensions();
  const [calendar, setCalendar] = useState(false);
  const [month, setMonth] = useState(monthStart(localDate));
  const [baseWeek] = useState(localDate);
  const [shown, setShown] = useState(localDate);
  const [seen, setSeen] = useState(localDate);
  if (localDate !== seen) { setSeen(localDate); setShown(localDate); }
  const onSelect = (date: string) => { setShown(date); startTransition(() => onSelectDate(date)); };
  const week = useMemo(() => weekOf(shown), [shown]);
  const marks = useAccountedRange(clientId, diary, shiftDate(week[0]!, -7), shiftDate(week[6]!, 7));
  return <View style={[styles.card, { backgroundColor: colors.surface }]}>
    <View style={styles.head}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${dayTitle(shown, today)}. Открыть календарь`}
        style={styles.calendarButton} hitSlop={8}
        onPress={() => { setMonth(monthStart(shown)); setCalendar(true); }}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Календарь</Text>
        <ChevronDown size={18} color={colors.textPrimary} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.dayTitle, { color: colors.textSecondary }]}>{dayTitle(shown, today)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к сегодняшнему дню" disabled={shown === today}
        onPress={() => onSelect(today)} style={({ pressed }) => [styles.today, {
          backgroundColor: pressed ? colors.surfaceRaised : colors.accentSoft, opacity: shown === today ? 0.45 : 1 }]}>
        <Undo2 size={13} color={colors.accentInk} />
        <Text style={[styles.todayText, { color: colors.accentInk }]}>Сегодня</Text>
      </Pressable>
    </View>
    <CalendarPager page={weekOffset(baseWeek, shown) + WEEK_SPAN} pageCount={WEEK_SPAN * 2 + 1}
      initialWidth={Math.max(0, width - 44)} height={56} testID="nutrition-week-pager"
      onPageChange={(index, previous) => onSelect(shiftDate(shown, (index - previous) * 7))}
      renderPage={(index, pageWidth) => {
        const dates = weekOf(shiftDate(baseWeek, (index - WEEK_SPAN) * 7));
        return <View style={[styles.strip, { width: pageWidth }]}>
          {dates.map((date, at) => {
            const active = date === shown;
            return <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${dayTitle(date, today)}${marks.has(date) ? ", есть записи о еде" : ""}`}
              onPress={() => onSelect(date)} style={[styles.day, active ? { backgroundColor: colors.accentFill, borderRadius: 16 } : null]}>
              <Text style={[styles.dayName, { color: active ? colors.onAccentFill : colors.textMuted }]}>{weekdayShort[at]}</Text>
              <DayNumber text={Number(date.slice(8, 10))} marked={marks.has(date)} selected={active} today={date === today} textStyle={styles.dayNumber} />
            </Pressable>;
          })}
        </View>;
      }} />
    <MonthModal visible={calendar} clientId={clientId} diary={diary} selected={shown} today={today} month={month}
      onBrowse={setMonth} onSelect={onSelect} onClose={() => setCalendar(false)} />
  </View>;
}

const styles = StyleSheet.create({
  card: { ...shadow.card, borderRadius: 18, paddingHorizontal: 6, paddingVertical: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  calendarButton: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20 },
  dayTitle: { flex: 1, textAlign: "right", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  today: { minHeight: 30, paddingHorizontal: 7, borderRadius: 15, flexDirection: "row", alignItems: "center", gap: 3 },
  todayText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  strip: { flexDirection: "row", alignItems: "center" },
  day: { flex: 1, minHeight: 56, paddingTop: 5, paddingBottom: 3, alignItems: "center", justifyContent: "center" },
  dayCircle: { minWidth: 34, minHeight: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  dayName: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  dayNumber: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  marker: { height: 10, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { borderRadius: 24, padding: 14, gap: 4 },
  monthTitle: { height: 36, textAlign: "center", fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, paddingVertical: 4 },
  cell: { flex: 1, height: 48, alignItems: "center", justifyContent: "center" },
  cellText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  footer: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
});
