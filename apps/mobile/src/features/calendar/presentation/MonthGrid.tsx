import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { LocalDate } from "../domain/CalendarModel.ts";
import { addMonths, monthGridWeeks } from "../domain/CalendarGeometry.ts";
import { addDays, mondayOf } from "../domain/CalendarRules.ts";
import { dayTitle, monthTitle, weekdayShort } from "./calendarPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

/** Сколько месяцев в каждую сторону можно пролистать от текущего. */
const SPAN = 120;
const CARD_PADDING = 6;

function monthIndex(base: LocalDate, month: LocalDate): number {
  return (Number(month.slice(0, 4)) - Number(base.slice(0, 4))) * 12
    + Number(month.slice(5, 7)) - Number(base.slice(5, 7)) + SPAN;
}

type Props = Readonly<{
  viewMonth: LocalDate;
  selected: LocalDate;
  today: LocalDate;
  counts: ReadonlyMap<LocalDate, number>;
  onBrowse: (firstOfMonth: LocalDate) => void;
  onSelect: (date: LocalDate) => void;
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
                  backgroundColor: isSelected ? colors.accentFill : colors.surface,
                  borderColor: isSelected ? colors.accentFill : isToday ? colors.accentInk : colors.border,
                  borderWidth: isToday && !isSelected ? 2 : 1,
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
export function MonthGrid({ viewMonth, selected, today, counts, onBrowse, onSelect }: Props) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [width, setWidth] = useState(0);
  const [base] = useState(() => `${today.slice(0, 7)}-01`);
  const list = useRef<FlatList<number>>(null);
  const shown = useRef(monthIndex(base, viewMonth));
  const data = useMemo(() => Array.from({ length: SPAN * 2 + 1 }, (_, at) => at), []);
  const target = monthIndex(base, viewMonth);

  // Месяц сменился не свайпом (тап по соседней дате, «Сегодня») — прокручиваем ленту к нему.
  useEffect(() => {
    if (width === 0 || target === shown.current) return;
    shown.current = target;
    list.current?.scrollToIndex({ index: target, animated: true });
  }, [target, width]);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width - 2 * CARD_PADDING - 2)}>
      {width > 0 ? (
        <FlatList ref={list} data={data} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => String(item)} initialScrollIndex={target} windowSize={3}
          initialNumToRender={1} maxToRenderPerBatch={2}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={(event) => {
            const index = Math.round(event.nativeEvent.contentOffset.x / width);
            if (index === shown.current) return;
            shown.current = index;
            onBrowse(addMonths(base, index - SPAN));
          }}
          renderItem={({ item }) => (
            <MonthPage month={addMonths(base, item - SPAN)} width={width} selected={selected} today={today}
              counts={counts} onSelect={onSelect} onBrowse={onBrowse} />
          )} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: CARD_PADDING, overflow: "hidden" },
  title: { fontSize: 15, lineHeight: 22, fontFamily: fonts.bold, textAlign: "center", paddingBottom: 4 },
  row: { flexDirection: "row" },
  week: { borderRadius: 8 },
  weekday: { flex: 1, textAlign: "center", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  cell: { flex: 1, padding: 2 },
  dayBox: { height: 42, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  date: { fontSize: 14, lineHeight: 17 },
  count: { fontSize: 10, lineHeight: 12, fontFamily: fonts.bold },
});
