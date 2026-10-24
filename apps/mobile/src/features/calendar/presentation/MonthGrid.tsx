import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarPager } from "../../../shared/ui/components/CalendarPager.tsx";
import { Undo2 } from "lucide-react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { LocalDate } from "../domain/CalendarModel.ts";
import { addMonths, monthGridWeeks } from "../domain/CalendarGeometry.ts";
import { addDays, mondayOf } from "../domain/CalendarRules.ts";
import { dayTitle, monthTitle, weekdayShort } from "./calendarPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";

/** Сколько месяцев в каждую сторону можно пролистать от текущего. */
const SPAN = 120;
export const CARD_PADDING = 6;

function monthIndex(base: LocalDate, month: LocalDate): number {
  return (Number(month.slice(0, 4)) - Number(base.slice(0, 4))) * 12
    + Number(month.slice(5, 7)) - Number(base.slice(5, 7)) + SPAN;
}

type Props = Readonly<{
  /** Ширина области ленты, вычисленная из размера окна: лента строится сразу, а не после измерения (карточка не схлопывается). */
  initialWidth?: number;
  viewMonth: LocalDate;
  selected: LocalDate;
  today: LocalDate;
  counts: ReadonlyMap<LocalDate, number>;
  onBrowse: (firstOfMonth: LocalDate) => void;
  onSelect: (date: LocalDate) => void;
  /** Вернуться к текущему месяцу и сегодняшнему дню. */
  onToday: () => void;
}>;

/** Одна страница-месяц: заголовок, дни недели и сетка дат в рамках «число + записей». */
const MonthPage = memo(function MonthPage({ month, width, selected, today, counts, onSelect, onBrowse }: Readonly<{
  month: LocalDate; width: number; selected: LocalDate; today: LocalDate; counts: ReadonlyMap<LocalDate, number>;
  onSelect: (date: LocalDate) => void; onBrowse: (firstOfMonth: LocalDate) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  // Всегда 6 недель (как в привычных календарях): недостающая строка — дни следующего месяца.
  const weeks = useMemo(() => {
    const grid: LocalDate[][] = monthGridWeeks(month).map((week) => [...week]);
    while (grid.length < 6) {
      const last = grid[grid.length - 1]?.[6] ?? month;
      grid.push(Array.from({ length: 7 }, (_, at) => addDays(last, at + 1)));
    }
    return grid;
  }, [month]);
  const inMonthKey = month.slice(0, 7);
  const selectedMonday = mondayOf(selected);
  return (
    <View style={{ width }}>
      {/* Без стрелок: TalkBack листает месяцы жестами вверх/вниз на заголовке. */}
      <Text accessibilityRole="adjustable" accessibilityLabel={monthTitle(month)}
        accessibilityActions={[{ name: "increment", label: "Следующий месяц" }, { name: "decrement", label: "Предыдущий месяц" }]}
        onAccessibilityAction={(event) => onBrowse(addMonths(month, event.nativeEvent.actionName === "increment" ? 1 : -1))}
        style={[styles.title, { color: colors.textPrimary }]}>{monthTitle(month)}</Text>
      <View style={styles.row}>
        {weekdayShort.map((label) => (
          <Text key={label} style={[styles.weekday, { color: colors.textMuted }]}>{label}</Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={[styles.row, styles.week,
          week[0] === selectedMonday ? { backgroundColor: colors.surfaceRaised } : null]}>
          {week.map((date) => {
            const inMonth = date.slice(0, 7) === inMonthKey;
            const isSelected = date === selected;
            const isToday = date === today;
            const count = counts.get(date) ?? 0;
            const ink = isSelected ? colors.onAccentFill : inMonth ? colors.textPrimary : colors.textMuted;
            return (
              <Pressable key={date} accessibilityRole="button" onPress={() => onSelect(date)}
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${dayTitle(date)}${isToday ? ", сегодня" : ""}, записей: ${count}`}
                style={styles.cell}>
                <View style={[styles.dayBox, {
                  backgroundColor: isSelected ? colors.accentFill : "transparent",
                  borderColor: isToday && !isSelected ? colors.accentInk : "transparent",
                  borderWidth: 2,
                  opacity: inMonth ? 1 : 0.55,
                }]}>
                  <Text style={[styles.date, { color: ink, fontFamily: isToday || isSelected ? fonts.bold : fonts.medium }]}>
                    {Number(date.slice(8, 10))}
                  </Text>
                  <Text style={[styles.count, { color: isSelected ? colors.onAccentFill : colors.accentInk }]}>
                    {count > 0 ? count : " "}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

/**
 * §13.2 Month Grid: месяцы листаются только свайпом (без стрелок, решение владельца). Лента страниц —
 * горизонтальный FlatList с постраничной прокруткой: соседние месяцы отрисованы заранее, рамка
 * остаётся на месте. Тап выбирает дату; Today, Selected Date и Selected Week — отдельные состояния.
 */
export function MonthGrid({ initialWidth = 0, viewMonth, selected, today, counts, onBrowse, onSelect, onToday }: Props) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [base] = useState(() => `${today.slice(0, 7)}-01`);
  const target = monthIndex(base, viewMonth);
  const atToday = selected === today && viewMonth.slice(0, 7) === today.slice(0, 7);
  const renderMonth = useCallback((item: number, width: number) => (
    <MonthPage month={addMonths(base, item - SPAN)} width={width} selected={selected} today={today}
      counts={counts} onSelect={onSelect} onBrowse={onBrowse} />
  ), [base, counts, onBrowse, onSelect, selected, today]);

  return (
    <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
      {/* Ширина страницы = точная ширина области ленты: иначе доли пикселя копятся по страницам и месяц съезжает. */}
      <CalendarPager page={target} pageCount={SPAN * 2 + 1} initialWidth={initialWidth}
        onPageChange={(index) => onBrowse(addMonths(base, index - SPAN))} renderPage={renderMonth} />
      {/* «Сегодня» стоит на месте в строке заголовка, а название месяца листается со страницей. */}
      <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к текущему месяцу и сегодняшнему дню"
        disabled={atToday} onPress={onToday} hitSlop={6}
        style={({ pressed }) => [styles.today, {
          backgroundColor: pressed ? colors.surfaceRaised : colors.accentSoft, opacity: atToday ? 0.45 : 1 }]}>
        <Undo2 size={14} color={colors.accentInk} strokeWidth={2.2} />
        <Text style={[styles.todayText, { color: colors.accentInk }]}>Сегодня</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: CARD_PADDING, overflow: "hidden" },
  title: { height: 32, fontSize: 16, lineHeight: 21, fontFamily: fonts.bold, paddingLeft: 6, paddingRight: 110 },
  today: { position: "absolute", top: CARD_PADDING, right: CARD_PADDING + 2, height: 32, borderRadius: 16,
    paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 5 },
  todayText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  row: { flexDirection: "row" },
  week: { borderRadius: 8 },
  weekday: { flex: 1, textAlign: "center", fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, textTransform: "uppercase" },
  cell: { flex: 1, padding: 2 },
  dayBox: { height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  date: { fontSize: 14, lineHeight: 17 },
  count: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bold },
});
