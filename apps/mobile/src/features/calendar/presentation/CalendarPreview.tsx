import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyPanel, PrototypeNotice, PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";

const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const monthLabels = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
] as const;
const previewHours = ["09:00", "11:00", "13:00", "15:00", "17:00"] as const;

function startOfWeek(date: Date): Date {
  const mondayOffset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function CalendarPreview({ onOpenSettings }: Readonly<{ onOpenSettings: () => void }>) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const weekScrollRef = useRef<ScrollView>(null);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const week = useMemo(() => {
    const monday = startOfWeek(new Date());
    monday.setDate(monday.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, index) =>
      new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
  }, [weekOffset]);
  const selectedDate = week.find((date) => dateKey(date) === selectedDay) ?? week[0] ?? new Date();
  const monthName = monthLabels[selectedDate.getMonth()] ?? "месяц";

  const moveWeek = (delta: number) => {
    const nextOffset = weekOffset + delta;
    const nextMonday = startOfWeek(new Date());
    nextMonday.setDate(nextMonday.getDate() + nextOffset * 7);
    setWeekOffset(nextOffset);
    setSelectedDay(dateKey(nextMonday));
    weekScrollRef.current?.scrollTo({ x: 0, animated: false });
  };

  return (
    <PrototypeScreen>
      <View style={styles.titleRow}>
        <View style={styles.titleSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Настройки календаря"
          onPress={onOpenSettings}
          onFocus={() => setFocusedControl("settings")}
          onBlur={() => setFocusedControl((current) => current === "settings" ? null : current)}
          style={[styles.settingsButton, { borderColor: focusedControl === "settings" ? colors.focusRing : "transparent" }]}
        >
          <Text style={[styles.settingsGlyph, { color: colors.accentInk }]}>⚙</Text>
        </Pressable>
      </View>
      <View style={styles.weekHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Предыдущая неделя"
          onPress={() => moveWeek(-1)}
          onFocus={() => setFocusedControl("previous")}
          onBlur={() => setFocusedControl((current) => current === "previous" ? null : current)}
          style={[styles.arrowButton, { borderColor: focusedControl === "previous" ? colors.focusRing : "transparent" }]}
        >
          <Text style={[styles.arrow, { color: colors.accentInk }]}>‹</Text>
        </Pressable>
        <Text style={[styles.monthTitle, { color: colors.textPrimary }]}>{monthName} {selectedDate.getFullYear()}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Следующая неделя"
          onPress={() => moveWeek(1)}
          onFocus={() => setFocusedControl("next")}
          onBlur={() => setFocusedControl((current) => current === "next" ? null : current)}
          style={[styles.arrowButton, { borderColor: focusedControl === "next" ? colors.focusRing : "transparent" }]}
        >
          <Text style={[styles.arrow, { color: colors.accentInk }]}>›</Text>
        </Pressable>
      </View>
      <ScrollView
        ref={weekScrollRef}
        horizontal
        showsHorizontalScrollIndicator
        style={styles.weekScroll}
        contentContainerStyle={styles.weekRow}
      >
        {week.map((date, index) => {
          const key = dateKey(date);
          const focusKey = `day:${key}`;
          const selected = key === selectedDay;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${weekdayLabels[index] ?? "День"}, ${date.getDate()} ${monthLabels[date.getMonth()] ?? ""}`}
              accessibilityState={{ selected }}
              onPress={() => setSelectedDay(key)}
              onFocus={() => setFocusedControl(focusKey)}
              onBlur={() => setFocusedControl((current) => current === focusKey ? null : current)}
              style={[styles.day, {
                backgroundColor: selected ? colors.accentFill : colors.surface,
                borderColor: focusedControl === focusKey ? colors.focusRing : selected ? colors.accentFill : colors.border,
                borderWidth: focusedControl === focusKey ? 3 : 1,
              }]}
            >
              <Text style={[styles.weekday, { color: selected ? colors.onAccentFill : colors.textSecondary }]}>{weekdayLabels[index]}</Text>
              <Text style={[styles.dayNumber, {
                color: selected ? colors.onAccentFill : colors.textPrimary,
                textDecorationLine: selected ? "underline" : "none",
              }]}>{date.getDate()}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <SectionHeading>Рабочая сетка · {selectedDate.getDate()} {monthName}</SectionHeading>
      <View style={[styles.grid, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {previewHours.map((hour) => (
          <View key={hour} style={[styles.gridRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.hour, { color: colors.textMuted }]}>{hour}</Text>
            <View style={styles.gridSpace} />
          </View>
        ))}
      </View>
      <Text style={[styles.footnote, { color: colors.textMuted }]}>
        Часы здесь только демонстрируют сетку; рабочий интервал и Appointment будут приходить из локальных настроек и данных.
      </Text>
      <PrototypeNotice>
        Это макет навигации по датам. Записи и копирование недели пока не подключены.
      </PrototypeNotice>
    </PrototypeScreen>
  );
}

export function CalendarSettingsPreview() {
  return (
    <PrototypeScreen description="Локальные параметры отображения и работы календаря">
      <PrototypeNotice>
        Это только экран маршрута. Настройки рабочего интервала и отображения не записываются, пока не подключён Settings repository.
      </PrototypeNotice>
      <EmptyPanel
        title="Параметры пока не подключены"
        body="Доступ к настройкам остаётся внутри календаря. Текущие значения не подменяются демонстрационными."
      />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleSpacer: { flex: 1 },
  settingsButton: { width: 48, height: 48, borderWidth: 2, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  settingsGlyph: { fontSize: 26, lineHeight: 30 },
  weekHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  arrowButton: { width: 48, height: 48, borderWidth: 2, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  arrow: { fontSize: 30, lineHeight: 34 },
  monthTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  weekScroll: { flexGrow: 0 },
  weekRow: { flexDirection: "row", gap: 4, paddingBottom: 4 },
  day: { minWidth: 48, minHeight: 64, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 3 },
  weekday: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
  dayNumber: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  grid: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  gridRow: { minHeight: 54, borderBottomWidth: 1, flexDirection: "row", alignItems: "flex-start", paddingTop: 8 },
  hour: { width: 62, paddingLeft: 12, fontSize: 12, lineHeight: 16 },
  gridSpace: { flex: 1 },
  footnote: { fontSize: 12, lineHeight: 18 },
});
