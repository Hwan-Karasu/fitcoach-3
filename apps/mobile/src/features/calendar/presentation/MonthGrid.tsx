import { useMemo, useRef } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { LocalDate } from "../domain/CalendarModel.ts";
import { addMonths, monthGridWeeks } from "../domain/CalendarGeometry.ts";
import { mondayOf } from "../domain/CalendarRules.ts";
import { dayTitle, monthTitle, weekdayShort } from "./calendarPresentation.ts";

/**
 * §13.2 Month Grid: a compact date navigator. Swipe or arrows only browse months; a tap selects a
 * date (a neighbour-month tap also moves the viewport). Today, Selected Date and Selected Week are
 * three separate states; the indicator counts appointments, not people.
 */
export function MonthGrid({ viewMonth, selected, today, counts, onBrowse, onSelect }: Readonly<{
  viewMonth: LocalDate;
  selected: LocalDate;
  today: LocalDate;
  counts: ReadonlyMap<LocalDate, number>;
  onBrowse: (firstOfMonth: LocalDate) => void;
  onSelect: (date: LocalDate) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const weeks = useMemo(() => monthGridWeeks(viewMonth), [viewMonth]);
  const month = viewMonth.slice(0, 7);
  const selectedMonday = mondayOf(selected);
  const browse = useRef(onBrowse);
  browse.current = onBrowse;
  const current = useRef(viewMonth);
  current.current = viewMonth;
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) > 50) browse.current(addMonths(current.current, gesture.dx < 0 ? 1 : -1));
    },
  }), []);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Предыдущий месяц" hitSlop={8}
          onPress={() => onBrowse(addMonths(viewMonth, -1))} style={styles.arrowButton}>
          <Text style={[styles.arrow, { color: colors.accentInk }]}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{monthTitle(viewMonth)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Следующий месяц" hitSlop={8}
          onPress={() => onBrowse(addMonths(viewMonth, 1))} style={styles.arrowButton}>
          <Text style={[styles.arrow, { color: colors.accentInk }]}>›</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        {weekdayShort.map((label) => (
          <Text key={label} style={[styles.weekday, { color: colors.textMuted }]}>{label}</Text>
        ))}
      </View>
      <View {...swipe.panHandlers}>
        {weeks.map((week) => {
          const selectedWeek = week[0] === selectedMonday;
          return (
            <View key={week[0]} style={[styles.row, styles.week,
              selectedWeek ? { backgroundColor: colors.surfaceRaised } : null]}>
              {week.map((date) => {
                const inMonth = date.slice(0, 7) === month;
                const isSelected = date === selected;
                const count = counts.get(date) ?? 0;
                return (
                  <Pressable key={date} accessibilityRole="button" onPress={() => onSelect(date)}
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${dayTitle(date)}${date === today ? ", сегодня" : ""}, записей: ${count}`}
                    style={styles.cell}>
                    <View style={[styles.dateBubble, {
                      backgroundColor: isSelected ? colors.accentFill : "transparent",
                      borderColor: date === today ? colors.accentInk : "transparent",
                    }]}>
                      <Text style={[styles.date, {
                        color: isSelected ? colors.onAccentFill : inMonth ? colors.textPrimary : colors.textMuted,
                        fontWeight: date === today || isSelected ? "700" : "500",
                      }]}>{Number(date.slice(8, 10))}</Text>
                    </View>
                    <Text style={[styles.count, { color: inMonth ? colors.accentInk : colors.textMuted }]}>
                      {count > 0 ? count : " "}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 6, paddingVertical: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrowButton: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  arrow: { fontSize: 26, lineHeight: 30 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  row: { flexDirection: "row" },
  week: { borderRadius: 10 },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, lineHeight: 16 },
  cell: { flex: 1, alignItems: "center", paddingVertical: 2, minHeight: 44 },
  dateBubble: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  date: { fontSize: 14, lineHeight: 18 },
  count: { fontSize: 10, lineHeight: 12, fontWeight: "700" },
});
